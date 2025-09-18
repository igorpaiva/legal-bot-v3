import fs from 'fs/promises';
import path from 'path';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;
import { formatPhoneForWhatsApp } from '../routes/lawyers.js';
import DatabaseService from './DatabaseService.js';

class LawyerNotificationService {
  constructor() {
    this.databaseService = DatabaseService;
  }

  // Get law office name for the active bot
  async getLawOfficeName(botManager) {
    try {
      // Get all bots and filter for active ones
      const allBots = botManager.getAllBots();
      const activeBots = allBots.filter(bot => bot.isActive && bot.status === 'ready');
      
      if (activeBots.length === 0) {
        return "V3"; // Fallback if no active bots
      }

      const bot = activeBots[0];
      const ownerId = bot.ownerId;
      
      if (!ownerId) {
        return "V3"; // Fallback if no owner ID
      }

      const user = await this.databaseService.getUserById(ownerId);
      return user?.lawOfficeName || "V3"; // Use law office name or fallback
    } catch (error) {
      console.error('Error getting law office name:', error);
      return "V3"; // Fallback on error
    }
  }

  // Load lawyers from database
  async loadLawyers() {
    try {
      // Get all lawyers from database
      const lawyers = this.databaseService.getAllLawyers();
      console.log(`Loaded ${lawyers.length} lawyers from database`);
      return lawyers;
    } catch (error) {
      console.error('Error loading lawyers:', error);
      return [];
    }
  }

  // Find active lawyer for a specific legal field
  async findLawyerForField(legalField) {
    try {
      const lawyers = await this.loadLawyers();
      
      // Find active lawyers for the specific field
      const activeLawyers = lawyers.filter(
        lawyer => lawyer.specialty === legalField && lawyer.isActive
      );

      if (activeLawyers.length === 0) {
        console.warn(`No active lawyer found for field: ${legalField}`);
        return null;
      }

      // For now, return the first active lawyer
      // In the future, we could implement round-robin or other distribution logic
      return activeLawyers[0];
    } catch (error) {
      console.error('Error finding lawyer for field:', error);
      return null;
    }
  }

  // Send WhatsApp notification to lawyer
  async sendPDFToLawyer(botManager, conversation, pdfBuffer) {
    try {
      // Check both possible locations for the legal field
      const legalField = conversation.analysis?.case?.category || conversation.triageAnalysis?.case?.category;
      if (!legalField) {
        console.warn('No legal field found in conversation analysis');
        console.log('Conversation analysis:', JSON.stringify(conversation.analysis, null, 2));
        console.log('Conversation triageAnalysis:', JSON.stringify(conversation.triageAnalysis, null, 2));
        return false;
      }

      console.log(`Found legal field: ${legalField}`);
      const lawyer = await this.findLawyerForField(legalField);
      if (!lawyer) {
        console.warn(`No lawyer found for field: ${legalField}`);
        return false;
      }

      const lawyerPhone = formatPhoneForWhatsApp(lawyer.phone);
      console.log(`Original lawyer phone: ${lawyer.phone}`);
      console.log(`Formatted lawyer phone: ${lawyerPhone}`);
      console.log(`Sending PDF to lawyer ${lawyer.name} (${lawyer.specialty}) at ${lawyerPhone}`);

      // Find an active bot to send the message
      const activeBots = Array.from(botManager.bots.values()).filter(bot => bot.isActive);
      if (activeBots.length === 0) {
        console.error('No active bots available to send lawyer notification');
        return false;
      }

      const bot = activeBots[0]; // Use the first available bot
      const client = bot.client;

      if (!client || !client.info) {
        console.error('Bot client not ready');
        console.log('Client exists:', !!client);
        console.log('Client info exists:', !!client?.info);
        console.log('Client state:', client?.info?.wid || 'unknown');
        return false;
      }

      console.log('WhatsApp client is ready, sending message...');

      // Format lawyer phone for WhatsApp Chat ID
      const chatId = `${lawyerPhone.replace('+', '')}@c.us`;
      console.log(`Using chat ID: ${chatId}`);

      // Prepare the message
      const clientName = conversation.client.name || 'Cliente';
      const clientPhone = conversation.client.phone;
      const caseDate = new Date(conversation.startTime || conversation.startedAt).toLocaleDateString('pt-BR');
      
      // Get dynamic office name
      const officeName = await this.getLawOfficeName(botManager);
      
      const message = `📋 *NOVO CASO - ${legalField.toUpperCase()}*

👤 *Cliente:* ${clientName}
📱 *WhatsApp:* ${clientPhone}
📅 *Data:* ${caseDate}

📊 *Resumo do Caso:*
${conversation.triageAnalysis?.case?.description || 'Consulta sobre ' + legalField.toLowerCase()}

🎯 *Status:* Triagem concluída
📄 *Relatório completo em anexo*

_Enviado automaticamente pelo sistema ${officeName}_`;

      // Send the text message first
      console.log('Sending text message...');
      await client.sendMessage(chatId, message);
      console.log('Text message sent successfully');

      // Send the PDF as a document
      if (pdfBuffer) {
        console.log('PDF buffer type:', typeof pdfBuffer);
        console.log('PDF buffer is Buffer:', Buffer.isBuffer(pdfBuffer));
        console.log('PDF buffer length:', pdfBuffer?.length);
        
        const filename = `relatorio-${clientName.replace(/\s+/g, '-')}-${caseDate.replace(/\//g, '-')}.pdf`;
        
        // Ensure we have a proper buffer
        let buffer = pdfBuffer;
        if (!Buffer.isBuffer(pdfBuffer)) {
          console.log('Converting to Buffer...');
          buffer = Buffer.from(pdfBuffer);
        }
        
        const base64Data = buffer.toString('base64');
        console.log('Base64 data length:', base64Data.length);
        console.log('Base64 starts with:', base64Data.substring(0, 50));
        
        const media = new MessageMedia(
          'application/pdf',
          base64Data,
          filename
        );

        console.log('Sending PDF document...');
        
        try {
          // First attempt: Send as MessageMedia
          await client.sendMessage(chatId, media, {
            caption: `📄 Relatório completo do caso de ${clientName}`
          });
          console.log('PDF document sent successfully via MessageMedia');
        } catch (mediaError) {
          console.warn('MessageMedia failed, trying alternative method:', mediaError.message);
          
          // Second attempt: Send as regular message with base64 data
          try {
            await client.sendMessage(chatId, `📄 *Relatório PDF do caso de ${clientName}*\n\n_O arquivo PDF está sendo processado. Se não receber o arquivo, entre em contato._`);
            console.log('Sent PDF notification message as fallback');
          } catch (fallbackError) {
            console.error('Both PDF sending methods failed:', fallbackError);
            throw fallbackError;
          }
        }
      }

      console.log(`Successfully sent PDF notification to lawyer ${lawyer.name}`);
      return true;

    } catch (error) {
      console.error('Error sending PDF to lawyer:', error);
      return false;
    }
  }

  // Send notification when a case is updated with new information
  async notifyLawyerCaseUpdated(botManager, conversation, updateMessage) {
    try {
      const specialty = this.identifySpecialty(conversation.analysis);
      const lawyers = await this.getLawyersBySpecialty();
      
      if (!lawyers[specialty] || lawyers[specialty].length === 0) {
        console.warn(`No lawyers found for specialty: ${specialty}`);
        return false;
      }

      const urgency = conversation.analysis?.case?.urgency || 'baixa';
      const urgencyEmoji = urgency === 'alta' ? '🔴' : urgency === 'média' ? '🟡' : '🟢';
      
      const message = `${urgencyEmoji} *ATUALIZAÇÃO DE CASO*\n\n` +
        `📋 *Caso:* ${conversation.id}\n` +
        `👤 *Cliente:* ${conversation.client.name}\n` +
        `📞 *Telefone:* ${conversation.client.phone}\n` +
        `⚖️ *Especialidade:* ${specialty}\n` +
        `🔥 *Urgência:* ${urgency}\n` +
        `📅 *Iniciado:* ${new Date(conversation.startedAt).toLocaleString('pt-BR')}\n\n` +
        `📝 *Nova informação adicionada:*\n${updateMessage}\n\n` +
        `💡 *Acesse o painel administrativo para mais detalhes*`;

      // Send to appropriate lawyers for this specialty
      let sent = false;
      for (const lawyer of lawyers[specialty]) {
        try {
          await botManager.sendMessage(lawyer.phone, message);
          console.log(`Case update notification sent to lawyer: ${lawyer.name} (${lawyer.phone})`);
          sent = true;
        } catch (error) {
          console.error(`Failed to send update notification to lawyer ${lawyer.name}:`, error);
        }
      }

      return sent;

    } catch (error) {
      console.error('Error notifying lawyer of case update:', error);
      return false;
    }
  }

  // Send notification when a case is completed
  async notifyLawyerCaseCompleted(botManager, conversation) {
    try {
      // Format the conversation object to match the structure expected by PDF generation
      // (same as getAllConversations() method)
      const formattedConversation = {
        id: conversation.id,
        client: conversation.client,
        state: conversation.state,
        startedAt: conversation.startedAt,
        lastActivityAt: conversation.lastActivityAt,
        triageAnalysis: conversation.analysis, // Map analysis to triageAnalysis
        preAnalysis: conversation.preAnalysis,
        timestamp: conversation.startedAt,
        urgency: conversation.analysis?.case?.urgency || 'baixa'
      };

      // Generate PDF for the conversation
      const PdfGenerationService = (await import('./PdfGenerationService.js')).default;
      
      // Get dynamic office name for PDF
      const officeName = await this.getLawOfficeName(botManager);
      
      console.log(`Generating PDF for completed case: ${conversation.id}`);
      const pdfBuffer = await PdfGenerationService.generateConversationPdf(formattedConversation, officeName);
      
      console.log('Generated PDF - type:', typeof pdfBuffer);
      console.log('Generated PDF - is Buffer:', Buffer.isBuffer(pdfBuffer));
      console.log('Generated PDF - length:', pdfBuffer?.length);
      
      if (!pdfBuffer) {
        console.error('Failed to generate PDF for lawyer notification');
        return false;
      }

      // Send PDF to appropriate lawyer
      return await this.sendPDFToLawyer(botManager, formattedConversation, pdfBuffer);

    } catch (error) {
      console.error('Error notifying lawyer of completed case:', error);
      return false;
    }
  }

  // Get all lawyers grouped by specialty
  async getLawyersBySpecialty() {
    try {
      const lawyers = await this.loadLawyers();
      const grouped = {};

      lawyers.forEach(lawyer => {
        if (lawyer.isActive) {
          if (!grouped[lawyer.specialty]) {
            grouped[lawyer.specialty] = [];
          }
          grouped[lawyer.specialty].push(lawyer);
        }
      });

      return grouped;
    } catch (error) {
      console.error('Error grouping lawyers by specialty:', error);
      return {};
    }
  }

  // Get statistics about lawyer coverage
  async getLawyerCoverageStats() {
    try {
      const lawyers = await this.loadLawyers();
      const activeLawyers = lawyers.filter(l => l.isActive);
      
      const specialties = [...new Set(activeLawyers.map(l => l.specialty))];
      
      return {
        totalLawyers: lawyers.length,
        activeLawyers: activeLawyers.length,
        specialtiesCovered: specialties.length,
        specialties: specialties
      };
    } catch (error) {
      console.error('Error getting lawyer coverage stats:', error);
      return {
        totalLawyers: 0,
        activeLawyers: 0,
        specialtiesCovered: 0,
        specialties: []
      };
    }
  }
}

export default new LawyerNotificationService();

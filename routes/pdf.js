import express from 'express';
import pdfService from '../services/PdfGenerationService.js';
import ConversationFlowService from '../services/ConversationFlowService.js';
import DatabaseService from '../services/DatabaseService.js';

const router = express.Router();

// Helper function to get office name
async function getOfficeNameForBot(botManager) {
  try {
    // Get all bots and filter for active ones
    const allBots = botManager.getAllBots();
    const activeBots = allBots.filter(bot => bot.isActive && bot.status === 'ready');
    
    if (activeBots.length === 0) {
      return "V3"; // Fallback
    }

    const bot = activeBots[0];
    const ownerId = bot.ownerId;
    
    if (!ownerId) {
      return "V3"; // Fallback
    }

    const user = await DatabaseService.getUserById(ownerId);
    return user?.lawOfficeName || "V3"; // Use law office name or fallback
  } catch (error) {
    console.error('Error getting law office name for PDF:', error);
    return "V3"; // Fallback on error
  }
}

// Generate PDF for a specific conversation
router.get('/conversation/:conversationId', async (req, res) => {
  try {
    const conversationId = req.params.conversationId;
    
    // Get the conversation flow service instance from the bot manager
    // We need to access it through the request object that has botManager
    const botManager = req.botManager;
    if (!botManager) {
      return res.status(500).json({ error: 'Bot manager not available' });
    }
    
    // Get conversations from all active bots
    let conversation = null;
    for (const [botId, bot] of botManager.bots.entries()) {
      if (bot.conversationFlowService) {
        const conversations = bot.conversationFlowService.getAllConversations();
        const found = conversations.find(c => c.id == conversationId);
        if (found) {
          conversation = found;
          break;
        }
      }
    }
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Get dynamic office name
    const officeName = await getOfficeNameForBot(botManager);
    
    const pdf = await pdfService.generateConversationPdf(conversation, officeName);
    
    const filename = `relatorio-${(conversation.client.name || 'cliente').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf, 'binary');
  } catch (error) {
    console.error('Error generating conversation PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Generate summary PDF for all conversations
router.get('/summary', async (req, res) => {
  try {
    // Get the conversation flow service instance from the bot manager
    const botManager = req.botManager;
    if (!botManager) {
      return res.status(500).json({ error: 'Bot manager not available' });
    }
    
    // Collect conversations from all active bots
    let allConversations = [];
    for (const [botId, bot] of botManager.bots.entries()) {
      if (bot.conversationFlowService) {
        const conversations = bot.conversationFlowService.getAllConversations();
        allConversations = allConversations.concat(conversations);
      }
    }
    
    const pdf = await pdfService.generateSummaryPdf(allConversations);
    
    const filename = `relatorio-geral-${new Date().toISOString().split('T')[0]}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf, 'binary');
  } catch (error) {
    console.error('Error generating summary PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

export default router;

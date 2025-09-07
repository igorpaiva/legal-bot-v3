import express from 'express';
import pdfService from '../services/PdfGenerationService.js';
import ConversationFlowService from '../services/ConversationFlowService.js';

const router = express.Router();

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
    
    const pdf = await pdfService.generateConversationPdf(conversation);
    
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

import express from 'express';
import { GroqService } from '../services/GroqService.js';

const router = express.Router();

// Get admin dashboard data
router.get('/dashboard', (req, res) => {
  try {
    const botStatus = req.botManager.getBotsStatus();
    
    res.json({
      success: true,
      data: {
        ...botStatus,
        systemStatus: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'development'
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Groq connection
router.get('/test-groq', async (req, res) => {
  try {
    const groqService = new GroqService();
    const result = await groqService.testConnection();
    
    res.json({
      success: result.success,
      message: result.success ? 'Groq connection successful' : 'Groq connection failed',
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get system configuration
router.get('/config', (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        responseDelays: {
          min: process.env.BOT_RESPONSE_DELAY_MIN || 1000,
          max: process.env.BOT_RESPONSE_DELAY_MAX || 5000
        },
        typingDelays: {
          min: process.env.BOT_TYPING_DELAY_MIN || 500,
          max: process.env.BOT_TYPING_DELAY_MAX || 2000
        },
        rateLimit: {
          windowMs: process.env.RATE_LIMIT_WINDOW_MS || 60000,
          maxRequests: process.env.RATE_LIMIT_MAX_REQUESTS || 100
        },
        groqConfigured: !!process.env.GROQ_API_KEY
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get bot statistics
router.get('/stats', (req, res) => {
  try {
    const bots = req.botManager.getAllBots();
    
    const stats = {
      totalBots: bots.length,
      activeBots: bots.filter(bot => bot.isActive).length,
      totalMessages: bots.reduce((sum, bot) => sum + bot.messageCount, 0),
      botsByStatus: bots.reduce((acc, bot) => {
        acc[bot.status] = (acc[bot.status] || 0) + 1;
        return acc;
      }, {}),
      recentActivity: bots
        .filter(bot => bot.lastActivity)
        .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
        .slice(0, 10)
        .map(bot => ({
          id: bot.id,
          name: bot.name,
          lastActivity: bot.lastActivity,
          messageCount: bot.messageCount
        }))
    };
    
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update bot configuration
router.put('/bot/:id/config', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    const bot = req.botManager.getBot(id);
    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }
    
    if (name) {
      bot.name = name;
      req.botManager.emitBotUpdate(id);
    }
    
    res.json({ success: true, message: 'Bot configuration updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk operations
router.post('/bulk/stop', async (req, res) => {
  try {
    const { botIds } = req.body;
    
    if (!Array.isArray(botIds)) {
      return res.status(400).json({ success: false, error: 'botIds must be an array' });
    }
    
    const results = await Promise.allSettled(
      botIds.map(id => req.botManager.stopBot(id))
    );
    
    const successful = results.filter(result => result.status === 'fulfilled' && result.value === true).length;
    const failed = results.length - successful;
    
    res.json({
      success: true,
      message: `Stopped ${successful} bots, ${failed} failed`,
      results: { successful, failed }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/bulk/restart', async (req, res) => {
  try {
    const { botIds } = req.body;
    
    if (!Array.isArray(botIds)) {
      return res.status(400).json({ success: false, error: 'botIds must be an array' });
    }
    
    const results = await Promise.allSettled(
      botIds.map(id => req.botManager.restartBot(id))
    );
    
    const successful = results.filter(result => result.status === 'fulfilled' && result.value === true).length;
    const failed = results.length - successful;
    
    res.json({
      success: true,
      message: `Restarted ${successful} bots, ${failed} failed`,
      results: { successful, failed }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/bulk/delete', async (req, res) => {
  try {
    const { botIds } = req.body;
    
    if (!Array.isArray(botIds)) {
      return res.status(400).json({ success: false, error: 'botIds must be an array' });
    }
    
    const results = await Promise.allSettled(
      botIds.map(id => req.botManager.deleteBot(id))
    );
    
    const successful = results.filter(result => result.status === 'fulfilled' && result.value === true).length;
    const failed = results.length - successful;
    
    res.json({
      success: true,
      message: `Deleted ${successful} bots, ${failed} failed`,
      results: { successful, failed }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get active conversations and triages
router.get('/triages', (req, res) => {
  try {
    // Get conversations from all bots
    const allConversations = [];
    
    for (const [botId, bot] of req.botManager.bots) {
      if (bot.client && bot.isActive && bot.conversationFlowService) {
        const botConversations = bot.conversationFlowService.getAllConversations();
        botConversations.forEach(conversation => {
          allConversations.push({
            ...conversation,
            botId,
            botName: bot.name,
            startTime: conversation.startedAt,
            lastActivity: conversation.lastActivityAt
          });
        });
      }
    }

    // Sort by urgency and start time
    allConversations.sort((a, b) => {
      const urgencyOrder = { 'alta': 3, 'media': 2, 'baixa': 1 };
      const urgencyDiff = urgencyOrder[b.urgency || 'baixa'] - urgencyOrder[a.urgency || 'baixa'];
      if (urgencyDiff !== 0) return urgencyDiff;
      return new Date(b.startTime) - new Date(a.startTime);
    });

    res.json({
      success: true,
      triages: allConversations,
      stats: {
        total: allConversations.length,
        alta: allConversations.filter(t => t.urgency === 'alta').length,
        media: allConversations.filter(t => t.urgency === 'media').length,
        baixa: allConversations.filter(t => t.urgency === 'baixa').length,
        byState: allConversations.reduce((acc, t) => {
          acc[t.state] = (acc[t.state] || 0) + 1;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific conversation details
router.get('/triages/:contactId', (req, res) => {
  try {
    const { contactId } = req.params;
    
    // Find the conversation in any bot
    let conversationData = null;
    let botInfo = null;
    
    for (const [botId, bot] of req.botManager.bots) {
      if (bot.client && bot.isActive && bot.conversationFlowService) {
        const data = bot.conversationFlowService.getConversation(contactId);
        if (data) {
          conversationData = data;
          botInfo = { id: botId, name: bot.name };
          break;
        }
      }
    }

    if (!conversationData) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({
      success: true,
      conversation: conversationData,
      bot: botInfo
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Analyze legal case manually (admin function)
router.post('/analyze-case', async (req, res) => {
  try {
    const { description, phone } = req.body;
    
    if (!description) {
      return res.status(400).json({ 
        success: false, 
        error: 'Case description is required' 
      });
    }
    
    const botManager = req.botManager;
    if (!botManager || !botManager.legalTriageService) {
      return res.status(500).json({
        success: false,
        error: 'Legal triage service not available'
      });
    }
    
    // Create a temporary analysis
    const analysis = await botManager.legalTriageService.analyzeCompleteCase(
      phone || 'admin-analysis',
      [description],
      botManager.groqService
    );
    
    res.json({
      success: true,
      analysis: analysis
    });
    
  } catch (error) {
    console.error('Error in manual case analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Export all data for backup
router.get('/export-data', async (req, res) => {
  try {
    const botManager = req.botManager;
    if (!botManager || !botManager.persistence) {
      return res.status(500).json({
        success: false,
        error: 'Persistence service not available'
      });
    }
    
    const exportPath = await botManager.persistence.exportAllData();
    
    res.json({
      success: true,
      message: 'Data exported successfully',
      exportPath: exportPath
    });
    
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Save current state manually
router.post('/save-state', async (req, res) => {
  try {
    const botManager = req.botManager;
    if (!botManager) {
      return res.status(500).json({
        success: false,
        error: 'Bot manager not available'
      });
    }
    
    await botManager.saveAllData();
    
    res.json({
      success: true,
      message: 'State saved successfully'
    });
    
  } catch (error) {
    console.error('Error saving state:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get persistence statistics
router.get('/persistence-stats', async (req, res) => {
  try {
    const botManager = req.botManager;
    if (!botManager || !botManager.persistence) {
      return res.status(500).json({
        success: false,
        error: 'Persistence service not available'
      });
    }
    
    const botConfigs = await botManager.persistence.loadBotConfigs();
    const conversations = await botManager.persistence.loadConversations();
    
    const stats = {
      totalBots: botConfigs.length,
      activeBots: botConfigs.filter(bot => bot.isActive).length,
      totalConversations: conversations.size,
      oldestBot: botConfigs.reduce((oldest, bot) => {
        return !oldest || new Date(bot.createdAt) < new Date(oldest.createdAt) ? bot : oldest;
      }, null),
      newestBot: botConfigs.reduce((newest, bot) => {
        return !newest || new Date(bot.createdAt) > new Date(newest.createdAt) ? bot : newest;
      }, null)
    };
    
    res.json({
      success: true,
      stats: stats
    });
    
  } catch (error) {
    console.error('Error getting persistence stats:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;

import express from 'express';
import { GroqService } from '../services/GroqService.js';
import { authenticateUser, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get admin dashboard data
router.get('/dashboard', authenticateUser, (req, res) => {
  try {
    let botStatus = req.botManager.getBotsStatus();
    
    // Filter bots by user's ownership for law offices
    if (req.user.role === 'law_office') {
      const userBots = botStatus.bots.filter(bot => bot.ownerId === req.user.id);
      botStatus = {
        total: userBots.length,
        active: userBots.filter(bot => bot.isActive).length,
        bots: userBots
      };
    }
    
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
router.get('/test-groq', authenticateUser, async (req, res) => {
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
router.get('/config', authenticateUser, (req, res) => {
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
router.get('/stats', authenticateUser, (req, res) => {
  try {
    let bots = req.botManager.getAllBots();
    
    // Filter bots by user's ownership for law offices
    if (req.user.role === 'law_office') {
      bots = bots.filter(bot => bot.ownerId === req.user.id);
    }
    
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
router.put('/bot/:id/config', authenticateUser, async (req, res) => {
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
router.post('/bulk/stop', authenticateUser, async (req, res) => {
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

router.post('/bulk/restart', authenticateUser, async (req, res) => {
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

router.delete('/bulk/delete', authenticateUser, async (req, res) => {
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
router.get('/triages', authenticateUser, (req, res) => {
  try {
    // Buscar triagens persistidas no banco
    const DatabaseService = req.botManager.database;
    
    // Para usuários law_office, filtrar apenas dados do seu escritório
    let triages;
    if (req.user.role === 'law_office') {
      triages = DatabaseService.getTriagesByOwner(req.user.id);
    } else {
      triages = DatabaseService.getAllTriages();
    }

    // Buscar dados da conversa para cada triage de forma otimizada
    const conversationsMap = new Map();
    const botsMap = new Map();

    // Mapear conversas e bots de uma só vez (memória)
    for (const bot of req.botManager.bots.values()) {
      // Para usuários law_office, só incluir bots do seu escritório
      if (req.user.role === 'law_office' && bot.ownerId !== req.user.id) {
        continue;
      }
      
      botsMap.set(bot.id, bot);
      if (bot.conversationFlowService) {
        const convs = bot.conversationFlowService.getAllConversations();
        for (const conv of convs) {
          conversationsMap.set(conv.id, {
            ...conv,
            botName: bot.name || bot.id,
            lawOfficeName: bot.lawOfficeName || bot.name
          });
        }
      }
    }

    // Adicionar conversas persistidas do banco
    let persistedConvs;
    if (req.user.role === 'law_office') {
      persistedConvs = DatabaseService.getConversationsByOwner(req.user.id);
    } else {
      persistedConvs = DatabaseService.db.prepare('SELECT * FROM conversations').all().map(conv => DatabaseService.formatConversation(conv));
    }
    
    for (const conv of persistedConvs) {
      const formattedConv = conv;
      if (!conversationsMap.has(formattedConv.id)) {
        conversationsMap.set(formattedConv.id, {
          ...formattedConv,
          botName: formattedConv.botId || 'N/A',
          lawOfficeName: formattedConv.lawOfficeName || 'N/A',
          ownerId: formattedConv.ownerId || null
        });
      }
    }

    // Remover filtro duplicado - já filtramos acima
    const seen = new Set();
    const triageList = triages
      .map(triage => {
        const conv = conversationsMap.get(triage.conversation_id);
        if (!conv) {
          console.warn(`Conversa não encontrada para triage ${triage.id}`);
          return null;
        }
        
        // Buscar nome do escritório
        let lawOfficeName = 'N/A';
        if (conv.ownerId) {
          const userStmt = DatabaseService.db.prepare('SELECT law_office_name FROM users WHERE id = ?');
          const user = userStmt.get(conv.ownerId);
          lawOfficeName = user?.law_office_name || 'N/A';
        }
        // Buscar nome do bot
        let botName = 'N/A';
        if (conv.botId) {
          const botStmt = DatabaseService.db.prepare('SELECT name FROM bots WHERE id = ?');
          const bot = botStmt.get(conv.botId);
          botName = bot?.name || conv.botId || 'N/A';
        }
        // Parse da análise de triagem com tratamento de erro
        let triageAnalysis = null;
        try {
          triageAnalysis = triage.triage_json ? JSON.parse(triage.triage_json) : null;
        } catch (error) {
          console.error(`Erro ao fazer parse da análise da triage ${triage.id}:`, error);
          triageAnalysis = null;
        }
        // Função helper para extrair dados do cliente
        const getClientData = () => ({
          name: triageAnalysis?.client?.name || conv.clientName || 'N/A',
          phone: triageAnalysis?.client?.phone || conv.clientPhone || 'N/A',
          email: triageAnalysis?.client?.email || conv.clientEmail || 'N/A'
        });
        // Função helper para dados do caso
        const getCaseData = () => ({
          category: triageAnalysis?.case?.category || 'N/A',
          description: triageAnalysis?.case?.description || 'N/A',
          date: triageAnalysis?.case?.date || 'N/A',
          documents: triageAnalysis?.case?.documents || []
        });
        // Função helper para dados da triagem
        const getTriageData = () => ({
          confidence: triageAnalysis?.triage?.confidence || 0,
          escalate: triageAnalysis?.triage?.escalate || false,
          recommended_action: triageAnalysis?.triage?.recommended_action || 'N/A',
          flags: triageAnalysis?.triage?.flags || []
        });
        // Função helper para solução legal
        const getLegalSolutionData = () => ({
          summary: triageAnalysis?.legal_solution?.summary || 'N/A',
          legal_basis: triageAnalysis?.legal_solution?.legal_basis || 'N/A',
          success_probability: triageAnalysis?.legal_solution?.success_probability || 'N/A',
          recommended_actions: triageAnalysis?.legal_solution?.recommended_actions || 'N/A',
          timeline: triageAnalysis?.legal_solution?.timeline || 'N/A',
          estimated_costs: triageAnalysis?.legal_solution?.estimated_costs || 'N/A',
          required_documents: triageAnalysis?.legal_solution?.required_documents || 'N/A',
          risks_and_alternatives: triageAnalysis?.legal_solution?.risks_and_alternatives || 'N/A'
        });
        return {
          id: `${triage.conversation_id}-${triage.id}`,
          client: getClientData(),
          lawOfficeName,
          state: conv.status ? conv.status.toUpperCase() : 'COMPLETED',
          startTime: conv.startTime || triage.created_at || new Date().toISOString(),
          botName,
          triageAnalysis: {
            client: getClientData(),
            case: getCaseData(),
            triage: getTriageData(),
            legal_solution: getLegalSolutionData()
          }
        };
      })
      .filter(triage => {
        if (!triage || seen.has(triage.id)) {
          return false;
        }
        seen.add(triage.id);
        return true;
      });

    // Calcular estatísticas
    const stats = {
      total: triageList.length,
      byState: triageList.reduce((acc, t) => {
        acc[t.state] = (acc[t.state] || 0) + 1;
        return acc;
      }, {}),
      byCategory: triageList.reduce((acc, t) => {
        const category = t.triageAnalysis?.case?.category || 'Outros';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {}),
      byBot: triageList.reduce((acc, t) => {
        acc[t.botName] = (acc[t.botName] || 0) + 1;
        return acc;
      }, {})
    };

    res.json({
      success: true,
      triages: triageList,
      stats
    });

  } catch (error) {
    console.error('Erro ao buscar triagens:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Analyze legal case manually (admin function)
router.post('/analyze-case', authenticateUser, async (req, res) => {
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
router.get('/export-data', authenticateUser, async (req, res) => {
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
router.post('/save-state', authenticateUser, async (req, res) => {
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
router.get('/persistence-stats', authenticateUser, async (req, res) => {
  try {
    const botManager = req.botManager;
    if (!botManager || !botManager.persistence) {
      return res.status(500).json({
        success: false,
        error: 'Persistence service not available'
      });
    }
    
    let botConfigs = await botManager.persistence.loadBotConfigs();
    let conversations = await botManager.persistence.loadConversations();
    
    // Filter by owner for law office users
    if (req.user.role === 'law_office') {
      botConfigs = botConfigs.filter(bot => bot.ownerId === req.user.id);
      // Filter conversations by bot ownership
      const userBotIds = new Set(botConfigs.map(bot => bot.id));
      const filteredConversations = new Map();
      for (const [convId, conv] of conversations.entries()) {
        if (userBotIds.has(conv.botId)) {
          filteredConversations.set(convId, conv);
        }
      }
      conversations = filteredConversations;
    }
    
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

// Export default para ES modules
export default router;

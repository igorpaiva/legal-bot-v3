import express from 'express';
import { authenticateUser, requireAdmin, requireBotCredits } from '../middleware/auth.js';

const router = express.Router();

// Get all bots
router.get('/', authenticateUser, (req, res) => {
  try {
    const bots = req.botManager.getAllBots();
    
    // Filter bots by user's ownership for law offices
    let userBots = bots;
    if (req.user.role === 'law_office') {
      userBots = bots.filter(bot => bot.ownerId === req.user.id);
    }
    
    res.json({ success: true, bots: userBots });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific bot
router.get('/:id', authenticateUser, (req, res) => {
  try {
    const bot = req.botManager.getBot(req.params.id);
    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }
    
    // Check if law office user owns this bot
    if (req.user.role === 'law_office' && bot.ownerId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    res.json({
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        assistantName: bot.assistantName, // Include assistant name
        status: bot.status,
        phoneNumber: bot.phoneNumber,
        isActive: bot.isActive,
        messageCount: bot.messageCount,
        lastActivity: bot.lastActivity,
        createdAt: bot.createdAt,
        qrCode: bot.qrCode,
        error: bot.error
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new bot
router.post('/', authenticateUser, requireBotCredits, async (req, res) => {
  try {
    const { name, assistantName } = req.body;
    const botId = await req.botManager.createBot(name, assistantName, req.user.id);
    
    // Deduct bot credit for law office users
    if (req.user.role === 'law_office') {
      await req.userService.useBotCredit(req.user.id);
    }
    
    res.json({ 
      success: true, 
      botId,
      message: 'Bot created successfully. Scan the QR code to connect.' 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop bot
router.post('/:id/stop', authenticateUser, async (req, res) => {
  try {
    const bot = req.botManager.getBot(req.params.id);
    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }
    
    // Check if law office user owns this bot
    if (req.user.role === 'law_office' && bot.ownerId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    const success = await req.botManager.stopBot(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Bot not found or already stopped' });
    }
    
    res.json({ success: true, message: 'Bot stopped successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Restart bot
router.post('/:id/restart', authenticateUser, async (req, res) => {
  try {
    const bot = req.botManager.getBot(req.params.id);
    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }
    
    // Check if law office user owns this bot
    if (req.user.role === 'law_office' && bot.ownerId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    const success = await req.botManager.restartBot(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Bot not found or failed to restart' });
    }
    
    res.json({ success: true, message: 'Bot restarted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete bot
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const bot = req.botManager.getBot(req.params.id);
    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }
    
    // Check if law office user owns this bot
    if (req.user.role === 'law_office' && bot.ownerId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    const success = await req.botManager.deleteBot(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }
    
    res.json({ success: true, message: 'Bot deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get bot QR code
router.get('/:id/qr', authenticateUser, (req, res) => {
  try {
    const bot = req.botManager.getBot(req.params.id);
    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }
    
    // Check if law office user owns this bot
    if (req.user.role === 'law_office' && bot.ownerId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    if (!bot.qrCode) {
      return res.status(404).json({ success: false, error: 'QR code not available' });
    }
    
    res.json({ success: true, qrCode: bot.qrCode });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

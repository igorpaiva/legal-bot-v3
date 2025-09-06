import express from 'express';

const router = express.Router();

// Get all bots
router.get('/', (req, res) => {
  try {
    const bots = req.botManager.getAllBots();
    res.json({ success: true, bots });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific bot
router.get('/:id', (req, res) => {
  try {
    const bot = req.botManager.getBot(req.params.id);
    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
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
router.post('/', async (req, res) => {
  try {
    const { name, assistantName } = req.body;
    const botId = await req.botManager.createBot(name, assistantName);
    
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
router.post('/:id/stop', async (req, res) => {
  try {
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
router.post('/:id/restart', async (req, res) => {
  try {
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
router.delete('/:id', async (req, res) => {
  try {
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
router.get('/:id/qr', (req, res) => {
  try {
    const bot = req.botManager.getBot(req.params.id);
    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
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

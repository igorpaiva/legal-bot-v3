import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import DatabaseService from './DatabaseService.js';
import fs from 'fs';
import path from 'path';

export class PlaywrightBotManager {
  constructor(io) {
    this.io = io;
    this.bots = new Map();
    this.database = DatabaseService;
    
    // Load persisted bots on startup
    this.loadPersistedData();
  }

  async loadPersistedData() {
    try {
      console.log('Loading persisted bot data from extended table...');
      
      const botConfigs = DatabaseService.getAllBotsExtended();
      
      for (const config of botConfigs) {
        if (config.isActive || config.status === 'ready' || config.status === 'authenticated' || config.status === 'connected') {
          console.log(`Restoring bot: ${config.name} (${config.id}) - Status: ${config.status}`);
          await this.restoreBot(config);
        } else {
          console.log(`Skipping inactive bot: ${config.name} (${config.id}) - Status: ${config.status}`);
        }
      }
      
      console.log(`Loaded ${botConfigs.length} bot configurations`);
      
    } catch (error) {
      console.error('Error loading persisted data:', error);
    }
  }

  async restoreBot(config) {
    try {
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--memory-pressure-off'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });

      const page = await context.newPage();
      
      const botData = {
        id: config.id,
        name: config.name,
        assistantName: config.assistantName || 'Ana',
        browser,
        context,
        page,
        status: 'restoring',
        qrCode: null,
        phoneNumber: config.phoneNumber,
        isActive: false,
        messageCount: config.messageCount || 0,
        lastActivity: config.lastActivity ? new Date(config.lastActivity) : null,
        createdAt: config.createdAt ? new Date(config.createdAt) : new Date(),
        isRestoring: true
      };

      this.bots.set(config.id, botData);
      
      // Load session data if exists
      const sessionPath = `./sessions/session-${config.id}`;
      if (fs.existsSync(sessionPath)) {
        console.log(`Loading session for bot ${config.id}`);
        // Load cookies and localStorage
        const cookiesPath = path.join(sessionPath, 'cookies.json');
        const localStoragePath = path.join(sessionPath, 'localStorage.json');
        
        if (fs.existsSync(cookiesPath)) {
          const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
          await context.addCookies(cookies);
        }
      }

      // Navigate to WhatsApp Web
      await page.goto('https://web.whatsapp.com');
      
      // Setup WhatsApp Web monitoring
      await this.setupWhatsAppWebMonitoring(botData);
      
      this.emitBotUpdate(config.id);
      
      return botData;
      
    } catch (error) {
      console.error(`Error restoring bot ${config.id}:`, error);
      await this.database.updateBotExtended(config.id, {
        isActive: false,
        status: 'error',
        lastError: error.message
      });
    }
  }

  async createBot(name = null, assistantName = null, ownerId = null) {
    const botId = uuidv4();
    const botName = name || `Bot-${Date.now()}`;
    const defaultAssistantName = assistantName || 'Ana';
    
    console.log(`Creating new WhatsApp Web bot ${botId} with Playwright`);

    try {
      // Create bot in database first
      await this.database.createBotExtended({
        id: botId,
        name: botName,
        assistantName: defaultAssistantName,
        ownerId: ownerId,
        status: 'initializing',
        phoneNumber: null,
        isActive: false,
        messageCount: 0,
        lastActivity: new Date().toISOString(),
        sessionPath: `./sessions/session-${botId}`,
        qrCode: null,
        connectionAttempts: 0,
        lastError: null,
        hasConnectedBefore: false,
        lastQrGenerated: null,
        restorationAttempts: 0
      });

      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--memory-pressure-off'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });

      const page = await context.newPage();
      
      const botData = {
        id: botId,
        name: botName,
        assistantName: defaultAssistantName,
        browser,
        context,
        page,
        status: 'initializing',
        qrCode: null,
        phoneNumber: null,
        isActive: false,
        messageCount: 0,
        lastActivity: null,
        createdAt: new Date(),
        isRestoring: false
      };

      this.bots.set(botId, botData);

      // Navigate to WhatsApp Web
      await page.goto('https://web.whatsapp.com');
      
      // Setup WhatsApp Web monitoring
      await this.setupWhatsAppWebMonitoring(botData);
      
      // Emit bot created event
      this.io.emit('bot-created', {
        id: botData.id,
        name: botData.name,
        status: botData.status,
        phoneNumber: botData.phoneNumber,
        isActive: botData.isActive,
        messageCount: botData.messageCount,
        lastActivity: botData.lastActivity,
        createdAt: botData.createdAt,
        qrCode: botData.qrCode,
        error: botData.error
      });
      
      this.emitBotUpdate(botId);
      return botId;
      
    } catch (error) {
      console.error(`Error creating bot ${botId}:`, error);
      await this.database.updateBotExtended(botId, {
        status: 'error',
        lastError: error.message
      });
      throw error;
    }
  }

  async setupWhatsAppWebMonitoring(botData) {
    const { page, id } = botData;

    try {
      // Wait for either QR code or main interface
      await page.waitForTimeout(3000);

      // Check for QR code
      const qrElement = await page.$('canvas[aria-label="QR code"]');
      if (qrElement && !botData.isRestoring) {
        console.log(`QR Code detected for bot ${id}`);
        
        // Get QR code as image
        const qrImage = await qrElement.screenshot();
        const qrCodeDataURL = `data:image/png;base64,${qrImage.toString('base64')}`;
        
        botData.qrCode = qrCodeDataURL;
        botData.status = 'waiting_for_scan';
        
        await this.database.updateBotExtended(id, {
          status: 'waiting_for_scan',
          lastQrGenerated: new Date().toISOString()
        });
        
        this.emitBotUpdate(id);
        
        // Monitor for authentication
        this.monitorAuthentication(botData);
      } else {
        // Check if already authenticated
        const chatList = await page.$('[data-testid="chat-list"]');
        if (chatList) {
          console.log(`Bot ${id} already authenticated`);
          await this.handleAuthenticated(botData);
        } else {
          // Wait and retry
          setTimeout(() => this.setupWhatsAppWebMonitoring(botData), 5000);
        }
      }
    } catch (error) {
      console.error(`Error setting up WhatsApp Web monitoring for bot ${id}:`, error);
    }
  }

  async monitorAuthentication(botData) {
    const { page, id } = botData;
    
    try {
      // Wait for authentication (chat list appears)
      await page.waitForSelector('[data-testid="chat-list"]', { timeout: 300000 }); // 5 minutes
      
      console.log(`Bot ${id} authenticated successfully`);
      await this.handleAuthenticated(botData);
      
    } catch (error) {
      console.error(`Authentication timeout for bot ${id}:`, error);
      botData.status = 'auth_timeout';
      botData.error = 'Authentication timeout';
      
      await this.database.updateBotExtended(id, {
        status: 'auth_timeout',
        lastError: 'Authentication timeout'
      });
      
      this.emitBotUpdate(id);
    }
  }

  async handleAuthenticated(botData) {
    const { page, context, id } = botData;
    
    try {
      // Get phone number
      const profileIcon = await page.$('[data-testid="avatar-anchor"]');
      if (profileIcon) {
        await profileIcon.click();
        await page.waitForTimeout(1000);
        
        // Try to get phone number from profile
        const phoneElement = await page.$('span[title*="+"]');
        if (phoneElement) {
          botData.phoneNumber = await phoneElement.textContent();
        }
        
        // Close profile
        await page.keyboard.press('Escape');
      }

      botData.status = 'connected';
      botData.isActive = true;
      botData.lastActivity = new Date();
      botData.isRestoring = false;
      
      // Save session
      await this.saveSession(botData);
      
      // Update database
      await this.database.updateBotExtended(id, {
        status: 'connected',
        isActive: true,
        phoneNumber: botData.phoneNumber,
        lastActivity: new Date().toISOString(),
        hasConnectedBefore: true
      });
      
      // Setup message monitoring
      await this.setupMessageMonitoring(botData);
      
      this.emitBotUpdate(id);
      console.log(`Bot ${id} is ready and monitoring messages!`);
      
    } catch (error) {
      console.error(`Error handling authentication for bot ${id}:`, error);
    }
  }

  async saveSession(botData) {
    const { context, id } = botData;
    
    try {
      const sessionPath = `./sessions/session-${id}`;
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }
      
      // Save cookies
      const cookies = await context.cookies();
      fs.writeFileSync(
        path.join(sessionPath, 'cookies.json'), 
        JSON.stringify(cookies, null, 2)
      );
      
      // Save localStorage
      const localStorage = await botData.page.evaluate(() => {
        return JSON.stringify(window.localStorage);
      });
      fs.writeFileSync(
        path.join(sessionPath, 'localStorage.json'), 
        localStorage
      );
      
      console.log(`Session saved for bot ${id}`);
      
    } catch (error) {
      console.error(`Error saving session for bot ${id}:`, error);
    }
  }

  async setupMessageMonitoring(botData) {
    const { page, id } = botData;
    
    // Monitor for new messages
    setInterval(async () => {
      try {
        if (!botData.isActive) return;
        
        // Check for unread messages
        const unreadChats = await page.$$('[data-testid="cell-frame-container"] [data-testid="icon-unread-count"]');
        
        for (const unreadChat of unreadChats) {
          // Click on chat
          const chatContainer = await unreadChat.$('xpath=ancestor::div[@data-testid="cell-frame-container"]');
          if (chatContainer) {
            await chatContainer.click();
            await page.waitForTimeout(1000);
            
            // Get messages
            await this.processMessages(botData);
            
            // Go back to chat list
            await page.keyboard.press('Escape');
          }
        }
      } catch (error) {
        console.error(`Error monitoring messages for bot ${id}:`, error);
      }
    }, 5000); // Check every 5 seconds
  }

  async processMessages(botData) {
    const { page, id } = botData;
    
    try {
      // Get last few messages
      const messages = await page.$$('[data-testid="msg-container"]');
      const lastMessages = messages.slice(-5); // Last 5 messages
      
      for (const message of lastMessages) {
        const isFromMe = await message.$('[data-testid="msg-meta"] [data-testid="tail-out"]');
        if (isFromMe) continue; // Skip messages from bot
        
        const textElement = await message.$('span.selectable-text');
        if (textElement) {
          const messageText = await textElement.textContent();
          console.log(`Bot ${id} received message: ${messageText}`);
          
          // Simple echo response for testing
          await this.sendMessage(botData, `Recebido: ${messageText}`);
          
          botData.messageCount++;
          botData.lastActivity = new Date();
          this.emitBotUpdate(id);
        }
      }
    } catch (error) {
      console.error(`Error processing messages for bot ${id}:`, error);
    }
  }

  async sendMessage(botData, message) {
    const { page, id } = botData;
    
    try {
      // Find message input
      const messageInput = await page.$('[data-testid="conversation-compose-box-input"]');
      if (messageInput) {
        await messageInput.fill(message);
        await page.keyboard.press('Enter');
        console.log(`Bot ${id} sent message: ${message}`);
      }
    } catch (error) {
      console.error(`Error sending message for bot ${id}:`, error);
    }
  }

  async stopBot(botId) {
    const bot = this.bots.get(botId);
    if (!bot) return false;

    try {
      if (bot.browser) {
        await bot.browser.close();
      }
      bot.status = 'stopped';
      bot.isActive = false;
      
      await this.database.updateBotExtended(botId, {
        status: 'stopped',
        isActive: false
      });
      
      this.emitBotUpdate(botId);
      return true;
    } catch (error) {
      console.error(`Error stopping bot ${botId}:`, error);
      return false;
    }
  }

  async deleteBot(botId) {
    const success = await this.stopBot(botId);
    if (success) {
      this.bots.delete(botId);
      await this.database.deleteBotExtended(botId);
      this.io.emit('bot-deleted', { botId });
    }
    return success;
  }

  getBot(botId) {
    return this.bots.get(botId);
  }

  getAllBots() {
    return Array.from(this.bots.values()).map(bot => ({
      id: bot.id,
      name: bot.name,
      assistantName: bot.assistantName,
      status: bot.status,
      phoneNumber: bot.phoneNumber,
      isActive: bot.isActive,
      messageCount: bot.messageCount,
      lastActivity: bot.lastActivity,
      createdAt: bot.createdAt,
      qrCode: bot.qrCode,
      error: bot.error
    }));
  }

  getBotsStatus() {
    return {
      total: this.bots.size,
      active: Array.from(this.bots.values()).filter(bot => bot.isActive).length,
      bots: this.getAllBots()
    };
  }

  emitBotUpdate(botId) {
    const bot = this.bots.get(botId);
    if (bot) {
      this.io.emit('bot-updated', {
        id: bot.id,
        name: bot.name,
        status: bot.status,
        phoneNumber: bot.phoneNumber,
        isActive: bot.isActive,
        messageCount: bot.messageCount,
        lastActivity: bot.lastActivity,
        createdAt: bot.createdAt,
        qrCode: bot.qrCode,
        error: bot.error
      });
    }
  }

  async restartBot(botId) {
    const bot = this.bots.get(botId);
    if (!bot) return false;

    try {
      await this.stopBot(botId);
      
      // Get bot config from database
      const config = await this.database.getBotExtendedById(botId);
      if (config) {
        await this.restoreBot(config);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error restarting bot ${botId}:`, error);
      return false;
    }
  }
}

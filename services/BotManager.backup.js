import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import DatabaseService from './DatabaseService.js';
import fs from 'fs';
import path from 'path';

export class BotManager {
  constructor(io) {
    this.io = io;
    this.bots = new Map();
    this.database = DatabaseService;
    this.whatsappWebPage = null;
    this.browser = null;
    this.context = null;
    
    // Initialize connection to existing WhatsApp Web
    this.initializeWhatsAppWebConnection();
  }

  async initializeWhatsAppWebConnection() {
    try {
      console.log('🔗 Connecting to WhatsApp Web for shared connection...');
      
      this.browser = await chromium.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--user-data-dir=./whatsapp-profile',
          '--remote-debugging-port=9222'
        ]
      });

      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      
      this.whatsappWebPage = await this.context.newPage();
      
      await this.whatsappWebPage.goto('https://web.whatsapp.com');
      
      console.log('📱 WhatsApp Web opened. Please login manually if needed.');
      console.log('🤖 The bot will start monitoring once you are logged in.');
      
      // Wait for login and start monitoring
      this.waitForLogin();
      
    } catch (error) {
      console.error('❌ Error initializing WhatsApp Web connection:', error);
    }
  }

  async waitForLogin() {
    try {
      console.log('⏳ Waiting for WhatsApp Web login...');
      
      // Wait for chat list to appear (indicates successful login)
      await this.whatsappWebPage.waitForSelector('[data-testid="chat-list"]', { timeout: 300000 }); // 5 minutes
      
      console.log('✅ WhatsApp Web login detected! Bot is ready for monitoring...');
      
      // Create default bot instance
      const botId = 'whatsapp-web-main';
      const botData = {
        id: botId,
        name: 'WhatsApp Web Bot',
        assistantName: 'Ana',
        page: this.whatsappWebPage,
        status: 'connected',
        qrCode: null,
        phoneNumber: 'Connected via WhatsApp Web',
        isActive: true,
        messageCount: 0,
        lastActivity: new Date(),
        createdAt: new Date()
      };

      this.bots.set(botId, botData);
      
      // Start message monitoring
      this.setupMessageMonitoring(botData);
      
      this.emitBotUpdate(botId);
      
    } catch (error) {
      console.error('⏰ Login timeout or error:', error);
      setTimeout(() => this.waitForLogin(), 10000); // Retry in 10 seconds
    }
  }

  // Implement required interface methods
  async createBot(name = null, assistantName = null, ownerId = null) {
    // For this implementation, we use the single WhatsApp Web connection
    const botId = uuidv4();
    const botName = name || `Bot-${Date.now()}`;
    
    console.log(`🤖 Virtual bot ${botId} created (using shared WhatsApp Web connection)`);
    
    // Create virtual bot entry
    const botData = {
      id: botId,
      name: botName,
      assistantName: assistantName || 'Ana',
      status: 'connected',
      phoneNumber: 'WhatsApp Web Shared',
      isActive: true,
      messageCount: 0,
      lastActivity: new Date(),
      createdAt: new Date(),
      qrCode: null
    };
    
    this.bots.set(botId, botData);
    this.emitBotUpdate(botId);
    
    return botId;
  }

  async setupMessageMonitoring(botData) {
    const { page, id } = botData;
    
    console.log(`📡 Setting up message monitoring for bot ${id}`);
    
    // Monitor for new messages using page events
    page.on('response', async (response) => {
      try {
        if (response.url().includes('web.whatsapp.com') && response.status() === 200) {
          // Check for new messages periodically
          setTimeout(() => this.checkForNewMessages(botData), 1000);
        }
      } catch (error) {
        // Ignore network errors
      }
    });

    // Also set up periodic checking
    setInterval(() => {
      if (botData.isActive) {
        this.checkForNewMessages(botData);
      }
    }, 3000); // Check every 3 seconds
  }

  async checkForNewMessages(botData) {
    const { page, id } = botData;
    
    try {
      if (!botData.isActive) return;
      
      // Look for unread message indicators
      const unreadChats = await page.$$('[data-testid="cell-frame-container"]:has([data-testid="icon-unread-count"])');
      
      for (const unreadChat of unreadChats) {
        try {
          // Click on the chat with unread messages
          await unreadChat.click();
          await page.waitForTimeout(2000);
          
          // Process messages in this chat
          await this.processUnreadMessages(botData);
          
          // Mark as read by just being in the chat
          await page.waitForTimeout(1000);
          
        } catch (error) {
          console.error(`❌ Error processing unread chat for bot ${id}:`, error);
        }
      }
      
    } catch (error) {
      // Ignore errors during monitoring
    }
  }

  async processUnreadMessages(botData) {
    const { page, id } = botData;
    
    try {
      // Get recent messages that are not from us
      const messages = await page.$$('[data-testid="msg-container"]');
      const recentMessages = messages.slice(-3); // Last 3 messages
      
      for (const message of recentMessages) {
        try {
          // Check if message is from us (has outgoing tail)
          const isFromMe = await message.$('[data-testid="tail-out"]');
          if (isFromMe) continue;
          
          // Get message text
          const textElement = await message.$('span.selectable-text');
          if (textElement) {
            const messageText = await textElement.textContent();
            
            if (messageText && messageText.trim()) {
              console.log(`📨 Bot ${id} received message: ${messageText}`);
              
              // Generate response
              const response = await this.generateResponse(messageText, botData);
              
              // Send response
              await this.sendMessage(botData, response);
              
              botData.messageCount++;
              botData.lastActivity = new Date();
              this.emitBotUpdate(id);
              
              // Add delay between processing messages
              await page.waitForTimeout(2000);
            }
          }
        } catch (error) {
          // Ignore individual message errors
        }
      }
    } catch (error) {
      // Ignore processing errors
    }
  }

  async generateResponse(messageText, botData) {
    // Simple response logic - you can integrate with GroqService here
    const responses = [
      `Olá! Recebi sua mensagem: "${messageText}". Como posso ajudá-lo com questões jurídicas?`,
      `Entendi. Sobre "${messageText}", preciso de mais detalhes para poder orientá-lo melhor.`,
      `Obrigado pela mensagem. Para "${messageText}", recomendo que forneça mais contexto sobre sua situação.`,
      `Recebido! Sobre "${messageText}", posso ajudá-lo com orientações jurídicas. Pode me dar mais detalhes?`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  async sendMessage(botData, message) {
    const { page, id } = botData;
    
    try {
      // Find the message input box
      const messageInput = await page.$('[data-testid="conversation-compose-box-input"]');
      if (messageInput) {
        // Clear any existing text and type new message
        await messageInput.click();
        await page.keyboard.press('Control+a');
        await messageInput.fill(message);
        
        // Add a small delay to simulate typing
        await page.waitForTimeout(1000 + Math.random() * 2000);
        
        // Send message
        await page.keyboard.press('Enter');
        
        console.log(`📤 Bot ${id} sent response`);
        
        // Small delay after sending
        await page.waitForTimeout(1000);
      }
    } catch (error) {
      console.error(`❌ Error sending message for bot ${id}:`, error);
    }
  }
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
        headless: false, // Visível para debug
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--memory-pressure-off'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'pt-BR',
        permissions: ['notifications'],
        extraHTTPHeaders: {
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        }
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

      // Navigate to WhatsApp Web with better settings
      console.log(`Navigating to WhatsApp Web for bot ${botId}...`);
      await page.goto('https://web.whatsapp.com', { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      // Wait a bit for page to fully load
      await page.waitForTimeout(3000);
      
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
      console.log(`Setting up WhatsApp Web monitoring for bot ${id}...`);
      
      // Wait for page to load
      await page.waitForTimeout(8000); // Increased timeout
      console.log(`Page loaded for bot ${id}, checking for QR code or chat list...`);

      // Try multiple QR code selectors
      const qrSelectors = [
        'canvas[aria-label="QR code"]',
        'canvas[aria-label*="QR"]', 
        'div[data-testid="qr-code"] canvas',
        'canvas[role="img"]',
        'div._2EZ_m canvas', // WhatsApp Web QR container
        'canvas', // Generic canvas - last resort
        '[data-ref] canvas' // Alternative QR container
      ];
      
      let qrElement = null;
      for (const selector of qrSelectors) {
        qrElement = await page.$(selector);
        if (qrElement) {
          console.log(`QR Code found with selector: ${selector}`);
          break;
        }
      }

      // If no QR found but has download page, try to force mobile view
      if (!qrElement) {
        const downloadHeading = await page.$('text="Download WhatsApp for Windows"');
        if (downloadHeading) {
          console.log(`Bot ${id} detected download page, trying to force web interface...`);
          
          // Try to click "Use WhatsApp Web" if available
          const webLink = await page.$('text="Use WhatsApp Web"');
          if (webLink) {
            await webLink.click();
            await page.waitForTimeout(3000);
            
            // Try QR detection again
            for (const selector of qrSelectors) {
              qrElement = await page.$(selector);
              if (qrElement) {
                console.log(`QR Code found after forcing web interface: ${selector}`);
                break;
              }
            }
          }
        }
      }

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
        console.log(`QR code emitted for bot ${id}`);
        
        // Monitor for authentication
        this.monitorAuthentication(botData);
      } else {
        // Check if already authenticated - try multiple selectors
        const chatSelectors = [
          '[data-testid="chat-list"]',
          'div[data-testid="chat-list-drawer"]',
          '[data-testid="conversation-panel-messages"]',
          'div[role="application"]',
          '#main' // WhatsApp main chat area
        ];
        
        let chatList = null;
        for (const selector of chatSelectors) {
          chatList = await page.$(selector);
          if (chatList) {
            console.log(`Chat interface found with selector: ${selector}`);
            break;
          }
        }
        
        if (chatList) {
          console.log(`Bot ${id} already authenticated`);
          await this.handleAuthenticated(botData);
        } else {
          console.log(`Bot ${id} - No QR code or chat list found, checking page content...`);
          
          // Debug: Log page content to see what's there
          const pageContent = await page.evaluate(() => {
            return {
              title: document.title,
              url: window.location.href,
              hasQR: !!document.querySelector('canvas'),
              hasChat: !!document.querySelector('[role="application"]'),
              bodyClasses: document.body.className,
              headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent)
            };
          });
          
          console.log(`Page debug info for bot ${id}:`, pageContent);
          
          // Wait and retry
          setTimeout(() => this.setupWhatsAppWebMonitoring(botData), 8000);
        }
      }
    } catch (error) {
      console.error(`Error setting up WhatsApp Web monitoring for bot ${id}:`, error);
      botData.status = 'error';
      botData.error = error.message;
      
      await this.database.updateBotExtended(id, {
        status: 'error',
        lastError: error.message
      });
      
      this.emitBotUpdate(id);
    }
  }

  async monitorAuthentication(botData) {
    const { page, id, browser } = botData;
    
    try {
      console.log(`Monitoring authentication for bot ${id}...`);
      
      // Check if browser/page is still active first
      if (browser && !browser.isConnected()) {
        throw new Error('Browser connection lost');
      }
      
      if (page && page.isClosed()) {
        throw new Error('Page was closed');
      }
      
      // Wait for authentication with multiple attempts
      let attempts = 0;
      const maxAttempts = 60; // 60 attempts of 2 seconds each = 2 minutes
      
      while (attempts < maxAttempts) {
        try {
          // Check if chat list exists (authenticated)
          const chatList = await page.$('[data-testid="chat-list"]');
          if (chatList) {
            console.log(`Bot ${id} authenticated successfully after ${attempts * 2} seconds`);
            await this.handleAuthenticated(botData);
            return;
          }
          
          // Wait 2 seconds before next check
          await page.waitForTimeout(2000);
          attempts++;
          
          // Log progress every 10 attempts (20 seconds)
          if (attempts % 10 === 0) {
            console.log(`Bot ${id} still waiting for authentication... ${attempts * 2}s elapsed`);
          }
          
        } catch (innerError) {
          if (innerError.message.includes('closed') || innerError.message.includes('Target page')) {
            throw new Error('Browser/page was closed during authentication');
          }
          throw innerError;
        }
      }
      
      // If we get here, authentication timed out
      throw new Error('Authentication timeout - QR code was not scanned within 2 minutes');
      
    } catch (error) {
      console.error(`Authentication error for bot ${id}:`, error.message);
      botData.status = 'auth_timeout';
      botData.error = error.message;
      
      await this.database.updateBotExtended(id, {
        status: 'auth_timeout',
        lastError: error.message
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

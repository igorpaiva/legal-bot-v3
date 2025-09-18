import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import DatabaseService from './DatabaseService.js';

export class WhatsAppWebBotManager {
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
      console.log('Connecting to existing WhatsApp Web instance...');
      
      // Connect to existing Chrome instance (you need to start Chrome with --remote-debugging-port=9222)
      // OR create a new persistent context
      
      this.browser = await chromium.launch({
        headless: false, // Visível para você fazer login
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--user-data-dir=./whatsapp-profile', // Persistent profile
          '--remote-debugging-port=9222'
        ]
      });

      this.context = await this.browser.newContext();
      this.whatsappWebPage = await this.context.newPage();
      
      // Navigate to WhatsApp Web
      await this.whatsappWebPage.goto('https://web.whatsapp.com');
      
      console.log('WhatsApp Web opened. Please login manually if needed.');
      console.log('The bot will start monitoring once you are logged in.');
      
      // Wait for login and start monitoring
      this.waitForLogin();
      
    } catch (error) {
      console.error('Error initializing WhatsApp Web connection:', error);
    }
  }

  async waitForLogin() {
    try {
      console.log('Waiting for WhatsApp Web login...');
      
      // Wait for chat list to appear (indicates successful login)
      await this.whatsappWebPage.waitForSelector('[data-testid="chat-list"]', { timeout: 300000 }); // 5 minutes
      
      console.log('WhatsApp Web login detected! Starting bot monitoring...');
      
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
      console.error('Login timeout or error:', error);
      setTimeout(() => this.waitForLogin(), 10000); // Retry in 10 seconds
    }
  }

  async setupMessageMonitoring(botData) {
    const { page, id } = botData;
    
    console.log(`Setting up message monitoring for bot ${id}`);
    
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
      this.checkForNewMessages(botData);
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
          console.error(`Error processing unread chat for bot ${id}:`, error);
        }
      }
      
    } catch (error) {
      console.error(`Error checking for new messages for bot ${id}:`, error);
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
          
          // Check if message is very recent (to avoid processing old messages)
          const timeElement = await message.$('[data-testid="msg-meta"] span[title]');
          if (timeElement) {
            const timeTitle = await timeElement.getAttribute('title');
            const messageTime = new Date(timeTitle);
            const now = new Date();
            
            // Only process messages from last 5 minutes
            if (now - messageTime > 5 * 60 * 1000) continue;
          }
          
          // Get message text
          const textElement = await message.$('span.selectable-text');
          if (textElement) {
            const messageText = await textElement.textContent();
            
            if (messageText && messageText.trim()) {
              console.log(`Bot ${id} received message: ${messageText}`);
              
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
          console.error(`Error processing individual message:`, error);
        }
      }
    } catch (error) {
      console.error(`Error processing unread messages for bot ${id}:`, error);
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
    
    // Simple random response for testing
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
        
        console.log(`Bot ${id} sent message: ${message.substring(0, 100)}...`);
        
        // Small delay after sending
        await page.waitForTimeout(1000);
      }
    } catch (error) {
      console.error(`Error sending message for bot ${id}:`, error);
    }
  }

  // Implement required interface methods
  async createBot(name = null, assistantName = null, ownerId = null) {
    // For this implementation, we use the single WhatsApp Web connection
    const botId = uuidv4();
    console.log(`Virtual bot ${botId} created (using shared WhatsApp Web connection)`);
    return botId;
  }

  async stopBot(botId) {
    const bot = this.bots.get(botId);
    if (bot) {
      bot.isActive = false;
      bot.status = 'stopped';
      this.emitBotUpdate(botId);
      return true;
    }
    return false;
  }

  async deleteBot(botId) {
    return await this.stopBot(botId);
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
    if (bot) {
      bot.isActive = true;
      bot.status = 'connected';
      this.emitBotUpdate(botId);
      return true;
    }
    return false;
  }

  // Cleanup
  async destroy() {
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch (error) {
      console.error('Error destroying WhatsApp Web connection:', error);
    }
  }
}

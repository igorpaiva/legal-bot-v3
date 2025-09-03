import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { GroqService } from './GroqService.js';
import { HumanLikeDelay } from './HumanLikeDelay.js';
import { LegalTriageService } from './LegalTriageService.js';
import { BotPersistence } from './BotPersistence.js';
import { ConversationFlowService } from './ConversationFlowService.js';

export class BotManager {
  constructor(io) {
    this.io = io;
    this.bots = new Map(); // Initialize the bots Map
    this.botPersistence = new BotPersistence();
    
    // Load persisted bots on startup
    this.loadPersistedData();
  }

  // Load persisted bots and conversations
  async loadPersistedData() {
    try {
      console.log('Loading persisted bot data...');
      
      // Load conversations first
      const allConversations = await this.botPersistence.loadConversations();
      
      // Load bot configurations
      const botConfigs = await this.botPersistence.loadBotConfigs();
      
      for (const config of botConfigs) {
        // Try to restore bots that were previously active or authenticated
        if (config.isActive || config.status === 'ready' || config.status === 'authenticated') {
          console.log(`Restoring bot: ${config.name} (${config.id}) - Status: ${config.status}`);
          await this.restoreBot(config);
          
          // Load conversations for this bot
          const botData = this.bots.get(config.id);
          if (botData && botData.conversationFlowService && allConversations) {
            const botConversations = new Map();
            for (const [key, conversation] of allConversations.entries()) {
              if (key.startsWith(`${config.id}:`)) {
                const contactId = key.substring(`${config.id}:`.length);
                botConversations.set(contactId, conversation);
              }
            }
            botData.conversationFlowService.conversations = botConversations;
            console.log(`Loaded ${botConversations.size} conversations for bot ${config.name}`);
          }
        } else {
          console.log(`Skipping inactive bot: ${config.name} (${config.id}) - Status: ${config.status}`);
        }
      }
      
      console.log(`Loaded ${botConfigs.length} bot configurations, ${allConversations?.size || 0} total conversations`);
      
    } catch (error) {
      console.error('Error loading persisted data:', error);
    }
  }

  // Restore a bot from configuration
  async restoreBot(config) {
    try {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: config.id,
          dataPath: './sessions'
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        }
      });

      const botData = {
        id: config.id,
        name: config.name,
        client,
        status: 'restoring', // Set a specific status for restoration
        qrCode: null,
        phoneNumber: config.phoneNumber,
        isActive: false, // Will be set to true when authenticated
        messageCount: config.messageCount || 0,
        lastActivity: config.lastActivity ? new Date(config.lastActivity) : null,
        createdAt: config.createdAt ? new Date(config.createdAt) : new Date(),
        processedMessages: new Set(),
        isProcessing: false,
        chatCooldowns: new Map(),
        error: null,
        isRestoring: true, // Flag to indicate this is a restoration
        conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService()), // Add conversation flow service with dependencies
        groqService: new GroqService(), // Add AI service
        humanLikeDelay: new HumanLikeDelay() // Add human-like delay service
      };

      this.bots.set(config.id, botData);
      this.setupBotEvents(botData);
      
      // Emit initial state
      this.emitBotUpdate(config.id);
      
      // Initialize the client
      await client.initialize();
      
      return botData;
      
    } catch (error) {
      console.error(`Error restoring bot ${config.id}:`, error);
      // Update the config to mark as inactive if restoration fails
      await this.botPersistence.saveBotConfig({
        ...config,
        isActive: false,
        error: error.message
      });
    }
  }

  // Save all bot data and conversations
  async saveAllData() {
    try {
      // Save all bot configurations
      for (const [botId, botData] of this.bots.entries()) {
        await this.botPersistence.saveBotConfig(botData);
      }
      
      // Save conversation states from all bots
      const allConversations = new Map();
      for (const [botId, botData] of this.bots.entries()) {
        if (botData.conversationFlowService && botData.conversationFlowService.conversations) {
          // Merge conversations from all bots with bot prefix to avoid conflicts
          for (const [contactId, conversation] of botData.conversationFlowService.conversations.entries()) {
            allConversations.set(`${botId}:${contactId}`, conversation);
          }
        }
      }
      
      if (allConversations.size > 0) {
        await this.botPersistence.saveConversations(allConversations);
      }
      
    } catch (error) {
      console.error('Error saving all data:', error);
    }
  }

  async createBot(name = null) {
    const botId = uuidv4();
    const botName = name || `Bot-${Date.now()}`;
    
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: botId,
        dataPath: './sessions'
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    const botData = {
      id: botId,
      name: botName,
      client,
      status: 'initializing',
      qrCode: null,
      phoneNumber: null,
      isActive: false,
      messageCount: 0,
      lastActivity: null,
      createdAt: new Date(),
      processedMessages: new Set(), // Track processed message IDs to prevent duplicates
      isProcessing: false, // Flag to prevent concurrent message processing
      chatCooldowns: new Map(), // Track last response time per chat to prevent spam
      cooldownWarnings: new Map(), // Track cooldown warning messages to prevent spam
      conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService()), // Add conversation flow service with dependencies
      groqService: new GroqService(), // Add AI service
      humanLikeDelay: new HumanLikeDelay() // Add human-like delay service
    };

    this.bots.set(botId, botData);
    this.setupBotEvents(botData);
    
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
    
    try {
      await client.initialize();
      this.emitBotUpdate(botId);
      return botId;
    } catch (error) {
      console.error(`Error initializing bot ${botId}:`, error);
      botData.status = 'error';
      botData.error = error.message;
      this.emitBotUpdate(botId);
      throw error;
    }
  }

  setupBotEvents(botData) {
    const { client, id } = botData;

    client.on('qr', async (qr) => {
      // Skip QR generation for restored bots that should already be authenticated
      if (botData.isRestoring) {
        console.log(`Skipping QR generation for restored bot ${id} - should already be authenticated`);
        return;
      }
      
      // Additional check: if bot is already active, don't generate QR
      if (botData.isActive) {
        console.log(`Skipping QR generation for active bot ${id}`);
        return;
      }
      
      try {
        const qrCodeDataURL = await QRCode.toDataURL(qr);
        botData.qrCode = qrCodeDataURL;
        botData.status = 'waiting_for_scan';
        this.emitBotUpdate(id);
        console.log(`QR Code generated for bot ${id}`);
      } catch (error) {
        console.error('Error generating QR code:', error);
      }
    });

    client.on('ready', () => {
      botData.status = 'ready';
      botData.isActive = true;
      botData.phoneNumber = client.info?.wid?.user || 'Unknown';
      botData.lastActivity = new Date();
      botData.isRestoring = false; // Clear restoration flag
      this.emitBotUpdate(id);
      // Save bot state when ready (with a small delay to avoid rapid saves)
      setTimeout(() => {
        this.botPersistence.saveBotConfig(botData);
      }, 1000);
      console.log(`Bot ${id} is ready!`);
    });

    client.on('authenticated', () => {
      botData.status = 'authenticated';
      botData.isRestoring = false; // Clear restoration flag
      this.emitBotUpdate(id);
      // Don't save state here - wait for 'ready' event
      console.log(`Bot ${id} authenticated`);
    });

    client.on('auth_failure', (msg) => {
      botData.status = 'auth_failed';
      botData.error = msg;
      botData.isActive = false;
      this.emitBotUpdate(id);
      // Save bot state on auth failure
      this.botPersistence.saveBotConfig(botData);
      console.log(`Bot ${id} authentication failed:`, msg);
    });

    client.on('disconnected', (reason) => {
      botData.status = 'disconnected';
      botData.isActive = false;
      botData.error = reason;
      this.emitBotUpdate(id);
      // Save bot state when disconnected
      this.botPersistence.saveBotConfig(botData);
      console.log(`Bot ${id} disconnected:`, reason);
    });

    client.on('message_create', async (message) => {
      // Only respond to messages received by the bot, not sent by it
      if (message.fromMe) return;
      
      // Prevent duplicate message processing
      const messageId = message.id._serialized || message.id;
      if (botData.processedMessages.has(messageId)) {
        console.log(`Bot ${id} - Duplicate message detected, skipping: ${messageId}`);
        return;
      }
      
      // Add message ID to processed set
      botData.processedMessages.add(messageId);
      
      // Clean up old message IDs (keep only last 100 to prevent memory leak)
      if (botData.processedMessages.size > 100) {
        const messageIds = Array.from(botData.processedMessages);
        const toRemove = messageIds.slice(0, messageIds.length - 100);
        toRemove.forEach(id => botData.processedMessages.delete(id));
      }
      
      try {
        await this.handleMessage(botData, message);
      } catch (error) {
        console.error(`Error handling message for bot ${id}:`, error);
        // Remove message ID from processed set if processing failed
        botData.processedMessages.delete(messageId);
      }
    });
  }

  async handleMessage(botData, message) {
    if (!botData.isActive) return;

    // Check if bot is currently processing a message (rate limiting)
    if (botData.isProcessing) {
      console.log(`Bot ${botData.id} is already processing a message, skipping`);
      return;
    }

    // Get chat info early to check cooldown BEFORE setting processing flag
    let chat, chatId;
    try {
      chat = await message.getChat();
      chatId = chat.id._serialized;
    } catch (error) {
      console.error(`Error getting chat info for bot ${botData.id}:`, error);
      return;
    }
    
    // Check chat-specific cooldown (configurable cooldown between responses to same chat)
    const lastResponseTime = botData.chatCooldowns.get(chatId);
    const now = Date.now();
    const cooldownPeriod = parseInt(process.env.BOT_CHAT_COOLDOWN_MS) || 6000; // Default 6 seconds
    
    if (lastResponseTime && (now - lastResponseTime) < cooldownPeriod) {
      const remainingCooldown = Math.ceil((cooldownPeriod - (now - lastResponseTime)) / 1000);
      console.log(`Bot ${botData.id} - Chat ${chatId} is in cooldown for ${remainingCooldown} more seconds`);
      return; // Just ignore messages during cooldown without any warning
    }

    // Set processing flag AFTER cooldown check to prevent getting stuck
    botData.isProcessing = true;

    try {

      // Update bot activity
      botData.messageCount++;
      botData.lastActivity = new Date();
      this.emitBotUpdate(botData.id);

      // Get contact info
      const contact = await message.getContact();
      const contactName = contact.name || contact.pushname || contact.number;
      
      console.log(`Bot ${botData.id} received message from ${contactName}: ${message.body}`);

      // Add human-like typing delay using the bot's delay service
      await botData.humanLikeDelay.simulateTyping(chat);

      let response;

      // Use ConversationFlowService for all message handling
      // It will handle the complete conversation flow like the original Java system
      response = await botData.conversationFlowService.processIncomingMessage(
        contact.number,
        message.body,
        contactName
      );

      // Add human-like delay before sending response
      await botData.humanLikeDelay.waitBeforeResponse();

      // Send the response
      await chat.sendMessage(response);
      
      // Update chat cooldown
      botData.chatCooldowns.set(chatId, Date.now());
      
      // Clean up old cooldowns (keep only last 50 chats to prevent memory leak)
      if (botData.chatCooldowns.size > 50) {
        const entries = Array.from(botData.chatCooldowns.entries());
        const toRemove = entries.slice(0, entries.length - 50);
        toRemove.forEach(([id]) => botData.chatCooldowns.delete(id));
      }
      
      console.log(`Bot ${botData.id} sent response: ${response.substring(0, 100)}...`);
      
    } catch (error) {
      console.error(`Error generating/sending response for bot ${botData.id}:`, error);
      
      try {
        // Send a fallback message with human-like delay
        await botData.humanLikeDelay.waitBeforeResponse();
        await chat.sendMessage('Sorry, I\'m having trouble responding right now. Please try again later.');
        
        // Update chat cooldown even for fallback messages
        botData.chatCooldowns.set(chatId, Date.now());
      } catch (fallbackError) {
        console.error(`Error sending fallback message for bot ${botData.id}:`, fallbackError);
      }
    } finally {
      // Always clear processing flag
      botData.isProcessing = false;
    }
  }

  async stopBot(botId) {
    const bot = this.bots.get(botId);
    if (!bot) return false;

    try {
      if (bot.client) {
        await bot.client.destroy();
      }
      bot.status = 'stopped';
      bot.isActive = false;
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
      // Remove bot configuration from persistence
      await this.botPersistence.removeBotConfig(botId);
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
      // Stop the current client
      if (bot.client) {
        await bot.client.destroy();
      }

      // Reset bot data
      bot.status = 'initializing';
      bot.qrCode = null;
      bot.isActive = false;
      bot.error = null;
      this.emitBotUpdate(botId);

      // Create new client with same auth strategy
      const newClient = new Client({
        authStrategy: new LocalAuth({
          clientId: botId,
          dataPath: './sessions'
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        }
      });

      bot.client = newClient;
      this.setupBotEvents(bot);
      
      await newClient.initialize();
      return true;
    } catch (error) {
      console.error(`Error restarting bot ${botId}:`, error);
      bot.status = 'error';
      bot.error = error.message;
      this.emitBotUpdate(botId);
      return false;
    }
  }
}

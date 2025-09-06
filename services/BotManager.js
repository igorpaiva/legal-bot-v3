import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { GroqService } from './GroqService.js';
import { HumanLikeDelay } from './HumanLikeDelay.js';
import { LegalTriageService } from './LegalTriageService.js';
import { BotPersistence } from './BotPersistence.js';
import { ConversationFlowService } from './ConversationFlowService.js';
import { AudioTranscriptionService } from './AudioTranscriptionService.js';
import { PdfProcessingService } from './PdfProcessingService.js';

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
        assistantName: config.assistantName || 'Ana', // Use saved assistant name or default
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
        lastMessageTimes: new Map(), // Track user message timing for spam prevention
        error: null,
        isRestoring: true, // Flag to indicate this is a restoration
        conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), config.assistantName || 'Ana'), // Pass assistant name
        groqService: new GroqService(), // Add AI service
        humanLikeDelay: new HumanLikeDelay(), // Add human-like delay service
        audioTranscriptionService: new AudioTranscriptionService(), // Add audio transcription service
        pdfProcessingService: new PdfProcessingService() // Add PDF processing service
      };

      this.bots.set(config.id, botData);
      this.setupBotEvents(botData);
      this.setupRetryCallbacks(botData);
      
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

  async createBot(name = null, assistantName = null) {
    const botId = uuidv4();
    const botName = name || `Bot-${Date.now()}`;
    const defaultAssistantName = assistantName || 'Ana';
    
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
      assistantName: defaultAssistantName, // Add assistant name field
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
      lastMessageTimes: new Map(), // Track user message timing for spam prevention
      cooldownWarnings: new Map(), // Track cooldown warning messages to prevent spam
      conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), defaultAssistantName), // Pass assistant name to conversation service
      groqService: new GroqService(), // Add AI service
      humanLikeDelay: new HumanLikeDelay(), // Add human-like delay service
      audioTranscriptionService: new AudioTranscriptionService(), // Add audio transcription service
      pdfProcessingService: new PdfProcessingService() // Add PDF processing service
    };

    this.bots.set(botId, botData);
    this.setupBotEvents(botData);
    this.setupRetryCallbacks(botData);
    
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
    
    // Check for spam prevention (very rapid messages only)
    const lastResponseTime = botData.chatCooldowns.get(chatId);
    const lastMessageTime = botData.lastMessageTimes?.get(chatId) || 0;
    const now = Date.now();
    
    // Track when user sent this message
    if (!botData.lastMessageTimes) {
      botData.lastMessageTimes = new Map();
    }
    
    // Only apply cooldown if:
    // 1. User sent messages very rapidly (less than 2 seconds apart) AND
    // 2. Bot recently responded (less than 3 seconds ago)
    const messageTooFast = (now - lastMessageTime) < 2000; // Messages less than 2 seconds apart
    const botRecentlyResponded = lastResponseTime && (now - lastResponseTime) < 3000; // Bot responded less than 3 seconds ago
    
    if (messageTooFast && botRecentlyResponded) {
      const remainingCooldown = Math.ceil((3000 - (now - lastResponseTime)) / 1000);
      console.log(`Bot ${botData.id} - Chat ${chatId} rate limited for ${remainingCooldown} more seconds (spam prevention)`);
      return; // Prevent spam but allow normal conversation flow
    }
    
    // Update last message time for this chat
    botData.lastMessageTimes.set(chatId, now);

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
      
      console.log(`Bot ${botData.id} received message from ${contactName} - Type: ${message.type}`);

      let messageText = '';
      
      // Handle different message types
      if (message.type === 'ptt' || message.type === 'audio') {
        // Handle audio/voice messages
        console.log(`Bot ${botData.id} - Processing audio message from ${contactName}`);
        
        try {
          // Download and transcribe audio
          const media = await message.downloadMedia();
          const transcription = await botData.audioTranscriptionService.transcribeAudio(media);
          
          if (transcription) {
            messageText = transcription;
            console.log(`Bot ${botData.id} - Audio transcribed: ${transcription.substring(0, 100)}...`);
          } else {
            messageText = 'Desculpe, não consegui entender o áudio. Pode tentar enviar uma mensagem de texto?';
            console.log(`Bot ${botData.id} - Failed to transcribe audio`);
          }
        } catch (error) {
          console.error(`Bot ${botData.id} - Error processing audio:`, error);
          messageText = 'Desculpe, tive problemas para processar o áudio. Pode tentar enviar uma mensagem de texto?';
        }
      } else if (message.type === 'document') {
        // Handle document messages (including PDFs)
        console.log(`Bot ${botData.id} - Processing document from ${contactName}`);
        
        try {
          // Download the document
          const media = await message.downloadMedia();
          
          // Check if it's a PDF
          if (media.mimetype && botData.pdfProcessingService.isPdfMimetype(media.mimetype)) {
            console.log(`Bot ${botData.id} - Processing PDF document from ${contactName}`);
            
            // Process PDF and extract text
            const pdfText = await botData.pdfProcessingService.processPdf(media);
            
            if (pdfText && !pdfText.includes('Desculpe')) {
              // Format the PDF text for legal context
              messageText = botData.pdfProcessingService.formatPdfTextForLegal(pdfText);
              console.log(`Bot ${botData.id} - PDF processed: ${pdfText.substring(0, 200)}...`);
            } else {
              // PDF processing failed - send error message directly and return
              console.log(`Bot ${botData.id} - Failed to process PDF, sending error message directly`);
              
              // Add human-like delay before sending error response
              await botData.humanLikeDelay.simulateReading(pdfText.length);
              await botData.humanLikeDelay.simulateTyping(chat);
              await botData.humanLikeDelay.waitBeforeResponse();
              
              // Send error message directly to user
              await this.sendLongMessage(chat, pdfText, botData.humanLikeDelay);
              console.log(`Bot ${botData.id} sent PDF error response to ${contactName}: ${pdfText.substring(0, 100)}...`);
              
              return; // Don't process this through conversation flow
            }
          } else {
            // Unsupported document type - send error message directly and return
            const errorMessage = 'Desculpe, apenas documentos PDF são suportados. Pode enviar um PDF ou me contar sobre o documento por texto/áudio?';
            console.log(`Bot ${botData.id} - Unsupported document type: ${media.mimetype}, sending error directly`);
            
            // Add human-like delay before sending error response
            await botData.humanLikeDelay.simulateReading(errorMessage.length);
            await botData.humanLikeDelay.simulateTyping(chat);
            await botData.humanLikeDelay.waitBeforeResponse();
            
            // Send error message directly to user
            await this.sendLongMessage(chat, errorMessage, botData.humanLikeDelay);
            console.log(`Bot ${botData.id} sent document type error to ${contactName}`);
            
            return; // Don't process this through conversation flow
          }
        } catch (error) {
          console.error(`Bot ${botData.id} - Error processing document:`, error);
          
          // Document processing error - send error message directly and return
          const errorMessage = 'Desculpe, tive problemas para processar o documento. Pode tentar enviar novamente ou me contar sobre o conteúdo por texto/áudio?';
          
          // Add human-like delay before sending error response
          await botData.humanLikeDelay.simulateReading(errorMessage.length);
          await botData.humanLikeDelay.simulateTyping(chat);
          await botData.humanLikeDelay.waitBeforeResponse();
          
          // Send error message directly to user
          await this.sendLongMessage(chat, errorMessage, botData.humanLikeDelay);
          console.log(`Bot ${botData.id} sent document processing error to ${contactName}`);
          
          return; // Don't process this through conversation flow
        }
      } else if (message.type === 'chat' && message.body) {
        // Handle regular text messages
        messageText = message.body;
        console.log(`Bot ${botData.id} - Text message: ${messageText.substring(0, 100)}...`);
      } else {
        // Handle unsupported message types
        console.log(`Bot ${botData.id} - Unsupported message type: ${message.type}`);
        messageText = 'Desculpe, posso responder a mensagens de texto, áudio e documentos PDF. Como posso ajudá-lo hoje?';
      }

      // Simulate reading the message first (longer messages take more time to read)
      await botData.humanLikeDelay.simulateReading(messageText.length);

      // Skip processing if no valid message text was extracted
      if (!messageText || messageText.trim().length === 0) {
        console.log(`Bot ${botData.id} - No valid message text to process, skipping`);
        return;
      }

      // Add human-like typing delay using the bot's delay service
      await botData.humanLikeDelay.simulateTyping(chat);

      let response;

      // Use ConversationFlowService for all message handling
      // It will handle the complete conversation flow like the original Java system
      response = await botData.conversationFlowService.processIncomingMessage(
        contact.number,
        messageText,
        contactName
      );

      // Add human-like delay before sending response
      await botData.humanLikeDelay.waitBeforeResponse();

      // Send the response (split if too long for WhatsApp)
      await this.sendLongMessage(chat, response, botData.humanLikeDelay);
      
      // Update chat cooldown
      botData.chatCooldowns.set(chatId, Date.now());
      
      // Clean up old cooldowns and message times (keep only last 50 chats to prevent memory leak)
      if (botData.chatCooldowns.size > 50) {
        const entries = Array.from(botData.chatCooldowns.entries());
        const toRemove = entries.slice(0, entries.length - 50);
        toRemove.forEach(([id]) => {
          botData.chatCooldowns.delete(id);
          botData.lastMessageTimes?.delete(id);
        });
      }
      
      console.log(`Bot ${botData.id} sent response to ${contactName}: ${response.substring(0, 100)}...`);
      
    } catch (error) {
      console.error(`Error generating/sending response for bot ${botData.id}:`, error);
      
      try {
        // Send a fallback message with human-like delay
        await botData.humanLikeDelay.waitBeforeResponse();
        await chat.sendMessage('Desculpe, estou com dificuldades técnicas. Tente novamente mais tarde.');
        
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
      assistantName: bot.assistantName, // Include assistant name
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

  setupRetryCallbacks(botData) {
    const onRetrySuccess = async (phone, response) => {
      try {
        // Find the chat for this phone number and send the retry response
        const contacts = await botData.client.getContacts();
        const contact = contacts.find(c => c.number === phone);
        
        if (contact) {
          const chat = await contact.getChat();
          
          // Add human-like delay
          await botData.humanLikeDelay.simulateTyping(chat);
          await botData.humanLikeDelay.waitBeforeResponse();
          
          // Send the successful retry response (split if too long)
          await this.sendLongMessage(chat, response, botData.humanLikeDelay);
          
          console.log(`Retry success message sent to ${phone}: ${response.substring(0, 100)}...`);
        }
      } catch (error) {
        console.error(`Error sending retry success message to ${phone}:`, error);
      }
    };

    const onRetryFailed = async (phone, failMessage) => {
      try {
        // Find the chat for this phone number and send the failure message
        const contacts = await botData.client.getContacts();
        const contact = contacts.find(c => c.number === phone);
        
        if (contact) {
          const chat = await contact.getChat();
          
          // Add human-like delay
          await botData.humanLikeDelay.waitBeforeResponse();
          
          // Send the failure message
          await chat.sendMessage(failMessage);
          
          console.log(`Retry failed message sent to ${phone}: ${failMessage}`);
        }
      } catch (error) {
        console.error(`Error sending retry failed message to ${phone}:`, error);
      }
    };

    // Set the callbacks in the conversation flow service
    botData.conversationFlowService.setRetryCallbacks(onRetrySuccess, onRetryFailed);
  }

  /**
   * Send long messages by splitting them if they exceed WhatsApp's character limit
   */
  async sendLongMessage(chat, message, humanLikeDelay) {
    const MAX_WHATSAPP_MESSAGE_LENGTH = 4000; // Safe limit under WhatsApp's 4096
    
    if (message.length <= MAX_WHATSAPP_MESSAGE_LENGTH) {
      // Message is short enough, send normally
      await chat.sendMessage(message);
      return;
    }
    
    // Split long message into parts
    const parts = this.splitMessage(message, MAX_WHATSAPP_MESSAGE_LENGTH);
    
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        // Add a small delay between parts to seem more natural
        await humanLikeDelay.sleep(1000 + Math.random() * 2000); // 1-3 seconds
      }
      
      const part = parts[i];
      const partIndicator = parts.length > 1 ? ` (${i + 1}/${parts.length})` : '';
      
      await chat.sendMessage(part + partIndicator);
    }
  }

  /**
   * Split a message into smaller parts, trying to break at natural points
   */
  splitMessage(message, maxLength) {
    if (message.length <= maxLength) {
      return [message];
    }
    
    const parts = [];
    let remaining = message;
    
    while (remaining.length > maxLength) {
      let splitIndex = maxLength;
      
      // Try to find a good breaking point (sentence end, paragraph, etc.)
      const breakPoints = ['. ', '.\n', '? ', '?\n', '! ', '!\n'];
      let bestBreak = -1;
      
      for (const breakPoint of breakPoints) {
        const lastIndex = remaining.lastIndexOf(breakPoint, maxLength - breakPoint.length);
        if (lastIndex > bestBreak && lastIndex > maxLength * 0.7) { // Don't break too early
          bestBreak = lastIndex + breakPoint.length;
        }
      }
      
      if (bestBreak > 0) {
        splitIndex = bestBreak;
      }
      
      parts.push(remaining.substring(0, splitIndex).trim());
      remaining = remaining.substring(splitIndex).trim();
    }
    
    if (remaining.length > 0) {
      parts.push(remaining);
    }
    
    return parts;
  }
}

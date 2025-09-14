import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { GroqService } from './GroqService.js';
import { HumanLikeDelay } from './HumanLikeDelay.js';
import { LegalTriageService } from './LegalTriageService.js';
import DatabaseService from './DatabaseService.js';
import { ConversationFlowService } from './ConversationFlowService.js';
import { AudioTranscriptionService } from './AudioTranscriptionService.js';
import { PdfProcessingService } from './PdfProcessingService.js';
import GoogleDriveService from './GoogleDriveService.js';

export class BotManager {
  constructor(io) {
    this.io = io;
    this.bots = new Map(); // Initialize the bots Map
    this.initializingBots = new Set(); // Track bots being initialized to prevent conflicts
    
    // Load persisted bots on startup
    this.loadPersistedData();
  }

  // Load persisted bots and conversations
  async loadPersistedData() {
    try {
      console.log('Loading persisted bot data...');
      
      // Load bot configurations from database
      const botConfigs = DatabaseService.getAllBots();
      
      for (const config of botConfigs) {
        // Try to restore bots that were previously active or authenticated
        if (config.isActive || config.status === 'ready' || config.status === 'authenticated') {
          console.log(`Restoring bot: ${config.name} (${config.id}) - Status: ${config.status}`);
          await this.restoreBot(config);
          
          // Load conversations for this bot from database
          const botData = this.bots.get(config.id);
          if (botData && botData.conversationFlowService) {
            // Use the new database loading method
            await botData.conversationFlowService.loadConversationsFromDatabase(config.id);
          }
        } else {
          console.log(`Skipping inactive bot: ${config.name} (${config.id}) - Status: ${config.status}`);
        }
      }
      
      console.log(`Loaded ${botConfigs.length} bot configurations`);
      
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
        ownerId: config.ownerId, // Add owner ID from database config
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
        conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), config.assistantName || 'Ana', this), // Pass assistant name and botManager
        groqService: new GroqService(), // Add AI service
        humanLikeDelay: new HumanLikeDelay(), // Add human-like delay service
        audioTranscriptionService: new AudioTranscriptionService(), // Add audio transcription service
        pdfProcessingService: new PdfProcessingService(), // Add PDF processing service
        googleDriveService: new GoogleDriveService() // Add Google Drive service
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
      DatabaseService.updateBot(config.id, {
        isActive: false,
        status: 'error',
        lastActivity: new Date().toISOString()
      });
    }
  }

  // Save all bot data and conversations
  async saveAllData() {
    try {
      // Save all bot configurations to database
      for (const [botId, botData] of this.bots.entries()) {
        try {
          DatabaseService.updateBot(botId, {
            name: botData.name,
            assistantName: botData.assistantName,
            status: botData.status,
            phoneNumber: botData.phoneNumber,
            isActive: botData.isActive,
            messageCount: botData.messageCount,
            lastActivity: botData.lastActivity ? botData.lastActivity.toISOString() : null
          });
        } catch (error) {
          console.error(`Error saving bot ${botId} config:`, error);
        }
      }
      
      // Save conversation states from all bots to database
      for (const [botId, botData] of this.bots.entries()) {
        if (botData.conversationFlowService && botData.conversationFlowService.conversations) {
          for (const [contactId, conversation] of botData.conversationFlowService.conversations.entries()) {
            try {
              // Check if conversation exists, update or create
              const existingConversation = DatabaseService.getConversationByBotAndPhone(botId, contactId);
              if (existingConversation) {
                DatabaseService.updateConversation(existingConversation.id, {
                  status: conversation.status || 'active',
                  legalField: conversation.legalField,
                  urgency: conversation.urgency,
                  summary: conversation.summary
                });
              } else {
                DatabaseService.createConversation({
                  id: uuidv4(),
                  botId: botId,
                  clientPhone: contactId,
                  clientName: conversation.clientName || 'Cliente',
                  status: conversation.status || 'active',
                  legalField: conversation.legalField,
                  urgency: conversation.urgency,
                  startTime: conversation.startTime ? conversation.startTime.toISOString() : new Date().toISOString(),
                  summary: conversation.summary
                });
              }
            } catch (error) {
              console.error(`Error saving conversation for bot ${botId}, contact ${contactId}:`, error);
            }
          }
        }
      }
      
    } catch (error) {
      console.error('Error saving all data:', error);
    }
  }

  async createBot(name = null, assistantName = null, ownerId = null) {
    const botId = uuidv4();
    const botName = name || `Bot-${Date.now()}`;
    const defaultAssistantName = assistantName || 'Ana';
    
    // Check if bot is already being initialized
    if (this.initializingBots.has(botId)) {
      console.log(`Bot ${botId} is already being initialized, skipping`);
      return null;
    }
    
    // Add to initializing set
    this.initializingBots.add(botId);
    
    try {
      console.log(`Creating new WhatsApp client for bot ${botId} with session path: ./sessions`);
      
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
      ownerId: ownerId, // Add owner ID for user association
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
      isRestoring: false, // Flag to indicate if bot is being restored
      restorationTimeout: null, // Timeout handle for restoration attempts
      restorationAttempts: 0, // Counter for restoration attempts
      conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), defaultAssistantName, this), // Pass assistant name and botManager to conversation service
      groqService: new GroqService(), // Add AI service
      humanLikeDelay: new HumanLikeDelay(), // Add human-like delay service
      audioTranscriptionService: new AudioTranscriptionService(), // Add audio transcription service
      pdfProcessingService: new PdfProcessingService(), // Add PDF processing service
      googleDriveService: new GoogleDriveService() // Add Google Drive service
      };

      this.bots.set(botId, botData);
      this.setupBotEvents(botData);
      this.setupRetryCallbacks(botData);
      
      // Save bot to database
      try {
        DatabaseService.createBot({
          id: botId,
          name: botName,
          assistantName: defaultAssistantName,
          ownerId: ownerId,
          status: 'initializing',
          phoneNumber: null,
          isActive: false,
          messageCount: 0,
          lastActivity: null
        });
      } catch (error) {
        console.error(`Error saving bot to database:`, error);
      }
      
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
      
      await client.initialize();
      this.emitBotUpdate(botId);
      return botId;
    } catch (error) {
      console.error(`Error initializing bot ${botId}:`, error);
      
      // Clean up if bot exists in map
      if (this.bots.has(botId)) {
        const botData = this.bots.get(botId);
        botData.status = 'error';
        botData.error = error.message;
        this.emitBotUpdate(botId);
        
        // Update bot status in database
        try {
          DatabaseService.updateBot(botId, {
            status: 'error',
            lastActivity: new Date().toISOString()
          });
        } catch (dbError) {
          console.error(`Error updating bot status in database:`, dbError);
        }
      }
      
      throw error;
    } finally {
      // Remove from initializing set
      this.initializingBots.delete(botId);
    }
  }

  setupBotEvents(botData) {
    const { client, id } = botData;

    // Set up timeout for restoration attempts
    if (botData.isRestoring) {
      botData.restorationAttempts++;
      console.log(`Bot ${id} restoration attempt #${botData.restorationAttempts}`);
      
      // Increase timeout with each attempt to give more time for slow connections
      const timeoutDuration = 30000 + (botData.restorationAttempts * 10000); // 30s, 40s, 50s, etc.
      
      botData.restorationTimeout = setTimeout(async () => {
        console.log(`Restoration timeout reached for bot ${id} (attempt ${botData.restorationAttempts}) after ${timeoutDuration}ms`);
        
        // Clear restoration state
        botData.isRestoring = false;
        botData.restorationTimeout = null;
        
        // Strategy based on attempt number
        if (botData.restorationAttempts >= 3) {
          console.log(`Bot ${id} has failed ${botData.restorationAttempts} restoration attempts. Cleaning session and force restarting...`);
          await this.forceRestartBot(id);
          return;
        } else if (botData.restorationAttempts >= 2) {
          console.log(`Bot ${id} second restoration attempt failed. Cleaning session for fresh start...`);
          await this.cleanBotSession(id);
        }
        
        try {
          // Try to destroy the client to force session cleanup
          if (client && typeof client.destroy === 'function') {
            await client.destroy();
            console.log(`Bot ${id} client destroyed to clear session`);
          }
        } catch (error) {
          console.log(`Note: Could not destroy client for bot ${id} (may not be initialized yet):`, error.message);
        }
        
        // Update status and force re-initialization
        botData.status = 'initializing';
        botData.error = `Restoration timeout (attempt ${botData.restorationAttempts}) - session will be recreated`;
        this.emitBotUpdate(id);
        
        // Save status to database
        try {
          DatabaseService.updateBot(id, {
            status: 'initializing',
            lastActivity: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Error updating bot ${id} restoration timeout in database:`, error);
        }
      }, timeoutDuration); // Dynamic timeout based on attempt number
    }

    client.on('qr', async (qr) => {
      // Clear restoration timeout if QR is being generated
      if (botData.restorationTimeout) {
        clearTimeout(botData.restorationTimeout);
        botData.restorationTimeout = null;
      }

      // Allow QR generation if restoration has timed out or failed
      if (botData.isRestoring) {
        console.log(`Restoration failed for bot ${id}, generating QR code for re-authentication`);
        botData.isRestoring = false;
      }
      
      // Skip QR only if bot is actually ready and active
      if (botData.isActive && botData.status === 'ready') {
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
      // Clear restoration timeout on successful connection
      if (botData.restorationTimeout) {
        clearTimeout(botData.restorationTimeout);
        botData.restorationTimeout = null;
      }
      
      botData.status = 'ready';
      botData.isActive = true;
      botData.phoneNumber = client.info?.wid?.user || 'Unknown';
      botData.lastActivity = new Date();
      botData.isRestoring = false; // Clear restoration flag
      botData.restorationAttempts = 0; // Reset restoration attempts counter
      console.log(`Bot ${id} authenticated and ready!`);
      this.emitBotUpdate(id);
      // Save bot state when ready (with a small delay to avoid rapid saves)
      setTimeout(() => {
        try {
          DatabaseService.updateBot(id, {
            status: 'ready',
            isActive: true,
            phoneNumber: botData.phoneNumber,
            lastActivity: botData.lastActivity.toISOString()
          });
        } catch (error) {
          console.error(`Error updating bot ${id} in database:`, error);
        }
      }, 1000);
      console.log(`Bot ${id} is ready!`);
    });

    client.on('authenticated', () => {
      console.log(`Bot ${id} authenticated successfully`);
      
      // Clear restoration flag and timeout when successfully authenticated
      if (botData.isRestoring) {
        console.log(`Bot ${id} restoration completed successfully`);
        botData.isRestoring = false;
        if (botData.restorationTimeout) {
          clearTimeout(botData.restorationTimeout);
          botData.restorationTimeout = null;
        }
      }
      
      botData.status = 'authenticated';
      botData.error = null; // Clear any previous errors
      this.emitBotUpdate(id);
      // Don't save state here - wait for 'ready' event
    });

    client.on('auth_failure', (msg) => {
      console.log(`Bot ${id} authentication failed:`, msg);
      
      // Clear restoration flag and timeout on auth failure
      if (botData.isRestoring) {
        console.log(`Bot ${id} restoration failed - authentication error`);
        botData.isRestoring = false;
        if (botData.restorationTimeout) {
          clearTimeout(botData.restorationTimeout);
          botData.restorationTimeout = null;
        }
      }
      
      botData.status = 'auth_failed';
      botData.error = msg;
      botData.isActive = false;
      this.emitBotUpdate(id);
      
      // Save bot state on auth failure
      try {
        DatabaseService.updateBot(id, {
          status: 'auth_failed',
          isActive: false,
          lastActivity: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error updating bot ${id} auth failure in database:`, error);
      }
    });

    client.on('disconnected', (reason) => {
      console.log(`Bot ${id} disconnected:`, reason);
      
      // Clear restoration flag and timeout when disconnected
      if (botData.isRestoring) {
        console.log(`Bot ${id} restoration interrupted - disconnected`);
        botData.isRestoring = false;
        if (botData.restorationTimeout) {
          clearTimeout(botData.restorationTimeout);
          botData.restorationTimeout = null;
        }
      }
      
      botData.status = 'disconnected';
      botData.isActive = false;
      botData.error = reason;
      this.emitBotUpdate(id);
      
      // Save bot state when disconnected
      try {
        DatabaseService.updateBot(id, {
          status: 'disconnected',
          isActive: false,
          lastActivity: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error updating bot ${id} disconnection in database:`, error);
      }
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
    
    // Check if this is a media message (used in multiple places)
    const isMediaMessage = message.type === 'document' || message.type === 'image' || message.type === 'audio' || message.type === 'video';
    
    // Check if bot is currently processing a message (rate limiting)
    // Allow document/media messages to be processed even when bot is busy
    if (botData.isProcessing && !isMediaMessage) {
      console.log(`Bot ${botData.id} is already processing a message, skipping`);
      return;
    }
    
    // Only apply cooldown if:
    // 1. User sent messages very rapidly (less than 2 seconds apart) AND
    // 2. Bot recently responded (less than 3 seconds ago) AND
    // 3. It's not a document/media message (allow documents to be processed immediately)
    const messageTooFast = (now - lastMessageTime) < 2000; // Messages less than 2 seconds apart
    const botRecentlyResponded = lastResponseTime && (now - lastResponseTime) < 3000; // Bot responded less than 3 seconds ago
    
    if (messageTooFast && botRecentlyResponded && !isMediaMessage) {
      const remainingCooldown = Math.ceil((3000 - (now - lastResponseTime)) / 1000);
      console.log(`Bot ${botData.id} - Chat ${chatId} rate limited for ${remainingCooldown} more seconds (spam prevention)`);
      return; // Prevent spam but allow normal conversation flow
    }
    
    // Update last message time for this chat
    botData.lastMessageTimes.set(chatId, now);

    // Set processing flag AFTER cooldown check to prevent getting stuck
    // Don't set processing flag for media messages to allow multiple uploads
    if (!isMediaMessage) {
      botData.isProcessing = true;
    }

    try {

      // Update bot activity
      botData.messageCount++;
      botData.lastActivity = new Date();
      this.emitBotUpdate(botData.id);

      // Get contact info
      const contact = await message.getContact();
      const contactName = contact.name || contact.pushname || contact.number;
      const userPhone = contact.number;
      
      console.log(`Bot ${botData.id} received message from ${contactName} - Type: ${message.type}`);

      let messageText = '';
      
      // Handle different message types
      if (message.type === 'ptt' || message.type === 'audio') {
        // Handle audio/voice messages
        console.log(`Bot ${botData.id} - Processing audio message from ${contactName}`);
        
        try {
          // Download and transcribe audio
          const media = await message.downloadMedia();
          
          // Upload to Google Drive (if authenticated)
          await this.uploadMediaToGoogleDrive(botData, media, contactName, userPhone, 'audio');
          
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
          
          // Upload to Google Drive (if authenticated)
          await this.uploadMediaToGoogleDrive(botData, media, contactName, userPhone, 'document');
          
          // Check if it's a PDF
          if (media.mimetype && botData.pdfProcessingService.isPdfMimetype(media.mimetype)) {
            console.log(`Bot ${botData.id} - PDF document received from ${contactName} (content reading disabled)`);
            
            // PDF received - acknowledge receipt without reading content
            messageText = '[DOCUMENTO PDF ANEXADO]';
            console.log(`Bot ${botData.id} - PDF document acknowledged: ${contactName}`);
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
      } else if (message.type === 'image') {
        // Handle image messages
        console.log(`Bot ${botData.id} - Processing image from ${contactName}`);
        
        try {
          // Download the image
          const media = await message.downloadMedia();
          
          // Upload to Google Drive (if authenticated)
          await this.uploadMediaToGoogleDrive(botData, media, contactName, userPhone, 'image');
          
          // Use tag format similar to documents
          messageText = '[IMAGEM ANEXADA]';
          console.log(`Bot ${botData.id} - Image processed and uploaded to Google Drive`);
        } catch (error) {
          console.error(`Bot ${botData.id} - Error processing image:`, error);
          messageText = '[IMAGEM ANEXADA]';
        }
      } else if (message.type === 'video') {
        // Handle video messages
        console.log(`Bot ${botData.id} - Processing video from ${contactName}`);
        
        try {
          // Download the video
          const media = await message.downloadMedia();
          
          // Upload to Google Drive (if authenticated)
          await this.uploadMediaToGoogleDrive(botData, media, contactName, userPhone, 'video');
          
          // Use tag format similar to documents
          messageText = '[VIDEO ANEXADO]';
          console.log(`Bot ${botData.id} - Video processed and uploaded to Google Drive`);
        } catch (error) {
          console.error(`Bot ${botData.id} - Error processing video:`, error);
          messageText = '[VIDEO ANEXADO]';
        }
      } else if (message.type === 'chat' && message.body) {
        // Handle regular text messages
        messageText = message.body;
        console.log(`Bot ${botData.id} - Text message: ${messageText.substring(0, 100)}...`);
      } else {
        // Handle unsupported message types
        console.log(`Bot ${botData.id} - Unsupported message type: ${message.type}`);
        messageText = 'Desculpe, posso responder a mensagens de texto, áudio e aceitar documentos PDF. Como posso ajudá-lo hoje?';
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

      // Set up callback for message burst responses
      const sendBurstResponse = async (burstResponse) => {
        try {
          // Add human-like delay before sending burst response
          await botData.humanLikeDelay.waitBeforeResponse();
          
          // Send the burst response (split if too long for WhatsApp)
          await this.sendLongMessage(chat, burstResponse, botData.humanLikeDelay);
          
          console.log(`Bot ${botData.id} sent burst response to ${contactName}: ${burstResponse.substring(0, 100)}...`);
        } catch (error) {
          console.error(`Error sending burst response for bot ${botData.id}:`, error);
        }
      };

      // Set the callback for the conversation flow service
      botData.conversationFlowService.setSendResponseCallback(sendBurstResponse);

      // Use ConversationFlowService for all message handling
      // It will handle the complete conversation flow like the original Java system
      response = await botData.conversationFlowService.processIncomingMessage(
        userPhone,
        messageText,
        contactName
      );

      // Check if response is null (message burst waiting)
      if (!response) {
        console.log(`Bot ${botData.id} - Message added to burst, waiting for more messages`);
        return; // Don't send anything yet, waiting for message burst to complete
      }

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
      // Only clear processing flag for non-media messages (media messages don't set it)
      if (!isMediaMessage) {
        botData.isProcessing = false;
      }
    }
  }

  async stopBot(botId) {
    const bot = this.bots.get(botId);
    if (!bot) return false;

    try {
      // Clear any restoration timeout
      if (bot.restorationTimeout) {
        clearTimeout(bot.restorationTimeout);
        bot.restorationTimeout = null;
      }
      
      // Clear restoration flag
      bot.isRestoring = false;
      
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

  async forceRestartBot(botId) {
    console.log(`Force restarting bot ${botId} due to restoration issues`);
    
    const bot = this.bots.get(botId);
    if (!bot) {
      console.error(`Bot ${botId} not found for restart`);
      return false;
    }

    try {
      // Stop the bot completely
      await this.stopBot(botId);
      
      // Remove from memory
      this.bots.delete(botId);
      
      // Remove potentially corrupted session files
      await this.cleanBotSession(botId);
      
      // Update database status
      try {
        DatabaseService.updateBot(botId, {
          status: 'initializing',
          isActive: false,
          lastActivity: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error updating bot ${botId} restart in database:`, error);
      }
      
      // Wait a moment then restart
      setTimeout(() => {
        console.log(`Restarting bot ${botId} after force restart`);
        this.createBot(botId);
      }, 2000);
      
      return true;
    } catch (error) {
      console.error(`Error force restarting bot ${botId}:`, error);
      return false;
    }
  }

  async cleanBotSession(botId) {
    try {
      const sessionPath = `./sessions/session-${botId}`;
      console.log(`Cleaning potentially corrupted session for bot ${botId} at: ${sessionPath}`);
      
      // Check if session directory exists
      const { exec } = await import('child_process');
      const util = await import('util');
      const execPromise = util.promisify(exec);
      
      // Check if session exists and remove if corrupted
      try {
        await execPromise(`ls -la "${sessionPath}"`);
        console.log(`Session directory exists for bot ${botId}, removing for clean restart`);
        await execPromise(`rm -rf "${sessionPath}"`);
        console.log(`Session directory removed for bot ${botId}`);
      } catch (error) {
        console.log(`No existing session found for bot ${botId}, clean start available`);
      }
    } catch (error) {
      console.error(`Error cleaning session for bot ${botId}:`, error);
    }
  }

  async deleteBot(botId) {
    const success = await this.stopBot(botId);
    if (success) {
      this.bots.delete(botId);
      // Remove bot from database
      try {
        DatabaseService.deleteBot(botId);
      } catch (error) {
        console.error(`Error deleting bot ${botId} from database:`, error);
      }
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
      ownerId: bot.ownerId, // Include owner ID
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

    // Check if bot is already being initialized
    if (this.initializingBots.has(botId)) {
      console.log(`Bot ${botId} is already being restarted, skipping`);
      return false;
    }
    
    // Add to initializing set
    this.initializingBots.add(botId);

    try {
      console.log(`Restarting bot ${botId} - destroying current client`);
      
      // Clear any restoration timeout
      if (bot.restorationTimeout) {
        clearTimeout(bot.restorationTimeout);
        bot.restorationTimeout = null;
      }
      
      // Clear restoration flag
      bot.isRestoring = false;
      
      // Stop the current client with proper cleanup
      if (bot.client) {
        try {
          await bot.client.destroy();
          console.log(`Bot ${botId} client destroyed successfully`);
        } catch (destroyError) {
          console.log(`Note: Could not destroy client for bot ${botId}:`, destroyError.message);
        }
      }

      // Wait a moment to ensure session cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Reset bot data
      bot.status = 'initializing';
      bot.qrCode = null;
      bot.isActive = false;
      bot.error = null;
      bot.restorationAttempts = 0; // Reset restoration attempts
      this.emitBotUpdate(botId);

      console.log(`Creating new client for bot ${botId} after restart`);
      
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
    } finally {
      // Remove from initializing set
      this.initializingBots.delete(botId);
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

  /**
   * Upload media files to Google Drive client folder
   */
  async uploadMediaToGoogleDrive(botData, media, contactName, userPhone, mediaType) {
    try {
      // Check if Google Drive service is authenticated
      const authStatus = await botData.googleDriveService.checkAuthentication();
      
      if (!authStatus.authenticated) {
        console.log(`Bot ${botData.id} - Google Drive not authenticated, skipping upload`);
        return null;
      }

      // Get or find client information
      const client = botData.conversationFlowService.findOrCreateClient(userPhone);
      const clientName = client.name || contactName || 'Unknown Client';

      // Generate filename based on media type
      let fileName;
      let fileExtension = '';
      
      if (media.mimetype) {
        // Extract extension from mimetype
        const mimeTypeMap = {
          'audio/ogg': 'ogg',
          'audio/mpeg': 'mp3',
          'audio/mp4': 'm4a',
          'audio/wav': 'wav',
          'application/pdf': 'pdf',
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'video/mp4': 'mp4',
          'video/3gpp': '3gp',
          'application/msword': 'doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
        };
        
        fileExtension = mimeTypeMap[media.mimetype] || 'bin';
      }

      // Create filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fileName = `${mediaType}_${timestamp}.${fileExtension}`;

      // Convert media data to buffer
      const buffer = Buffer.from(media.data, 'base64');

      // Upload to client's Google Drive folder
      const uploadResult = await botData.googleDriveService.uploadClientDocument(
        clientName,
        userPhone,
        buffer,
        fileName,
        media.mimetype
      );

      console.log(`Bot ${botData.id} - Successfully uploaded ${mediaType} to Google Drive:`, uploadResult.name);
      
      return uploadResult;
    } catch (error) {
      console.error(`Bot ${botData.id} - Error uploading to Google Drive:`, error);
      // Don't throw error - just log it and continue with normal processing
      return null;
    }
  }
}

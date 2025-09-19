import { default as makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage, isJidBroadcast } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import DatabaseService from './DatabaseService.js';
import { GroqService } from './GroqService.js';
import { HumanLikeDelay } from './HumanLikeDelay.js';
import { LegalTriageService } from './LegalTriageService.js';
import { ConversationFlowService } from './ConversationFlowService.js';
import { AudioTranscriptionService } from './AudioTranscriptionService.js';
import { PdfProcessingService } from './PdfProcessingService.js';
import GoogleDriveService from './GoogleDriveService.js';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

export class BotManager {
  constructor(io) {
    this.io = io;
    this.bots = new Map();
    this.initializationLocks = new Map(); // Add locks to prevent concurrent initialization
    this.keepAliveTimers = new Map(); // Keep-alive timers for each bot
    this.globalInitLock = false; // Global lock to prevent simultaneous initializations
    
    // Message filtering configuration
    this.maxMessageAge = parseInt(process.env.MAX_MESSAGE_AGE_SECONDS) || 30; // Default: 30 seconds for first connection
    this.maxOfflineRecoveryHours = parseInt(process.env.MAX_OFFLINE_RECOVERY_HOURS) || 24; // Default: 24 hours
    
    console.log(`BotManager configured to recover offline messages from last ${this.maxOfflineRecoveryHours} hours (reconnections)`);
    console.log(`First connection filter: ${this.maxMessageAge} seconds`);
    
    // Load persisted bots on startup
    this.loadPersistedData();
    
    // Cleanup processed messages periodically to prevent memory leaks
    this.startPeriodicCleanup();
    
    // Start global keep-alive system
    this.startGlobalKeepAlive();
    
    // Note: Removed automatic cleanup - bots should persist until manually deleted
    // Only clean up on specific error conditions or manual removal
  }
  
  startPeriodicCleanup() {
    // Clean up processed messages every hour
    setInterval(() => {
      this.bots.forEach((bot, botId) => {
        if (bot.processedMessages && bot.processedMessages.size > 1000) {
          console.log(`🧹 Bot ${botId} - Clearing processed messages cache (${bot.processedMessages.size} items)`);
          bot.processedMessages.clear();
        }
      });
    }, 60 * 60 * 1000); // Every hour
  }
  
  startGlobalKeepAlive() {
    // Global keep-alive check every 5 minutes
    setInterval(() => {
      this.bots.forEach((bot, botId) => {
        if (bot.status === 'connected' && bot.socket) {
          this.performKeepAlive(botId, bot);
        }
      });
    }, 5 * 60 * 1000); // Every 5 minutes
    
    console.log('🔄 Global keep-alive system started (checks every 5 minutes)');
  }
  
  async performKeepAlive(botId, bot) {
    try {
      if (!bot.socket || bot.status !== 'connected') {
        return;
      }
      
      // Update last activity
      bot.lastActivity = new Date();
      
      // Send a simple ping to WhatsApp to keep connection alive
      // This is done by checking the socket state
      const state = bot.socket.readyState;
      
      if (state === bot.socket.CONNECTING) {
        console.log(`⏳ Bot ${botId} - Connection in progress, skipping keep-alive`);
        return;
      }
      
      if (state === bot.socket.CLOSED || state === bot.socket.CLOSING) {
        console.log(`⚠️ Bot ${botId} - Socket closed/closing, triggering reconnection`);
        if (!bot.manuallyStopped && !bot.isReconnecting) {
          this.handleConnectionLoss(botId, bot);
        }
        return;
      }
      
      // For connected sockets, send a lightweight query to maintain connection
      if (state === bot.socket.OPEN) {
        try {
          // Query presence (lightweight operation)
          await bot.socket.presenceSubscribe(bot.socket.user?.id);
          console.log(`💓 Bot ${botId} - Keep-alive successful`);
        } catch (error) {
          console.log(`⚠️ Bot ${botId} - Keep-alive failed:`, error.message);
          if (!bot.manuallyStopped && !bot.isReconnecting) {
            this.handleConnectionLoss(botId, bot);
          }
        }
      }
      
    } catch (error) {
      console.error(`❌ Bot ${botId} - Keep-alive error:`, error);
      if (!bot.manuallyStopped && !bot.isReconnecting) {
        this.handleConnectionLoss(botId, bot);
      }
    }
  }
  
  handleConnectionLoss(botId, bot) {
    console.log(`🔌 Bot ${botId} - Handling connection loss`);
    
    // Mark as disconnected
    bot.status = 'disconnected';
    bot.isReconnecting = true;
    bot.reconnectionAttempts = (bot.reconnectionAttempts || 0) + 1;
    
    // Emit update
    this.emitBotUpdate(botId);
    
    // Start reconnection with exponential backoff
    const delay = Math.min(5000 * Math.pow(1.5, bot.reconnectionAttempts - 1), 60000);
    
    console.log(`🔄 Bot ${botId} - Scheduling reconnection in ${delay}ms (attempt ${bot.reconnectionAttempts})`);
    
    bot.reconnectionTimer = setTimeout(async () => {
      if (bot.isReconnecting && !bot.manuallyStopped && bot.reconnectionAttempts <= 10) {
        console.log(`🔄 Bot ${botId} - Attempting reconnection (${bot.reconnectionAttempts}/10)`);
        try {
          // Wait for global lock to be released
          while (this.globalInitLock) {
            console.log(`⏳ Bot ${botId} waiting for global initialization lock for reconnection...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          // Acquire global lock
          this.globalInitLock = true;
          console.log(`🔐 Bot ${botId} acquired global initialization lock for reconnection`);
          
          await this.initializeBaileysBot(botId, bot.name, bot.assistantName);
          
          // Release global lock
          this.globalInitLock = false;
          console.log(`🔓 Bot ${botId} released global initialization lock for reconnection`);
          
        } catch (error) {
          console.error(`❌ Bot ${botId} - Reconnection failed:`, error);
          // Always release lock on error
          this.globalInitLock = false;
        }
      }
    }, delay);
  }
  
  setupBotKeepAlive(botId, bot) {
    // Clear any existing keep-alive timer
    if (this.keepAliveTimers.has(botId)) {
      clearInterval(this.keepAliveTimers.get(botId));
    }
    
    // Set up individual bot keep-alive (every 2 minutes)
    const keepAliveTimer = setInterval(() => {
      this.performKeepAlive(botId, bot);
    }, 2 * 60 * 1000); // Every 2 minutes
    
    this.keepAliveTimers.set(botId, keepAliveTimer);
    console.log(`💓 Bot ${botId} - Individual keep-alive timer started`);
  }
  
  clearBotKeepAlive(botId) {
    if (this.keepAliveTimers.has(botId)) {
      clearInterval(this.keepAliveTimers.get(botId));
      this.keepAliveTimers.delete(botId);
      console.log(`💓 Bot ${botId} - Keep-alive timer cleared`);
    }
  }

  async loadPersistedData() {
    try {
      console.log('📋 Loading persisted bot data from database...');
      
      const botConfigs = DatabaseService.getAllBotsExtended();
      
      for (const config of botConfigs) {
        // Restore bots that have connected before (have authentication data)
        // or are currently active, regardless of temporary disconnection status
        if (config.hasConnectedBefore || (config.isActive && config.status !== 'error')) {
          console.log(`🔄 Restoring bot: ${config.name} (${config.id})`);
          await this.restoreBot(config);
        } else {
          console.log(`⏭️  Skipping bot: ${config.name} (${config.id}) - Never connected before`);
        }
      }
      
      console.log(`✅ Loaded ${botConfigs.length} bot configurations`);
      
    } catch (error) {
      console.error('❌ Error loading persisted data:', error);
    }
  }

  async createBot(name = null, assistantName = null, ownerId = null) {
    const botId = uuidv4();
    const botName = name || `Bot-${Date.now()}`;
    const defaultAssistantName = assistantName || 'Ana';
    
    console.log(`🤖 Creating new WhatsApp bot ${botId} with Baileys`);

    try {
      // Create bot in database first
      await DatabaseService.createBotExtended({
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

      // Initialize Baileys connection
      await this.initializeBaileysBot(botId, botName, defaultAssistantName);
      
      return botId;
      
    } catch (error) {
      console.error(`❌ Error creating bot ${botId}:`, error);
      await DatabaseService.updateBotExtended(botId, {
        status: 'error',
        lastError: error.message
      });
      throw error;
    }
  }

  async initializeBaileysBot(botId, botName, assistantName) {
    try {
      console.log(`🚀 [INIT] Starting initialization for bot ${botId} (${botName})`);
      
      // Check if this bot is already being initialized
      if (this.initializationLocks.has(botId)) {
        console.log(`🔒 [INIT] Bot ${botId} is already being initialized, skipping duplicate call`);
        return;
      }
      
      // Set lock
      this.initializationLocks.set(botId, true);
      
      // Get bot data from database to include ownerId
      const botConfig = DatabaseService.getBotExtendedById(botId);
      
      // Check if bot already exists and is connected
      const existingBot = this.bots.get(botId);
      
      console.log(`🔍 [INIT] Bot ${botId} current state:`, {
        exists: !!existingBot,
        status: existingBot?.status,
        isInitializing: existingBot?.isInitializing,
        isReconnecting: existingBot?.isReconnecting,
        hasSocket: !!existingBot?.socket
      });
      
      // Prevent multiple simultaneous initializations of the same bot
      // But allow if it's stopped (manual restart)
      if (existingBot && (existingBot.isInitializing || existingBot.isReconnecting) && existingBot.status !== 'stopped') {
        console.log(`⚠️  Bot ${botId} is already being initialized or reconnecting, skipping`);
        this.initializationLocks.delete(botId);
        return;
      }
      
      if (existingBot && existingBot.status === 'connected' && existingBot.socket) {
        console.log(`⚠️  Bot ${botId} already connected, skipping initialization`);
        return;
      }
      
      // If there's an existing bot with a socket, close it first to avoid conflicts
      if (existingBot && existingBot.socket) {
        console.log(`🔄 Closing existing socket for bot ${botId} before reinitializing`);
        try {
          existingBot.socket.end();
        } catch (error) {
          console.error(`⚠️  Error closing existing socket:`, error);
        }
        // Wait a bit for the socket to close properly
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      const sessionPath = `./sessions/session-${botId}`;
      
      // Ensure session directory exists
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }
      
      // Check for potential session conflicts and clean if necessary
      const credPath = path.join(sessionPath, 'creds.json');
      if (fs.existsSync(credPath)) {
        console.log(`🔍 Checking session integrity for bot ${botId}`);
        // Add small delay for session consistency
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Create auth state
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      
      // Create logger
      const logger = pino({ 
        level: 'warn',
        stream: {
          write: () => {} // Silent logger
        }
      });

      // Create socket with keep-alive configurations
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We'll handle QR in frontend
        logger,
        browser: ['Legal Bot', 'Chrome', '1.0.0'],
        defaultQueryTimeoutMs: 60000,
        markOnlineOnConnect: true,
        // Keep-alive configurations
        keepAliveIntervalMs: 30000, // Send keep-alive every 30 seconds
        connectTimeoutMs: 60000, // Connection timeout
        qrTimeout: 60000, // QR timeout
        retryRequestDelayMs: 2000, // Delay between retries
        maxMsgRetryCount: 3, // Max retry attempts for messages
        // Performance optimizations
        shouldIgnoreJid: jid => isJidBroadcast(jid), // Ignore broadcasts
        shouldSyncHistoryMessage: () => false, // Don't sync history for performance
        generateHighQualityLinkPreview: false, // Disable link previews for performance
        // Connection settings
        waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat',
        connectCooldownMs: 10000, // Cooldown between connection attempts
      });

      // If bot already exists (reconnection), update it with new socket
      let botData;
      if (existingBot) {
        console.log(`🔄 Updating existing bot ${botId} with new socket`);
        botData = existingBot;
        botData.socket = sock;
        botData.saveCreds = saveCreds;
        botData.sessionPath = sessionPath;
        botData.status = 'initializing';
        botData.isReconnecting = true;
        botData.isInitializing = true;
        
        // Ensure services are initialized (in case they were lost during reconnection)
        if (!botData.conversationFlowService) {
          botData.conversationFlowService = new ConversationFlowService(new GroqService(), new LegalTriageService(), assistantName, this);
        }
        if (!botData.groqService) {
          botData.groqService = new GroqService();
        }
        if (!botData.humanLikeDelay) {
          botData.humanLikeDelay = new HumanLikeDelay();
        }
        if (!botData.audioTranscriptionService) {
          botData.audioTranscriptionService = new AudioTranscriptionService();
        }
        if (!botData.pdfProcessingService) {
          botData.pdfProcessingService = new PdfProcessingService();
        }
        if (!botData.googleDriveService) {
          botData.googleDriveService = new GoogleDriveService(botData.ownerId);
        }
      } else {
        // Create new bot data
        console.log(`🆕 Creating new bot data for ${botId}`);
        botData = {
          id: botId,
          name: botName,
          assistantName: assistantName,
          socket: sock,
          status: 'initializing',
          qrCode: null,
          phoneNumber: null,
          isActive: false,
          messageCount: 0,
          lastActivity: null,
          createdAt: new Date(),
          sessionPath: sessionPath,
          saveCreds: saveCreds,
          isRestoring: false,
          isReconnecting: false,
          isInitializing: true,
          ownerId: botConfig ? botConfig.ownerId : null, // Add ownerId from database
          hasConnectedBefore: botConfig ? !!botConfig.hasConnectedBefore : false, // True if bot has connected before
          processedMessages: new Set(), // Track processed messages to avoid duplicates
          // Initialize services
          conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), assistantName, this),
          groqService: new GroqService(),
          humanLikeDelay: new HumanLikeDelay(),
          audioTranscriptionService: new AudioTranscriptionService(),
          pdfProcessingService: new PdfProcessingService(),
          googleDriveService: new GoogleDriveService(botConfig ? botConfig.ownerId : null)
        };

        this.bots.set(botId, botData);
      }

      // Setup event handlers
      this.setupBaileysEvents(botData);
      
      // Load conversations from database for this bot
      try {
        console.log(`📁 Loading conversations from database for bot ${botId}`);
        await botData.conversationFlowService.loadConversationsFromDatabase(botId);
        console.log(`✅ Successfully loaded conversations for bot ${botId}`);
      } catch (error) {
        console.error(`❌ Error loading conversations for bot ${botId}:`, error);
      }
      
      // Mark initialization as complete
      botData.isInitializing = false;
      
      // Only emit bot-created event for truly new bots (not reconnections or restorations)
      // Bot is NEW only if it was just created (existingBot was null)
      const isNewBot = !existingBot;
      
      if (isNewBot) {
        console.log(`📢 Emitting bot-created event for new bot: ${botId}`);
        this.io.emit('bot-created', {
          id: botData.id,
          name: botData.name,
          status: botData.status,
          phoneNumber: botData.phoneNumber,
          isActive: botData.isActive,
          messageCount: botData.messageCount,
          lastActivity: botData.lastActivity,
          createdAt: botData.createdAt,
          qrCode: botData.qrCode
        });
      } else {
        console.log(`🔄 Skipping bot-created event for existing bot: ${botId} (reconnection/restoration)`);
      }
      
      this.emitBotUpdate(botId);
      
      // Clear initialization lock on success
      this.initializationLocks.delete(botId);
      console.log(`🔓 [INIT] Released lock for bot ${botId}`);
      
    } catch (error) {
      // Clear initialization lock on error
      this.initializationLocks.delete(botId);
      console.error(`❌ [INIT] Error initializing bot ${botId}:`, error);
      console.log(`🔓 [INIT] Released lock for bot ${botId} due to error`);
      throw error;
    }
  }

  setupBaileysEvents(botData) {
    const { socket, id, saveCreds } = botData;

    // Connection update handler
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      console.log(`🔄 Bot ${id} connection update:`, { connection, qr: !!qr });

      if (qr) {
        // Generate QR code for frontend
        console.log(`📱 QR Code generated for bot ${id}`);
        
        try {
          const qrCodeDataURL = await QRCode.toDataURL(qr, {
            width: 256,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          
          botData.qrCode = qrCodeDataURL;
          botData.status = 'waiting_for_scan';
          
          await DatabaseService.updateBotExtended(id, {
            status: 'waiting_for_scan',
            lastQrGenerated: new Date().toISOString()
          });
          
          this.emitBotUpdate(id);
          
        } catch (qrError) {
          console.error(`❌ Error generating QR code for bot ${id}:`, qrError);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        const errorMessage = lastDisconnect?.error?.message || '';
        const isReplaced = errorMessage.includes('replaced') || errorMessage.includes('conflict');
        
        console.log(`🔌 Bot ${id} connection closed. Should reconnect:`, shouldReconnect, 'Error:', errorMessage);
        
        // Initialize reconnection counter if not exists
        if (!botData.reconnectionAttempts) {
          botData.reconnectionAttempts = 0;
        }
        
        // If session was replaced by another connection, try to reconnect
        if (isReplaced) {
          console.log(`🔄 Bot ${id} session was replaced by another connection. Will attempt reconnection...`);
          botData.status = 'disconnected';
          
          await DatabaseService.updateBotExtended(id, {
            status: 'disconnected'
            // Keep isActive: true to allow manual reconnection
          });
          
          this.emitBotUpdate(id);
          
          // Try to reconnect after session conflict
          if (!botData.manuallyStopped) {
            this.handleConnectionLoss(id, botData);
          }
          return;
        }
        
        // Limit reconnection attempts to prevent infinite loops
        // Don't reconnect if bot was manually stopped
        if (shouldReconnect && !botData.isReconnecting && !botData.manuallyStopped && botData.reconnectionAttempts < 10) {
          botData.status = 'reconnecting';
          botData.isReconnecting = true;
          botData.reconnectionAttempts++;
          
          console.log(`🔄 Bot ${id} reconnection attempt ${botData.reconnectionAttempts}/10`);
          
          this.emitBotUpdate(id);
          
          // Exponential backoff for reconnection delay
          const delay = Math.min(5000 * Math.pow(1.5, botData.reconnectionAttempts - 1), 60000);
          
          // Store timer reference for cleanup
          botData.reconnectionTimer = setTimeout(async () => {
            if (botData.isReconnecting && !botData.manuallyStopped && botData.reconnectionAttempts <= 10) {
              console.log(`🔄 Reconnecting bot ${id}... (attempt ${botData.reconnectionAttempts})`);
              try {
                await this.initializeBaileysBot(id, botData.name, botData.assistantName);
              } catch (error) {
                console.error(`❌ Error during reconnection attempt for bot ${id}:`, error);
              }
            }
          }, delay);
        } else if (!shouldReconnect || botData.reconnectionAttempts >= 10 || botData.manuallyStopped) {
          if (botData.reconnectionAttempts >= 10) {
            console.log(`🛑 Bot ${id} reached maximum reconnection attempts (10). Stopping.`);
          }
          if (botData.manuallyStopped) {
            console.log(`🛑 Bot ${id} was manually stopped. Not reconnecting.`);
          }
          
          botData.status = botData.manuallyStopped ? 'stopped' : 'disconnected';
          // Keep isActive = true to allow restoration on restart
          // Only set isActive = false when manually deactivated by user
          botData.isReconnecting = false;
          botData.reconnectionAttempts = 0;
          
          await DatabaseService.updateBotExtended(id, {
            status: botData.manuallyStopped ? 'stopped' : 'disconnected'
            // Don't set isActive: false here - let it remain true for restoration
          });
          
          this.emitBotUpdate(id);
        }
      } else if (connection === 'open') {
        console.log(`✅ Bot ${id} connected successfully!`);
        console.log(`🔍 Bot ${id} - hasConnectedBefore status: ${botData.hasConnectedBefore} (type: ${typeof botData.hasConnectedBefore})`);
        
        // Cancel any pending reconnection timer
        if (botData.reconnectionTimer) {
          clearTimeout(botData.reconnectionTimer);
          botData.reconnectionTimer = null;
          console.log(`🔄 Cancelled pending reconnection timer for bot ${id}`);
        }
        
        // Stop any pending reconnection and reset counters/flags
        botData.isReconnecting = false;
        botData.reconnectionAttempts = 0;
        botData.isInitializing = false;
        // Reset manually stopped flag when bot connects successfully
        botData.manuallyStopped = false;
        
        botData.status = 'connected';
        botData.isActive = true;
        botData.lastActivity = new Date();
        botData.qrCode = null;
        
        // Mark as connected before if this is first successful connection
        if (!botData.hasConnectedBefore) {
          botData.hasConnectedBefore = true;
          console.log(`🎉 Bot ${id} - First successful connection! Will process offline messages on future reconnections.`);
          
          // Update database with has_connected_before = true
          try {
            await DatabaseService.updateBotExtended(id, { has_connected_before: 1 });
            console.log(`💾 Bot ${id} - Updated has_connected_before in database`);
          } catch (error) {
            console.error(`❌ Bot ${id} - Failed to update has_connected_before in database:`, error);
          }
        } else {
          console.log(`🔄 Bot ${id} - Reconnection detected! Will process offline messages.`);
        }
        
        console.log(`📋 Bot ${id} - Message age filter: ${botData.hasConnectedBefore ? 'flexible (reconnection)' : 'strict (first connection)'}`);
        
        console.log(`🔍 [DEBUG] Bot ${id} - Connection details:`, {
          hasConnectedBefore: botData.hasConnectedBefore,
          lastActivity: botData.lastActivity,
          maxOfflineRecoveryHours: this.maxOfflineRecoveryHours,
          maxMessageAge: this.maxMessageAge
        });
        
        // Get phone number
        try {
          const user = socket.user;
          if (user && user.id) {
            botData.phoneNumber = user.id.split(':')[0];
          }
        } catch (error) {
          console.error(`⚠️  Error getting phone number for bot ${id}:`, error);
        }
        
        await DatabaseService.updateBotExtended(id, {
          status: 'connected',
          isActive: true,
          phoneNumber: botData.phoneNumber,
          hasConnectedBefore: true,
          lastActivity: new Date().toISOString()
        });
        
        // Setup keep-alive for this bot
        this.setupBotKeepAlive(id, botData);
        
        this.emitBotUpdate(id);
      }
    });

    // Save credentials when they change
    socket.ev.on('creds.update', saveCreds);

    // Message handler
    socket.ev.on('messages.upsert', async (m) => {
      try {
        console.log(`🔍 [DEBUG] Bot ${id} - Received messages.upsert event:`, {
          messageCount: m.messages.length,
          type: m.type,
          firstMessageKey: m.messages[0]?.key
        });
        
        const message = m.messages[0];
        
        // Accept both 'notify' (real-time) and 'append' (offline sync) messages
        // For reconnections, we want to process 'append' messages to handle offline messages
        const shouldProcessMessage = !message.key.fromMe && (
          m.type === 'notify' || 
          (m.type === 'append' && botData.hasConnectedBefore)
        );
        
        if (shouldProcessMessage) {
          const remoteJid = message.key.remoteJid;
          const contactNumber = remoteJid.split('@')[0];
          
          console.log(`🔍 [DEBUG] Bot ${id} - Message type accepted: ${m.type} (hasConnectedBefore: ${botData.hasConnectedBefore})`);
          
          console.log(`🔍 [DEBUG] Bot ${id} - Processing message from ${contactNumber}:`, {
            messageId: message.key.id,
            timestamp: message.messageTimestamp,
            hasConnectedBefore: botData.hasConnectedBefore,
            lastActivity: botData.lastActivity
          });
          
          // **SMART MESSAGE FILTERING BY AGE**
          // Different behavior for first connection vs reconnections
          const messageTimestamp = (message.messageTimestamp?.low || message.messageTimestamp || Date.now() / 1000) * 1000;
          const now = Date.now();
          const messageAge = now - messageTimestamp;
          
          console.log(`🔍 [DEBUG] Bot ${id} - Message timing:`, {
            messageTimestamp: new Date(messageTimestamp).toISOString(),
            now: new Date(now).toISOString(),
            messageAgeSeconds: Math.round(messageAge/1000),
            hasConnectedBefore: botData.hasConnectedBefore
          });
          
          let maxMessageAge;
          let filterReason;
          
          if (!botData.hasConnectedBefore) {
            // **FIRST CONNECTION**: Strict filter - only messages from last few seconds
            maxMessageAge = this.maxMessageAge * 1000;
            filterReason = "first connection - avoiding history processing";
          } else {
            // **RECONNECTION**: Flexible filter - messages since last activity or configured hours
            const lastActivityTime = botData.lastActivity ? botData.lastActivity.getTime() : 0;
            const timeSinceLastActivity = now - lastActivityTime;
            const maxOfflineAge = this.maxOfflineRecoveryHours * 60 * 60 * 1000; // Configured hours
            
            console.log(`🔍 [DEBUG] Bot ${id} - Reconnection timing:`, {
              lastActivityTime: lastActivityTime ? new Date(lastActivityTime).toISOString() : 'never',
              timeSinceLastActivityHours: Math.round(timeSinceLastActivity / (60 * 60 * 1000) * 100) / 100,
              maxOfflineRecoveryHours: this.maxOfflineRecoveryHours
            });
            
            // If offline for less than configured limit, process messages since last activity
            // If offline for longer, process only last 2 hours
            if (timeSinceLastActivity < maxOfflineAge && lastActivityTime > 0) {
              maxMessageAge = timeSinceLastActivity + (5 * 60 * 1000); // Last activity + 5min buffer
              filterReason = "reconnection - processing since last activity";
            } else {
              maxMessageAge = 2 * 60 * 60 * 1000; // 2 hours for long offline
              filterReason = "reconnection - long offline, processing last 2 hours";
            }
          }
          
          console.log(`🔍 [DEBUG] Bot ${id} - Filter decision:`, {
            maxMessageAgeSeconds: Math.round(maxMessageAge/1000),
            messageAgeSeconds: Math.round(messageAge/1000),
            willProcess: messageAge <= maxMessageAge,
            filterReason
          });
          
          if (messageAge > maxMessageAge) {
            console.log(`📜 Bot ${id} - Skipping old message (${Math.round(messageAge/1000)}s ago, ${filterReason})`);
            return;
          } else if (!botData.hasConnectedBefore) {
            console.log(`📝 Bot ${id} - Processing recent message (${Math.round(messageAge/1000)}s ago, first connection, type: ${m.type})`);
          } else {
            console.log(`📬 Bot ${id} - Processing offline message (${Math.round(messageAge/1000)}s ago, reconnection, type: ${m.type})`);
          }
          
          // Prevent duplicate message processing
          const messageId = message.key.id;
          
          // Ensure processedMessages is initialized (defensive programming)
          if (!botData.processedMessages) {
            botData.processedMessages = new Set();
          }
          
          if (botData.processedMessages.has(messageId)) {
            console.log(`🔄 Bot ${id} - Duplicate message detected, skipping: ${messageId}`);
            return;
          }
          botData.processedMessages.add(messageId);
          
          console.log(`📨 Bot ${id} received message from: ${contactNumber}`);
          
          try {
            // Update bot stats
            botData.messageCount++;
            botData.lastActivity = new Date();
            this.emitBotUpdate(id);

            // Get contact name from push name or use number
            const contactName = message.pushName || contactNumber;
            
            let messageText = '';
            
            // Handle different message types in Baileys format
            if (message.message?.audioMessage || message.message?.pttMessage) {
              // Handle audio/voice messages
              console.log(`📢 Bot ${id} - Processing audio message from ${contactName}`);
              
              try {
                const audioMessage = message.message.audioMessage || message.message.pttMessage;
                const media = await downloadMediaMessage(message, 'buffer', {});
                
                // Upload to Google Drive
                await this.uploadMediaToGoogleDrive(botData, media, contactName, contactNumber, 'audio');
                
                // Transcribe audio - pass the Buffer directly
                const transcription = await botData.audioTranscriptionService.transcribeAudio(media);
                
                if (transcription) {
                  messageText = transcription;
                  console.log(`📢 Bot ${id} - Audio transcribed: ${transcription.substring(0, 100)}...`);
                } else {
                  messageText = 'Desculpe, não consegui entender o áudio. Pode tentar enviar uma mensagem de texto?';
                }
              } catch (error) {
                console.error(`❌ Bot ${id} - Error processing audio:`, error);
                messageText = 'Desculpe, tive problemas para processar o áudio. Pode tentar enviar uma mensagem de texto?';
              }
            } else if (message.message?.documentMessage) {
              // Handle document messages
              console.log(`📄 Bot ${id} - Processing document from ${contactName}`);
              
              try {
                const documentMessage = message.message.documentMessage;
                const media = await downloadMediaMessage(message, 'buffer', {});
                
                // Upload to Google Drive
                await this.uploadMediaToGoogleDrive(botData, media, contactName, contactNumber, 'document');
                
                // Check if it's a PDF
                if (documentMessage.mimetype && botData.pdfProcessingService.isPdfMimetype(documentMessage.mimetype)) {
                  console.log(`📄 Bot ${id} - PDF document received from ${contactName}`);
                  messageText = '[DOCUMENTO PDF ANEXADO]';
                } else {
                  // Unsupported document type
                  await this.sendMessage(botData, remoteJid, 'Desculpe, apenas documentos PDF são suportados. Pode enviar um PDF ou me contar sobre o documento por texto/áudio?');
                  return;
                }
              } catch (error) {
                console.error(`❌ Bot ${id} - Error processing document:`, error);
                await this.sendMessage(botData, remoteJid, 'Desculpe, tive problemas para processar o documento. Pode tentar enviar novamente ou me contar sobre o conteúdo por texto/áudio?');
                return;
              }
            } else if (message.message?.imageMessage) {
              // Handle image messages
              console.log(`🖼️ Bot ${id} - Processing image from ${contactName}`);
              
              try {
                const media = await downloadMediaMessage(message, 'buffer', {});
                
                // Upload to Google Drive
                await this.uploadMediaToGoogleDrive(botData, media, contactName, contactNumber, 'image');
                
                messageText = '[IMAGEM ANEXADA]';
                console.log(`🖼️ Bot ${id} - Image processed and uploaded to Google Drive`);
              } catch (error) {
                console.error(`❌ Bot ${id} - Error processing image:`, error);
                messageText = '[IMAGEM ANEXADA]';
              }
            } else if (message.message?.videoMessage) {
              // Handle video messages
              console.log(`🎥 Bot ${id} - Processing video from ${contactName}`);
              
              try {
                const media = await downloadMediaMessage(message, 'buffer', {});
                
                // Upload to Google Drive
                await this.uploadMediaToGoogleDrive(botData, media, contactName, contactNumber, 'video');
                
                messageText = '[VIDEO ANEXADO]';
                console.log(`🎥 Bot ${id} - Video processed and uploaded to Google Drive`);
              } catch (error) {
                console.error(`❌ Bot ${id} - Error processing video:`, error);
                messageText = '[VIDEO ANEXADO]';
              }
            } else {
              // Handle regular text messages
              messageText = message.message?.conversation || 
                           message.message?.extendedTextMessage?.text || '';
              
              if (messageText.trim()) {
                console.log(`� Bot ${id} processing text message from ${contactName}: ${messageText.substring(0, 50)}...`);
              } else {
                console.log(`⚠️ Bot ${id} - Unsupported message type from ${contactName}`);
                return;
              }
            }
            
            // Process message if we have text content
            if (messageText.trim()) {
              // Add human-like delay before processing
              if (botData.humanLikeDelay && typeof botData.humanLikeDelay.waitBeforeResponse === 'function') {
                await botData.humanLikeDelay.waitBeforeResponse();
              } else {
                console.log(`⚠️  Skipping humanLikeDelay - service not properly initialized`);
              }

              // Use ConversationFlowService for intelligent response
              const response = await botData.conversationFlowService.processIncomingMessage(
                contactNumber,
                messageText,
                contactName
              );

              // Validate response before sending
              if (!response || typeof response !== 'string' || response.trim().length === 0) {
                console.error(`⚠️  Invalid response received: ${typeof response}, value: ${response}`);
                throw new Error('Invalid response from conversation service');
              }

              // Send response with human-like delay
              await this.sendMessage(botData, remoteJid, response);
              
              console.log(`📤 Bot ${id} sent response to ${contactName}: ${response.substring(0, 100)}...`);
            }
          } catch (error) {
            console.error(`❌ Error processing message for bot ${id}:`, error);
            
            // Send fallback message
            try {
              await this.sendMessage(botData, remoteJid, 'Desculpe, estou com dificuldades técnicas. Tente novamente mais tarde.');
            } catch (fallbackError) {
              console.error(`❌ Error sending fallback message for bot ${id}:`, fallbackError);
            }
          }
        } else {
          console.log(`🔍 [DEBUG] Bot ${id} - Skipping message (reason: ${message.key.fromMe ? 'fromMe=true' : `type=${m.type}, hasConnectedBefore=${botData.hasConnectedBefore}`}):`, {
            fromMe: message.key.fromMe,
            type: m.type,
            hasConnectedBefore: botData.hasConnectedBefore,
            messageKey: message.key
          });
        }
      } catch (error) {
        console.error(`❌ Error in message handler for bot ${id}:`, error);
      }
    });
  }

  async sendMessage(botData, to, message) {
    const { socket, id, humanLikeDelay } = botData;
    
    try {
      // Validate message before processing
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        console.error(`❌ Invalid message for bot ${id}: ${typeof message}, value: ${message}`);
        return;
      }
      
      // Trim and validate final message
      const finalMessage = message.trim();
      if (finalMessage.length === 0) {
        console.error(`❌ Empty message after trim for bot ${id}`);
        return;
      }

      // Add human-like delay before sending (typing simulation)
      if (humanLikeDelay && typeof humanLikeDelay.waitBeforeResponse === 'function') {
        await humanLikeDelay.waitBeforeResponse();
      } else {
        console.log(`⚠️  Skipping humanLikeDelay in sendMessage - service not properly initialized`);
      }
      
      await socket.sendMessage(to, { text: finalMessage });
      console.log(`📤 Bot ${id} sent message to ${to.split('@')[0]}`);
      
    } catch (error) {
      console.error(`❌ Error sending message for bot ${id}:`, error);
    }
  }

  async restoreBot(config) {
    try {
      console.log(`🔄 Restoring bot ${config.name} (${config.id})`);
      
      const botData = {
        id: config.id,
        name: config.name,
        assistantName: config.assistantName,
        status: 'restoring',
        phoneNumber: config.phoneNumber,
        isActive: config.isActive !== false, // Restore as active unless explicitly set to false
        messageCount: config.messageCount || 0,
        lastActivity: config.lastActivity ? new Date(config.lastActivity) : null,
        createdAt: config.createdAt ? new Date(config.createdAt) : new Date(),
        sessionPath: config.sessionPath,
        qrCode: null,
        isRestoring: true,
        ownerId: config.ownerId, // Add missing ownerId field
        hasConnectedBefore: !!config.hasConnectedBefore, // CRITICAL: Restore hasConnectedBefore flag
        processedMessages: new Set(), // Track processed messages to avoid duplicates
        // Initialize services
        conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), config.assistantName || 'Ana', this),
        groqService: new GroqService(),
        humanLikeDelay: new HumanLikeDelay(),
        audioTranscriptionService: new AudioTranscriptionService(),
        pdfProcessingService: new PdfProcessingService(),
        googleDriveService: new GoogleDriveService(config.ownerId)
      };

      this.bots.set(config.id, botData);
      
      // Load conversations from database for this restored bot
      try {
        console.log(`📁 Loading conversations from database for restored bot ${config.id}`);
        await botData.conversationFlowService.loadConversationsFromDatabase(config.id);
        console.log(`✅ Successfully loaded conversations for restored bot ${config.id}`);
      } catch (error) {
        console.error(`❌ Error loading conversations for restored bot ${config.id}:`, error);
      }
      
      // Schedule delayed initialization to avoid session conflicts during system startup
      const initDelay = Math.random() * 3000 + 2000; // Random delay between 2-5 seconds
      console.log(`⏰ Scheduling bot ${config.id} initialization in ${Math.round(initDelay/1000)}s to avoid session conflicts`);
      
      setTimeout(async () => {
        try {
          // Wait for global lock to be released
          while (this.globalInitLock) {
            console.log(`⏳ Bot ${config.id} waiting for global initialization lock to be released...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          // Acquire global lock
          this.globalInitLock = true;
          console.log(`� Bot ${config.id} acquired global initialization lock`);
          
          console.log(`�🔄 Starting delayed initialization for restored bot ${config.id}`);
          await this.initializeBaileysBot(config.id, config.name, config.assistantName);
          
          // Release global lock
          this.globalInitLock = false;
          console.log(`🔓 Bot ${config.id} released global initialization lock`);
          
        } catch (error) {
          console.error(`❌ Error in delayed initialization for bot ${config.id}:`, error);
          // Always release lock on error
          this.globalInitLock = false;
        }
      }, initDelay);
      
    } catch (error) {
      console.error(`❌ Error restoring bot ${config.id}:`, error);
      
      await DatabaseService.updateBotExtended(config.id, {
        status: 'error',
        lastError: error.message
      });
    }
  }

  async stopBot(botId) {
    const bot = this.bots.get(botId);
    if (bot) {
      try {
        console.log(`🛑 Stopping bot ${botId}...`);
        
        // Cancel any pending reconnection timer
        if (bot.reconnectionTimer) {
          clearTimeout(bot.reconnectionTimer);
          bot.reconnectionTimer = null;
        }
        
        // Set manually stopped flag to prevent automatic reconnection
        bot.manuallyStopped = true;
        
        // Clear keep-alive timer
        this.clearBotKeepAlive(botId);
        
        // Reset reconnection flags to prevent conflicts
        bot.isReconnecting = false;
        bot.reconnectionAttempts = 0;
        bot.isInitializing = false;
        
        // Close socket if exists
        if (bot.socket) {
          bot.socket.end();
        }
        
        bot.isActive = false;
        bot.status = 'stopped';
        
        await DatabaseService.updateBotExtended(botId, {
          status: 'stopped',
          isActive: false
        });
        
        this.emitBotUpdate(botId);
        console.log(`✅ Bot ${botId} stopped successfully`);
        return true;
      } catch (error) {
        console.error(`❌ Error stopping bot ${botId}:`, error);
      }
    }
    return false;
  }

  async deleteBot(botId) {
    const success = await this.stopBot(botId);
    if (success) {
      const bot = this.bots.get(botId);
      if (bot && bot.sessionPath) {
        // Delete session files
        try {
          if (fs.existsSync(bot.sessionPath)) {
            fs.rmSync(bot.sessionPath, { recursive: true, force: true });
          }
        } catch (error) {
          console.error(`⚠️  Error deleting session files for bot ${botId}:`, error);
        }
      }
      
      // Clear keep-alive timer
      this.clearBotKeepAlive(botId);
      
      this.bots.delete(botId);
      
      // Delete from database
      await DatabaseService.deleteBotExtended(botId);
    }
    return success;
  }

  getBot(botId) {
    return this.bots.get(botId);
  }

  getAllBots() {
    console.log(`🔍 getAllBots called - Map size: ${this.bots.size}, Bot IDs: ${Array.from(this.bots.keys()).join(', ')}`);
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
      error: bot.error,
      ownerId: bot.ownerId  // Added missing ownerId field
    }));
  }

  getBotsStatus() {
    return {
      total: this.bots.size,
      active: Array.from(this.bots.values()).filter(bot => bot.isActive).length,
      bots: this.getAllBots()
    };
  }

  async uploadMediaToGoogleDrive(botData, mediaBuffer, contactName, userPhone, mediaType) {
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

      // Generate filename based on media type and current timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      let fileName = `${mediaType}_${timestamp}`;
      
      // Add appropriate extension based on media type (we'll use generic extensions since we may not have mimetype)
      const extensionMap = {
        'audio': 'ogg',
        'document': 'pdf',
        'image': 'jpg',
        'video': 'mp4'
      };
      
      fileName += `.${extensionMap[mediaType] || 'bin'}`;

      // Upload to client's Google Drive folder
      const uploadResult = await botData.googleDriveService.uploadClientDocument(
        clientName,
        userPhone,
        mediaBuffer,
        fileName,
        'application/octet-stream' // Generic mimetype since Baileys doesn't always provide it
      );

      console.log(`Bot ${botData.id} - Successfully uploaded ${mediaType} to Google Drive:`, uploadResult.name);
      
      return uploadResult;
    } catch (error) {
      console.error(`Bot ${botData.id} - Error uploading to Google Drive:`, error);
      // Don't throw error - just log it and continue with normal processing
      return null;
    }
  }

  emitBotUpdate(botId) {
    const bot = this.bots.get(botId);
    if (bot) {
      console.log(`📢 Emitting bot update for ${botId} - Status: ${bot.status}, Active: ${bot.isActive}`);
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
      console.log(`🔄 Restarting bot ${botId}...`);
      
      // Cancel any pending reconnection timer
      if (bot.reconnectionTimer) {
        clearTimeout(bot.reconnectionTimer);
        bot.reconnectionTimer = null;
      }
      
      // Reset all reconnection and initialization flags
      bot.isReconnecting = false;
      bot.reconnectionAttempts = 0;
      bot.isInitializing = false;
      // Remove manually stopped flag to allow reconnection
      bot.manuallyStopped = false;
      
      // Stop current connection
      if (bot.socket) {
        try {
          bot.socket.end();
        } catch (error) {
          console.error(`⚠️  Error stopping socket for restart:`, error);
        }
      }
      
      // Clear any existing initialization locks
      if (this.initializationLocks.has(botId)) {
        this.initializationLocks.delete(botId);
      }
      
      // Wait a moment for cleanup then reinitialize
      setTimeout(async () => {
        try {
          await this.initializeBaileysBot(botId, bot.name, bot.assistantName);
          console.log(`✅ Bot ${botId} restarted successfully`);
        } catch (error) {
          console.error(`❌ Error restarting bot ${botId}:`, error);
        }
      }, 1000);
      
      return true;
    }
    return false;
  }

  // Cleanup method
  async destroy() {
    console.log('🧹 Cleaning up bot manager...');
    
    // Note: No cleanup interval to clear since we removed automatic cleanup
    
    for (const [botId, bot] of this.bots) {
      if (bot.socket) {
        try {
          bot.socket.end();
        } catch (error) {
          console.error(`⚠️  Error closing socket for bot ${botId}:`, error);
        }
      }
    }
    
    this.bots.clear();
  }

  // Clean up bots only in specific error conditions (not on normal disconnection)
  cleanupDisconnectedBots() {
    const now = Date.now();
    const CLEANUP_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours - much longer threshold
    
    for (const [botId, bot] of this.bots) {
      // Only cleanup bots that are in error state for a very long time
      if (bot.status === 'error' && 
          bot.lastActivity && 
          (now - new Date(bot.lastActivity).getTime()) > CLEANUP_THRESHOLD) {
        
        console.log(`🧹 Cleaning up bot in error state for 24+ hours: ${botId}`);
        
        // Close socket if still exists
        if (bot.socket) {
          try {
            bot.socket.end();
          } catch (error) {
            console.error(`⚠️  Error closing socket during cleanup:`, error);
          }
        }
        
        // Remove from memory but keep in database
        this.bots.delete(botId);
      }
    }
  }
}

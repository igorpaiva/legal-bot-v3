import { default as makeWASocket, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
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
import fs from 'fs';
import path from 'path';
import pino from 'pino';

export class BotManager {
  constructor(io) {
    this.io = io;
    this.bots = new Map();
    this.initializationLocks = new Map(); // Add locks to prevent concurrent initialization
    
    // Load persisted bots on startup
    this.loadPersistedData();
    
    // Note: Removed automatic cleanup - bots should persist until manually deleted
    // Only clean up on specific error conditions or manual removal
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
      if (existingBot && (existingBot.isInitializing || existingBot.isReconnecting)) {
        console.log(`⚠️  Bot ${botId} is already being initialized or reconnecting, skipping`);
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

      // Create auth state
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      
      // Create logger
      const logger = pino({ 
        level: 'warn',
        stream: {
          write: () => {} // Silent logger
        }
      });

      // Create socket
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We'll handle QR in frontend
        logger,
        browser: ['Legal Bot', 'Chrome', '1.0.0'],
        defaultQueryTimeoutMs: 60000,
        markOnlineOnConnect: true
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
          // Initialize services
          conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), assistantName, this),
          groqService: new GroqService(),
          humanLikeDelay: new HumanLikeDelay(),
          audioTranscriptionService: new AudioTranscriptionService(),
          pdfProcessingService: new PdfProcessingService()
        };

        this.bots.set(botId, botData);
      }

      // Setup event handlers
      this.setupBaileysEvents(botData);
      
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
        
        // If session was replaced by another connection, stop reconnecting
        if (isReplaced) {
          console.log(`🔄 Bot ${id} session was replaced by another connection. Setting to disconnected state.`);
          botData.status = 'disconnected';
          botData.isReconnecting = false;
          botData.reconnectionAttempts = 0;
          
          await DatabaseService.updateBotExtended(id, {
            status: 'disconnected'
            // Keep isActive: true to allow manual reconnection
          });
          
          this.emitBotUpdate(id);
          return;
        }
        
        // Limit reconnection attempts to prevent infinite loops
        if (shouldReconnect && !botData.isReconnecting && botData.reconnectionAttempts < 10) {
          botData.status = 'reconnecting';
          botData.isReconnecting = true;
          botData.reconnectionAttempts++;
          
          console.log(`🔄 Bot ${id} reconnection attempt ${botData.reconnectionAttempts}/10`);
          
          this.emitBotUpdate(id);
          
          // Exponential backoff for reconnection delay
          const delay = Math.min(5000 * Math.pow(1.5, botData.reconnectionAttempts - 1), 60000);
          
          // Reconnect after delay
          setTimeout(async () => {
            if (botData.isReconnecting && botData.reconnectionAttempts <= 10) {
              console.log(`🔄 Reconnecting bot ${id}... (attempt ${botData.reconnectionAttempts})`);
              try {
                await this.initializeBaileysBot(id, botData.name, botData.assistantName);
              } catch (error) {
                console.error(`❌ Error during reconnection attempt for bot ${id}:`, error);
              }
            }
          }, delay);
        } else if (!shouldReconnect || botData.reconnectionAttempts >= 10) {
          if (botData.reconnectionAttempts >= 10) {
            console.log(`🛑 Bot ${id} reached maximum reconnection attempts (10). Stopping.`);
          }
          
          botData.status = 'disconnected';
          // Keep isActive = true to allow restoration on restart
          // Only set isActive = false when manually deactivated by user
          botData.isReconnecting = false;
          botData.reconnectionAttempts = 0;
          
          await DatabaseService.updateBotExtended(id, {
            status: 'disconnected'
            // Don't set isActive: false here - let it remain true for restoration
          });
          
          this.emitBotUpdate(id);
        }
      } else if (connection === 'open') {
        console.log(`✅ Bot ${id} connected successfully!`);
        
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
        
        botData.status = 'connected';
        botData.isActive = true;
        botData.lastActivity = new Date();
        botData.qrCode = null;
        
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
        
        this.emitBotUpdate(id);
      }
    });

    // Save credentials when they change
    socket.ev.on('creds.update', saveCreds);

    // Message handler
    socket.ev.on('messages.upsert', async (m) => {
      try {
        const message = m.messages[0];
        
        if (!message.key.fromMe && m.type === 'notify') {
          const remoteJid = message.key.remoteJid;
          const contactNumber = remoteJid.split('@')[0];
          
          console.log(`📨 Bot ${id} received message from: ${contactNumber}`);
          
          try {
            const messageText = message.message?.conversation || 
                               message.message?.extendedTextMessage?.text || '';
            
            if (messageText.trim()) {
              // Update bot stats
              botData.messageCount++;
              botData.lastActivity = new Date();
              this.emitBotUpdate(id);

              // Get contact name from push name or use number
              const contactName = message.pushName || contactNumber;
              
              console.log(`📨 Bot ${id} processing message from ${contactName}: ${messageText.substring(0, 50)}...`);

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
        isActive: false,
        messageCount: config.messageCount || 0,
        lastActivity: config.lastActivity ? new Date(config.lastActivity) : null,
        createdAt: config.createdAt ? new Date(config.createdAt) : new Date(),
        sessionPath: config.sessionPath,
        qrCode: null,
        isRestoring: true,
        ownerId: config.ownerId, // Add missing ownerId field
        // Initialize services
        conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), config.assistantName || 'Ana', this),
        groqService: new GroqService(),
        humanLikeDelay: new HumanLikeDelay(),
        audioTranscriptionService: new AudioTranscriptionService(),
        pdfProcessingService: new PdfProcessingService()
      };

      this.bots.set(config.id, botData);
      
      // Try to restore the Baileys connection
      await this.initializeBaileysBot(config.id, config.name, config.assistantName);
      
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
    if (bot && bot.socket) {
      try {
        // Cancel any pending reconnection timer
        if (bot.reconnectionTimer) {
          clearTimeout(bot.reconnectionTimer);
          bot.reconnectionTimer = null;
        }
        
        bot.socket.end();
        bot.isActive = false;
        bot.status = 'stopped';
        
        await DatabaseService.updateBotExtended(botId, {
          status: 'stopped',
          isActive: false
        });
        
        this.emitBotUpdate(botId);
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
      console.log(`🔄 Restarting bot ${botId}...`);
      
      // Stop current connection
      if (bot.socket) {
        try {
          bot.socket.end();
        } catch (error) {
          console.error(`⚠️  Error stopping socket for restart:`, error);
        }
      }
      
      // Reinitialize
      await this.initializeBaileysBot(botId, bot.name, bot.assistantName);
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

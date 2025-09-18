import { default as makeWASocket, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import DatabaseService from './DatabaseService.js';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

export class BotManager {
  constructor(io) {
    this.io = io;
    this.bots = new Map();
    this.database = DatabaseService;
    
    // Create sessions directory if it doesn't exist
    if (!fs.existsSync('./sessions')) {
      fs.mkdirSync('./sessions', { recursive: true });
    }
    
    // Load persisted bots on startup
    this.loadPersistedData();
  }

  async loadPersistedData() {
    try {
      console.log('📋 Loading persisted bot data from database...');
      
      const botConfigs = DatabaseService.getAllBotsExtended();
      
      for (const config of botConfigs) {
        if (config.isActive && (config.status === 'connected' || config.status === 'ready')) {
          console.log(`🔄 Restoring bot: ${config.name} (${config.id})`);
          await this.restoreBot(config);
        } else {
          console.log(`⏭️  Skipping inactive bot: ${config.name} (${config.id}) - Status: ${config.status}`);
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

      // Initialize Baileys connection
      await this.initializeBaileysBot(botId, botName, defaultAssistantName);
      
      return botId;
      
    } catch (error) {
      console.error(`❌ Error creating bot ${botId}:`, error);
      await this.database.updateBotExtended(botId, {
        status: 'error',
        lastError: error.message
      });
      throw error;
    }
  }

  async initializeBaileysBot(botId, botName, assistantName) {
    try {
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

      const botData = {
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
        isRestoring: false
      };

      this.bots.set(botId, botData);

      // Setup event handlers
      this.setupBaileysEvents(botData);
      
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
        qrCode: botData.qrCode
      });
      
      this.emitBotUpdate(botId);
      
    } catch (error) {
      console.error(`❌ Error initializing Baileys bot ${botId}:`, error);
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
          
          await this.database.updateBotExtended(id, {
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
        
        console.log(`🔌 Bot ${id} connection closed. Should reconnect:`, shouldReconnect);
        
        if (shouldReconnect) {
          botData.status = 'reconnecting';
          this.emitBotUpdate(id);
          
          // Reconnect after delay
          setTimeout(() => {
            console.log(`🔄 Reconnecting bot ${id}...`);
            this.initializeBaileysBot(id, botData.name, botData.assistantName);
          }, 3000);
        } else {
          botData.status = 'disconnected';
          botData.isActive = false;
          
          await this.database.updateBotExtended(id, {
            status: 'disconnected',
            isActive: false
          });
          
          this.emitBotUpdate(id);
        }
      } else if (connection === 'open') {
        console.log(`✅ Bot ${id} connected successfully!`);
        
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
        
        await this.database.updateBotExtended(id, {
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
          console.log(`📨 Bot ${id} received message from:`, message.key.remoteJid);
          
          const messageText = message.message?.conversation || 
                             message.message?.extendedTextMessage?.text || '';
          
          if (messageText.trim()) {
            // Generate response
            const response = await this.generateResponse(messageText, botData);
            
            // Send response
            await this.sendMessage(botData, message.key.remoteJid, response);
            
            botData.messageCount++;
            botData.lastActivity = new Date();
            this.emitBotUpdate(id);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing message for bot ${id}:`, error);
      }
    });
  }

  async generateResponse(messageText, botData) {
    // Simple response logic - integrate with GroqService here
    const responses = [
      `Olá! Recebi sua mensagem: "${messageText}". Como posso ajudá-lo com questões jurídicas?`,
      `Entendi. Sobre "${messageText}", preciso de mais detalhes para poder orientá-lo melhor.`,
      `Obrigado pela mensagem. Para "${messageText}", recomendo que forneça mais contexto sobre sua situação.`,
      `Recebido! Sobre "${messageText}", posso ajudá-lo com orientações jurídicas. Pode me dar mais detalhes?`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  async sendMessage(botData, to, message) {
    const { socket, id } = botData;
    
    try {
      await socket.sendMessage(to, { text: message });
      console.log(`📤 Bot ${id} sent message to ${to}`);
      
      // Add delay to simulate human typing
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
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
        isRestoring: true
      };

      this.bots.set(config.id, botData);
      
      // Try to restore the Baileys connection
      await this.initializeBaileysBot(config.id, config.name, config.assistantName);
      
    } catch (error) {
      console.error(`❌ Error restoring bot ${config.id}:`, error);
      
      await this.database.updateBotExtended(config.id, {
        status: 'error',
        lastError: error.message
      });
    }
  }

  async stopBot(botId) {
    const bot = this.bots.get(botId);
    if (bot && bot.socket) {
      try {
        bot.socket.end();
        bot.isActive = false;
        bot.status = 'stopped';
        
        await this.database.updateBotExtended(botId, {
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
      await this.database.deleteBotExtended(botId);
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
}

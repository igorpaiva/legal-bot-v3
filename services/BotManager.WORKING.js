import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import DatabaseService from './DatabaseService.js';
import { GroqService } from './GroqService.js';
import { HumanLikeDelay } from './HumanLikeDelay.js';
import { LegalTriageService } from './LegalTriageService.js';
import { ConversationFlowService } from './ConversationFlowService.js';
import { AudioTranscriptionService } from './AudioTranscriptionService.js';
import { PdfProcessingService } from './PdfProcessingService.js';

export class BotManager {
  constructor(io) {
    this.io = io;
    this.bots = new Map();
    this.database = DatabaseService;
    
    // Load persisted bots on startup
    this.loadPersistedData();
  }

  // Load persisted bots and conversations
  async loadPersistedData() {
    try {
      console.log('Loading persisted bot data from extended table...');
      
      // Load bot configurations from new extended database table
      const botConfigs = DatabaseService.getAllBotsExtended();
      
      for (const config of botConfigs) {
        // Try to restore bots that were previously active or authenticated
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

  // Restore a bot from configuration
  async restoreBot(config) {
    try {
      // CONFIGURAÇÃO OTIMIZADA DO PUPPETEER
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: config.id,
          dataPath: './sessions'
        }),
        puppeteer: {
          headless: true,
          args: [
            // Argumentos essenciais para estabilidade
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            
            // Otimizações de memória
            '--memory-pressure-off',
            '--max_old_space_size=4096',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            
            // Otimizações de rede
            '--aggressive-cache-discard',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--disable-ipc-flooding-protection'
          ],
          // Timeout otimizado
          timeout: 60000, // 60 segundos ao invés do padrão (30s)
          // Configurações de execução otimizadas
          executablePath: undefined, // Usa Chrome padrão do sistema
          ignoreDefaultArgs: false,
          ignoreHTTPSErrors: true,
          slowMo: 0, // Remove delays desnecessários
          devtools: false
        }
      });

      const botData = {
        id: config.id,
        name: config.name,
        assistantName: config.assistantName || 'Ana',
        client,
        status: 'restoring',
        qrCode: null,
        phoneNumber: config.phoneNumber,
        isActive: false,
        messageCount: config.messageCount || 0,
        lastActivity: config.lastActivity ? new Date(config.lastActivity) : null,
        createdAt: config.createdAt ? new Date(config.createdAt) : new Date(),
        processedMessages: new Set(),
        isProcessing: false,
        chatCooldowns: new Map(),
        lastMessageTimes: new Map(),
        error: null,
        isRestoring: true,
        conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), config.assistantName || 'Ana'),
        groqService: new GroqService(),
        humanLikeDelay: new HumanLikeDelay(),
        audioTranscriptionService: new AudioTranscriptionService(),
        pdfProcessingService: new PdfProcessingService()
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
    
    console.log(`Creating new WhatsApp client for bot ${botId} with session path: ./sessions`);
    
    // CONFIGURAÇÃO OTIMIZADA DO PUPPETEER PARA CRIAÇÃO
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: botId,
        dataPath: './sessions'
      }),
      puppeteer: {
        headless: true,
        args: [
          // Argumentos básicos obrigatórios
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          
          // Otimizações específicas para criação
          '--disable-web-security',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--memory-pressure-off'
        ],
        timeout: 90000, // 90 segundos para criação inicial
        ignoreHTTPSErrors: true,
        devtools: false
      }
    });

    const botData = {
      id: botId,
      name: botName,
      assistantName: defaultAssistantName,
      client,
      status: 'initializing',
      qrCode: null,
      phoneNumber: null,
      isActive: false,
      messageCount: 0,
      lastActivity: null,
      createdAt: new Date(),
      processedMessages: new Set(),
      isProcessing: false,
      chatCooldowns: new Map(),
      lastMessageTimes: new Map(),
      cooldownWarnings: new Map(),
      conversationFlowService: new ConversationFlowService(new GroqService(), new LegalTriageService(), defaultAssistantName),
      groqService: new GroqService(),
      humanLikeDelay: new HumanLikeDelay(),
      audioTranscriptionService: new AudioTranscriptionService(),
      pdfProcessingService: new PdfProcessingService()
    };

    // Salvar no database primeiro
    try {
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
      console.log(`Bot ${botId} created in database`);
    } catch (error) {
      console.error(`Error creating bot ${botId} in database:`, error);
      throw error;
    }

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
      
      // Update database
      await this.database.updateBotExtended(botId, {
        status: 'error',
        lastError: error.message
      });
      
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
      
      try {
        const qrCodeDataURL = await QRCode.toDataURL(qr);
        botData.qrCode = qrCodeDataURL;
        botData.status = 'waiting_for_scan';
        
        // Update database
        await this.database.updateBotExtended(id, {
          qrCode: qr,
          status: 'waiting_for_scan',
          lastQrGenerated: new Date().toISOString()
        });
        
        this.emitBotUpdate(id);
        console.log(`QR Code generated for bot ${id}`);
      } catch (error) {
        console.error('Error generating QR code:', error);
      }
    });

    client.on('ready', async () => {
      botData.status = 'ready';
      botData.isActive = true;
      botData.phoneNumber = client.info?.wid?.user || 'Unknown';
      botData.lastActivity = new Date();
      botData.isRestoring = false;
      
      // Update database
      await this.database.updateBotExtended(id, {
        status: 'connected', // Use 'connected' as status for consistency
        isActive: true,
        phoneNumber: botData.phoneNumber,
        lastActivity: new Date().toISOString(),
        hasConnectedBefore: true
      });
      
      this.emitBotUpdate(id);
      console.log(`Bot ${id} is ready!`);
    });

    client.on('authenticated', async () => {
      botData.status = 'authenticated';
      botData.isRestoring = false;
      
      // Update database
      await this.database.updateBotExtended(id, {
        status: 'authenticated'
      });
      
      this.emitBotUpdate(id);
      console.log(`Bot ${id} authenticated`);
    });

    client.on('auth_failure', async (msg) => {
      botData.status = 'auth_failed';
      botData.error = msg;
      botData.isActive = false;
      
      // Update database
      await this.database.updateBotExtended(id, {
        status: 'auth_failed',
        isActive: false,
        lastError: msg
      });
      
      this.emitBotUpdate(id);
      console.log(`Bot ${id} authentication failed:`, msg);
    });

    client.on('disconnected', async (reason) => {
      botData.status = 'disconnected';
      botData.isActive = false;
      botData.error = reason;
      
      // Update database
      await this.database.updateBotExtended(id, {
        status: 'disconnected',
        isActive: false,
        lastError: reason
      });
      
      this.emitBotUpdate(id);
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
      
      // Clean up old message IDs (keep only last 100)
      if (botData.processedMessages.size > 100) {
        const messageIds = Array.from(botData.processedMessages);
        const toRemove = messageIds.slice(0, messageIds.length - 100);
        toRemove.forEach(id => botData.processedMessages.delete(id));
      }
      
      try {
        await this.handleMessage(botData, message);
      } catch (error) {
        console.error(`Error handling message for bot ${id}:`, error);
        botData.processedMessages.delete(messageId);
      }
    });
  }

  async handleMessage(botData, message) {
    if (!botData.isActive) return;

    // Rate limiting check
    if (botData.isProcessing) {
      console.log(`Bot ${botData.id} is already processing a message, skipping`);
      return;
    }

    let chat, chatId;
    try {
      chat = await message.getChat();
      chatId = chat.id._serialized;
    } catch (error) {
      console.error(`Error getting chat info for bot ${botData.id}:`, error);
      return;
    }
    
    // Simple rate limiting
    const lastResponseTime = botData.chatCooldowns.get(chatId);
    const now = Date.now();
    
    if (lastResponseTime && (now - lastResponseTime) < 3000) {
      console.log(`Bot ${botData.id} - Rate limited for chat ${chatId}`);
      return;
    }

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
      
      if (message.type === 'chat' && message.body) {
        messageText = message.body;
      } else {
        messageText = 'Desculpe, posso responder apenas a mensagens de texto no momento.';
      }

      // Simulate typing
      await chat.sendSeen();
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      // Use ConversationFlowService
      const response = await botData.conversationFlowService.processIncomingMessage(
        contact.number,
        messageText,
        contactName
      );

      // Send response
      await chat.sendMessage(response);
      
      // Update cooldown
      botData.chatCooldowns.set(chatId, Date.now());
      
      console.log(`Bot ${botData.id} sent response to ${contactName}: ${response.substring(0, 100)}...`);
      
    } catch (error) {
      console.error(`Error generating/sending response for bot ${botData.id}:`, error);
      
      try {
        await chat.sendMessage('Desculpe, estou com dificuldades técnicas. Tente novamente mais tarde.');
        botData.chatCooldowns.set(chatId, Date.now());
      } catch (fallbackError) {
        console.error(`Error sending fallback message for bot ${botData.id}:`, fallbackError);
      }
    } finally {
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
      
      // Update database
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
      // Remove bot from database
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

      // Create new client
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
            '--single-process',
            '--disable-gpu',
            '--memory-pressure-off',
            '--disable-ipc-flooding-protection'
          ],
          timeout: 60000,
          ignoreHTTPSErrors: true
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
      
      await this.database.updateBotExtended(botId, {
        status: 'error',
        lastError: error.message
      });
      
      this.emitBotUpdate(botId);
      return false;
    }
  }
}

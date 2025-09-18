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
    this.database = DatabaseService; // Adiciona referência ao DatabaseService

    // Sistema de reconexão robusto
    this.reconnectionManager = new Map(); // Track reconnection attempts per bot
    this.gracefulShutdown = false; // Flag para graceful shutdown

    // **CONFIGURAÇÃO DE FILTRO DE MENSAGENS ANTIGAS**
    // Máximo tempo para processar mensagens (evita processar histórico do WhatsApp)
    this.maxMessageAge = parseInt(process.env.MAX_MESSAGE_AGE_SECONDS) || 30; // Padrão: 30 segundos
    this.maxOfflineRecoveryHours = parseInt(process.env.MAX_OFFLINE_RECOVERY_HOURS) || 24; // Padrão: 24 horas
    console.log(`BotManager configurado para processar apenas mensagens dos últimos ${this.maxMessageAge} segundos (primeira conexão)`);
    console.log(`BotManager configurado para recuperar mensagens offline das últimas ${this.maxOfflineRecoveryHours} horas (reconexões)`);

    // Load persisted bots on startup
    this.loadPersistedData();

    // Configurar graceful shutdown
    this.setupGracefulShutdown();

    // Iniciar monitoramento periódico de bots stuck
    this.startStuckBotMonitoring();
  }

  // Load persisted bots and conversations
  async loadPersistedData() {
    try {
      console.log('Loading persisted bot data...');
      
      // Load bot configurations from database
      const botConfigs = DatabaseService.getAllBots();
      
      for (const config of botConfigs) {
        // Try to restore bots that were previously active, authenticated, or in initialization process
        if (config.isActive || config.status === 'ready' || config.status === 'authenticated' || 
            config.status === 'initializing' || config.status === 'waiting_for_scan') {
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

  // Configurar graceful shutdown
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`[${signal}] Recebido sinal de shutdown. Iniciando graceful shutdown...`);
      this.gracefulShutdown = true;

      try {
        // Desconectar todos os bots graciosamente
        const shutdownPromises = [];
        for (const [botId, botData] of this.bots.entries()) {
          if (botData.client && botData.isActive) {
            console.log(`[${signal}] Desconectando bot ${botId}...`);
            shutdownPromises.push(
              this.gracefulBotShutdown(botId)
                .catch(error => console.error(`[${signal}] Erro ao desconectar bot ${botId}:`, error))
            );
          }
        }

        // Aguardar todas as desconexões (máximo 30 segundos)
        await Promise.race([
          Promise.all(shutdownPromises),
          new Promise(resolve => setTimeout(resolve, 30000))
        ]);

        console.log(`[${signal}] Graceful shutdown concluído.`);
        process.exit(0);
      } catch (error) {
        console.error(`[${signal}] Erro durante graceful shutdown:`, error);
        process.exit(1);
      }
    };

    // Registrar handlers para sinais de shutdown
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // Para nodemon restart

    // Handler para uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('[CRITICAL] Uncaught Exception:', error);
      shutdown('UNCAUGHT_EXCEPTION');
    });

    // Handler para unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('UNHANDLED_REJECTION');
    });
  }

  // Graceful shutdown para um bot específico
  async gracefulBotShutdown(botId) {
    const bot = this.bots.get(botId);
    if (!bot) return;

    try {
      console.log(`[GRACEFUL] Iniciando shutdown do bot ${botId}`);

      // Cancelar qualquer tentativa de reconexão pendente
      const reconnManager = this.reconnectionManager.get(botId);
      if (reconnManager?.timeoutId) {
        clearTimeout(reconnManager.timeoutId);
        reconnManager.timeoutId = null;
      }

      // Salvar estado final antes de desconectar
      await this.saveBotState(botId);

      // Desconectar cliente WhatsApp
      if (bot.client) {
        // Aguardar desconexão completa (máximo 10 segundos)
        await Promise.race([
          bot.client.destroy(),
          new Promise(resolve => setTimeout(resolve, 10000))
        ]);
        console.log(`[GRACEFUL] Cliente do bot ${botId} desconectado`);
      }

      // Limpar estado do bot
      bot.isActive = false;
      bot.status = 'shutdown';

      console.log(`[GRACEFUL] Bot ${botId} shutdown concluído`);
    } catch (error) {
      console.error(`[GRACEFUL] Erro no shutdown do bot ${botId}:`, error);
      throw error;
    }
  }

  // Salvar estado de um bot específico
  async saveBotState(botId) {
    const bot = this.bots.get(botId);
    if (!bot) return;

    try {
      DatabaseService.updateBot(botId, {
        name: bot.name,
        assistantName: bot.assistantName,
        status: bot.status,
        phoneNumber: bot.phoneNumber,
        isActive: bot.isActive,
        messageCount: bot.messageCount,
        lastActivity: bot.lastActivity ? bot.lastActivity.toISOString() : null
      });
      console.log(`[GRACEFUL] Estado do bot ${botId} salvo com sucesso`);
    } catch (error) {
      console.error(`[GRACEFUL] Erro ao salvar estado do bot ${botId}:`, error);
    }
  }

  // Sistema de reconexão com backoff exponencial
  async handleReconnection(botId, error) {
    if (this.gracefulShutdown) return;

    const bot = this.bots.get(botId);
    if (!bot) return;

    // **NOVA POLÍTICA CONSERVADORA** - evitar reconexões desnecessárias
    // Se o bot estiver funcionando bem, evitar reconexão
    if (bot.status === 'ready' && bot.isActive) {
      try {
        // Teste rápido para ver se a sessão realmente está com problema
        const state = await Promise.race([
          bot.client.getState(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), 5000))
        ]);

        if (state === 'CONNECTED') {
          console.log(`[RECONNECT] Bot ${botId} ainda está conectado, cancelando reconexão desnecessária`);
          return; // Sessão ainda está boa, não reconectar
        }
      } catch (testError) {
        console.log(`[RECONNECT] Bot ${botId} teste de conectividade falhou, procedendo com reconexão: ${testError.message}`);
      }
    }

    let reconnManager = this.reconnectionManager.get(botId);
    if (!reconnManager) {
      reconnManager = {
        attempts: 0,
        maxAttempts: 5, // Reduzido de 10 para 5 para ser mais conservador
        baseDelay: 2000, // Aumentado de 1s para 2s
        maxDelay: 600000, // Aumentado para 10 minutos
        timeoutId: null,
        lastReconnectionTime: 0
      };
      this.reconnectionManager.set(botId, reconnManager);
    }

    // **COOLDOWN** - evitar reconexões muito frequentes
    const now = Date.now();
    const timeSinceLastReconnection = now - reconnManager.lastReconnectionTime;
    const minCooldown = 60000; // 1 minuto mínimo entre reconexões

    if (timeSinceLastReconnection < minCooldown) {
      console.log(`[RECONNECT] Bot ${botId} em cooldown, aguardando ${Math.round((minCooldown - timeSinceLastReconnection) / 1000)}s`);
      setTimeout(() => this.handleReconnection(botId, error), minCooldown - timeSinceLastReconnection);
      return;
    }

    // Cancelar tentativa anterior se existir
    if (reconnManager.timeoutId) {
      clearTimeout(reconnManager.timeoutId);
      reconnManager.timeoutId = null;
    }

    reconnManager.attempts++;

    // Se excedeu tentativas máximas, parar
    if (reconnManager.attempts > reconnManager.maxAttempts) {
      console.error(`[RECONNECT] Bot ${botId} excedeu ${reconnManager.maxAttempts} tentativas de reconexão. Abortando.`);
      bot.status = 'failed';
      await this.saveBotState(botId);
      return;
    }

    // Calcular delay com backoff exponencial + jitter
    const exponentialDelay = Math.min(
      reconnManager.baseDelay * Math.pow(2, reconnManager.attempts - 1),
      reconnManager.maxDelay
    );
    const jitter = Math.random() * 0.1 * exponentialDelay; // ±10% jitter
    const delay = exponentialDelay + jitter;

    console.log(`[RECONNECT] Tentativa ${reconnManager.attempts}/${reconnManager.maxAttempts} para bot ${botId} em ${Math.round(delay/1000)}s. Erro: ${error?.message || error}`);

    // Marcar o tempo da tentativa de reconexão
    reconnManager.lastReconnectionTime = Date.now();

    // Agendar reconexão
    reconnManager.timeoutId = setTimeout(async () => {
      try {
        await this.attemptReconnection(botId);
      } catch (reconnectError) {
        console.error(`[RECONNECT] Falha na tentativa ${reconnManager.attempts} para bot ${botId}:`, reconnectError);
        // Tentar novamente se não for graceful shutdown
        if (!this.gracefulShutdown) {
          this.handleReconnection(botId, reconnectError);
        }
      }
    }, delay);
  }

  // Tentar reconectar um bot específico
  async attemptReconnection(botId) {
    const bot = this.bots.get(botId);
    if (!bot || this.gracefulShutdown) return;

    console.log(`[RECONNECT] Iniciando reconexão do bot ${botId}`);

    try {
      // Destruir cliente antigo se existir
      if (bot.client) {
        try {
          await bot.client.destroy();
        } catch (destroyError) {
          console.warn(`[RECONNECT] Erro ao destruir cliente antigo do bot ${botId}:`, destroyError);
        }
      }

      // Resetar estado
      bot.status = 'reconnecting';
      bot.isActive = false;

      // Criar novo cliente
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
            '--single-process',
            '--disable-gpu',
            // Argumentos extras para máxima estabilidade
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-crash-upload',
            '--disable-component-extensions-with-background-pages',
            '--disable-domain-reliability',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--force-fieldtrials=SiteIsolationExtensions/Control',
            '--disable-back-forward-cache',
            '--disable-popup-blocking',
            '--disable-print-preview',
            '--max_old_space_size=4096',
            '--memory-pressure-off',
            '--disable-low-end-device-mode',
            '--disable-backing-store-limit',
            // Argumentos críticos para sessões persistentes
            '--disable-web-security',
            '--disable-site-isolation-trials',
            '--disable-features=VizDisplayCompositor',
            '--user-data-dir=/tmp/whatsapp-session-data',
            '--aggressive-cache-discard'
          ],
          // Configurações adicionais do Puppeteer para estabilidade
          ignoreHTTPSErrors: true,
          ignoreDefaultArgs: ['--disable-extensions'],
          slowMo: 100, // Adiciona delay entre ações para reduzir problemas
          timeout: 120000, // 2 minutos timeout
          protocolTimeout: 120000
        },
        // Configurações do cliente WhatsApp para máxima compatibilidade
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        takeoverOnConflict: true,
        takeoverTimeoutMs: 30000
      });

      // Configurar eventos para reconexão
      this.setupBotEvents(bot);

      // Iniciar cliente
      await client.initialize();

      // Atualizar estado
      bot.client = client;
      bot.status = 'connected';
      bot.isActive = true;
      bot.lastActivity = new Date();

      // Resetar contador de reconexões
      const reconnManager = this.reconnectionManager.get(botId);
      if (reconnManager) {
        reconnManager.attempts = 0;
        reconnManager.timeoutId = null;
      }

      console.log(`[RECONNECT] Bot ${botId} reconectado com sucesso`);

      // Salvar estado
      await this.saveBotState(botId);

    } catch (error) {
      console.error(`[RECONNECT] Falha ao reconectar bot ${botId}:`, error);
      
      // Handle specific Puppeteer errors during reconnection
      if (error.message && error.message.includes('Protocol error (Runtime.callFunctionOn): Target closed')) {
        console.log(`[RECONNECT] Puppeteer target closed error during reconnection for bot ${botId}. Cleaning session.`);
        
        // Clean the corrupted session
        try {
          await this.cleanBotSession(botId);
          console.log(`[RECONNECT] Session cleaned for bot ${botId} due to Puppeteer error`);
        } catch (cleanError) {
          console.error(`[RECONNECT] Error cleaning session for bot ${botId}:`, cleanError);
        }
        
        // Update status to force fresh initialization
        bot.status = 'initializing';
        bot.isActive = false;
        this.emitBotUpdate(botId);
      }
      
      throw error;
    }
  }

  // Detectar e recuperar bots stuck em "initializing"
  async detectAndRecoverStuckBots() {
    if (this.gracefulShutdown) return;

    const now = Date.now();
    const stuckThreshold = 5 * 60 * 1000; // 5 minutos

    for (const [botId, bot] of this.bots.entries()) {
      if (bot.status === 'initializing' && bot.lastActivity) {
        const timeSinceActivity = now - bot.lastActivity.getTime();

        if (timeSinceActivity > stuckThreshold) {
          console.warn(`[RECOVERY] Bot ${botId} stuck em 'initializing' por ${Math.round(timeSinceActivity/1000)}s. Iniciando recovery.`);

          try {
            await this.gracefulBotShutdown(botId);
            setTimeout(() => this.handleReconnection(botId, new Error('Bot stuck in initializing')), 1000);
          } catch (error) {
            console.error(`[RECOVERY] Erro ao recuperar bot stuck ${botId}:`, error);
          }
        }
      }
    }
  }

  // Iniciar monitoramento periódico de bots stuck
  startStuckBotMonitoring() {
    // Executar a cada 5 minutos - detecção de bots stuck
    setInterval(() => {
      if (!this.gracefulShutdown) {
        this.detectAndRecoverStuckBots();
      }
    }, 5 * 60 * 1000);

    // Executar a cada 3 minutos - manter sessões vivas com ping
    setInterval(() => {
      if (!this.gracefulShutdown) {
        this.performSessionKeepAlive();
      }
    }, 3 * 60 * 1000);

    console.log('[MONITOR] Monitoramento de bots stuck iniciado (intervalo: 5 minutos)');
    console.log('[MONITOR] Keep-alive de sessões iniciado (intervalo: 3 minutos)');
  }

  // Manter sessões vivas através de pings periódicos
  async performSessionKeepAlive() {
    console.log('[KEEPALIVE] Executando keep-alive das sessões ativas...');

    for (const [botId, bot] of this.bots.entries()) {
      if (bot.status === 'ready' && bot.isActive && bot.client) {
        try {
          // Operações leves para manter a sessão viva
          await Promise.race([
            bot.client.getState(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
          ]);

          // Tentar acessar informações básicas
          const info = bot.client.info;
          if (info && info.wid) {
            console.log(`[KEEPALIVE] Bot ${botId} - sessão ativa e saudável`);
            bot.lastKeepAlive = new Date();
          } else {
            console.warn(`[KEEPALIVE] Bot ${botId} - sem informações básicas, possível problema de sessão`);
          }

        } catch (error) {
          console.warn(`[KEEPALIVE] Bot ${botId} - falha no keep-alive: ${error.message}`);
          
          // Se falhar várias vezes seguidas, marcar para reconexão
          if (!bot.keepAliveFailures) bot.keepAliveFailures = 0;
          bot.keepAliveFailures++;

          if (bot.keepAliveFailures >= 3) {
            console.error(`[KEEPALIVE] Bot ${botId} - múltiplas falhas de keep-alive (${bot.keepAliveFailures}), iniciando reconexão preventiva`);
            bot.keepAliveFailures = 0; // Reset counter
            this.handleReconnection(botId, new Error('Keep-alive failed multiple times'));
          }
        }
      }
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
            '--disable-gpu',
            // Argumentos extras para máxima estabilidade
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-crash-upload',
            '--disable-component-extensions-with-background-pages',
            '--disable-domain-reliability',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--force-fieldtrials=SiteIsolationExtensions/Control',
            '--disable-back-forward-cache',
            '--disable-popup-blocking',
            '--disable-print-preview',
            '--max_old_space_size=4096',
            '--memory-pressure-off',
            '--disable-low-end-device-mode',
            '--disable-backing-store-limit',
            // Argumentos críticos para sessões persistentes
            '--disable-web-security',
            '--disable-site-isolation-trials',
            '--disable-features=VizDisplayCompositor',
            '--user-data-dir=/tmp/whatsapp-session-data',
            '--aggressive-cache-discard'
          ],
          ignoreHTTPSErrors: true,
          ignoreDefaultArgs: ['--disable-extensions'],
          slowMo: 100,
          timeout: 120000,
          protocolTimeout: 120000
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        takeoverOnConflict: true,
        takeoverTimeoutMs: 30000
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
        restorationTimeout: null, // Timeout handle for restoration attempts
        restorationAttempts: 0, // Counter for restoration attempts
        hasConnectedBefore: !!config.phoneNumber, // True if bot has phone number (connected before)
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
      
      // Handle specific Puppeteer errors
      if (error.message && error.message.includes('Protocol error (Runtime.callFunctionOn): Target closed')) {
        console.log(`Puppeteer target closed error for bot ${config.id}. This usually means the browser session was corrupted. Cleaning session and marking for fresh start.`);
        
        // Clean the corrupted session immediately
        try {
          await this.cleanBotSession(config.id);
          console.log(`Session cleaned for bot ${config.id} due to Puppeteer error`);
        } catch (cleanError) {
          console.error(`Error cleaning session for bot ${config.id}:`, cleanError);
        }
        
        // Update the config to force fresh initialization
        DatabaseService.updateBot(config.id, {
          isActive: false,
          status: 'initializing',
          lastActivity: new Date().toISOString()
        });
        
        // Remove from memory if it exists
        this.bots.delete(config.id);
        
        return null; // Don't return bot data for corrupted sessions
      }
      
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
            '--disable-gpu',
            // Argumentos extras para máxima estabilidade
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-crash-upload',
            '--disable-component-extensions-with-background-pages',
            '--disable-domain-reliability',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--force-fieldtrials=SiteIsolationExtensions/Control',
            '--disable-back-forward-cache',
            '--disable-popup-blocking',
            '--disable-print-preview',
            '--max_old_space_size=4096',
            '--memory-pressure-off',
            '--disable-low-end-device-mode',
            '--disable-backing-store-limit',
            // Argumentos críticos para sessões persistentes
            '--disable-web-security',
            '--disable-site-isolation-trials',
            '--disable-features=VizDisplayCompositor',
            '--user-data-dir=/tmp/whatsapp-session-data',
            '--aggressive-cache-discard'
          ],
          ignoreHTTPSErrors: true,
          ignoreDefaultArgs: ['--disable-extensions'],
          slowMo: 100,
          timeout: 120000,
          protocolTimeout: 120000
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        takeoverOnConflict: true,
        takeoverTimeoutMs: 30000
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
      hasConnectedBefore: false, // First time connecting
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
      
      // Emit bot created event only to the owner
      if (botData.ownerId) {
        this.io.to(botData.ownerId).emit('bot-created', {
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
      }
      
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
      console.log(`[QR] Bot ${id} solicitou QR code - Status: ${botData.status}, Active: ${botData.isActive}`);

      // Clear restoration timeout if QR is being generated
      if (botData.restorationTimeout) {
        clearTimeout(botData.restorationTimeout);
        botData.restorationTimeout = null;
      }

      // **PREVENÇÃO AGRESSIVA DE QR DESNECESSÁRIO**
      // Verificar se realmente precisamos do QR code
      if (botData.status === 'ready' && botData.isActive) {
        console.log(`[QR] Bot ${id} já está ativo e pronto, ignorando QR code desnecessário`);
        return;
      }

      // Se está em processo de restauração, permitir QR apenas se falhou
      if (botData.isRestoring) {
        console.log(`[QR] Bot ${id} em restauração falhou, gerando QR para re-autenticação`);
        botData.isRestoring = false;
      }

      // Verificar se não geramos QR muito recentemente (evitar spam de QR)
      const lastQRTime = botData.lastQRGenerated || 0;
      const timeSinceLastQR = Date.now() - lastQRTime;
      const minQRInterval = 30000; // 30 segundos mínimo entre QR codes

      if (timeSinceLastQR < minQRInterval) {
        console.log(`[QR] Bot ${id} QR code gerado muito recentemente, aguardando ${Math.round((minQRInterval - timeSinceLastQR) / 1000)}s`);
        return;
      }

      try {
        const qrCodeDataURL = await QRCode.toDataURL(qr);
        botData.qrCode = qrCodeDataURL;
        botData.status = 'waiting_for_scan';
        botData.lastQRGenerated = Date.now(); // Marcar quando foi gerado
        this.emitBotUpdate(id);
        console.log(`[QR] QR Code gerado para bot ${id} - Escaneie para conectar`);
      } catch (error) {
        console.error(`[QR] Erro ao gerar QR code para bot ${id}:`, error);
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
      
      // Mark as connected before if this is first successful connection
      if (!botData.hasConnectedBefore) {
        botData.hasConnectedBefore = true;
        console.log(`Bot ${id} - First successful connection! Will process offline messages on future reconnections.`);
      } else {
        console.log(`Bot ${id} - Reconnected! Processing missed messages since last activity.`);
      }
      
      console.log(`Bot ${id} authenticated and ready!`);
      console.log(`Bot ${id} - Message age filter: ${botData.hasConnectedBefore ? 'flexible (reconnection)' : 'strict (first connection)'}`);
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

      // Iniciar reconexão automática se não for graceful shutdown
      if (!this.gracefulShutdown && reason !== 'Client destroyed') {
        console.log(`[RECONNECT] Iniciando reconexão automática para bot ${id} após desconexão: ${reason}`);
        setTimeout(() => this.handleReconnection(id, new Error(`Disconnected: ${reason}`)), 5000);
      }
    });

    // Evento para capturar erros críticos do cliente
    client.on('error', (error) => {
      console.error(`Bot ${id} client error:`, error);

      // Verificar se é erro de protocolo que requer reconexão
      if (error.message && error.message.includes('ProtocolError') ||
          error.message && error.message.includes('Target closed') ||
          error.message && error.message.includes('Session closed')) {

        console.log(`[RECONNECT] Erro crítico detectado para bot ${id}, iniciando reconexão: ${error.message}`);
        botData.status = 'error';
        botData.error = error.message;
        botData.isActive = false;
        this.emitBotUpdate(id);

        // Iniciar reconexão com delay maior para erros críticos
        if (!this.gracefulShutdown) {
          setTimeout(() => this.handleReconnection(id, error), 10000);
        }
      } else {
        // Para outros erros, apenas logar
        botData.error = error.message;
        this.emitBotUpdate(id);
      }
    });

    // Evento para detectar quando o bot fica stuck
    client.on('change_state', (state) => {
      console.log(`Bot ${id} state changed to: ${state}`);
      botData.lastActivity = new Date();

      // Se ficar muito tempo em INITIALIZING, marcar para recovery
      if (state === 'INITIALIZING') {
        botData.status = 'initializing';
        this.emitBotUpdate(id);

        // Agendar verificação de stuck após 2 minutos
        setTimeout(() => {
          if (botData.status === 'initializing' && !this.gracefulShutdown) {
            console.warn(`[RECOVERY] Bot ${id} ainda em INITIALIZING após 2 minutos, marcando para recovery`);
            this.handleReconnection(id, new Error('Stuck in INITIALIZING state'));
          }
        }, 120000);
      }
    });

    client.on('message_create', async (message) => {
      // Only respond to messages received by the bot, not sent by it
      if (message.fromMe) return;
      
      // **FILTRO INTELIGENTE DE MENSAGENS POR IDADE**
      // Comportamento diferente para primeira conexão vs reconexões
      const messageTimestamp = message.timestamp * 1000; // Convert to milliseconds
      const now = Date.now();
      const messageAge = now - messageTimestamp;
      
      let maxMessageAge;
      let filterReason;
      
      if (!botData.hasConnectedBefore) {
        // **PRIMEIRA CONEXÃO**: Filtro rigoroso - apenas mensagens dos últimos segundos
        maxMessageAge = this.maxMessageAge * 1000;
        filterReason = "first connection - avoiding history processing";
      } else {
        // **RECONEXÃO**: Filtro flexível - mensagens desde última atividade ou últimas horas configuradas
        const lastActivityTime = botData.lastActivity ? botData.lastActivity.getTime() : 0;
        const timeSinceLastActivity = now - lastActivityTime;
        const maxOfflineAge = this.maxOfflineRecoveryHours * 60 * 60 * 1000; // Horas configuradas
        
        // Se estava offline por menos do limite configurado, processa mensagens desde última atividade
        // Se estava offline por mais tempo, processa apenas últimas 2 horas
        if (timeSinceLastActivity < maxOfflineAge && lastActivityTime > 0) {
          maxMessageAge = timeSinceLastActivity + (5 * 60 * 1000); // Última atividade + 5min buffer
          filterReason = "reconnection - processing since last activity";
        } else {
          maxMessageAge = 2 * 60 * 60 * 1000; // 2 horas para offline longo
          filterReason = "reconnection - long offline, processing last 2 hours";
        }
      }
      
      if (messageAge > maxMessageAge) {
        console.log(`Bot ${id} - Skipping old message (${Math.round(messageAge/1000)}s ago, ${filterReason})`);
        return;
      } else if (!botData.hasConnectedBefore) {
        console.log(`Bot ${id} - Processing recent message (${Math.round(messageAge/1000)}s ago, first connection)`);
      } else {
        console.log(`Bot ${id} - Processing offline message (${Math.round(messageAge/1000)}s ago, reconnection)`);
      }
      
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
    const bot = this.bots.get(botId);
    const success = await this.stopBot(botId);
    if (success) {
      // Clean up the bot session directory
      try {
        await this.cleanBotSession(botId);
        console.log(`Session cleaned up for deleted bot ${botId}`);
      } catch (error) {
        console.error(`Error cleaning session for bot ${botId}:`, error);
      }

      this.bots.delete(botId);
      // Remove bot from database
      try {
        DatabaseService.deleteBot(botId);
      } catch (error) {
        console.error(`Error deleting bot ${botId} from database:`, error);
      }

      // Emit bot deleted event only to the owner
      if (bot && bot.ownerId) {
        this.io.to(bot.ownerId).emit('bot-deleted', { botId });
      }
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
    if (bot && bot.ownerId) {
      // Send update only to the bot owner
      this.io.to(bot.ownerId).emit('bot-updated', {
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

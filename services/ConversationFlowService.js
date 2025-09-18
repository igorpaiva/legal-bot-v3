import fs from 'fs/promises';
import path from 'path';
import LegalFieldQuestionsService from './LegalFieldQuestionsService.js';
import LawyerNotificationService from './LawyerNotificationService.js';
import DatabaseService from './DatabaseService.js';

export class ConversationFlowService {
  constructor(groqService, triageService, assistantName = 'Ana', botManager = null) {
    this.groqService = groqService;
    this.triageService = triageService;
    this.assistantName = assistantName; // Store the assistant name
    this.botManager = botManager; // Store botManager reference for lawyer notifications
    this.conversations = new Map();
    this.clients = new Map();
    this.messages = new Map();
    this.conversationIdCounter = 1;
    this.messageIdCounter = 1;
    this.pendingRetries = new Map(); // Track pending retries
    this.pendingMessages = new Map(); // Track pending message bursts
    this.messageTimeouts = new Map(); // Track message timeouts
    this.sendResponseCallback = null; // Callback for sending responses in burst mode
    this.legalFieldQuestionsService = new LegalFieldQuestionsService(); // Strategic questions service
    this.messageTiming = new Map(); // Track message timing patterns
    this.typingDetection = new Map(); // Track typing patterns
    
    // Load persisted data - don't auto-load, let BotManager handle it
    // this.loadConversations();
    
    // Clean up old timing data periodically
    setInterval(() => {
      this.cleanupOldTimingData();
    }, 300000); // Every 5 minutes
  }

  // Get the law office name for the current bot
  async getLawOfficeName() {
    if (!this.botManager) {
      return 'V3'; // Fallback to default if no botManager
    }

    // Find the current bot by looking for the bot that owns this conversation service
    const currentBot = Array.from(this.botManager.bots.values()).find(bot => 
      bot.conversationFlowService === this
    );

    if (!currentBot || !currentBot.ownerId) {
      return 'V3'; // Fallback to default if no bot found or no owner
    }

    try {
      // Import DatabaseService to get law office info
      const { default: DatabaseService } = await import('./DatabaseService.js');
      const lawOffice = DatabaseService.getUserById(currentBot.ownerId);
      
      if (lawOffice && lawOffice.lawOfficeName) {
        return lawOffice.lawOfficeName;
      }
    } catch (error) {
      console.error('Error getting law office name:', error);
    }

    return 'V3'; // Final fallback
  }

  cleanupOldTimingData() {
    const fiveMinutesAgo = Date.now() - 300000;
    
    for (const [clientPhone, timingHistory] of this.messageTiming.entries()) {
      // Remove messages older than 5 minutes
      const recentMessages = timingHistory.filter(msg => msg.timestamp > fiveMinutesAgo);
      
      if (recentMessages.length === 0) {
        this.messageTiming.delete(clientPhone);
        this.typingDetection.delete(clientPhone);
      } else {
        this.messageTiming.set(clientPhone, recentMessages);
      }
    }
  }

  // Method to set the response callback for message bursts
  setSendResponseCallback(callback) {
    this.sendResponseCallback = callback;
  }

  async processIncomingMessage(phone, messageText, originalPhoneForReply = null) {
    console.log(`Processing message - Phone: ${phone}, Text: ${messageText}`);
    
    try {
      const client = this.findOrCreateClient(phone);
      const conversation = this.findOrCreateActiveConversation(client, messageText);
      
      // Handle message bursts - wait for client to finish typing
      if (this.shouldWaitForMoreMessages(conversation, messageText)) {
        return await this.handleMessageBurst(phone, messageText, originalPhoneForReply, client, conversation, this.sendResponseCallback);
      }
      
      this.saveIncomingMessage(conversation, messageText);

      // Get response based on conversation state
      const response = await this.processConversationState(conversation, messageText, client);

      // Save outgoing message
      if (response && response.trim()) {
        this.saveOutgoingMessage(conversation, response);
      }

      conversation.lastActivityAt = new Date();
      this.saveConversations();

      return response;

    } catch (error) {
      console.error('Error processing message:', error);
      
      // Mark this message for retry
      const retryKey = `${phone}_${Date.now()}`;
      if (!this.pendingRetries) {
        this.pendingRetries = new Map();
      }
      
      this.pendingRetries.set(retryKey, {
        phone,
        messageText,
        originalPhoneForReply,
        attempts: 1,
        maxAttempts: 3
      });
      
      // Schedule retry in 30 seconds
      setTimeout(() => {
        this.retryMessage(retryKey);
      }, 30000);
      
      // Return natural "busy" message
      const busyMessages = [
        'Oi! Estou com muitas mensagens agora, mas já volto para te atender. Aguarde só um minutinho! 😊',
        'Olá! Estou meio ocupada no momento, mas já já retorno para continuar nossa conversa!',
        'Oi! Só um momentinho, estou finalizando outro atendimento e já volto para você!',
        'Olá! Estou um pouco sobrecarregada agora, mas em instantes volto para te ajudar!'
      ];
      
      return busyMessages[Math.floor(Math.random() * busyMessages.length)];
    }
  }

  findOrCreateClient(phone) {
    // Add defensive check for phone parameter
    if (!phone) {
      console.error(`[ERROR] findOrCreateClient - Invalid phone parameter:`, phone);
      throw new Error('Invalid phone parameter');
    }
    
    let client = this.clients.get(phone);
    if (!client) {
      client = {
        id: Date.now(),
        phone: phone,
        name: null,
        email: null,
        createdAt: new Date()
      };
      this.clients.set(phone, client);
      console.log(`[DEBUG] findOrCreateClient - Created new client for phone: ${phone}`);
    } else {
      console.log(`[DEBUG] findOrCreateClient - Found existing client for phone: ${phone}`);
    }
    return client;
  }

  findOrCreateActiveConversation(client, messageText = '') {
    // Add defensive check for client object
    if (!client || !client.phone) {
      console.error(`[ERROR] findOrCreateActiveConversation - Invalid client object:`, client);
      throw new Error('Invalid client object - missing phone property');
    }
    
    console.log(`[DEBUG] findOrCreateActiveConversation - Looking for conversation for client: ${client.phone}`);
    console.log(`[DEBUG] findOrCreateActiveConversation - Total conversations in memory: ${this.conversations.size}`);
    
    // Log all existing conversations for debugging
    for (const [id, conv] of this.conversations.entries()) {
      console.log(`[DEBUG] findOrCreateActiveConversation - Conversation ${id}: client.phone=${conv.client?.phone}, state=${conv.state}, startedAt=${conv.startedAt}`);
    }
    
    // Check if this is a post-service message (any message from existing client, except explicit new case requests)
    const lowerText = messageText.toLowerCase();
    
    // Check if client explicitly wants a NEW case
    const isExplicitNewCase = lowerText.includes('novo caso') ||
                             lowerText.includes('nova questão') ||
                             lowerText.includes('outro problema') ||
                             lowerText.includes('outro assunto') ||
                             lowerText.includes('nova situação') ||
                             lowerText.includes('diferente') ||
                             lowerText.includes('separado') ||
                             (lowerText.includes('novo') && (lowerText.includes('problema') || lowerText.includes('juridic')));
    
    // If client has completed conversations and NOT requesting a new case explicitly, treat as post-service
    const hasCompletedConversations = Array.from(this.conversations.values()).some(conv => 
      conv.client && conv.client.phone === client.phone && conv.state === 'COMPLETED'
    );
    
    const isPostServiceMessage = hasCompletedConversations && !isExplicitNewCase;
    
    console.log(`[DEBUG] findOrCreateActiveConversation - Is post-service message: ${isPostServiceMessage} ("${messageText}")`);
    
    // If it's a post-service message, prioritize COMPLETED conversations
    if (isPostServiceMessage) {
      for (const [id, conv] of this.conversations.entries()) {
        if (conv && 
            conv.client && 
            conv.client.phone === client.phone && 
            conv.state === 'COMPLETED') {
          console.log(`[DEBUG] findOrCreateActiveConversation - Found COMPLETED conversation for post-service message: ${id}`);
          return conv;
        }
      }
    }
    
    // Log all existing conversations for this client
    for (const [id, conv] of this.conversations.entries()) {
      if (conv.client && conv.client.phone === client.phone) {
        console.log(`[DEBUG] findOrCreateActiveConversation - Found conversation for client ${client.phone}: ID=${id}, state=${conv.state}, startedAt=${conv.startedAt}`);
      }
    }
    
    // Find active conversation for this client (excluding COMPLETED ones unless it's a post-service message)
    // Also validate that the conversation has proper structure
    for (const [id, conv] of this.conversations.entries()) {
      if (conv && 
          conv.client && 
          conv.client.phone === client.phone && 
          conv.state && 
          (conv.state === 'GREETING' || 
           conv.state === 'COLLECTING_NAME' || 
           conv.state === 'COLLECTING_EMAIL' || 
           conv.state === 'ANALYZING_CASE' || 
           conv.state === 'COLLECTING_STRATEGIC_INFO' || 
           conv.state === 'COLLECTING_DETAILS' || 
           conv.state === 'COLLECTING_DOCUMENTS' || 
           conv.state === 'AWAITING_COMPLEMENT' || 
           conv.state === 'AWAITING_LAWYER')) {
        
        console.log(`[DEBUG] findOrCreateActiveConversation - Found existing active conversation: ${id}, state: ${conv.state}`);
        return conv;
      }
    }

    // Create new conversation
    const conversation = {
      id: this.conversationIdCounter++,
      client: client,
      state: 'GREETING',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      conversationHistory: [] // Initialize the conversation history array
    };
    
    console.log(`[DEBUG] findOrCreateActiveConversation - Created new conversation: ${conversation.id} for client: ${client.phone}`);
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  shouldWaitForMoreMessages(conversation, messageText) {
    // Don't wait for bursts in certain states where single responses are expected
    const singleResponseStates = ['COLLECTING_NAME', 'COLLECTING_EMAIL', 'COLLECTING_STRATEGIC_INFO'];
    if (singleResponseStates.includes(conversation.state)) {
      return false;
    }

    // Check if this is a document message - always wait for more documents
    const isDocumentMessage = messageText.includes('[DOCUMENTO') || 
                             messageText.includes('[PDF') ||
                             messageText.includes('[ARQUIVO') ||
                             messageText.includes('[IMAGEM') ||
                             messageText.includes('[VIDEO') ||
                             messageText.toLowerCase().includes('[documento]') ||
                             messageText.toLowerCase().includes('[pdf]') ||
                             messageText.toLowerCase().includes('[arquivo]') ||
                             messageText.toLowerCase().includes('[imagem]') ||
                             messageText.toLowerCase().includes('[video]');
    
    if (isDocumentMessage) {
      console.log(`[BURST] Document message, waiting for more documents: "${messageText}"`);
      return true;
    }

    // Wait for bursts in states where detailed information is expected
    const burstStates = ['GREETING', 'ANALYZING_CASE', 'COLLECTING_DETAILS', 'AWAITING_COMPLEMENT'];
    if (!burstStates.includes(conversation.state)) {
      return false;
    }

    // Smart analysis: Don't wait if message seems complete and substantial
    const text = messageText.trim();
    
    // If message is long and ends with proper punctuation, likely complete
    if (text.length > 200 && /[.!?]$/.test(text)) {
      console.log(`[BURST] Long complete message, not waiting: ${text.length} chars`);
      return false;
    }
    
    // If message is very short, likely more coming
    if (text.length < 50) {
      console.log(`[BURST] Short message, waiting for more: "${text}"`);
      return true;
    }
    
    // Check for incomplete patterns
    const seemsIncomplete = this.seemsIncomplete(text);
    if (seemsIncomplete) {
      console.log(`[BURST] Message seems incomplete, waiting: "${text}"`);
      return true;
    }
    
    // Medium length messages without punctuation
    if (text.length < 150 && !/[.!?]$/.test(text)) {
      console.log(`[BURST] Medium message without punctuation, waiting: "${text}"`);
      return true;
    }
    
    // Default: don't wait for seemingly complete messages
    console.log(`[BURST] Message seems complete, not waiting: "${text}"`);
    return false;
  }

  seemsIncomplete(text) {
    const trimmed = text.trim().toLowerCase();
    
    // Common incomplete patterns
    const incompletePatterns = [
      /^(e|mas|porque|então|aí|daí|tipo|só|ainda|também|além|inclusive)\s/,
      /\s(e|mas|porque|então|aí|daí|tipo|só|ainda|também)$/,
      /,$/,        // ends with comma
      /:\s*$/,     // ends with colon
      /\.\.\./,    // contains ellipsis
      /\s-\s*$/,   // ends with dash
      /\se\s*$/,   // ends with "e"
    ];
    
    return incompletePatterns.some(pattern => pattern.test(trimmed));
  }

  async handleMessageBurst(phone, messageText, originalPhoneForReply, client, conversation, sendResponseCallback = null) {
    const burstKey = `${phone}_${conversation.id}`;
    
    // Clear any existing timeout for this conversation
    if (this.messageTimeouts.has(burstKey)) {
      clearTimeout(this.messageTimeouts.get(burstKey));
    }

    // Initialize or update pending messages
    if (!this.pendingMessages.has(burstKey)) {
      this.pendingMessages.set(burstKey, []);
    }
    
    // Add current message to pending messages
    this.pendingMessages.get(burstKey).push(messageText);
    
    // Calculate dynamic timeout based on patterns
    const timeout = this.calculateDynamicTimeout(conversation, messageText);
    
    console.log(`[BURST] Added message to burst for ${phone}: "${messageText}". Using ${timeout}ms timeout. Queue: ${this.pendingMessages.get(burstKey).length} messages`);
    
    // Return a Promise that resolves when the burst is processed
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        try {
          console.log(`[BURST] Processing burst for ${phone} after ${timeout}ms timeout`);
          
          const allMessages = this.pendingMessages.get(burstKey) || [];
          const combinedMessage = allMessages.join('\n\n');
          
          // Clean up
          this.pendingMessages.delete(burstKey);
          this.messageTimeouts.delete(burstKey);
          
          // Process the combined message
          this.saveIncomingMessage(conversation, combinedMessage);
          const response = await this.processConversationState(conversation, combinedMessage, client);
          
          if (response && response.trim()) {
            this.saveOutgoingMessage(conversation, response);
          }
          
          conversation.lastActivityAt = new Date();
          this.saveConversations();
          
          // Resolve the Promise with the response
          resolve(response);
          
        } catch (error) {
          console.error('[BURST] Error processing message burst:', error);
          reject(error);
        }
      }, timeout);
      
      this.messageTimeouts.set(burstKey, timeoutId);
    });
  }

  calculateDynamicTimeout(conversation, messageText) {
    const text = messageText.trim();
    
    // Base timeout
    let timeout = 15000; // 15 seconds default
    
    // Shorter timeout for very short messages (likely quick follow-ups)
    if (text.length < 30) {
      timeout = 8000; // 8 seconds for very short
    }
    // Medium timeout for medium messages
    else if (text.length < 100) {
      timeout = 12000; // 12 seconds for medium
    }
    // Longer timeout for longer messages (user might be typing more)
    else if (text.length > 200) {
      timeout = 20000; // 20 seconds for long messages
    }
    
    // Extra time if message seems incomplete
    if (this.seemsIncomplete(text)) {
      timeout += 5000; // Extra 5 seconds for incomplete
    }
    
    // Extra time for case analysis states (more complex thinking)
    if (conversation.state === 'ANALYZING_CASE' || conversation.state === 'COLLECTING_DETAILS') {
      timeout += 3000; // Extra 3 seconds for complex states
    }
    
    // Bounds: between 8-25 seconds
    timeout = Math.max(8000, Math.min(timeout, 25000));
    
    console.log(`[BURST] Dynamic timeout: ${timeout}ms for message length: ${text.length}, incomplete: ${this.seemsIncomplete(text)}`);
    return timeout;
  }

  async processConversationState(conversation, messageText, client) {
    const state = conversation.state;
    console.log(`[DEBUG] processConversationState - Conversation ID: ${conversation.id}, State: ${state}, Client: ${client.phone}, Message: "${messageText}"`);
    console.log(`[DEBUG] processConversationState - Full conversation object:`, JSON.stringify({
      id: conversation.id,
      state: conversation.state,
      client: conversation.client,
      startedAt: conversation.startedAt
    }, null, 2));
    
    switch (state) {
      case 'GREETING':
        return await this.handleGreeting(conversation, messageText, client);
      case 'COLLECTING_NAME':
        return this.handleNameCollection(conversation, messageText, client);
      case 'COLLECTING_EMAIL':
        return this.handleEmailCollection(conversation, messageText, client);
      case 'ANALYZING_CASE':
        return await this.handleCaseAnalysis(conversation, messageText, client);
      case 'COLLECTING_STRATEGIC_INFO':
        return await this.handleStrategicInfoCollection(conversation, messageText, client);
      case 'COLLECTING_DETAILS':
        return await this.handleDetailCollection(conversation, messageText, client);
      case 'COLLECTING_DOCUMENTS':
        return await this.handleDocumentCollection(conversation, messageText, client);
      case 'AWAITING_LAWYER':
        return await this.handleAwaitingLawyer(conversation, messageText, client);
      case 'AWAITING_COMPLEMENT':
        return await this.handleComplementCollection(conversation, messageText, client);
      case 'COMPLETED':
        console.log(`[DEBUG] processConversationState - Handling COMPLETED state for client: ${client.phone}`);
        return await this.handlePostServiceMessage(conversation, messageText, client);
      default:
        console.log(`[DEBUG] processConversationState - DEFAULT case reached with state: ${state}, falling back to handleGreeting`);
        return await this.handleGreeting(conversation, messageText, client);
    }
  }

  async handleGreeting(conversation, messageText, client) {
    // Check if the message looks like case details rather than a greeting
    const lowerText = messageText.toLowerCase();
    const isLikelyGreeting = lowerText.includes('olá') || 
                            lowerText.includes('oi') || 
                            lowerText.includes('bom dia') ||
                            lowerText.includes('boa tarde') ||
                            lowerText.includes('boa noite') ||
                            lowerText.includes('tudo bem') ||
                            messageText.length < 30;
    
    // If it doesn't look like a greeting and they have name/email, assume they're providing case details
    if (!isLikelyGreeting && client.name && client.name.length > 3 && client.email && client.email.includes('@')) {
      console.log(`[DEBUG] handleGreeting - Message doesn't look like greeting and client has info, moving to case analysis`);
      conversation.state = 'ANALYZING_CASE';
      return await this.handleCaseAnalysis(conversation, messageText, client);
    }
    
    // Check if we already have name and email, skip to case analysis
    if (client.name && client.name.length > 3 && client.email && client.email.includes('@')) {
      console.log(`[DEBUG] handleGreeting - Client already has name and email, moving to case analysis`);
      conversation.state = 'ANALYZING_CASE';
      
      const firstName = client.name.split(' ')[0];
      
      // AI generates natural greeting and transition to case discussion
      const greetingPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente (${client.name}) está retornando.

SITUAÇÃO: O cliente já forneceu nome e email anteriormente.

TAREFA: Fazer uma saudação calorosa perguntando como vai e ir direto ao caso.

INSTRUÇÕES:
- Cumprimente usando o primeiro nome (${firstName})
- Pergunte como vai o cliente
- Convide a pessoa a contar sobre a situação jurídica
- Seja calorosa mas objetiva
- Encoraje detalhes (datas, pessoas envolvidas, valores, etc.)

Responda APENAS com sua mensagem:`;

      try {
        const response = await this.groqService.generateResponse(greetingPrompt);
        
        if (!response || typeof response !== 'string' || response.trim().length === 0) {
          console.error('Invalid response from GroqService in handleGreeting (returning user):', response);
          return `Olá ${firstName}! Como vai? Vamos conversar sobre sua situação jurídica. Pode me contar os detalhes?`;
        }
        
        return response.trim();
      } catch (error) {
        console.error('Error in handleGreeting (returning user):', error);
        return `Olá ${firstName}! Como vai? Vamos conversar sobre sua situação jurídica. Pode me contar os detalhes?`;
      }
    }
    
    // Check if we have name but no email
    if (client.name && client.name.length > 3) {
      console.log(`[DEBUG] handleGreeting - Client has name but no email, moving to email collection`);
      conversation.state = 'COLLECTING_EMAIL';
      
      const firstName = client.name.split(' ')[0];
      
      const emailPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente (${client.name}) está retornando.

SITUAÇÃO: Você já conhece o nome da pessoa mas precisa do email.

INSTRUÇÕES:
- Cumprimente usando o primeiro nome (${firstName})
- Peça o email de forma natural
- Explique brevemente por que precisa (para atualizações)
- Seja calorosa mas objetiva

Responda APENAS com sua mensagem:`;

      try {
        const response = await this.groqService.generateResponse(emailPrompt);
        
        if (!response || typeof response !== 'string' || response.trim().length === 0) {
          console.error('Invalid response from GroqService in handleGreeting (email collection):', response);
          return `Olá ${firstName}! Para manter você atualizado sobre o andamento, preciso do seu email. Qual o melhor email para contato?`;
        }
        
        return response.trim();
      } catch (error) {
        console.error('Error in handleGreeting (email collection):', error);
        return `Olá ${firstName}! Para manter você atualizado sobre o andamento, preciso do seu email. Qual o melhor email para contato?`;
      }
    }
    
    // Normal greeting flow - ask for name
    conversation.state = 'COLLECTING_NAME';
    
    // Get the law office name dynamically
    const lawOfficeName = await this.getLawOfficeName();
    
    // Let AI generate a completely natural greeting
    const greetingPrompt = `Você é ${this.assistantName}, assistente jurídica do escritório ${lawOfficeName}. 
    
Um cliente acabou de entrar em contato via WhatsApp pela primeira vez.

TAREFA: Cumprimente de forma natural e peça o nome da pessoa.

INSTRUÇÕES:
- Seja calorosa e profissional
- Use linguagem brasileira natural
- Seja concisa mas completa
- Não use emojis
- Se apresente como ${this.assistantName}
- SEMPRE responda em português brasileiro

Responda APENAS com sua mensagem em português:`;

    try {
      const response = await this.groqService.generateResponse(greetingPrompt);
      
      // Validate response
      if (!response || typeof response !== 'string' || response.trim().length === 0) {
        console.error('Invalid response from GroqService in handleGreeting:', response);
        return `Olá! Sou a ${this.assistantName}, assistente jurídica do escritório ${await this.getLawOfficeName()}. Como posso chamar você?`;
      }
      
      return response.trim();
    } catch (error) {
      console.error('Error in handleGreeting:', error);
      const lawOfficeName = await this.getLawOfficeName();
      return `Olá! Sou a ${this.assistantName}, assistente jurídica do escritório ${lawOfficeName}. Como posso chamar você?`;
    }
  }

  detectCaseDetailsInMessage(messageText) {
    // Check if the message contains case-related keywords and is long enough to be case details
    const caseKeywords = [
      'empresa', 'trabalho', 'emprego', 'demissão', 'salário', 'contrato', 'processo',
      'tribunal', 'advogado', 'direito', 'lei', 'acidente', 'indenização', 'dano',
      'separação', 'divórcio', 'filho', 'pensão', 'herança', 'inventário',
      'cobrança', 'dívida', 'documento', 'cnpj', 'cpf', 'registro',
      'problema', 'situação', 'caso', 'questão', 'dúvida', 'ajuda',
      'atestado', 'cid', 'cat', 'inss', 'afastado', 'burnout', 'doença',
      'rescisão', 'justa causa', 'banco', 'cartão', 'crédito'
    ];
    
    const lowerText = messageText.toLowerCase();
    const hasKeywords = caseKeywords.some(keyword => lowerText.includes(keyword));
    const isLongEnough = messageText.length > 50; // More than 50 characters suggests details
    
    return hasKeywords && isLongEnough;
  }

  async handleNameCollection(conversation, messageText, client) {
    console.log(`[DEBUG] handleNameCollection - Input: "${messageText}"`);
    console.log(`[DEBUG] handleNameCollection - Current client name: "${client.name}"`);
    console.log(`[DEBUG] handleNameCollection - Conversation state: "${conversation.state}"`);
    
    // If client already has a name and they're just providing it again or giving details, skip to email
    if (client.name && client.name.length > 3) {
      console.log(`[DEBUG] handleNameCollection - Client already has name, moving to email collection`);
      conversation.state = 'COLLECTING_EMAIL';
      
      const firstName = client.name.split(' ')[0];
      
      // Let AI generate natural response asking for email
      const emailPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente acabou de se apresentar como "${client.name}".

SITUAÇÃO: Agora você precisa do email da pessoa para enviar atualizações sobre o caso.

INSTRUÇÕES:
- Reconheça o nome de forma calorosa (use "${firstName}")
- Peça o email de forma natural
- Explique brevemente por que precisa (para atualizações)
- Seja conversacional, não robotizada

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(emailPrompt);
    }
    
    // Check if this message contains case details even though we're collecting names
    if (this.detectCaseDetailsInMessage(messageText)) {
      // Store the case details for later use
      if (!conversation.earlyCaseDetails) {
        conversation.earlyCaseDetails = [];
      }
      conversation.earlyCaseDetails.push(messageText);
      console.log(`[DEBUG] handleNameCollection - Detected case details in message, stored for later`);
    }

    const name = this.extractName(messageText);
    console.log(`[DEBUG] handleNameCollection - Extracted name: "${name}"`);
    
    if (name && name.length > 3) {
      client.name = name;
      this.clients.set(client.phone, client);
      
      conversation.state = 'COLLECTING_EMAIL';
      console.log(`[DEBUG] handleNameCollection - Updated state to: "${conversation.state}"`);
      console.log(`[DEBUG] handleNameCollection - Updated client name to: "${client.name}"`);
      
      const firstName = name.split(' ')[0];
      
      // If case details were provided, acknowledge them while asking for email
      let emailPrompt;
      if (conversation.earlyCaseDetails && conversation.earlyCaseDetails.length > 0) {
        emailPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente acabou de se apresentar como "${name}" e também compartilhou detalhes sobre sua situação.

SITUAÇÃO: O cliente forneceu nome E informações sobre o caso. Agora você precisa do email.

INSTRUÇÕES:
- Reconheça o nome de forma calorosa (use "${firstName}")
- Demonstre que você ouviu sobre a situação (seja empática)
- Peça o email para prosseguir com o atendimento
- Explique que com o email poderão enviar atualizações
- Seja conversacional e empática

Responda APENAS com sua mensagem:`;
      } else {
        emailPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente acabou de se apresentar como "${name}".

SITUAÇÃO: Agora você precisa do email da pessoa para enviar atualizações sobre o caso.

INSTRUÇÕES:
- Reconheça o nome de forma calorosa (use "${firstName}")
- Peça o email de forma natural
- Explique brevemente por que precisa (para atualizações)
- Seja conversacional, não robotizada

Responda APENAS com sua mensagem:`;
      }

      return await this.groqService.generateResponse(emailPrompt);
    } else {
      console.log(`[DEBUG] handleNameCollection - Name not valid, asking again`);
      // AI generates natural request for name in context
      const nameRequestPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente respondeu "${messageText}" quando você pediu o nome.

SITUAÇÃO: A resposta pode conter uma pergunta ou não ter um nome claro.

TAREFA: Se houver pergunta, responda brevemente e redirecione. Se não houver nome, peça novamente.

INSTRUÇÕES:
- Se há uma pergunta, responda de forma útil mas breve
- Explique que precisa do nome para personalizar o atendimento
- Redirecione gentilmente de volta ao pedido do nome
- Seja empática mas objetiva
- Seja concisa mas completa

EXEMPLO: Se perguntarem "por que precisa do nome?", responda "Para personalizar melhor seu atendimento. Como posso chamar você?"

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(nameRequestPrompt);
    }
  }

  async handleEmailCollection(conversation, messageText, client) {
    console.log(`[DEBUG] handleEmailCollection - Input: "${messageText}"`);
    console.log(`[DEBUG] handleEmailCollection - Current client email: "${client.email}"`);
    
    // Check if this message contains case details even though we're collecting email
    if (this.detectCaseDetailsInMessage(messageText)) {
      // Store the case details for later use
      if (!conversation.earlyCaseDetails) {
        conversation.earlyCaseDetails = [];
      }
      conversation.earlyCaseDetails.push(messageText);
      console.log(`[DEBUG] handleEmailCollection - Detected case details in message, stored for later`);
    }
    
    // If client already has an email and they're just providing it again or giving details, skip to case analysis
    if (client.email && client.email.includes('@')) {
      console.log(`[DEBUG] handleEmailCollection - Client already has email, moving to case analysis`);
      conversation.state = 'ANALYZING_CASE';
      
      // Check if we have early case details to use
      if (conversation.earlyCaseDetails && conversation.earlyCaseDetails.length > 0) {
        // Process the case with existing details
        console.log(`[DEBUG] handleEmailCollection - Found early case details, processing directly`);
        return await this.handleCaseAnalysis(conversation, conversation.earlyCaseDetails.join('\n'), client);
      }
      
      // AI generates natural transition to case discussion
      const transitionPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente (${client.name}) já forneceu o email "${client.email}".

TAREFA: Fazer a transição natural para ouvir sobre o caso.

INSTRUÇÕES:
- Convide a pessoa a contar sobre a situação jurídica
- Seja objetiva e empática
- Seja concisa mas clara
- Não use emojis
- Encoraje detalhes (datas, pessoas envolvidas, valores, etc.)

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(transitionPrompt);
    }
    
    const email = this.extractEmail(messageText);
    console.log(`[DEBUG] handleEmailCollection - Extracted email: "${email}"`);
    
    if (email) {
      client.email = email;
      this.clients.set(client.phone, client);
      
      conversation.state = 'ANALYZING_CASE';
      console.log(`[DEBUG] handleEmailCollection - Updated state to: "${conversation.state}"`);
      console.log(`[DEBUG] handleEmailCollection - Updated client email to: "${client.email}"`);
      
      // Check if we have early case details to use immediately
      if (conversation.earlyCaseDetails && conversation.earlyCaseDetails.length > 0) {
        console.log(`[DEBUG] handleEmailCollection - Found early case details, processing directly`);
        return await this.handleCaseAnalysis(conversation, conversation.earlyCaseDetails.join('\n'), client);
      }
      
      // AI generates natural transition to case discussion
      const transitionPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente (${client.name}) acabou de fornecer o email "${email}".

TAREFA: Fazer a transição natural para ouvir sobre o caso.

INSTRUÇÕES:
- Confirme o email rapidamente
- Convide a pessoa a contar sobre a situação jurídica
- Seja objetiva e empática
- Seja concisa mas clara
- Não use emojis
- Encoraje detalhes (datas, pessoas envolvidas, valores, etc.)

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(transitionPrompt);
    } else {
      console.log(`[DEBUG] handleEmailCollection - Email not valid, asking again`);
      // AI generates natural request for valid email
      const emailClarificationPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente respondeu "${messageText}" quando você pediu o email.

SITUAÇÃO: A resposta pode conter uma pergunta ou não ser um email válido.

TAREFA: Se houver pergunta, responda brevemente e redirecione. Se não houver email válido, peça novamente.

INSTRUÇÕES:
- Se há uma pergunta (como "pode ser qualquer um?"), responda de forma útil mas breve
- Explique que precisa de um email válido para atualizações do caso
- Redirecione gentilmente de volta ao pedido de email
- Seja objetiva mas empática
- Máximo 2 frases

EXEMPLO: Se perguntarem "pode ser qualquer um?", responda "Sim, pode ser seu email pessoal ou profissional. Qual email você gostaria de usar?"

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(emailClarificationPrompt);
    }
  }

  async handleCaseAnalysis(conversation, messageText, client) {
    // Ensure conversationHistory array exists
    if (!conversation.conversationHistory) {
      conversation.conversationHistory = [];
    }
    
    // Combine early case details with current message if available
    let fullCaseText = messageText;
    if (conversation.earlyCaseDetails && conversation.earlyCaseDetails.length > 0) {
      // Prepend early case details to current message
      fullCaseText = conversation.earlyCaseDetails.join('\n') + '\n' + messageText;
      console.log(`[DEBUG] handleCaseAnalysis - Combined early case details with current message`);
      // Clear early case details as they've been processed
      conversation.earlyCaseDetails = [];
    }
    
    // Acumula informações sobre o caso
    conversation.conversationHistory.push({
      role: 'user',
      content: fullCaseText,
      timestamp: new Date().toISOString()
    });
    
    // Check if we have too many exchanges - auto-finalize to prevent loops
    const userMessages = conversation.conversationHistory.filter(msg => msg.role === 'user');
    if (userMessages.length >= 6) {
      console.log('Auto-finalizing conversation due to too many exchanges');
      conversation.state = 'COMPLETED';
      
      // Update database
      await this.updateConversationInDatabase(conversation);
      
      // Save the triage analysis if available
      if (conversation.analysis) {
        this.saveTriageAnalysis(conversation, conversation.analysis);
      }
      return `Com base em todas as informações que você forneceu, nossa equipe jurídica irá analisar seu caso detalhadamente. Um advogado especializado entrará em contato em até 24 horas para discutir os próximos passos e esclarecer suas dúvidas.`;
    }
    
    // Se ainda não fez análise inicial ou precisa de mais informações
    if (!conversation.needsMoreInfo) {
      const analysis = await this.triageService.triageFromText(fullCaseText, client.phone, this.groqService);
      conversation.analysis = analysis;
      
      // AI decides if more information is needed
      const analysisPrompt = `Você é ${this.assistantName}, assistente jurídica especializada. O cliente ${client.name} contou sobre a situação:

"${fullCaseText}"

ANÁLISE TÉCNICA:
- Área: ${analysis?.case?.category || 'Não identificada'}
- Urgência: ${analysis?.case?.urgency || 'Média'}
- Complexidade: ${analysis?.triage?.complexity || 'Média'}
- Confiança: ${analysis?.triage?.confidence || 0.5}

AVALIAÇÃO DE COMPLETUDE:
Verifique se a mensagem contém:
- ✓ Situação claramente descrita com contexto (o que aconteceu?)
- ✓ Problema jurídico identificado
- ✓ Alguma informação temporal ou consequências

REGRA CONSERVADORA: Se há um relato coerente da situação jurídica (mesmo que resumido), PREFIRA FINALIZAR. O cliente poderá complementar depois se quiser.

TAREFA: Decidir se você precisa de mais informações ou se pode finalizar o atendimento.

Se PRECISAR de mais informações (apenas se a situação estiver muito vaga ou confusa):
- Demonstre empatia e compreensão pela situação difícil
- Use "entendi" ou "compreendo" para reconhecer o que foi compartilhado
- Faça UMA pergunta específica e essencial, mas com sensibilidade
- Seja calorosa e acolhedora (máximo 2 frases)

Se TIVER informações SUFICIENTES (relato coerente da situação jurídica):
- Comece sua resposta exatamente com "FINALIZAR:"
- NÃO faça resumo da situação (o cliente já sabe o que aconteceu)
- Vá direto aos próximos passos
- Explique que um advogado especializado analisará o caso
- Informe que o advogado entrará em contato em breve

Responda APENAS com sua mensagem:`;

      const response = await this.groqService.generateResponse(analysisPrompt);
      
      if (response.startsWith('FINALIZAR:')) {
        // Check if we need strategic information for this legal field
        const legalField = conversation.analysis?.case?.category;
        const fieldInfo = this.legalFieldQuestionsService.getRequiredInfoForField(legalField);
        
        // Only collect strategic questions for Trabalhista (worker's law) cases
        if (legalField === 'Trabalhista' && fieldInfo && fieldInfo.requiredInfo.length > 0) {
          // Analyze what information we already have vs what we need
          const analysisResult = this.legalFieldQuestionsService.analyzeProvidedInformation(
            conversation.conversationHistory || [], 
            legalField
          );
          
          if (analysisResult.missingInfo.length > 0) {
            // We have missing strategic information, start collecting it
            conversation.state = 'COLLECTING_STRATEGIC_INFO';
            conversation.strategicQuestions = {
              fieldInfo: fieldInfo,
              missingInfo: analysisResult.missingInfo,
              extractedInfo: analysisResult.extractedInfo,
              currentlyAsking: null
            };
            
            // Save the triage analysis
            if (conversation.analysis) {
              this.saveTriageAnalysis(conversation, conversation.analysis);
            }
            
            return await this.askNextStrategicQuestion(conversation, client);
          } else {
            // All information already provided, save what we extracted and continue
            if (!conversation.analysis) {
              conversation.analysis = {};
            }
            
            conversation.analysis.strategicInfo = {
              legalField: fieldInfo.displayName,
              extractedInfo: analysisResult.extractedInfo,
              extractedAt: new Date().toISOString()
            };
          }
        }
        
        // No missing strategic info, offer complement option
        conversation.state = 'AWAITING_COMPLEMENT';
        if (conversation.analysis) {
          this.saveTriageAnalysis(conversation, conversation.analysis);
        }
        
        return await this.offerComplementOption(conversation);
      } else {
        conversation.needsMoreInfo = true;
        conversation.waitingForAnswer = true; // Mark that we're waiting for an answer to our question
        return response;
      }
    } else {
      // Já tinha análise, agora com informações adicionais
      const conversationMessages = conversation.conversationHistory || [];
      const allUserMessages = conversationMessages.filter(msg => msg.role === 'user').map(msg => msg.content).join('\n\n');
      
      // Check if we were waiting for an answer to a specific question
      if (conversation.waitingForAnswer) {
        // We asked a question and now got an answer, process it and likely finalize
        conversation.waitingForAnswer = false; // Reset the flag
        
        const answerProcessingPrompt = `Você é ${this.assistantName}, assistente jurídica empática. Você fez uma pergunta ao cliente ${client.name} e agora recebeu a resposta:

RESPOSTA DO CLIENTE: "${messageText}"

TODAS AS INFORMAÇÕES COLETADAS:
"${allUserMessages}"

CONTEXTO: Área identificada como ${conversation.analysis?.case?.category || 'Jurídico'}

ANÁLISE EMOCIONAL: Examine se a situação envolve sofrimento emocional, injustiças ou dificuldades pessoais.

TAREFA: Processar a resposta com empatia e finalizar o atendimento.

INSTRUÇÕES:
- Demonstre empatia e compreensão pela situação
- Reconheça a resposta com sensibilidade (1-2 frases calorosas)
- Comece com "FINALIZAR:"
- NÃO faça resumo da situação
- Transmita apoio e esperança
- Explique que um advogado especialista cuidará do caso com dedicação
- Informe que entrará em contato em breve

Responda APENAS com sua mensagem:`;

        const response = await this.groqService.generateResponse(answerProcessingPrompt);
        
        // Should always finalize after getting an answer to our question
        const legalField = conversation.analysis?.case?.category;
        const fieldInfo = this.legalFieldQuestionsService.getRequiredInfoForField(legalField);
        
        // Only collect strategic questions for Trabalhista (worker's law) cases
        if (legalField === 'Trabalhista' && fieldInfo && fieldInfo.requiredInfo.length > 0) {
          // Analyze what information we have vs what we need
          const analysisResult = this.legalFieldQuestionsService.analyzeProvidedInformation(
            conversation.conversationHistory || [], 
            legalField
          );
          
          if (analysisResult.missingInfo.length > 0) {
            // We have missing strategic information, start collecting it
            conversation.state = 'COLLECTING_STRATEGIC_INFO';
            conversation.strategicQuestions = {
              fieldInfo: fieldInfo,
              missingInfo: analysisResult.missingInfo,
              extractedInfo: analysisResult.extractedInfo,
              currentlyAsking: null
            };
            
            return await this.askNextStrategicQuestion(conversation, client);
          } else {
            // All information already provided, save what we extracted
            if (!conversation.analysis) {
              conversation.analysis = {};
            }
            
            conversation.analysis.strategicInfo = {
              legalField: fieldInfo.displayName,
              extractedInfo: analysisResult.extractedInfo,
              extractedAt: new Date().toISOString()
            };
          }
        }
        
        // No missing strategic info, offer complement option
        conversation.state = 'AWAITING_COMPLEMENT';
        if (conversation.analysis) {
          this.saveTriageAnalysis(conversation, conversation.analysis);
        }
        
        return await this.offerComplementOption(conversation);
        
      } else {
        // Normal follow-up logic for additional information
        const followUpPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${client.name} deu mais informações:

ÚLTIMA MENSAGEM: "${messageText}"

TODAS AS MENSAGENS DO CLIENTE:
"${allUserMessages}"

CONTEXTO ANTERIOR:
- Área: ${conversation.analysis?.case?.category || 'Não identificada'}

ANÁLISE CRÍTICA:
- Se o cliente disse "já expliquei tudo" ou similar, é sinal que você está sendo repetitiva
- Se já há muitas informações detalhadas nas mensagens anteriores, provavelmente é suficiente
- Se o cliente está frustrado, finalize o atendimento

TAREFA: Com todas essas informações, decidir se pode finalizar ou precisa saber mais.

REGRA IMPORTANTE: Se há muita informação já coletada E o cliente demonstra frustração, FINALIZE o atendimento.

Se PRECISAR de mais informações (apenas se essencial):
- Não repita a situação
- Faça UMA pergunta específica sobre algo realmente crucial
- Máximo 1 frase

Se TIVER informações SUFICIENTES OU cliente demonstrar frustração:
- Comece sua resposta exatamente com "FINALIZAR:"
- NÃO faça resumo (o cliente já conhece sua situação)
- Vá direto aos próximos passos  
- Explique que um advogado especializado analisará o caso
- Informe que o advogado entrará em contato em breve

Responda APENAS com sua mensagem:`;

        const response = await this.groqService.generateResponse(followUpPrompt);
        
        if (response.startsWith('FINALIZAR:')) {
          // Check if we have strategic questions for this legal field (only for Trabalhista)
          const legalField = conversation.analysis?.case?.category;
          const fieldQuestions = this.legalFieldQuestionsService.getQuestionsForField(legalField);
          
          if (legalField === 'Trabalhista' && fieldQuestions && fieldQuestions.questions.length > 0) {
            // Move to strategic info collection instead of completing
            conversation.state = 'COLLECTING_STRATEGIC_INFO';
            conversation.strategicQuestions = {
              fieldInfo: fieldQuestions,
              currentQuestionIndex: 0,
              collectedAnswers: {}
            };
            
            return await this.askNextStrategicQuestion(conversation, client);
          } else {
            // No strategic questions for this field, or not Trabalhista - offer complement option
            conversation.state = 'AWAITING_COMPLEMENT';
            if (conversation.analysis) {
              this.saveTriageAnalysis(conversation, conversation.analysis);
            }
            
            return await this.offerComplementOption(conversation);
          }
        } else {
          conversation.waitingForAnswer = true; // Mark that we're waiting for an answer
          return response;
        }
      }
    }
  }

  async handleDetailCollection(conversation, messageText, client) {
    if (messageText.length > 50) {
      conversation.state = 'ANALYZING_CASE';
      return this.handleCaseAnalysis(conversation, messageText, client);
    } else {
      // AI generates natural request for more details
      const detailPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${client.name} deu uma resposta: "${messageText}"

SITUAÇÃO: A resposta pode ser breve ou conter perguntas sobre o processo.

TAREFA: Se houver perguntas, responda brevemente e redirecione. Se a resposta for muito breve, peça mais detalhes.

INSTRUÇÕES:
- Se há perguntas (sobre custos, tempo, processo), responda genericamente e redirecione
- Não repita o que a pessoa disse
- Peça detalhes específicos de forma objetiva
- Seja concisa mas completa
- Seja gentil mas direta

EXEMPLO: Se perguntarem "quanto custa?", responda "O advogado vai explicar sobre valores em breve. Algo mais?"

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(detailPrompt);
    }
  }

  async handleDocumentCollection(conversation, messageText, client) {
    console.log('Final document collection and analysis...');
    
    conversation.state = 'COMPLETED';
    
    // Update database
    await this.updateConversationInDatabase(conversation);
    
    // Generate final comprehensive analysis (stored for admin only)
    const allMessages = this.getAllConversationText(conversation);
    const finalTriage = await this.triageService.triageFromText(allMessages, client.phone, this.groqService);
    
    if (finalTriage) {
      this.saveTriageAnalysis(conversation, finalTriage);
      
      const category = finalTriage.case?.category || 'Jurídico';
      
      // AI generates natural completion message
      const completionPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${client.name} finalizou o processo de coleta de informações sobre um caso de ${category}.

SITUAÇÃO: Todas as informações foram coletadas e analisadas.

TAREFA: Dar uma mensagem final natural e profissional.

INSTRUÇÕES:
- Agradeça pela confiança
- Confirme que as informações foram registradas
- Explique que um advogado especialista em ${category} entrará em contato
- Seja calorosa mas profissional
- Use linguagem natural brasileira

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(completionPrompt);
    }
    
    // Fallback AI message
    const fallbackPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${client.name} finalizou o atendimento.

TAREFA: Dar uma mensagem final profissional.

INSTRUÇÕES:
- Agradeça pelas informações
- Confirme que um advogado entrará em contato
- Seja calorosa e profissional

Responda APENAS com sua mensagem:`;

    return await this.groqService.generateResponse(fallbackPrompt);
  }

  async handleAwaitingLawyer(conversation, messageText, client) {
    const firstName = client.name ? client.name.split(' ')[0] : '';
    
    // AI generates natural response for clients who message while waiting
    const waitingPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${firstName} já foi atendido e está aguardando contato de um advogado, mas enviou uma nova mensagem: "${messageText}"

SITUAÇÃO: Cliente já tem caso em andamento e está aguardando contato do advogado.

TAREFA: Responder de forma natural e tranquilizadora.

INSTRUÇÕES:
- Confirme que o caso está sendo acompanhado
- Tranquilize sobre o contato do advogado
- Seja empática
- Use o nome ${firstName}
- Use linguagem natural brasileira

Responda APENAS com sua mensagem:`;

    return await this.groqService.generateResponse(waitingPrompt);
  }

  async handlePostServiceMessage(conversation, messageText, client) {
    const firstName = client.name ? client.name.split(' ')[0] : '';
    
    console.log(`[DEBUG] handlePostServiceMessage - Client: ${client.phone}, Message: "${messageText}"`);
    
    // Count how many documents were sent in this burst
    const documentCount = (messageText.match(/\[DOCUMENTO|\[PDF|\[ARQUIVO|\[IMAGEM|\[VIDEO/gi) || []).length;
    const isMultipleDocuments = documentCount > 1;
    
    // Detect if message is only media/documents (no text content)
    const isOnlyMedia = !messageText || messageText.trim().length === 0 || 
                       messageText.toLowerCase().includes('[documento]') ||
                       messageText.toLowerCase().includes('[foto]') ||
                       messageText.toLowerCase().includes('[pdf]') ||
                       messageText.toLowerCase().includes('[arquivo]') ||
                       messageText.toLowerCase().includes('[imagem]') ||
                       messageText.toLowerCase().includes('[video]');
    
    if (isOnlyMedia) {
      // Handle pure media uploads without text
      const documentsText = isMultipleDocuments ? `${documentCount} documentos` : 'documentos';
      const mediaPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${firstName} enviou ${documentsText} após o atendimento ter sido finalizado.

TAREFA: Agradecer pelos documentos e confirmar que foram guardados.

INSTRUÇÕES:
- Agradeça pelos documentos${isMultipleDocuments ? ' (arquivos)' : ''}
- Confirme que foram adicionados ao processo dele
- Seja breve e profissional
- Use o nome ${firstName} se disponível

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(mediaPrompt);
    }
    
    // For any text message after service completion, analyze and respond contextually
    const lowerText = messageText.toLowerCase();
    
    // Detect document-related messages
    const isDocumentMessage = lowerText.includes('documento') ||
                             lowerText.includes('enviar') ||
                             lowerText.includes('anexar') ||
                             lowerText.includes('foto') ||
                             lowerText.includes('arquivo') ||
                             lowerText.includes('pdf') ||
                             lowerText.includes('comprovante');
    
    if (isDocumentMessage) {
      // Handle document-related messages - check if they actually sent docs or just mentioned them
      const actuallyHasDocument = messageText.includes('[DOCUMENTO') ||
                                 messageText.includes('[PDF') ||
                                 messageText.includes('[ARQUIVO') ||
                                 messageText.includes('[IMAGEM') ||
                                 messageText.includes('[VIDEO') ||
                                 lowerText.includes('[documento]') ||
                                 lowerText.includes('[pdf]') ||
                                 lowerText.includes('[arquivo]') ||
                                 lowerText.includes('[imagem]') ||
                                 lowerText.includes('[video]');
      
      if (actuallyHasDocument) {
        // Count documents sent
        const documentCount = (messageText.match(/\[DOCUMENTO|\[PDF|\[ARQUIVO|\[IMAGEM|\[VIDEO/gi) || []).length;
        const isMultiple = documentCount > 1;
        
        // They actually sent a document - just thank them
        const documentsText = isMultiple ? `${documentCount} documentos` : 'documentos';
        const documentPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${firstName} enviou ${documentsText} após o atendimento ter sido finalizado.

TAREFA: Agradecer pelos documentos enviados.

INSTRUÇÕES:
- Agradeça pelos documentos recebidos${isMultiple ? ' (arquivos)' : ''}
- Confirme que foram adicionados ao processo dele
- Seja breve e profissional (máximo 1-2 frases)
- Use o nome ${firstName}
- NÃO mencione aguardar mais nada - apenas agradeça pelo que foi enviado

Responda APENAS com sua mensagem:`;

        return await this.groqService.generateResponse(documentPrompt);
      } else {
        // They mentioned documents but didn't send any - ask them to send
        const documentPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${firstName} mencionou documentos mas não enviou ainda: "${messageText}"

TAREFA: Responder sobre os documentos de forma útil e direta.

INSTRUÇÕES:
- Peça para enviar os documentos se possível. Pode ser agora ou depois, mas o mais rápido possível para que eles sejam guardados.
- Seja concisa e direta (máximo 1-2 frases)
- Use o nome ${firstName}
- Seja empática e profissional

Responda APENAS com sua mensagem:`;

        return await this.groqService.generateResponse(documentPrompt);
      }
    }
    
    // Detect greeting messages
    const isGreeting = lowerText.includes('olá') || 
                      lowerText.includes('oi') || 
                      lowerText.includes('bom dia') ||
                      lowerText.includes('boa tarde') ||
                      lowerText.includes('boa noite') ||
                      lowerText.includes('tudo bem') ||
                      messageText.length < 20;
    
    if (isGreeting) {
      // Handle greetings - ask how to help
      const greetingPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${firstName} está cumprimentando após ter finalizado o atendimento.

TAREFA: Cumprimentar de volta e perguntar como pode ajudar.

INSTRUÇÕES:
- Retorne o cumprimento apropriado
- Use o nome ${firstName}
- Pergunte "Como posso ajudar?"
- Seja calorosa e disponível

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(greetingPrompt);
    }
    
    // Detect process follow-up requests
    const isFollowUp = lowerText.includes('andamento') ||
                      lowerText.includes('acompanhar') ||
                      lowerText.includes('processo') ||
                      lowerText.includes('advogado') ||
                      lowerText.includes('contato') ||
                      lowerText.includes('novidade') ||
                      lowerText.includes('atualiza') ||
                      lowerText.includes('quando') ||
                      lowerText.includes('prazo');
    
    if (isFollowUp) {
      // Handle process follow-up requests
      const followUpPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${firstName} está perguntando sobre o andamento do processo: "${messageText}"

TAREFA: Explicar sobre acompanhamento do processo.

INSTRUÇÕES:
- Tranquilize que o processo está em andamento
- Explique que assim que houver novidades, o advogado responsável irá atualizar
- Seja empática e profissional
- Use o nome ${firstName}

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(followUpPrompt);
    }
    
    // Handle ANY other message as related to the previous case - generic but contextual response
    const genericPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${firstName} enviou uma mensagem após ter finalizado um atendimento: "${messageText}"

CONTEXTO: Este cliente já teve um caso finalizado conosco, então esta mensagem está relacionada ao caso anterior.

TAREFA: Responder de forma útil e empática, considerando que se trata do caso anterior.

INSTRUÇÕES:
- Analise a mensagem e responda de forma apropriada e contextual
- Se for uma dúvida sobre o caso anterior, tente ajudar ou direcione para o advogado responsável
- Se for uma informação adicional, agradeça e confirme que foi anotada
- Se for uma pergunta geral, responda ou oriente
- Se parecer ser realmente uma nova questão jurídica totalmente diferente, sugira delicadamente que pode ser um novo caso
- Seja sempre empática e profissional
- Use o nome ${firstName}
- Seja concisa mas completa
- Sempre assuma que está relacionado ao caso anterior, a menos que seja claramente diferente

Responda APENAS com sua mensagem:`;

    return await this.groqService.generateResponse(genericPrompt);
  }

  getRandomGreeting() {
    const now = new Date();
    const hour = now.getHours();
    
    let greetings;
    if (hour < 12) {
      greetings = [
        'Bom dia!',
        'Olá, bom dia!',
        'Oi! Bom dia!'
      ];
    } else if (hour < 18) {
      greetings = [
        'Boa tarde!',
        'Olá, boa tarde!',
        'Oi! Boa tarde!'
      ];
    } else {
      greetings = [
        'Boa noite!',
        'Olá, boa noite!',
        'Oi! Boa noite!'
      ];
    }
    
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  extractName(text) {
    console.log(`[DEBUG] extractName - Input: "${text}"`);
    
    // Check if it's clearly a question first
    if (text.includes('?') || 
        text.toLowerCase().includes('precisa') || 
        text.toLowerCase().includes('por que') ||
        text.toLowerCase().includes('porque') ||
        text.toLowerCase().includes('pra que') ||
        text.toLowerCase().includes('tem que') ||
        text.toLowerCase().includes('obrigatório')) {
      console.log(`[DEBUG] extractName - Detected question, returning null`);
      return null; // It's a question, not a name
    }
    
    // Check for common greeting patterns that aren't names
    const lowerText = text.toLowerCase();
    if (lowerText.includes('olá') || 
        lowerText.includes('oi') || 
        lowerText.includes('bom dia') ||
        lowerText.includes('boa tarde') ||
        lowerText.includes('boa noite') ||
        lowerText.includes('tudo bem')) {
      console.log(`[DEBUG] extractName - Detected greeting, returning null`);
      return null;
    }
    
    const words = text.trim().split(/\s+/);
    console.log(`[DEBUG] extractName - Words: ${JSON.stringify(words)}`);
    
    // If only one word and it's too short or common, probably not a name
    if (words.length === 1) {
      const word = words[0].toLowerCase();
      if (word.length < 3 || 
          ['sim', 'não', 'ok', 'certo', 'claro', 'pode', 'sei'].includes(word)) {
        console.log(`[DEBUG] extractName - Single word rejected: "${word}"`);
        return null;
      }
    }
    
    if (words.length >= 2) {
      // Remove common words that aren't names
      const filtered = words.filter(word => 
        !['meu', 'nome', 'é', 'sou', 'eu', 'me', 'chamo', 'aqui', 'olá', 'oi'].includes(word.toLowerCase())
      );
      console.log(`[DEBUG] extractName - Filtered words: ${JSON.stringify(filtered)}`);
      
      // If after filtering we have at least one word that could be a name (contains only letters)
      const hasValidNameWord = filtered.some(word => 
        /^[a-záàâãéèêíïóôõöúçñ]+$/i.test(word) && word.length > 1
      );
      console.log(`[DEBUG] extractName - Has valid name word: ${hasValidNameWord}`);
      
      if (hasValidNameWord && filtered.length > 0) {
        // Capitalize each word properly
        const properName = filtered.map(word => 
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
        console.log(`[DEBUG] extractName - Returning multi-word name: "${properName}"`);
        return properName;
      }
    }
    
    // For single words, check if it looks like a name (contains only letters, reasonable length)
    if (words.length === 1) {
      const word = words[0];
      if (/^[a-záàâãéèêíïóôõöúçñ]+$/i.test(word) && word.length >= 3) {
        const properName = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        console.log(`[DEBUG] extractName - Returning single word name: "${properName}"`);
        return properName;
      }
    }
    
    console.log(`[DEBUG] extractName - No valid name found, returning null`);
    return null; // Couldn't identify a valid name
  }

  extractEmail(text) {
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const match = text.match(emailPattern);
    return match ? match[0] : null;
  }

  getAllConversationText(conversation) {
    const conversationMessages = this.messages.get(conversation.id) || [];
    return conversationMessages
      .filter(msg => msg.direction === 'IN')
      .map(msg => msg.body)
      .join('\n');
  }

  // Check if the text contains specific details that indicate completeness
  hasSpecificDetails(text) {
    const indicators = [
      // Date patterns
      /\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2} de \w+ de \d{4}|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i,
      // Value patterns
      /R\$\s*\d+|reais?\s*\d+|\d+\s*mil|\d+\s*milhão/i,
      // Document mentions
      /contrato|documento|comprovante|recibo|nota fiscal|boleto|email|carta|ofício|intimação|citação/i,
      // Specific legal terms
      /artigo \d+|lei \d+|código|clt|constituição|súmula/i,
      // Time references
      /há \d+ anos?|há \d+ meses?|desde \d+|em \d+|no dia|na época|quando/i,
      // People/companies
      /empresa|chefe|patrão|ex-|funcionário|cliente|fornecedor|vizinho/i
    ];
    
    const matches = indicators.filter(pattern => pattern.test(text)).length;
    return matches >= 2; // At least 2 types of specific details
  }

  saveIncomingMessage(conversation, text) {
    if (!this.messages.has(conversation.id)) {
      this.messages.set(conversation.id, []);
    }
    
    const message = {
      id: this.messageIdCounter++,
      conversation: conversation,
      direction: 'IN',
      body: text,
      timestamp: new Date(),
      rawPayload: { text: text }
    };
    
    this.messages.get(conversation.id).push(message);
  }

  saveOutgoingMessage(conversation, text) {
    if (!this.messages.has(conversation.id)) {
      this.messages.set(conversation.id, []);
    }
    
    const message = {
      id: this.messageIdCounter++,
      conversation: conversation,
      direction: 'OUT',
      body: text,
      timestamp: new Date(),
      rawPayload: { human_response: true }
    };
    
    this.messages.get(conversation.id).push(message);
  }

  saveTriageAnalysis(conversation, triageData) {
    console.log(`[DEBUG] saveTriageAnalysis - Called for conversation ${conversation.id}`);
    console.log(`[DEBUG] saveTriageAnalysis - Triage data exists: ${!!triageData}`);
    if (triageData) {
      console.log(`[DEBUG] saveTriageAnalysis - Case category: ${triageData.case?.category}, urgency: ${triageData.case?.urgency}`);
    }
    
    // Persist conversation if not exists in DB
    try {
      // Verifica se a conversa existe no banco
      const dbConv = DatabaseService.getBotConversations(conversation.botId || this.botManager?.id)
        .find(c => c.id === conversation.id.toString());
      if (!dbConv) {
        // Cria a conversa no banco
        // Corrige para garantir que o botId seja sempre o ID real do bot
        let botId = conversation.botId;
        if (!botId || typeof botId !== 'string' || botId.trim() === '') {
          // Tenta obter o botId do botManager
          if (this.botManager && this.botManager.bots && this.botManager.bots.size === 1) {
            botId = Array.from(this.botManager.bots.keys())[0];
          } else if (this.botManager && this.botManager.id && typeof this.botManager.id === 'string') {
            botId = this.botManager.id;
          } else {
            botId = 'default-bot';
          }
        }
        const allowedStatus = ['active', 'completed', 'abandoned'];
        let status = conversation.state;
        if (!allowedStatus.includes(status)) {
          status = 'active';
        }
        // Verifica se a conversa já existe antes de criar
        const existing = DatabaseService.getConversationById
          ? DatabaseService.getConversationById(conversation.id.toString())
          : null;
        if (!existing) {
          console.log(`[DEBUG] Salvando conversa no banco: id=${conversation.id}, botId=${botId}, status=${status}`);
          DatabaseService.createConversation({
            id: conversation.id.toString(),
            botId,
            ownerId: (this.botManager && this.botManager.bots && this.botManager.bots.get(botId)) ? this.botManager.bots.get(botId).ownerId : null,
            clientPhone: conversation.client?.phone || '',
            clientName: conversation.client?.name || '',
            clientEmail: conversation.client?.email || null,
            status,
            legalField: triageData?.case?.category || null,
            urgency: triageData?.case?.urgency || null,
            startTime: (conversation.startedAt instanceof Date)
              ? conversation.startedAt.toISOString()
              : (typeof conversation.startedAt === 'string' ? conversation.startedAt : new Date().toISOString()),
            summary: triageData?.case?.description || null
          });
        }
        console.log(`[CONVERSATION] Conversa criada no banco: id=${conversation.id}`);
      }
    } catch (err) {
      console.error(`[CONVERSATION] Erro ao criar conversa no banco: id=${conversation.id}`, err);
    }
    if (!this.messages.has(conversation.id)) {
      this.messages.set(conversation.id, []);
    }
    
    const message = {
      id: this.messageIdCounter++,
      conversation: conversation,
      direction: 'ANALYSIS',
      body: JSON.stringify(triageData, null, 2),
      timestamp: new Date(),
      rawPayload: triageData
    };
    
    this.messages.get(conversation.id).push(message);

      // Persist triage JSON in database (evita duplicidade)
      try {
        const triageId = `${conversation.id}-triage-${this.messageIdCounter}`;
        // Verifica se já existe triagem para esta conversa
        const existingTriage = DatabaseService.getTriageByConversationId(conversation.id.toString());
        if (!existingTriage) {
          const result = DatabaseService.createTriage({
            id: triageId,
            conversationId: conversation.id.toString(),
            triageJson: JSON.stringify(triageData)
          });
          if (result && result.changes > 0) {
            console.log(`[TRIAGE] Triagem persistida com sucesso: triageId=${triageId}, conversationId=${conversation.id}`);
          } else {
            console.warn(`[TRIAGE] Falha ao persistir triagem: triageId=${triageId}, conversationId=${conversation.id}`);
          }
        } else {
          console.log(`[TRIAGE] Triagem já existe para a conversa: conversationId=${conversation.id}`);
        }
      } catch (err) {
        console.error(`[TRIAGE] Erro ao persistir triagem no banco: triageId=${conversation.id}-triage-${this.messageIdCounter}, conversationId=${conversation.id}`, err);
      }
  }

  getUrgencyText(urgency) {
    const urgencyTexts = {
      'alta': '🔴 ALTA - Requer atenção imediata',
      'media': '🟡 MÉDIA - Importante mas sem urgência',
      'baixa': '🟢 BAIXA - Consulta geral'
    };
    return urgencyTexts[urgency] || urgencyTexts['baixa'];
  }

  getContactTimeframe(urgency) {
    const timeframes = {
      'alta': 'Hoje ou amanhã',
      'media': '2 a 3 dias úteis',
      'baixa': 'Até 5 dias úteis'
    };
    return timeframes[urgency] || timeframes['baixa'];
  }

  // Database update methods
  async updateConversationInDatabase(conversation) {
    try {
      // Map conversation state to database status
      let dbStatus = 'active';
      if (conversation.state === 'COMPLETED') {
        dbStatus = 'completed';
      } else if (conversation.state === 'ABANDONED') {
        dbStatus = 'abandoned';
      }

      const endTime = conversation.state === 'COMPLETED' ? new Date().toISOString() : null;

      console.log(`[DEBUG] updateConversationInDatabase - Conversation ID: ${conversation.id}, Current state: ${conversation.state}, DB Status: ${dbStatus}`);
      console.log(`[DEBUG] updateConversationInDatabase - Analysis exists: ${!!conversation.analysis}`);
      if (conversation.analysis) {
        console.log(`[DEBUG] updateConversationInDatabase - Legal field: ${conversation.analysis.case?.category}, Urgency: ${conversation.analysis.case?.urgency}`);
      }

      // Use DatabaseService singleton to update conversation
      const updateResult = DatabaseService.updateConversation(conversation.id.toString(), {
        status: dbStatus,
        endTime,
        summary: conversation.analysis?.case?.description || null,
        legalField: conversation.analysis?.case?.category || null,
        urgency: conversation.analysis?.case?.urgency || null
      });

      console.log(`[INFO] updateConversationInDatabase - Updated conversation ${conversation.id} with status: ${dbStatus}, Result:`, updateResult);
    } catch (error) {
      console.error('[ERROR] updateConversationInDatabase:', error.message);
    }
  }

  // Persistence methods
  async saveConversations() {
    try {
      const data = {
        conversations: Object.fromEntries(this.conversations),
        clients: Object.fromEntries(this.clients),
        messages: Object.fromEntries(this.messages),
        counters: {
          conversationId: this.conversationIdCounter,
          messageId: this.messageIdCounter
        }
      };
      
      await fs.writeFile(
        path.join(process.cwd(), 'data', 'conversations.json'),
        JSON.stringify(data, null, 2)
      );
    } catch (error) {
      console.error('Error saving conversations:', error);
    }
  }

  async loadConversations() {
    try {
      const filePath = path.join(process.cwd(), 'data', 'conversations.json');
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Load conversations with validation to filter corrupted data
      const rawConversations = Object.entries(parsed.conversations || {});
      this.conversations = new Map();
      
      for (const [id, conversation] of rawConversations) {
        // Validate conversation structure
        if (conversation && 
            conversation.client && 
            conversation.client.phone && 
            conversation.state && 
            conversation.startedAt) {
          this.conversations.set(id, conversation);
          console.log(`[DEBUG] loadConversations - Loaded valid conversation: ${id}, client: ${conversation.client.phone}, state: ${conversation.state}`);
        } else {
          console.warn(`[WARNING] loadConversations - Skipping corrupted conversation: ${id}`, conversation);
        }
      }
      
      this.clients = new Map(Object.entries(parsed.clients || {}));
      this.messages = new Map(Object.entries(parsed.messages || {}));
      
      // Ensure all loaded conversations have conversationHistory array
      for (const [id, conversation] of this.conversations.entries()) {
        if (!conversation.conversationHistory) {
          conversation.conversationHistory = [];
        }
      }
      
      if (parsed.counters) {
        this.conversationIdCounter = parsed.counters.conversationId || 1;
        this.messageIdCounter = parsed.counters.messageId || 1;
      }
      
      console.log(`Loaded ${this.conversations.size} conversations, ${this.clients.size} clients`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading conversations:', error);
      }
    }
  }

  // Load conversations from database (for production use)
  async loadConversationsFromDatabase(botId) {
    if (!this.botManager) {
      console.warn('[WARNING] loadConversationsFromDatabase - BotManager not available, using JSON fallback');
      return this.loadConversations();
    }

    try {
      // Import DatabaseService dynamically
      const { default: DatabaseService } = await import('./DatabaseService.js');
      const dbConversations = DatabaseService.getBotConversations(botId);
      
      this.conversations = new Map();
      this.clients = new Map();
      this.messages = new Map(); // Ensure messages map is initialized
      
      for (const dbConv of dbConversations) {
        // Convert database conversation to ConversationFlowService format
        const conversation = {
          id: parseInt(dbConv.id) || this.conversationIdCounter++,
          client: {
            phone: dbConv.clientPhone,
            name: dbConv.clientName,
            email: dbConv.clientEmail || null,
            createdAt: dbConv.startTime
          },
          state: this.mapDatabaseStatusToState(dbConv.status),
          startedAt: new Date(dbConv.startTime),
          lastActivityAt: new Date(dbConv.startTime),
          conversationHistory: []
        };

        // Load associated triage data
        const triage = DatabaseService.getTriageByConversationId(dbConv.id);
        if (triage && triage.triage_json) {
          try {
            const triageData = JSON.parse(triage.triage_json);
            conversation.analysis = triageData;
            
            // Create analysis message for compatibility with in-memory structure
            if (!this.messages.has(conversation.id)) {
              this.messages.set(conversation.id, []);
            }
            
            const analysisMessage = {
              id: this.messageIdCounter++,
              conversation: conversation,
              direction: 'ANALYSIS',
              body: JSON.stringify(triageData, null, 2),
              timestamp: new Date(triage.created_at || dbConv.startTime),
              rawPayload: triageData
            };
            
            this.messages.get(conversation.id).push(analysisMessage);
            console.log(`[DEBUG] loadConversationsFromDatabase - Loaded triage for conversation: ${conversation.id}`);
          } catch (error) {
            console.warn(`[WARNING] loadConversationsFromDatabase - Failed to parse triage JSON for conversation ${dbConv.id}:`, error);
            console.warn(`[WARNING] Corrupted triage JSON:`, triage.triage_json.substring(0, 200) + '...');
          }
        }

        // Validate the conversation structure
        if (conversation.client && 
            conversation.client.phone && 
            conversation.state && 
            conversation.startedAt) {
          this.conversations.set(conversation.id.toString(), conversation);
          
          // Store client data
          this.clients.set(conversation.client.phone, conversation.client);
          
          console.log(`[DEBUG] loadConversationsFromDatabase - Loaded conversation: ${conversation.id}, client: ${conversation.client.phone}, state: ${conversation.state}, triage: ${!!conversation.analysis}`);
        } else {
          console.warn(`[WARNING] loadConversationsFromDatabase - Skipping invalid conversation:`, dbConv);
        }
      }
      
      console.log(`Loaded ${this.conversations.size} conversations from database, ${this.clients.size} clients`);
    } catch (error) {
      console.error('Error loading conversations from database:', error);
      // Fallback to JSON loading
      return this.loadConversations();
    }
  }

  // Map database status to conversation state
  mapDatabaseStatusToState(dbStatus) {
    switch (dbStatus) {
      case 'completed':
        return 'COMPLETED';
      case 'active':
        return 'ANALYZING_CASE'; // Default active state
      case 'abandoned':
        return 'COMPLETED'; // Treat abandoned as completed for post-service handling
      default:
        return 'GREETING'; // Default state
    }
  }

  // Admin methods
  getAllConversations() {
    return Array.from(this.conversations.values()).map(conv => {
      // Get triage analysis for this conversation
      const messages = this.messages.get(conv.id) || [];
      const analysisMessage = messages.find(msg => msg.direction === 'ANALYSIS');
      
      // Use analysis message if available, otherwise use conversation.analysis
      const triageAnalysis = analysisMessage ? analysisMessage.rawPayload : conv.analysis;
      
      return {
        id: conv.id,
        client: conv.client,
        state: conv.state,
        startedAt: conv.startedAt,
        lastActivityAt: conv.lastActivityAt,
        triageAnalysis: triageAnalysis,
        preAnalysis: conv.preAnalysis, // Include pre-analysis if available
        timestamp: conv.startedAt,
        urgency: triageAnalysis?.case?.urgency || 'baixa'
      };
    });
  }

  getConversationMessages(conversationId) {
    return this.messages.get(parseInt(conversationId)) || [];
  }

  getAllTriages() {
    const triages = [];
    for (const [convId, messages] of this.messages.entries()) {
      const analysisMessages = messages.filter(msg => msg.direction === 'ANALYSIS');
      if (analysisMessages.length > 0) {
        const conversation = this.conversations.get(convId);
        if (conversation) {
          triages.push({
            conversationId: convId,
            client: conversation.client,
            analysis: analysisMessages[analysisMessages.length - 1].rawPayload,
            timestamp: analysisMessages[analysisMessages.length - 1].timestamp
          });
        }
      }
    }
    return triages;
  }

  async retryMessage(retryKey) {
    const retryData = this.pendingRetries.get(retryKey);
    
    if (!retryData) {
      console.log(`Retry key ${retryKey} not found`);
      return;
    }
    
    console.log(`Attempting retry ${retryData.attempts}/${retryData.maxAttempts} for ${retryData.phone}`);
    
    try {
      // Try to process the message again
      const response = await this.processIncomingMessage(
        retryData.phone, 
        retryData.messageText, 
        retryData.originalPhoneForReply
      );
      
      // If successful, remove from retry queue and notify via callback
      this.pendingRetries.delete(retryKey);
      
      // Notify the BotManager about the successful retry
      if (this.onRetrySuccess) {
        this.onRetrySuccess(retryData.phone, response);
      }
      
      console.log(`Retry successful for ${retryData.phone}`);
      
    } catch (error) {
      console.error(`Retry attempt ${retryData.attempts} failed:`, error);
      
      retryData.attempts++;
      
      if (retryData.attempts <= retryData.maxAttempts) {
        // Schedule another retry in 30 seconds
        setTimeout(() => {
          this.retryMessage(retryKey);
        }, 30000);
        
        console.log(`Scheduling retry ${retryData.attempts}/${retryData.maxAttempts} in 30s`);
      } else {
        // Max attempts reached, give up and send final message
        this.pendingRetries.delete(retryKey);
        
        if (this.onRetryFailed) {
          this.onRetryFailed(retryData.phone, 'Desculpe, não consegui processar sua mensagem. Tente novamente mais tarde.');
        }
        
        console.log(`Max retry attempts reached for ${retryData.phone}`);
      }
    }
  }

  // Set callback functions for retry events
  setRetryCallbacks(onSuccess, onFailed) {
    this.onRetrySuccess = onSuccess;
    this.onRetryFailed = onFailed;
  }

  async askNextStrategicQuestion(conversation, client) {
    const strategicInfo = conversation.strategicQuestions;
    
    if (!strategicInfo || !strategicInfo.missingInfo || strategicInfo.missingInfo.length === 0) {
      // No more questions, move to complement phase
      conversation.state = 'AWAITING_COMPLEMENT';
      return await this.offerComplementOption(conversation);
    }

    // Check if we're already waiting for an answer to a strategic question
    if (strategicInfo.currentlyAsking) {
      console.log(`[STRATEGIC] Already waiting for answer to: ${strategicInfo.currentlyAsking.key}`);
      return null; // Don't ask another question, wait for current answer
    }

    // Generate an intelligent question for the next missing information
    const questionResult = this.legalFieldQuestionsService.generateStrategicQuestion(
      strategicInfo.missingInfo,
      strategicInfo.fieldInfo.displayName,
      client.name,
      conversation.conversationHistory || []
    );

    if (!questionResult) {
      // No more questions to ask
      conversation.state = 'AWAITING_COMPLEMENT';
      return await this.offerComplementOption(conversation);
    }

    // Store what we're currently asking about
    strategicInfo.currentlyAsking = questionResult.info;
    
    // Set state to collecting strategic info to ensure we wait for the answer
    conversation.state = 'COLLECTING_STRATEGIC_INFO';
    
    console.log(`[STRATEGIC] Asking question for: ${questionResult.info.key}`);

    // Generate the actual question using AI
    const questionText = await this.groqService.generateResponse(questionResult.questionPrompt);
    
    return questionText;
  }

  async handleStrategicInfoCollection(conversation, messageText, client) {
    const strategicInfo = conversation.strategicQuestions;
    
    if (!strategicInfo || !strategicInfo.currentlyAsking) {
      // Something went wrong, move to complement phase
      conversation.state = 'AWAITING_COMPLEMENT';
      return await this.offerComplementOption(conversation);
    }

    const currentlyAsking = strategicInfo.currentlyAsking;

    // Extract the answer using the intelligent service
    const extractedAnswer = this.legalFieldQuestionsService.extractAnswerValue(
      null, // question object not needed in new approach
      messageText,
      currentlyAsking
    );

    // Store the collected answer
    if (!conversation.analysis) {
      conversation.analysis = {};
    }

    if (!conversation.analysis.strategicInfo) {
      conversation.analysis.strategicInfo = {
        legalField: strategicInfo.fieldInfo.displayName,
        collectedAnswers: {},
        extractedAt: new Date().toISOString()
      };
    }

    conversation.analysis.strategicInfo.collectedAnswers[currentlyAsking.key] = extractedAnswer;

    // Remove this requirement from missing info
    strategicInfo.missingInfo = strategicInfo.missingInfo.filter(
      info => info.key !== currentlyAsking.key
    );

    // Reset currently asking
    strategicInfo.currentlyAsking = null;

    // Check if there are more questions needed
    if (strategicInfo.missingInfo.length > 0) {
      console.log(`[STRATEGIC] Answer collected for ${currentlyAsking.key}. ${strategicInfo.missingInfo.length} questions remaining.`);
      
      // Immediately ask the next question - no delay
      return await this.askNextStrategicQuestion(conversation, client);
    } else {
      // All strategic questions completed
      conversation.state = 'AWAITING_COMPLEMENT';
      
      // Send PDF notification to lawyer if botManager is available
      console.log(`[DEBUG] handleStrategicInfoCollection - botManager available: ${!!this.botManager}`);
      console.log(`[DEBUG] handleStrategicInfoCollection - conversation.analysis available: ${!!conversation.analysis}`);
      console.log(`[DEBUG] handleStrategicInfoCollection - legal field: ${conversation.analysis?.case?.category}`);
      
      if (this.botManager && conversation.analysis) {
        try {
          console.log(`Strategic info collection completed for ${conversation.client.name || conversation.client.phone}. Sending notification to lawyer...`);
          await LawyerNotificationService.notifyLawyerCaseCompleted(this.botManager, conversation);
        } catch (error) {
          console.error('Error sending lawyer notification from strategic info collection:', error);
        }
      } else {
        console.log(`[DEBUG] Lawyer notification not sent from strategic info - botManager: ${!!this.botManager}, analysis: ${!!conversation.analysis}`);
      }
      
      // Go directly to complement option without intermediate message
      return await this.offerComplementOption(conversation);
    }
  }

  async offerComplementOption(conversation) {
    const firstName = conversation.client.name?.split(' ')[0] || 'cliente';
    
    // MARK CASE AS COMPLETED IMMEDIATELY and generate report
    conversation.state = 'COMPLETED';
    
    // Update database
    await this.updateConversationInDatabase(conversation);
    
    // Save the triage analysis 
    if (conversation.analysis) {
      this.saveTriageAnalysis(conversation, conversation.analysis);
    }
    
    // Send PDF notification to lawyer immediately
    console.log(`[DEBUG] offerComplementOption - Marking case as COMPLETED and sending notification`);
    if (this.botManager && conversation.analysis) {
      try {
        console.log(`Case completed for ${conversation.client.name || conversation.client.phone}. Sending notification to lawyer...`);
        await LawyerNotificationService.notifyLawyerCaseCompleted(this.botManager, conversation);
      } catch (error) {
        console.error('Error sending lawyer notification:', error);
      }
    }
    
    // Get the conversation history to understand the emotional context
    const conversationMessages = conversation.conversationHistory || [];
    const allUserMessages = conversationMessages.filter(msg => msg.role === 'user').map(msg => msg.content).join('\n\n');
    
    // Extract required documents from analysis
    const requiredDocs = conversation.analysis?.legal_solution?.required_documents || '';
    const documentsSection = requiredDocs ? `\n\n📋 *DOCUMENTOS NECESSÁRIOS:*\n${requiredDocs}` : '';
    
    const offerPrompt = `Você é ${this.assistantName}, assistente jurídica empática. Você acabou de coletar as informações necessárias do cliente ${firstName}.

HISTÓRIA COMPARTILHADA PELO CLIENTE:
"${allUserMessages}"

DOCUMENTOS NECESSÁRIOS IDENTIFICADOS:
${requiredDocs || 'Não identificados ainda'}

SITUAÇÃO: Você acabou de ouvir a história do cliente e coletou as informações específicas. O caso já foi registrado e enviado para análise do advogado. Agora precisa:
1. Informar que o caso foi registrado e está sendo encaminhado
2. Listar os documentos necessários que foram identificados (se houver)
3. Dar a oportunidade de complementar com mais detalhes se quiser
4. Mencionar que o advogado especialista já está analisando

INSTRUÇÕES:
- Seja genuinamente empática, mas de forma natural (não robótica)
- Reconheça brevemente a situação difícil se apropriado
- Informe que o caso foi registrado e enviado para o advogado
- SE houver documentos necessários identificados, liste-os de forma clara e organizada
- Ofereça a oportunidade de adicionar mais detalhes se desejar
- Use linguagem calorosa mas profissional
- NÃO seja excessivamente dramática ou repetitiva

FORMATO: Uma mensagem empática mas equilibrada informando que o caso foi registrado e incluindo os documentos necessários.

Responda APENAS com sua mensagem:`;

    return await this.groqService.generateResponse(offerPrompt);
  }

  async handleComplementCollection(conversation, messageText, client) {
    const lowerText = messageText.toLowerCase().trim();
    
    // Check if client wants to add more details or is done
    const isFinishing = lowerText.includes('não') ||
                       lowerText.includes('nao') ||
                       lowerText.includes('só isso') ||
                       lowerText.includes('so isso') ||
                       lowerText.includes('é isso') ||
                       lowerText.includes('e isso') ||
                       lowerText.includes('obrigad') ||
                       lowerText.includes('tchau') ||
                       lowerText.includes('valeu') ||
                       lowerText.includes('pode ser') ||
                       lowerText.includes('tá bom') ||
                       lowerText.includes('ta bom') ||
                       lowerText.includes('ok') ||
                       lowerText.length < 10;

    if (isFinishing) {
      // Client is done - case is already COMPLETED, just acknowledge
      return await this.acknowledgeCompletion(conversation);
    } else {
      // Client has more details to add
      // Add this message to conversation history
      if (!conversation.conversationHistory) {
        conversation.conversationHistory = [];
      }
      
      conversation.conversationHistory.push({
        role: 'user',
        content: messageText,
        timestamp: new Date().toISOString(),
        isComplement: true // Mark as complement information
      });

      // Update the analysis with the new information and notify lawyer about update
      const allUserMessages = conversation.conversationHistory
        .filter(msg => msg.role === 'user')
        .map(msg => msg.content)
        .join('\n\n');
      
      // Re-analyze with the additional information
      if (conversation.analysis) {
        const updatedAnalysis = await this.triageService.triageFromText(allUserMessages, client.phone, this.groqService);
        // Merge new analysis with existing one, keeping the original structure
        conversation.analysis = {
          ...conversation.analysis,
          ...updatedAnalysis,
          case: {
            ...conversation.analysis.case,
            ...updatedAnalysis.case,
            complemented: true,
            lastUpdated: new Date().toISOString()
          }
        };
        
        // Save updated analysis
        this.saveTriageAnalysis(conversation, conversation.analysis);
        
        // Send updated report to lawyer if significant new information
        if (this.botManager && this.isSignificantUpdate(messageText)) {
          try {
            console.log(`Case updated with additional information for ${conversation.client.name || conversation.client.phone}. Sending update to lawyer...`);
            await LawyerNotificationService.notifyLawyerCaseUpdated(this.botManager, conversation, messageText);
          } catch (error) {
            console.error('Error sending lawyer update notification:', error);
          }
        }
      }

      // Ask if they have anything else to add
      const updatedRequiredDocs = conversation.analysis?.legal_solution?.required_documents || '';
      
      const complementPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${client.name} acabou de fornecer informações adicionais sobre seu caso.

NOVA INFORMAÇÃO RECEBIDA: "${messageText}"

DOCUMENTOS NECESSÁRIOS ATUALIZADOS:
${updatedRequiredDocs || 'Ainda sendo analisados'}

SITUAÇÃO: O caso já está registrado e sendo analisado pelo advogado, mas o cliente forneceu informações adicionais que foram registradas.

INSTRUÇÕES:
- Agradeça pelas informações complementares
- Confirme que foram adicionadas ao caso
- SE os documentos necessários foram atualizados/identificados, mencione brevemente
- Seja breve e natural
- Pergunte se há mais algum detalhe importante que queira adicionar
- Use linguagem calorosa mas objetiva

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(complementPrompt);
    }
  }

  /**
   * Complete conversation with empathy
   */
  async completeTriageWithEmpathy(conversation) {
    // Get the legal field from the analysis
    const legalField = conversation.analysis?.case?.category || 'Jurídico';
    
    // Get the conversation history to understand the emotional context
    const conversationMessages = conversation.conversationHistory || [];
    const allUserMessages = conversationMessages.filter(msg => msg.role === 'user').map(msg => msg.content).join('\n\n');
    
    // Get the law office name dynamically
    const lawOfficeName = await this.getLawOfficeName();
    
    const completionPrompt = `Você é ${this.assistantName}, assistente jurídica empática do escritório ${lawOfficeName}.

HISTÓRIA COMPARTILHADA PELO CLIENTE:
"${allUserMessages}"

Você acabou de ouvir toda a história do cliente sobre um caso de ${legalField}.

ANÁLISE EMOCIONAL: Examine se a história contém:
- Sofrimento emocional (ansiedade, depressão, burnout, insônia, estresse)
- Situações traumáticas ou injustas
- Problemas de saúde mental ou física
- Dificuldades financeiras
- Sentimentos de impotência ou desespero
- Situações que afetam a dignidade da pessoa

TAREFA: Finalizar a conversa com genuína empatia e acolhimento humano.

INSTRUÇÕES OBRIGATÓRIAS:
- SEMPRE demonstre genuína empatia e compreensão pela dor/sofrimento
- Reconheça as dificuldades específicas que a pessoa está enfrentando
- Valide os sentimentos e o sofrimento do cliente
- Use linguagem calorosa, humana e acolhedora (não corporativa)
- Transmita apoio emocional genuíno
- Assegure que um advogado especialista cuidará do caso com dedicação
- Transmita esperança e confiança de que a situação pode melhorar
- Use palavras que demonstrem que vocês realmente se importam
- EVITE linguagem fria, técnica ou burocrática

FORMATO: Fale como uma pessoa real e empática, não como um robô. Demonstre que você realmente entende e se importa com o sofrimento da pessoa.

Responda APENAS com sua mensagem:`;

    const response = await this.groqService.generateResponse(completionPrompt);

    // Send PDF notification to lawyer if botManager is available
    console.log(`[DEBUG] completeTriageWithEmpathy - botManager available: ${!!this.botManager}`);
    console.log(`[DEBUG] completeTriageWithEmpathy - conversation.analysis available: ${!!conversation.analysis}`);
    console.log(`[DEBUG] completeTriageWithEmpathy - legal field: ${conversation.analysis?.case?.category}`);
    
    if (this.botManager && conversation.analysis) {
      try {
        console.log(`Case completed for ${conversation.client.name || conversation.client.phone}. Sending notification to lawyer...`);
        await LawyerNotificationService.notifyLawyerCaseCompleted(this.botManager, conversation);
      } catch (error) {
        console.error('Error sending lawyer notification:', error);
      }
    } else {
      console.log(`[DEBUG] Lawyer notification not sent - botManager: ${!!this.botManager}, analysis: ${!!conversation.analysis}`);
    }

    return response;
  }

  /**
   * Acknowledge completion when client says they're done
   */
  async acknowledgeCompletion(conversation) {
    const firstName = conversation.client.name?.split(' ')[0] || 'cliente';
    
    const acknowledgmentPrompt = `Você é ${this.assistantName}, assistente jurídica. O cliente ${firstName} indicou que terminou de fornecer informações.

SITUAÇÃO: O caso já foi registrado e enviado para análise do advogado. O cliente confirmou que não tem mais nada a acrescentar.

TAREFA: Agradecer e confirmar que tudo está sendo acompanhado.

INSTRUÇÕES:
- Agradeça pela confiança
- Confirme que o caso está sendo analisado
- Informe que o advogado entrará em contato em breve
- Seja calorosa e tranquilizadora
- Use linguagem empática mas profissional

Responda APENAS com sua mensagem:`;

    return await this.groqService.generateResponse(acknowledgmentPrompt);
  }

  /**
   * Check if the additional information is significant enough to warrant an update notification
   */
  isSignificantUpdate(messageText) {
    const text = messageText.toLowerCase();
    
    // Consider significant if it contains important legal keywords or is substantial
    const significantKeywords = [
      'documento', 'contrato', 'testemunha', 'prova', 'evidência',
      'valor', 'data', 'prazo', 'urgente', 'grave', 'sério',
      'médico', 'laudo', 'exame', 'atestado', 'relatório',
      'ameaça', 'demissão', 'rescisão', 'processo', 'ação'
    ];
    
    const hasSignificantKeywords = significantKeywords.some(keyword => text.includes(keyword));
    const isSubstantialLength = messageText.length > 50;
    
    return hasSignificantKeywords || isSubstantialLength;
  }

}

export default ConversationFlowService;

import fs from 'fs/promises';
import path from 'path';

export class ConversationFlowService {
  constructor(groqService, triageService) {
    this.groqService = groqService;
    this.triageService = triageService;
    this.conversations = new Map();
    this.clients = new Map();
    this.messages = new Map();
    this.conversationIdCounter = 1;
    this.messageIdCounter = 1;
    
    // Load persisted data
    this.loadConversations();
  }

  async processIncomingMessage(phone, messageText, originalPhoneForReply = null) {
    console.log(`Processing message - Phone: ${phone}, Text: ${messageText}`);
    
    try {
      const client = this.findOrCreateClient(phone);
      const conversation = this.findOrCreateActiveConversation(client);
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
      return 'Desculpe, tive um problema técnico. Pode repetir sua mensagem?';
    }
  }

  findOrCreateClient(phone) {
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
    }
    return client;
  }

  findOrCreateActiveConversation(client) {
    // Find active conversation for this client
    for (const [id, conv] of this.conversations.entries()) {
      if (conv.client.phone === client.phone && conv.state !== 'COMPLETED') {
        return conv;
      }
    }

    // Create new conversation
    const conversation = {
      id: this.conversationIdCounter++,
      client: client,
      state: 'GREETING',
      startedAt: new Date(),
      lastActivityAt: new Date()
    };
    
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async processConversationState(conversation, messageText, client) {
    const state = conversation.state;
    
    switch (state) {
      case 'GREETING':
        return this.handleGreeting(conversation, messageText, client);
      case 'COLLECTING_NAME':
        return this.handleNameCollection(conversation, messageText, client);
      case 'COLLECTING_EMAIL':
        return this.handleEmailCollection(conversation, messageText, client);
      case 'ANALYZING_CASE':
        return await this.handleCaseAnalysis(conversation, messageText, client);
      case 'COLLECTING_DETAILS':
        return this.handleDetailCollection(conversation, messageText, client);
      case 'COLLECTING_DOCUMENTS':
        return await this.handleDocumentCollection(conversation, messageText, client);
      case 'AWAITING_LAWYER':
        return this.handleAwaitingLawyer(conversation, messageText, client);
      default:
        return this.handleGreeting(conversation, messageText, client);
    }
  }

  handleGreeting(conversation, messageText, client) {
    conversation.state = 'COLLECTING_NAME';
    
    const greeting = this.getRandomGreeting();
    return `${greeting} Meu nome é Ana e trabalho aqui no escritório BriseWare. Vou ajudá-lo com sua questão jurídica. Qual é o seu nome completo?`;
  }

  handleNameCollection(conversation, messageText, client) {
    const name = this.extractName(messageText);
    if (name && name.length > 3) {
      client.name = name;
      this.clients.set(client.phone, client);
      
      conversation.state = 'COLLECTING_EMAIL';
      
      const firstName = name.split(' ')[0];
      const responses = [
        `Muito prazer, ${firstName}! Para manter você informado, poderia me passar seu e-mail?`,
        `Que bom te conhecer, ${firstName}! Preciso do seu e-mail para enviar atualizações. Pode me passar?`
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    } else {
      return 'Desculpe, não consegui entender seu nome. Poderia repetir por favor?';
    }
  }

  handleEmailCollection(conversation, messageText, client) {
    const email = this.extractEmail(messageText);
    if (email) {
      client.email = email;
      this.clients.set(client.phone, client);
      
      conversation.state = 'ANALYZING_CASE';
      
      const responses = [
        'Perfeito! Agora me conta: qual situação você está enfrentando? Pode dar todos os detalhes - datas, valores, pessoas envolvidas...',
        'Ótimo! Vamos ao que interessa. Me explica o que está acontecendo? Quanto mais detalhes, melhor vou conseguir ajudar.'
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    } else {
      return 'Não consegui identificar um e-mail válido. Pode digitar novamente?';
    }
  }

  async handleCaseAnalysis(conversation, messageText, client) {
    console.log('Analyzing case with Groq LLM...');
    
    try {
      // Get full conversation context
      const allMessages = this.getAllConversationText(conversation);
      const fullContext = `${allMessages}\n\nÚltima mensagem: ${messageText}`;
      
      // Perform comprehensive triage analysis
      const triageResult = await this.triageService.triageFromText(fullContext, client.phone, this.groqService);
      console.log('Triage result:', JSON.stringify(triageResult, null, 2));
      
      if (triageResult) {
        // Save triage analysis
        this.saveTriageAnalysis(conversation, triageResult);
        
        // Check if we need more information - improved analysis
        const confidence = triageResult.triage?.confidence || 0;
        const description = triageResult.case?.description || '';
        const hasDocuments = triageResult.case?.documents?.length > 0;
        const hasSpecificDetails = this.hasSpecificDetails(fullContext);
        
        // More intelligent assessment of information completeness
        const needsMoreInfo = (
          confidence < 0.75 || 
          description.length < 150 || 
          (!hasSpecificDetails && !hasDocuments && fullContext.length < 300)
        );
        
        if (needsMoreInfo) {
          conversation.state = 'COLLECTING_DETAILS';
          
          // Provide specific guidance on what's missing
          let detailRequest = 'Entendi sua situação. Para elaborar uma análise mais completa, preciso de alguns detalhes adicionais.';
          
          if (!hasSpecificDetails) {
            detailRequest += ' Pode me contar mais sobre:\n\n• Datas específicas dos acontecimentos\n• Valores envolvidos\n• Nomes das pessoas/empresas envolvidas\n• O que exatamente aconteceu';
          } else {
            detailRequest += ' Pode me fornecer mais informações sobre os documentos que você possui ou detalhes adicionais relevantes?';
          }
          
          return detailRequest;
        } else {
          // Generate simple completion response without triage details
          const category = triageResult.case?.category || 'Jurídico';
          const urgency = triageResult.case?.urgency || 'media';
          
          conversation.state = 'COMPLETED';
          
          return `Ok, obrigada por informar todos os detalhes. O advogado responsável deve ser especialista em *${category}*. Ele deve entrar em contato com você nas próximas horas.`;
        }
      } else {
        conversation.state = 'COLLECTING_DETAILS';
        return 'Entendi. Para te ajudar melhor, pode me dar mais detalhes sobre sua situação?';
      }
      
    } catch (error) {
      console.error('Error in case analysis:', error);
      conversation.state = 'COLLECTING_DETAILS';
      return 'Entendi sua situação. Pode me dar alguns detalhes adicionais para eu elaborar uma análise mais precisa?';
    }
  }

  handleDetailCollection(conversation, messageText, client) {
    if (messageText.length > 50) {
      conversation.state = 'ANALYZING_CASE';
      return this.handleCaseAnalysis(conversation, messageText, client);
    } else {
      return 'Pode me dar um pouco mais de detalhes? Isso me ajuda a entender melhor seu caso.';
    }
  }

  async handleDocumentCollection(conversation, messageText, client) {
    console.log('Final document collection and analysis...');
    
    conversation.state = 'COMPLETED';
    
    // Generate final comprehensive analysis (stored for admin only)
    const allMessages = this.getAllConversationText(conversation);
    const finalTriage = await this.triageService.triageFromText(allMessages, client.phone, this.groqService);
    
    if (finalTriage) {
      this.saveTriageAnalysis(conversation, finalTriage);
      
      const category = finalTriage.case?.category || 'Jurídico';
      
      // Simple message for client - no triage details
      return `Ok, obrigada por informar todos os detalhes. O advogado responsável deve ser especialista em *${category}*. Ele deve entrar em contato com você nas próximas horas.`;
    }
    
    return 'Ok, obrigada por informar todos os detalhes. O advogado responsável deve entrar em contato com você nas próximas horas.';
  }

  handleAwaitingLawyer(conversation, messageText, client) {
    const firstName = client.name ? client.name.split(' ')[0] : '';
    return `Oi ${firstName}! Sua conversa foi direcionada para um advogado especializado. Todas as informações foram registradas. Um profissional entrará em contato em breve!`;
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
    const words = text.trim().split(/\s+/);
    if (words.length >= 2) {
      // Remove common words that aren't names
      const filtered = words.filter(word => 
        !['meu', 'nome', 'é', 'sou', 'eu', 'me', 'chamo'].includes(word.toLowerCase())
      );
      return filtered.join(' ');
    }
    return text.trim();
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
      
      this.conversations = new Map(Object.entries(parsed.conversations || {}));
      this.clients = new Map(Object.entries(parsed.clients || {}));
      this.messages = new Map(Object.entries(parsed.messages || {}));
      
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

  // Admin methods
  getAllConversations() {
    return Array.from(this.conversations.values()).map(conv => {
      // Get triage analysis for this conversation
      const messages = this.messages.get(conv.id) || [];
      const analysisMessage = messages.find(msg => msg.direction === 'ANALYSIS');
      
      return {
        id: conv.id,
        client: conv.client,
        state: conv.state,
        startedAt: conv.startedAt,
        lastActivityAt: conv.lastActivityAt,
        triageAnalysis: analysisMessage ? analysisMessage.rawPayload : null,
        timestamp: conv.startedAt,
        urgency: analysisMessage?.rawPayload?.case?.urgency || 'baixa'
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
}

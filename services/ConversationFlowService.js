import fs from 'fs/promises';
import path from 'path';

export class ConversationFlowService {
  constructor(groqService, triageService, assistantName = 'Ana') {
    this.groqService = groqService;
    this.triageService = triageService;
    this.assistantName = assistantName; // Store the assistant name
    this.conversations = new Map();
    this.clients = new Map();
    this.messages = new Map();
    this.conversationIdCounter = 1;
    this.messageIdCounter = 1;
    this.pendingRetries = new Map(); // Track pending retries
    
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
      lastActivityAt: new Date(),
      conversationHistory: [] // Initialize the conversation history array
    };
    
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async processConversationState(conversation, messageText, client) {
    const state = conversation.state;
    
    switch (state) {
      case 'GREETING':
        return await this.handleGreeting(conversation, messageText, client);
      case 'COLLECTING_NAME':
        return this.handleNameCollection(conversation, messageText, client);
      case 'COLLECTING_EMAIL':
        return this.handleEmailCollection(conversation, messageText, client);
      case 'ANALYZING_CASE':
        return await this.handleCaseAnalysis(conversation, messageText, client);
      case 'COLLECTING_DETAILS':
        return await this.handleDetailCollection(conversation, messageText, client);
      case 'COLLECTING_DOCUMENTS':
        return await this.handleDocumentCollection(conversation, messageText, client);
      case 'AWAITING_LAWYER':
        return await this.handleAwaitingLawyer(conversation, messageText, client);
      default:
        return await this.handleGreeting(conversation, messageText, client);
    }
  }

  async handleGreeting(conversation, messageText, client) {
    conversation.state = 'COLLECTING_NAME';
    
    // Let AI generate a completely natural greeting
    const greetingPrompt = `Você é ${this.assistantName}, assistente jurídica do escritório BriseWare. 
    
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

    return await this.groqService.generateResponse(greetingPrompt);
  }

  async handleNameCollection(conversation, messageText, client) {
    const name = this.extractName(messageText);
    if (name && name.length > 3) {
      client.name = name;
      this.clients.set(client.phone, client);
      
      conversation.state = 'COLLECTING_EMAIL';
      
      const firstName = name.split(' ')[0];
      
      // Let AI generate natural response asking for email
      const emailPrompt = `Você é Ana, assistente jurídica. O cliente acabou de se apresentar como "${name}".

SITUAÇÃO: Agora você precisa do email da pessoa para enviar atualizações sobre o caso.

INSTRUÇÕES:
- Reconheça o nome de forma calorosa (use "${firstName}")
- Peça o email de forma natural
- Explique brevemente por que precisa (para atualizações)
- Seja conversacional, não robotizada

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(emailPrompt);
    } else {
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
    const email = this.extractEmail(messageText);
    if (email) {
      client.email = email;
      this.clients.set(client.phone, client);
      
      conversation.state = 'ANALYZING_CASE';
      
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
    
    // Acumula informações sobre o caso
    conversation.conversationHistory.push({
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString()
    });
    
    // Check if we have too many exchanges - auto-finalize to prevent loops
    const userMessages = conversation.conversationHistory.filter(msg => msg.role === 'user');
    if (userMessages.length >= 6) {
      console.log('Auto-finalizing conversation due to too many exchanges');
      conversation.state = 'COMPLETED';
      // Save the triage analysis if available
      if (conversation.analysis) {
        this.saveTriageAnalysis(conversation, conversation.analysis);
      }
      return `Entendi. Com base em todas as informações que você forneceu, nossa equipe jurídica irá analisar seu caso detalhadamente. Um advogado especializado entrará em contato em até 24 horas para discutir os próximos passos e esclarecer suas dúvidas.`;
    }
    
    // Se ainda não fez análise inicial ou precisa de mais informações
    if (!conversation.needsMoreInfo) {
      const analysis = await this.triageService.triageFromText(messageText, client.phone, this.groqService);
      conversation.analysis = analysis;
      
      // AI decides if more information is needed
      const analysisPrompt = `Você é ${this.assistantName}, assistente jurídica especializada. O cliente ${client.name} contou sobre a situação:

"${messageText}"

ANÁLISE TÉCNICA:
- Área: ${analysis?.case?.category || 'Não identificada'}
- Urgência: ${analysis?.case?.urgency || 'Média'}
- Complexidade: ${analysis?.triage?.complexity || 'Média'}
- Confiança: ${analysis?.triage?.confidence || 0.5}

AVALIAÇÃO DE COMPLETUDE:
Verifique se a mensagem contém:
- ✓ Situação claramente descrita com contexto completo (datas, pessoas, eventos)
- ✓ Problema jurídico específico identificado
- ✓ Consequências ou danos mencionados
- ✓ Cronologia dos fatos apresentada

REGRA IMPORTANTE: Se a mensagem for LONGA (mais de 300 caracteres) e DETALHADA com cronologia clara, geralmente JÁ CONTÉM informações suficientes.

TAREFA: Decidir se você precisa de mais informações ou se pode finalizar o atendimento.

Se PRECISAR de mais informações (apenas se faltarem elementos essenciais):
- Use apenas "entendi" ou "compreendo" para reconhecer a situação
- Faça UMA pergunta específica sobre o que realmente falta
- Seja objetiva (máximo 1 frase de pergunta)

Se TIVER informações SUFICIENTES (caso detalhado com cronologia):
- Comece sua resposta exatamente com "FINALIZAR:"
- NÃO faça resumo da situação (o cliente já sabe o que aconteceu)
- Vá direto aos próximos passos
- Explique que um advogado especializado analisará o caso
- Informe que o advogado entrará em contato em breve

Responda APENAS com sua mensagem:`;

      const response = await this.groqService.generateResponse(analysisPrompt);
      
      if (response.startsWith('FINALIZAR:')) {
        conversation.state = 'COMPLETED';
        // Save the triage analysis when conversation completes
        if (conversation.analysis) {
          this.saveTriageAnalysis(conversation, conversation.analysis);
        }
        return response.substring(10).trim();
      } else {
        conversation.needsMoreInfo = true;
        return response;
      }
    } else {
      // Já tinha análise, agora com informações adicionais
      const conversationMessages = conversation.conversationHistory || [];
      const allUserMessages = conversationMessages.filter(msg => msg.role === 'user').map(msg => msg.content).join('\n\n');
      
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
- Use apenas "entendi" - não repita a situação
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
        conversation.state = 'COMPLETED';
        // Save the triage analysis when conversation completes
        if (conversation.analysis) {
          this.saveTriageAnalysis(conversation, conversation.analysis);
        }
        return response.substring(10).trim();
      } else {
        return response;
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
- Use apenas "entendi" - não repita o que a pessoa disse
- Peça detalhes específicos de forma objetiva
- Seja concisa mas completa
- Seja gentil mas direta

EXEMPLO: Se perguntarem "quanto custa?", responda "O advogado vai explicar sobre valores. Pode me dar mais detalhes sobre sua situação?"

Responda APENAS com sua mensagem:`;

      return await this.groqService.generateResponse(detailPrompt);
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
    // Check if it's clearly a question first
    if (text.includes('?') || 
        text.toLowerCase().includes('precisa') || 
        text.toLowerCase().includes('por que') ||
        text.toLowerCase().includes('porque') ||
        text.toLowerCase().includes('pra que') ||
        text.toLowerCase().includes('tem que') ||
        text.toLowerCase().includes('obrigatório')) {
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
      return null;
    }
    
    const words = text.trim().split(/\s+/);
    
    // If only one word and it's too short or common, probably not a name
    if (words.length === 1) {
      const word = words[0].toLowerCase();
      if (word.length < 3 || 
          ['sim', 'não', 'ok', 'certo', 'claro', 'pode', 'sei'].includes(word)) {
        return null;
      }
    }
    
    if (words.length >= 2) {
      // Remove common words that aren't names
      const filtered = words.filter(word => 
        !['meu', 'nome', 'é', 'sou', 'eu', 'me', 'chamo', 'aqui', 'olá', 'oi'].includes(word.toLowerCase())
      );
      
      // If after filtering we have at least one capitalized word, it might be a name
      const hasCapitalizedWord = filtered.some(word => 
        word.charAt(0) === word.charAt(0).toUpperCase() && word.length > 2
      );
      
      if (hasCapitalizedWord && filtered.length > 0) {
        return filtered.join(' ');
      }
    }
    
    // For single words, check if it looks like a name (capitalized, reasonable length)
    if (words.length === 1) {
      const word = words[0];
      if (word.charAt(0) === word.charAt(0).toUpperCase() && word.length >= 3) {
        return word;
      }
    }
    
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
}

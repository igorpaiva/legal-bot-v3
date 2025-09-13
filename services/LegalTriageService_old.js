import dotenv from 'dotenv';

dotenv.config();

export class LegalTriageService {
  constructor() {
    this.conversationSteps = new Map();
    
    // Tipos de casos jurídicos comuns
    this.legalCases = {
      'trabalhista': {
        name: 'Direito Trabalhista',
        keywords: ['trabalho', 'demissão', 'rescisão', 'horas extras', 'férias', 'salário', 'CLT', 'emprego', 'patrão', 'chefe'],
        questions: [
          'Qual é a natureza do seu problema trabalhista?',
          'Você ainda está empregado ou foi demitido?',
          'Há quanto tempo trabalha/trabalhou na empresa?',
          'Possui carteira assinada?',
          'Tem documentos relacionados ao caso?'
        ]
      },
      'civil': {
        name: 'Direito Civil',
        keywords: ['contrato', 'dívida', 'cobrança', 'indenização', 'danos', 'acidente', 'vizinho', 'propriedade'],
        questions: [
          'Qual é o tipo de problema civil que está enfrentando?',
          'Existe algum contrato envolvido?',
          'Quando o problema começou?',
          'Já tentou resolver amigavelmente?',
          'Tem provas ou documentos do ocorrido?'
        ]
      },
      'familia': {
        name: 'Direito de Família',
        keywords: ['divórcio', 'pensão', 'guarda', 'filhos', 'casamento', 'união estável', 'separação', 'partilha'],
        questions: [
          'Qual é a situação familiar que precisa resolver?',
          'Há filhos menores envolvidos?',
          'Existe patrimônio para partilha?',
          'O outro cônjuge concorda com o processo?',
          'Há violência doméstica envolvida?'
        ]
      },
      'criminal': {
        name: 'Direito Criminal',
        keywords: ['crime', 'delegacia', 'boletim', 'roubo', 'furto', 'agressão', 'ameaça', 'processo criminal'],
        questions: [
          'Você é vítima ou está sendo acusado?',
          'Já foi registrado boletim de ocorrência?',
          'Quando ocorreu o fato?',
          'Há testemunhas?',
          'Já foi intimado ou processado?'
        ]
      },
      'consumidor': {
        name: 'Direito do Consumidor',
        keywords: ['compra', 'produto', 'serviço', 'defeito', 'troca', 'devolução', 'procon', 'empresa'],
        questions: [
          'Qual produto ou serviço está com problema?',
          'Quando foi a compra/contratação?',
          'Já tentou resolver com a empresa?',
          'Tem nota fiscal ou comprovante?',
          'Qual prejuízo teve?'
        ]
      }
    };

    // Informações de urgência
    this.urgencyLevels = {
      'alta': ['prisão', 'flagrante', 'intimação', 'audiência', 'prazo', 'urgente', 'amanhã', 'hoje'],
      'media': ['processo', 'ação', 'resposta', 'contestação', 'semana'],
      'baixa': ['consulta', 'orientação', 'dúvida', 'informação']
    };
  }

  // Inicia o atendimento de triagem
  startTriage(contactId, message) {
    const conversation = {
      step: 'inicio',
      caseType: null,
      urgency: 'baixa',
      answers: [],
      startTime: new Date(),
      contactInfo: {}
    };

    this.conversationSteps.set(contactId, conversation);
    return conversation; // Return the conversation object, not the welcome message
  }

  // Processa a mensagem na triagem
  async processMessage(contactId, message, contactName, groqService = null) {
    let conversation = this.conversationSteps.get(contactId);
    
    if (!conversation) {
      conversation = this.startTriage(contactId, message);
      // Return welcome message for new conversations
      return this.getWelcomeMessage();
    }

    // Verify conversation is an object (safety check)
    if (typeof conversation === 'string') {
      console.warn('Found string conversation, resetting:', contactId);
      conversation = this.startTriage(contactId, message);
      return this.getWelcomeMessage();
    }

    // Detecta urgência
    const urgency = this.detectUrgency(message);
    if (urgency !== 'baixa') {
      conversation.urgency = urgency;
    }

    switch (conversation.step) {
      case 'inicio':
        return this.handleInitialMessage(contactId, message, contactName);
      
      case 'identificacao':
        return this.handleIdentification(contactId, message);
      
      case 'tipo_caso':
        return this.handleCaseType(contactId, message);
      
      case 'perguntas_especificas':
        return this.handleSpecificQuestions(contactId, message);
      
      case 'finalizar':
        return this.handleFinalization(contactId, message);
      
      default:
        return this.handleInitialMessage(contactId, message, contactName);
    }
  }

  getWelcomeMessage() {
    return `👋 Olá! Bem-vindo(a) ao atendimento do *Escritório Jurídico V3*.

Sou seu assistente virtual e vou ajudá-lo a organizar suas informações para que nossos advogados possam atendê-lo da melhor forma.

📋 *Para começar, preciso de algumas informações:*

Digite seu *nome completo* para iniciarmos o atendimento.`;
  }

  handleInitialMessage(contactId, message, contactName) {
    const conversation = this.conversationSteps.get(contactId);
    
    // Detecta o tipo de caso automaticamente
    const detectedCase = this.detectCaseType(message);
    
    if (detectedCase) {
      conversation.caseType = detectedCase;
    }

    conversation.step = 'identificacao';
    conversation.contactInfo.name = contactName;
    
    this.conversationSteps.set(contactId, conversation);

    if (conversation.urgency === 'alta') {
      return `⚠️ *CASO URGENTE DETECTADO* ⚠️

Entendi que seu caso tem urgência! Vou priorizar seu atendimento.

Para começar, confirme seu *nome completo*:`;
    }

    return `Obrigado por entrar em contato! 

Para começar o atendimento, confirme seu *nome completo*:`;
  }

  handleIdentification(contactId, message) {
    const conversation = this.conversationSteps.get(contactId);
    conversation.contactInfo.fullName = message.trim();
    conversation.step = 'tipo_caso';
    
    this.conversationSteps.set(contactId, conversation);

    if (conversation.caseType) {
      const caseInfo = this.legalCases[conversation.caseType];
      return `Obrigado, *${conversation.contactInfo.fullName}*! 

Pelo que entendi, seu caso pode estar relacionado a *${caseInfo.name}*. 

Está correto? Digite:
• *1* - Sim, é isso mesmo
• *2* - Não, é outro tipo de caso
• *3* - Não tenho certeza`;
    }

    return `Obrigado, *${conversation.contactInfo.fullName}*! 

Agora me conta: *qual tipo de problema jurídico você precisa resolver?*

Alguns exemplos:
🏢 Problemas trabalhistas (demissão, horas extras, etc.)
👨‍👩‍👧‍👦 Questões de família (divórcio, pensão, guarda)
🏠 Direito civil (contratos, dívidas, indenização)
🛡️ Direito criminal (vítima ou acusação)
🛒 Direito do consumidor (problemas com compras)

*Descreva brevemente sua situação:*`;
  }

  handleCaseType(contactId, message) {
    const conversation = this.conversationSteps.get(contactId);
    
    if (conversation.caseType && ['1', 'sim', 'correto', 'isso mesmo'].some(word => 
      message.toLowerCase().includes(word))) {
      // Caso já detectado e confirmado
      conversation.step = 'perguntas_especificas';
      conversation.currentQuestion = 0;
      this.conversationSteps.set(contactId, conversation);
      return this.askSpecificQuestion(contactId);
    }

    // Detecta o tipo de caso pela resposta
    const detectedCase = this.detectCaseType(message);
    
    if (detectedCase) {
      conversation.caseType = detectedCase;
      conversation.step = 'perguntas_especificas';
      conversation.currentQuestion = 0;
      this.conversationSteps.set(contactId, conversation);
      
      const caseInfo = this.legalCases[detectedCase];
      return `Perfeito! Identifiquei que seu caso é de *${caseInfo.name}*.

Agora vou fazer algumas perguntas específicas para entender melhor sua situação:

${this.askSpecificQuestion(contactId)}`;
    }

    // Se não conseguiu detectar, pede mais informações
    return `Preciso entender melhor seu caso. 

*Escolha uma das opções abaixo:*

1️⃣ *Trabalhista* - Problemas no trabalho
2️⃣ *Família* - Divórcio, pensão, guarda dos filhos
3️⃣ *Civil* - Contratos, dívidas, indenizações
4️⃣ *Criminal* - Crimes, delegacia, processo criminal
5️⃣ *Consumidor* - Problemas com compras ou serviços

Digite o *número* da opção ou me conte mais detalhes sobre seu problema.`;
  }

  askSpecificQuestion(contactId) {
    const conversation = this.conversationSteps.get(contactId);
    const caseInfo = this.legalCases[conversation.caseType];
    
    if (conversation.currentQuestion < caseInfo.questions.length) {
      const question = caseInfo.questions[conversation.currentQuestion];
      return `📝 *Pergunta ${conversation.currentQuestion + 1}/${caseInfo.questions.length}:*

${question}`;
    }
    
    // Terminou as perguntas
    conversation.step = 'finalizar';
    this.conversationSteps.set(contactId, conversation);
    return this.generateSummary(contactId, groqService);
  }

  handleSpecificQuestions(contactId, message) {
    const conversation = this.conversationSteps.get(contactId);
    
    // Salva a resposta
    conversation.answers.push({
      question: conversation.currentQuestion,
      answer: message,
      timestamp: new Date()
    });
    
    conversation.currentQuestion++;
    this.conversationSteps.set(contactId, conversation);
    
    return this.askSpecificQuestion(contactId);
  }

  async generateSummary(contactId, groqService = null) {
    const conversation = this.conversationSteps.get(contactId);
    const caseInfo = this.legalCases[conversation.caseType];
    
    // Gerar análise completa via LLM se disponível
    let analysis = null;
    if (groqService) {
      try {
        const allMessages = conversation.answers.map(a => `${a.question}: ${a.answer}`);
        analysis = await this.analyzeCompleteCase(contactId, allMessages, groqService);
      } catch (error) {
        console.warn('Erro ao gerar análise LLM, usando formato básico:', error);
      }
    }

    let summary = `✅ *TRIAGEM CONCLUÍDA*

*Cliente:* ${conversation.contactInfo.fullName}
*Área do Direito:* ${caseInfo.name}
*Urgência:* ${this.getUrgencyText(conversation.urgency)}
*Data/Hora:* ${conversation.startTime.toLocaleString('pt-BR')}

*📋 RESUMO DAS INFORMAÇÕES:*\n`;

    conversation.answers.forEach((answer, index) => {
      summary += `\n*${index + 1}.* ${caseInfo.questions[index]}\n📝 ${answer.answer}\n`;
    });

    // Incluir análise jurídica detalhada se disponível
    if (analysis && analysis.legal_solution) {
      summary += `\n*⚖️ ANÁLISE JURÍDICA PRELIMINAR:*

*📖 Resumo:* ${analysis.legal_solution.summary}

*📚 Base Legal:* ${analysis.legal_solution.legal_basis}

*📈 Probabilidade de Sucesso:* ${analysis.legal_solution.success_probability}

*📄 Documentos Necessários:* ${analysis.legal_solution.required_documents}

*⚠️ Riscos e Alternativas:* ${analysis.legal_solution.risks_and_alternatives}
`;
    }

    summary += `\n*🎯 PRÓXIMOS PASSOS:*

${this.getNextSteps(conversation)}

*📞 CONTATO:*
Um de nossos advogados entrará em contato em breve para agendar uma consulta.

*⏰ PRAZO:* ${this.getContactTimeframe(conversation.urgency)}

Obrigado por escolher nosso escritório! 💼⚖️`;

    return summary;
  }

  // Limpa a conversa após um tempo
  cleanupConversation(contactId) {
    setTimeout(() => {
      this.conversationSteps.delete(contactId);
    }, 24 * 60 * 60 * 1000); // 24 horas
  }

  detectCaseType(message) {
    const lowerMessage = message.toLowerCase();
    
    for (const [caseType, caseInfo] of Object.entries(this.legalCases)) {
      for (const keyword of caseInfo.keywords) {
        if (lowerMessage.includes(keyword)) {
          return caseType;
        }
      }
    }
    
    // Detecta por números das opções
    if (lowerMessage.includes('1') || lowerMessage.includes('trabalhista')) return 'trabalhista';
    if (lowerMessage.includes('2') || lowerMessage.includes('família')) return 'familia';
    if (lowerMessage.includes('3') || lowerMessage.includes('civil')) return 'civil';
    if (lowerMessage.includes('4') || lowerMessage.includes('criminal')) return 'criminal';
    if (lowerMessage.includes('5') || lowerMessage.includes('consumidor')) return 'consumidor';
    
    return null;
  }

  detectUrgency(message) {
    const lowerMessage = message.toLowerCase();
    
    for (const [level, keywords] of Object.entries(this.urgencyLevels)) {
      for (const keyword of keywords) {
        if (lowerMessage.includes(keyword)) {
          return level;
        }
      }
    }
    
    return 'baixa';
  }

  getUrgencyText(urgency) {
    const urgencyTexts = {
      'alta': '🔴 ALTA (Atendimento prioritário)',
      'media': '🟡 MÉDIA (Atendimento em 2-3 dias)',
      'baixa': '🟢 BAIXA (Atendimento em até 5 dias)'
    };
    
    return urgencyTexts[urgency] || urgencyTexts['baixa'];
  }

  getNextSteps(conversation) {
    const steps = {
      'trabalhista': `• Separar todos os documentos trabalhistas (carteira, contratos, holerites)
• Anotar datas importantes (admissão, demissão, problemas)
• Listar testemunhas se houver`,
      
      'familia': `• Reunir documentos pessoais (RG, CPF, certidões)
• Listar bens do casal se houver
• Documentos dos filhos se aplicável`,
      
      'civil': `• Organizar contratos e documentos relacionados
• Reunir provas (fotos, mensagens, e-mails)
• Anotar valores e datas importantes`,
      
      'criminal': `• Guardar boletim de ocorrência se houver
• Listar possíveis testemunhas
• Documentar provas (fotos, mensagens)`,
      
      'consumidor': `• Guardar nota fiscal e comprovantes
• Documentar defeitos com fotos
• Histórico de tentativas de solução`
    };
    
    return steps[conversation.caseType] || '• Organizar documentos relacionados ao caso';
  }

  getContactTimeframe(urgency) {
    const timeframes = {
      'alta': 'Hoje ou amanhã',
      'media': '2 a 3 dias úteis',
      'baixa': 'Até 5 dias úteis'
    };
    
    return timeframes[urgency] || timeframes['baixa'];
  }

  // Método para administradores verem triagens
  getTriageData(contactId) {
    return this.conversationSteps.get(contactId);
  }

  // Lista todas as triagens ativas
  getAllTriages() {
    return Array.from(this.conversationSteps.entries()).map(([contactId, data]) => ({
      contactId,
      name: data.contactInfo.fullName,
      caseType: data.caseType,
      urgency: data.urgency,
      step: data.step,
      startTime: data.startTime
    }));
  }

  // Analisa o caso completo e gera triagem detalhada via LLM
  async analyzeCompleteCase(contactId, allMessages, groqService) {
    const conversation = this.conversationSteps.get(contactId);
    if (!conversation) return null;

    const caseDescription = allMessages.join('\n');
    const phone = contactId;
    
    try {
      // Usar o mesmo prompt estruturado do projeto original
      const prompt = this.buildTriagePrompt(caseDescription, phone);
      
      // Usar o GroqService para fazer a análise via LLM
      const response = await groqService.generateAnalysisResponse(prompt);
      
      // Tentar fazer parse do JSON retornado
      let analysis;
      try {
        analysis = JSON.parse(response);
      } catch (parseError) {
        console.warn('Erro ao fazer parse do JSON da triagem, usando fallback:', parseError);
        analysis = this.createFallbackAnalysis(conversation, contactId, caseDescription);
      }
      
      // Verificar se o JSON está completo
      if (!analysis.client || !analysis.case || !analysis.triage || !analysis.legal_solution) {
        console.warn('JSON incompleto recebido, usando fallback');
        analysis = this.createFallbackAnalysis(conversation, contactId, caseDescription);
      }
      
      return analysis;
      
    } catch (error) {
      console.error('Erro na análise de triagem:', error);
      return this.createFallbackAnalysis(conversation, contactId, caseDescription);
    }
  }

  // Constrói o prompt estruturado para triagem (baseado no projeto original)
  buildTriagePrompt(incomingText, phone) {
    return `Você é um assistente de triagem para um escritório de advocacia brasileiro. 

INSTRUÇÕES IMPORTANTES:
- Seja empático e profissional
- NÃO forneça aconselhamento jurídico específico, apenas orientações gerais
- Analise o relato do cliente e extraia informações estruturadas
- Inclua sugestões de soluções jurídicas baseadas em precedentes e legislação
- Responda APENAS com um JSON válido, sem explicações adicionais

SCHEMA OBRIGATÓRIO:
{
  "client": {
    "name": "string - nome do cliente se mencionado",
    "phone": "string - telefone conhecido",
    "email": "string - email se mencionado"
  },
  "case": {
    "category": "string - uma de: Trabalhista, Civil, Penal, Empresarial, Tributário, Administrativo, Constitucional, Família, Consumidor, Imobiliário, Previdenciário, Internacional, Outros",
    "description": "string - resumo do caso baseado no relato",
    "date": "string - data do fato se mencionada (formato YYYY-MM-DD)",
    "urgency": "string - uma de: alta, media, baixa",
    "documents": ["array de strings - documentos mencionados pelo cliente"]
  },
  "triage": {
    "confidence": "number - 0.0 a 1.0 - sua confiança na categorização",
    "escalate": "boolean - true se for emergência que requer advogado imediato",
    "flags": ["array - possíveis: medida_cautelar, ameaça, crime, prazo_urgente, risco_financeiro"],
    "recommended_action": "string - próxima ação recomendada"
  },
  "legal_solution": {
    "summary": "string - resumo executivo da situação jurídica (máximo 200 palavras)",
    "legal_basis": "string - leis, códigos e artigos aplicáveis específicos",
    "recommended_actions": "string - procedimentos recomendados passo a passo",
    "success_probability": "string - análise da probabilidade de sucesso com justificativa",
    "required_documents": "string - documentos e provas necessárias",
    "risks_and_alternatives": "string - riscos processuais e alternativas extrajudiciais"
  }
}

CRITÉRIOS DE URGÊNCIA:
- ALTA: risco de vida, prazos legais iminentes, crimes em andamento, medidas urgentes
- MÉDIA: questões importantes mas sem urgência imediata
- BAIXA: consultas gerais, dúvidas simples

DIRETRIZES PARA SOLUÇÕES JURÍDICAS DETALHADAS:
- Base-se na legislação brasileira vigente (Códigos Civil, Penal, Trabalhista, Processual)
- Cite artigos específicos, súmulas e jurisprudência consolidada do STF, STJ e tribunais
- Desenvolva estratégia jurídica completa com fundamentação doutrinária
- Inclua análise de riscos processuais e contraproducência
- Sugira tanto soluções judiciais quanto extrajudiciais com detalhamento
- Considere aspectos práticos como documentação, perícias e testemunhas
- Analise precedentes jurisprudenciais específicos e tendências atuais
- Desenvolva estratégias de negociação quando aplicável
- Inclua medidas cautelares e urgentes quando necessárias
- Considere impactos tributários, trabalhistas ou regulatórios quando relevantes

TEXTO DO CLIENTE: "${incomingText?.replace(/"/g, '\\"') || ''}"
TELEFONE: "${phone || ''}"

IMPORTANTE: Retorne apenas um JSON válido e completo. Se estiver próximo do limite de tokens, priorize completar o JSON com informações essenciais ao invés de textos muito longos. Certifique-se de fechar todas as aspas e chaves.

Retorne apenas o JSON:`;
  }

  // Cria análise de fallback quando a IA falha
  createFallbackAnalysis(conversation, contactId, caseDescription) {
    return {
      client: {
        name: conversation?.contactInfo?.name || conversation?.contactInfo?.fullName || 'Não informado',
        phone: contactId,
        email: conversation?.contactInfo?.email || 'Não informado'
      },
      case: {
        category: conversation?.caseType ? this.legalCases[conversation.caseType]?.name : 'Outros',
        description: caseDescription.substring(0, 500) + '...',
        date: null,
        urgency: conversation?.urgency || 'media',
        documents: conversation?.documents || []
      },
      triage: {
        confidence: 0.5,
        escalate: conversation?.urgency === 'alta',
        flags: this.getFlags(conversation),
        recommended_action: 'Consulta com advogado especializado para análise detalhada'
      },
      legal_solution: {
        summary: 'Caso requer análise especializada por advogado qualificado para elaboração de estratégia jurídica adequada.',
        legal_basis: 'Legislação brasileira aplicável ao caso específico conforme análise especializada.',
        recommended_actions: 'Consulta presencial para análise completa da documentação e viabilidade jurídica.',
        success_probability: 'A definir após análise detalhada dos documentos e circunstâncias específicas.',
        required_documents: 'Documentos relacionados ao caso conforme orientação especializada.',
        risks_and_alternatives: 'Análise de riscos e alternativas a serem apresentadas em consulta especializada.'
      }
    };
  }

  // Método para limpar JSON truncado (do projeto original)
  cleanupJson(jsonString) {
    if (!jsonString || jsonString.trim() === '') {
      return this.createFallbackJson();
    }
    
    let cleaned = jsonString.trim();
    
    // Remove caracteres de controle, mantendo quebras de linha
    cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    
    // Conta chaves e colchetes para verificar balanceamento
    const openBraces = (cleaned.match(/\{/g) || []).length;
    const closeBraces = (cleaned.match(/\}/g) || []).length;
    
    if (openBraces > closeBraces) {
      const missing = openBraces - closeBraces;
      cleaned += '}'.repeat(missing);
    }
    
    const openBrackets = (cleaned.match(/\[/g) || []).length;
    const closeBrackets = (cleaned.match(/\]/g) || []).length;
    
    if (openBrackets > closeBrackets) {
      const missing = openBrackets - closeBrackets;
      cleaned += ']'.repeat(missing);
    }
    
    // Verificar se é JSON válido
    try {
      JSON.parse(cleaned);
      return cleaned;
    } catch (e) {
      console.warn('JSON ainda inválido após limpeza:', e.message);
      return this.createFallbackJson();
    }
  }

  // JSON de fallback estruturado
  createFallbackJson() {
    return JSON.stringify({
      client: { name: null, phone: '', email: null },
      case: { category: 'Outros', description: 'Consulta jurídica', urgency: 'media', documents: [] },
      triage: { confidence: 0.5, escalate: true, flags: [], recommended_action: 'Consulta com advogado especializado' },
      legal_solution: {
        summary: 'Caso requer análise especializada por advogado qualificado',
        legal_basis: 'Legislação brasileira aplicável ao caso específico',
        recommended_actions: 'Consulta presencial para análise detalhada',
        success_probability: 'A definir após análise completa',
        required_documents: 'Documentos relacionados ao caso',
        risks_and_alternatives: 'Riscos e alternativas a serem avaliados'
      }
    });
  }
}

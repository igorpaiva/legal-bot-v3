export class LegalFieldQuestionsService {
  constructor() {
    this.fieldRequirements = this.initializeFieldRequirements();
  }

  initializeFieldRequirements() {
    return {
      'Trabalhista': {
        displayName: 'Direito Trabalhista',
        requiredInfo: [
          {
            key: 'dataAdmissao',
            description: 'Data de admissão na empresa',
            importance: 'alta',
            keywords: ['admiss', 'contrat', 'trabalh', 'emprego', 'começou', 'iniciou'],
            examples: ['15/03/2020', 'março de 2020', 'há 3 anos']
          },
          {
            key: 'dataDemissao',
            description: 'Data de demissão ou afastamento',
            importance: 'alta',
            keywords: ['demiss', 'afastamento', 'saiu', 'terminou', 'desligamento', 'rescis'],
            examples: ['10/08/2023', 'agosto passado', 'ainda trabalho lá']
          },
          {
            key: 'cargo',
            description: 'Cargo ou função exercida',
            importance: 'alta',
            keywords: ['cargo', 'função', 'trabalh', 'atua', 'faz', 'profiss'],
            examples: ['analista', 'vendedor', 'operador', 'gerente']
          },
          {
            key: 'ultimoSalario',
            description: 'Valor do último salário',
            importance: 'alta',
            keywords: ['salário', 'remuner', 'ganh', 'receb', 'valor', 'R$'],
            examples: ['R$ 2.500,00', '2500 reais', 'dois mil e quinhentos']
          },
          {
            key: 'nomeEmpresa',
            description: 'Nome da empresa',
            importance: 'alta',
            keywords: ['empresa', 'empregador', 'patrão', 'firma', 'trabalh'],
            examples: ['ABC Ltda', 'Empresa XYZ', 'Mercado Local']
          },
          {
            key: 'jornadaTrabalho',
            description: 'Jornada de trabalho',
            importance: 'media',
            keywords: ['hora', 'jornada', 'expediente', 'trabalh', 'entrada', 'saída'],
            examples: ['8 horas por dia', 'das 8 às 17h', '44 horas semanais']
          }
        ]
      },
      'Civil': {
        displayName: 'Direito Civil',
        requiredInfo: [
          {
            key: 'dataOcorrencia',
            description: 'Data do ocorrido',
            importance: 'alta',
            keywords: ['quando', 'data', 'ocorreu', 'aconteceu', 'dia'],
            examples: ['15/06/2023', 'mês passado', 'semana retrasada']
          },
          {
            key: 'partesEnvolvidas',
            description: 'Pessoas ou empresas envolvidas',
            importance: 'alta',
            keywords: ['quem', 'pessoa', 'empresa', 'envolvido', 'responsável'],
            examples: ['João Silva', 'Loja ABC', 'meu vizinho']
          },
          {
            key: 'valorPrejuizo',
            description: 'Valor do prejuízo ou dano',
            importance: 'media',
            keywords: ['valor', 'prejuízo', 'dano', 'perda', 'R$', 'custo'],
            examples: ['R$ 5.000', 'cinco mil reais', 'não sei o valor']
          },
          {
            key: 'documentos',
            description: 'Contratos ou documentos relacionados',
            importance: 'media',
            keywords: ['contrato', 'documento', 'papel', 'acordo', 'termo'],
            examples: ['contrato de compra', 'recibo', 'não tenho documentos']
          }
        ]
      },
      'Penal': {
        displayName: 'Direito Penal',
        requiredInfo: [
          {
            key: 'dataCrime',
            description: 'Data do crime ou infração',
            importance: 'alta',
            keywords: ['quando', 'data', 'ocorreu', 'aconteceu', 'crime'],
            examples: ['10/07/2023', 'semana passada', 'ontem à noite']
          },
          {
            key: 'boletimOcorrencia',
            description: 'Número do boletim de ocorrência',
            importance: 'alta',
            keywords: ['bo', 'boletim', 'ocorrência', 'polícia', 'delegacia'],
            examples: ['BO 123456/2023', 'não registrei ainda', 'fiz o BO ontem']
          },
          {
            key: 'acusadoIdentidade',
            description: 'Identidade do acusado/agressor',
            importance: 'alta',
            keywords: ['quem', 'acusado', 'agressor', 'conhece', 'identidade'],
            examples: ['João da Silva', 'meu vizinho', 'não sei quem é']
          },
          {
            key: 'testemunhas',
            description: 'Existência de testemunhas',
            importance: 'media',
            keywords: ['testemunha', 'viu', 'presenciou', 'pessoa'],
            examples: ['minha esposa viu', 'tinha gente na rua', 'ninguém viu']
          }
        ]
      },
      'Família': {
        displayName: 'Direito de Família',
        requiredInfo: [
          {
            key: 'tipoCaso',
            description: 'Tipo de caso (divórcio, pensão, guarda)',
            importance: 'alta',
            keywords: ['divórcio', 'separação', 'pensão', 'guarda', 'alimentos'],
            examples: ['divórcio', 'pensão alimentícia', 'guarda dos filhos']
          },
          {
            key: 'situacaoConjugal',
            description: 'Estado civil e duração da união',
            importance: 'alta',
            keywords: ['casad', 'união', 'estável', 'tempo', 'anos'],
            examples: ['casados há 10 anos', 'união estável de 5 anos']
          },
          {
            key: 'filhos',
            description: 'Informações sobre filhos',
            importance: 'alta',
            keywords: ['filho', 'criança', 'idade', 'menor'],
            examples: ['2 filhos: 8 e 12 anos', 'uma filha de 6 anos', 'não temos filhos']
          },
          {
            key: 'bensComuns',
            description: 'Bens em comum',
            importance: 'media',
            keywords: ['bens', 'casa', 'carro', 'propriedade', 'patrimônio'],
            examples: ['casa própria e um carro', 'não temos bens', 'apartamento financiado']
          }
        ]
      },
      'Previdenciário': {
        displayName: 'Direito Previdenciário',
        requiredInfo: [
          {
            key: 'tipoBeneficio',
            description: 'Tipo de benefício buscado',
            importance: 'alta',
            keywords: ['aposentadoria', 'auxílio', 'benefício', 'inss', 'pensão'],
            examples: ['aposentadoria por tempo', 'auxílio-doença', 'pensão por morte']
          },
          {
            key: 'tempoContribuicao',
            description: 'Tempo de contribuição ao INSS',
            importance: 'alta',
            keywords: ['contribu', 'tempo', 'anos', 'inss', 'carteira'],
            examples: ['25 anos de contribuição', 'desde 1995', 'sempre contribuí']
          },
          {
            key: 'situacaoINSS',
            description: 'Situação atual com o INSS',
            importance: 'alta',
            keywords: ['negado', 'indeferido', 'solicitei', 'inss', 'pedido'],
            examples: ['pedido negado', 'ainda não solicitei', 'em análise']
          },
          {
            key: 'condicaoMedica',
            description: 'Condição médica (se aplicável)',
            importance: 'media',
            keywords: ['doença', 'problema', 'saúde', 'médico', 'laudo'],
            examples: ['problema na coluna', 'depressão', 'estou saudável']
          }
        ]
      },
      'Consumidor': {
        displayName: 'Direito do Consumidor',
        requiredInfo: [
          {
            key: 'tipoProblema',
            description: 'Tipo de problema com produto/serviço',
            importance: 'alta',
            keywords: ['problema', 'defeito', 'vício', 'produto', 'serviço'],
            examples: ['produto com defeito', 'serviço não prestado', 'cobrança indevida']
          },
          {
            key: 'dataCompra',
            description: 'Data da compra ou contratação',
            importance: 'alta',
            keywords: ['compra', 'comprei', 'contrat', 'quando', 'data'],
            examples: ['15/05/2023', 'mês passado', 'há 3 meses']
          },
          {
            key: 'fornecedor',
            description: 'Nome da empresa/fornecedor',
            importance: 'alta',
            keywords: ['empresa', 'loja', 'fornecedor', 'vendedor', 'prestador'],
            examples: ['Magazine Luiza', 'Casas Bahia', 'loja do bairro']
          },
          {
            key: 'valorProduto',
            description: 'Valor pago pelo produto/serviço',
            importance: 'alta',
            keywords: ['valor', 'preço', 'paguei', 'custou', 'R$'],
            examples: ['R$ 1.200', 'mil e duzentos reais', 'foi caro']
          },
          {
            key: 'tentativasSolucao',
            description: 'Tentativas de resolver o problema',
            importance: 'media',
            keywords: ['tentei', 'procurei', 'reclamei', 'procon', 'contato'],
            examples: ['liguei várias vezes', 'fui na loja', 'ainda não tentei']
          }
        ]
      },
      'Imobiliário': {
        displayName: 'Direito Imobiliário',
        requiredInfo: [
          {
            key: 'tipoNegocio',
            description: 'Tipo de negócio imobiliário',
            importance: 'alta',
            keywords: ['compra', 'venda', 'aluguel', 'financiamento', 'imóvel'],
            examples: ['compra de casa', 'aluguel de apartamento', 'venda de terreno']
          },
          {
            key: 'enderecoImovel',
            description: 'Localização do imóvel',
            importance: 'alta',
            keywords: ['endereço', 'onde', 'localiz', 'imóvel', 'casa', 'apartamento'],
            examples: ['Rua das Flores, 123', 'Centro da cidade', 'bairro Vila Nova']
          },
          {
            key: 'valorNegocio',
            description: 'Valor do negócio',
            importance: 'alta',
            keywords: ['valor', 'preço', 'R$', 'custou', 'pago'],
            examples: ['R$ 300.000', 'trezentos mil', 'ainda negociando']
          },
          {
            key: 'situacaoDocumental',
            description: 'Situação da documentação',
            importance: 'alta',
            keywords: ['documento', 'escritura', 'registro', 'cartório', 'regulariz'],
            examples: ['documentos em ordem', 'falta escritura', 'irregular']
          }
        ]
      }
    };
  }

  getRequiredInfoForField(legalField) {
    const normalizedField = this.normalizeLegalField(legalField);
    return this.fieldRequirements[normalizedField] || null;
  }

  normalizeLegalField(field) {
    if (!field) return null;
    
    const fieldLower = field.toLowerCase();
    
    if (fieldLower.includes('trabalh') || fieldLower.includes('emprego') || fieldLower.includes('clt')) {
      return 'Trabalhista';
    } else if (fieldLower.includes('civil') || fieldLower.includes('contrato') || fieldLower.includes('responsabilidade')) {
      return 'Civil';
    } else if (fieldLower.includes('penal') || fieldLower.includes('criminal') || fieldLower.includes('crime')) {
      return 'Penal';
    } else if (fieldLower.includes('família') || fieldLower.includes('divórcio') || fieldLower.includes('casamento') || fieldLower.includes('pensão')) {
      return 'Família';
    } else if (fieldLower.includes('previdenc') || fieldLower.includes('inss') || fieldLower.includes('aposentador')) {
      return 'Previdenciário';
    } else if (fieldLower.includes('consumidor') || fieldLower.includes('compra') || fieldLower.includes('produto')) {
      return 'Consumidor';
    } else if (fieldLower.includes('imobiliário') || fieldLower.includes('imóvel') || fieldLower.includes('propriedade')) {
      return 'Imobiliário';
    }
    
    return field;
  }

  analyzeProvidedInformation(conversationHistory, legalField) {
    const fieldInfo = this.getRequiredInfoForField(legalField);
    if (!fieldInfo) return { missingInfo: [], extractedInfo: {} };

    const allUserMessages = conversationHistory
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content)
      .join(' ')
      .toLowerCase();

    const extractedInfo = {};
    const missingInfo = [];

    for (const requirement of fieldInfo.requiredInfo) {
      const hasKeywords = requirement.keywords.some(keyword => 
        allUserMessages.includes(keyword.toLowerCase())
      );

      if (hasKeywords) {
        extractedInfo[requirement.key] = {
          description: requirement.description,
          importance: requirement.importance,
          foundInText: true
        };
      } else {
        missingInfo.push(requirement);
      }
    }

    return { missingInfo, extractedInfo };
  }

  generateStrategicQuestion(missingInfo, fieldName, clientName, conversationHistory) {
    // Get high importance missing info first
    const highPriorityMissing = missingInfo.filter(info => info.importance === 'alta');
    const nextToAsk = highPriorityMissing.length > 0 ? highPriorityMissing[0] : missingInfo[0];

    if (!nextToAsk) return null;

    return {
      info: nextToAsk,
      questionPrompt: this.buildQuestionPrompt(nextToAsk, fieldName, clientName, conversationHistory)
    };
  }

  buildQuestionPrompt(requiredInfo, fieldName, clientName, conversationHistory) {
    const firstName = clientName?.split(' ')[0] || 'cliente';
    const allUserText = conversationHistory
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content)
      .join('\n\n');

    return `Você é Ana, assistente jurídica especializada. Você está coletando informações específicas sobre um caso de ${fieldName}.

INFORMAÇÃO NECESSÁRIA: ${requiredInfo.description}
IMPORTÂNCIA: ${requiredInfo.importance}
EXEMPLOS DE RESPOSTA: ${requiredInfo.examples.join(', ')}

HISTÓRICO DA CONVERSA:
"${allUserText}"

CONTEXTO: Você precisa obter "${requiredInfo.description}" para que o advogado possa analisar o caso adequadamente.

TAREFA: Fazer uma pergunta direta e profissional para obter essa informação específica.

INSTRUÇÕES:
- Seja direta e objetiva na pergunta
- NÃO use frases empáticas repetitivas como "compreendo como está sendo difícil"
- NÃO repita o nome do cliente no início
- Explique brevemente POR QUE essa informação é importante para o caso
- Faça a pergunta de forma clara e natural
- Use linguagem profissional mas calorosa
- Se a informação já foi mencionada vagamente, peça para esclarecer/confirmar

FORMATO: Responda apenas com sua pergunta/mensagem ao cliente, de forma direta.

Responda APENAS com sua mensagem:`;
  }

  extractAnswerValue(question, answer, requiredInfo) {
    // Simple extraction - in a real system, you might use more sophisticated NLP
    return {
      question: requiredInfo.description,
      answer: answer.trim(),
      extractedAt: new Date().toISOString(),
      infoKey: requiredInfo.key
    };
  }

  getAllFields() {
    return Object.keys(this.fieldRequirements).map(key => ({
      key,
      displayName: this.fieldRequirements[key].displayName,
      requirementCount: this.fieldRequirements[key].requiredInfo.length
    }));
  }
}

export default LegalFieldQuestionsService;

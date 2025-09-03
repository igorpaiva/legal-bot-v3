import dotenv from 'dotenv';

dotenv.config();

export class LegalTriageService {
  constructor() {
    // This service now focuses purely on triage analysis via LLM
    // Conversation flow is handled by ConversationFlowService
  }

  // Main triage method - matches the original Java implementation
  async triageFromText(incomingText, phone, groqService) {
    const prompt = this.buildTriagePrompt(incomingText, phone);
    
    try {
      console.log('Starting triage analysis for phone:', phone);
      const response = await groqService.generateAnalysisResponse(prompt);
      console.log('Triage completed, response length:', response.length);
      
      // Check if JSON is complete
      if (!response.trim().endsWith('}')) {
        console.warn('JSON possibly truncated, attempting to fix');
        return this.fixTruncatedJson(response);
      }
      
      // Parse and validate JSON
      let analysis;
      try {
        analysis = JSON.parse(response);
      } catch (parseError) {
        console.warn('JSON parse error, using cleanup method:', parseError);
        const cleanedJson = this.cleanupJson(response);
        analysis = JSON.parse(cleanedJson);
      }
      
      // Validate required fields
      if (!analysis.client || !analysis.case || !analysis.triage || !analysis.legal_solution) {
        console.warn('Incomplete JSON structure, using fallback');
        return this.createFallbackAnalysis(phone, incomingText);
      }
      
      return analysis;
      
    } catch (error) {
      console.error('Error during triage analysis:', error);
      return this.createFallbackAnalysis(phone, incomingText);
    }
  }

  // Build the comprehensive triage prompt - exactly like the original
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
    "timeline": "string - cronograma estimado das principais fases",
    "required_documents": "string - documentos e provas necessárias",
    "estimated_costs": "string - estimativa de custos processuais e honorários",
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
- Avalie custos-benefício detalhado considerando todas as variáveis
- Inclua cronograma realista com marcos processuais importantes
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

  // Fix truncated JSON - from original implementation
  fixTruncatedJson(truncatedJson) {
    let trimmed = truncatedJson.trim();
    
    // If ends with quote without closing field, add quotes and close
    if (trimmed.endsWith('"')) {
      return trimmed + '}}}';
    }
    
    // If ends in middle of string, close appropriately
    if (!trimmed.endsWith('}') && !trimmed.endsWith('"')) {
      // Add quotes to close current string and close JSON
      return trimmed + '"}}';
    }
    
    return trimmed;
  }

  // Clean up JSON - from original implementation
  cleanupJson(jsonString) {
    if (!jsonString || jsonString.trim() === '') {
      return this.createFallbackJson();
    }
    
    let cleaned = jsonString.trim();
    
    // Remove control characters, keeping line breaks
    cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    
    // Count braces and brackets to verify balancing
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
    
    // Verify if it's valid JSON
    try {
      JSON.parse(cleaned);
      return cleaned;
    } catch (e) {
      console.warn('JSON still invalid after cleanup:', e.message);
      return this.createFallbackJson();
    }
  }

  // Create fallback analysis when AI fails
  createFallbackAnalysis(phone, caseDescription) {
    return {
      client: {
        name: null,
        phone: phone,
        email: null
      },
      case: {
        category: 'Outros',
        description: caseDescription.substring(0, 500) + '...',
        date: null,
        urgency: 'media',
        documents: []
      },
      triage: {
        confidence: 0.5,
        escalate: true,
        flags: [],
        recommended_action: 'Consulta com advogado especializado para análise detalhada'
      },
      legal_solution: {
        summary: 'Caso requer análise especializada por advogado qualificado para elaboração de estratégia jurídica adequada.',
        legal_basis: 'Legislação brasileira aplicável ao caso específico conforme análise especializada.',
        recommended_actions: 'Consulta presencial para análise completa da documentação e viabilidade jurídica.',
        success_probability: 'A definir após análise detalhada dos documentos e circunstâncias específicas.',
        timeline: 'Prazo estimado após avaliação inicial e estratégia definida.',
        required_documents: 'Documentos relacionados ao caso conforme orientação especializada.',
        estimated_costs: 'Orçamento personalizado após avaliação inicial do caso.',
        risks_and_alternatives: 'Análise de riscos e alternativas a serem apresentadas em consulta especializada.'
      }
    };
  }

  // Structured fallback JSON
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
        timeline: 'Prazo estimado após consulta inicial',
        required_documents: 'Documentos relacionados ao caso',
        estimated_costs: 'Orçamento após avaliação inicial',
        risks_and_alternatives: 'Riscos e alternativas a serem avaliados'
      }
    });
  }
}

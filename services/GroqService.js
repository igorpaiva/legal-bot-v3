import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

export class GroqService {
  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
    
    this.systemPrompt = `Você é um assistente virtual de um escritório de advocacia brasileiro especializado em triagem jurídica. Suas características:

PERSONALIDADE:
- Profissional, mas acessível e empático
- Fala em português brasileiro natural
- Usa linguagem simples, sem juridiquês
- Demonstra compreensão e acolhimento

FUNÇÃO PRINCIPAL:
- Realizar triagem inicial de casos jurídicos
- Coletar informações básicas dos clientes
- Classificar urgência e área do direito
- Orientar sobre documentos necessários

ÁREAS DE ATUAÇÃO:
- Direito Trabalhista
- Direito de Família  
- Direito Civil
- Direito Criminal
- Direito do Consumidor

INSTRUÇÕES:
1. Seja sempre empático com situações difíceis
2. Explique procedimentos de forma simples
3. Não dê conselhos jurídicos específicos
4. Sempre reforce que um advogado dará orientação detalhada
5. Use emojis moderadamente para ser mais humano
6. Mantenha respostas concisas (máximo 3 frases)
7. Se não souber algo, seja honesto e encaminhe para o advogado

TOME CUIDADO:
- Nunca prometa resultados de processos
- Não critique outros advogados
- Não comente sobre valores de honorários
- Sempre oriente a procurar um advogado para casos urgentes

LEMBRE-SE: Você está ajudando pessoas em momentos difíceis. Seja humano, compreensivo e profissional.`;
  }

  async generateResponse(userMessage, context = {}) {
    try {
      if (!this.groq || !process.env.GROQ_API_KEY) {
        return 'Desculpe, estou com dificuldades técnicas no momento. Um advogado entrará em contato em breve. 📞';
      }

      const contextInfo = this.buildContextString(context);
      
      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: this.systemPrompt + contextInfo
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        model: 'openai/gpt-oss-120b', // Fast and efficient model
        temperature: 0.7,
        max_tokens: 200, // Slightly more for legal explanations
        top_p: 0.9,
        stream: false
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response) {
        throw new Error('No response generated from Groq');
      }

      return response.trim();
      
    } catch (error) {
      console.error('Groq API error:', error);
      
      // Return fallback responses in Portuguese based on error type
      if (error.message.includes('API key')) {
        return 'Olá! Estou com problemas técnicos temporários. Nossa equipe já foi notificada e um advogado entrará em contato em breve. 📱';
      }
      
      if (error.message.includes('rate limit')) {
        return 'Estou recebendo muitas mensagens agora. Aguarde um momento e tente novamente, por favor. ⏳';
      }
      
      // Generic fallback in Portuguese
      return 'Desculpe, não consegui processar sua mensagem. Pode reformular? Um advogado também pode te atender diretamente. 💼';
    }
  }

  async generateResponse(userMessage, context = {}) {
    try {
      if (!this.groq || !process.env.GROQ_API_KEY) {
        throw new Error('Groq API not configured');
      }

      const contextInfo = this.buildContextString(context);
      
      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: this.systemPrompt + contextInfo
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        model: 'openai/gpt-oss-120b', // Fast and efficient model
        temperature: 0.7,
        max_tokens: 150, // Keep responses concise for WhatsApp
        top_p: 0.9,
        stream: false
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response) {
        throw new Error('No response generated from Groq');
      }

      return response.trim();
      
    } catch (error) {
      console.error('Groq API error:', error);
      
      // Return fallback responses based on error type
      if (error.message.includes('API key')) {
        return 'Hi! I\'m currently having some technical difficulties. Please try again in a few minutes.';
      }
      
      if (error.message.includes('rate limit')) {
        return 'I\'m getting a lot of messages right now. Could you please wait a moment and try again?';
      }
      
      // Generic fallback
      return 'Sorry, I didn\'t quite catch that. Could you please rephrase your message?';
    }
  }

  buildContextString(context) {
    let contextStr = '\n\nContext:';
    
    if (context.contactName) {
      contextStr += `\n- User's name: ${context.contactName}`;
    }
    
    if (context.isGroup) {
      contextStr += `\n- This is a group chat`;
      if (context.chatName) {
        contextStr += ` called "${context.chatName}"`;
      }
    } else {
      contextStr += `\n- This is a private conversation`;
    }
    
    return contextStr;
  }

  async testConnection() {
    try {
      const response = await this.generateResponse('Hello, this is a test message.');
      return { success: true, response };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Método específico para análise de triagem jurídica (maior limite de tokens)
  async generateAnalysisResponse(prompt) {
    try {
      if (!this.groq || !process.env.GROQ_API_KEY) {
        throw new Error('Groq service not available');
      }

      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.3, // Mais determinístico para análise estruturada
        max_tokens: 8192, // Maior limite para análises completas
        top_p: 0.9,
        stream: false
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response) {
        throw new Error('No response generated from Groq');
      }

      return response.trim();
      
    } catch (error) {
      console.error('Groq Analysis API error:', error);
      throw error;
    }
  }
}

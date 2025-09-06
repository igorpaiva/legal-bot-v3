import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

export class GroqService {
  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
    
    this.systemPrompt = `Você é um assistente virtual de um escritório de advocacia brasileiro especializado em triagem jurídica.

IDIOMA: SEMPRE responda em português brasileiro. NUNCA use inglês.

PERSONALIDADE:
- Profissional e empático
- Fala em português brasileiro natural e conciso
- Usa linguagem simples, sem juridiquês
- Não use emojis

FUNÇÃO:
- Realizar triagem inicial de casos jurídicos
- Coletar informações básicas dos clientes
- Orientar sobre próximos passos

INSTRUÇÕES:
1. Seja empático com situações difíceis
2. Responda de forma completa mas objetiva
3. Não repita o que o cliente disse - apenas responda
4. Não dê conselhos jurídicos específicos
5. Use "entendi" ou "compreendo" em vez de repetir situações
6. Vá direto ao ponto
7. SEMPRE responda em português brasileiro
8. Para casos complexos, faça quantas perguntas forem necessárias

IMPORTANTE: Seja objetivo, profissional e humano, mas sem repetições desnecessárias. NUNCA responda em inglês.`;
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
        max_tokens: 800, // Increased to prevent message truncation for longer responses
        top_p: 0.9,
        stream: false
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response || response.trim() === '') {
        console.warn('Empty response from Groq, using fallback');
        throw new Error('No response generated from Groq');
      }

      return response.trim();
      
    } catch (error) {
      console.error('Groq API error:', error);
      
      // Return fallback responses based on error type
      if (error.message.includes('API key')) {
        return 'Olá! Estou com problemas técnicos temporários. Tente novamente em alguns minutos.';
      }
      
      if (error.message.includes('rate limit')) {
        return 'Estou recebendo muitas mensagens agora. Aguarde um momento e tente novamente, por favor.';
      }
      
      // Generic fallback
      return 'Desculpe, não consegui processar sua mensagem. Pode reformular?';
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
        model: 'openai/gpt-oss-120b', // Use the same model for consistency
        temperature: 0.3, // Mais determinístico para análise estruturada
        max_tokens: 8192, // Maior limite para análises completas
        top_p: 0.9,
        stream: false
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response || response.trim() === '') {
        console.warn('Empty analysis response from Groq');
        throw new Error('No response generated from Groq');
      }

      return response.trim();
      
    } catch (error) {
      console.error('Groq Analysis API error:', error);
      throw error;
    }
  }
}

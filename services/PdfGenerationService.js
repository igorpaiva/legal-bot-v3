import puppeteer from 'puppeteer';
import { marked } from 'marked';

class PdfGenerationService {
  constructor() {
    this.browser = null;
  }

  async initialize() {
    try {
      // Check if browser exists and is connected
      if (this.browser && this.browser.isConnected()) {
        return;
      }
      
      // Close any existing browser instance
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (error) {
          console.log('Error closing existing browser:', error.message);
        }
      }
      
      // Create new browser instance
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
      
      console.log('Puppeteer browser initialized successfully');
    } catch (error) {
      console.error('Error initializing Puppeteer browser:', error);
      throw error;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  markdownToPlainText(markdown) {
    if (!markdown) return '';
    
    // Convert markdown to plain text and escape HTML
    const plainText = markdown
      .replace(/#{1,6}\s+/g, '') // Remove headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/`(.*?)`/g, '$1') // Remove code
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links
      .replace(/^\s*[-*+]\s+/gm, '• ') // Convert list items
      .replace(/^\s*\d+\.\s+/gm, '• ') // Convert numbered lists
      .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
      .trim();
    
    return this.escapeHtml(plainText);
  }

  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  generateConversationHtml(conversation) {
    const client = conversation.client;
    const analysis = conversation.triageAnalysis;
    const preAnalysis = conversation.preAnalysis;

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page {
          margin: 2cm;
          size: A4;
        }
        
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        
        .header {
          text-align: center;
          border-bottom: 2px solid #25d366;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        
        .header h1 {
          color: #25d366;
          margin: 0;
          font-size: 24px;
        }
        
        .header .subtitle {
          color: #666;
          font-size: 14px;
          margin-top: 5px;
        }
        
        .section {
          margin-bottom: 25px;
          page-break-inside: avoid;
        }
        
        .section h2 {
          color: #25d366;
          border-bottom: 1px solid #eee;
          padding-bottom: 8px;
          margin-bottom: 15px;
          font-size: 18px;
        }
        
        .section h3 {
          color: #333;
          margin-bottom: 10px;
          font-size: 14px;
          font-weight: bold;
        }
        
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin-bottom: 20px;
        }
        
        .info-item {
          background: #f9f9f9;
          padding: 10px;
          border-radius: 5px;
        }
        
        .info-item strong {
          color: #25d366;
        }
        
        .content-block {
          background: #f9f9f9;
          padding: 15px;
          border-radius: 5px;
          margin-bottom: 15px;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        
        .urgency-alta {
          background: #ffebee;
          border-left: 4px solid #f44336;
        }
        
        .urgency-media {
          background: #fff3e0;
          border-left: 4px solid #ff9800;
        }
        
        .urgency-baixa {
          background: #e8f5e8;
          border-left: 4px solid #4caf50;
        }
        
        .footer {
          position: fixed;
          bottom: 1cm;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 10px;
          color: #666;
          border-top: 1px solid #eee;
          padding-top: 10px;
        }
        
        .page-break {
          page-break-before: always;
        }
        
        ul {
          margin: 10px 0;
          padding-left: 20px;
        }
        
        li {
          margin-bottom: 5px;
        }
        
        .text-content {
          white-space: pre-wrap;
          word-wrap: break-word;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>RELATÓRIO DE TRIAGEM JURÍDICA</h1>
        <div class="subtitle">BriseWare - Sistema de Triagem Jurídica</div>
      </div>

      <!-- Client Information -->
      <div class="section">
        <h2>👤 DADOS DO CLIENTE</h2>
        <div class="info-grid">
          <div class="info-item">
            <strong>Nome:</strong> ${this.escapeHtml(client.name) || 'N/A'}
          </div>
          <div class="info-item">
            <strong>WhatsApp:</strong> ${this.escapeHtml(client.phone)}
          </div>
          <div class="info-item">
            <strong>Email:</strong> ${this.escapeHtml(client.email) || 'N/A'}
          </div>
          <div class="info-item">
            <strong>Data da Conversa:</strong> ${new Date(conversation.startedAt || conversation.startTime).toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      ${analysis ? `
      <!-- Case Details -->
      <div class="section">
        <h2>📋 DETALHES DO CASO</h2>
        <div class="info-grid">
          ${analysis.case?.category ? `
          <div class="info-item">
            <strong>Categoria:</strong> ${this.escapeHtml(analysis.case.category)}
          </div>
          ` : ''}
          ${analysis.case?.urgency ? `
          <div class="info-item urgency-${analysis.case.urgency}">
            <strong>Urgência:</strong> ${this.escapeHtml(analysis.case.urgency.toUpperCase())}
          </div>
          ` : ''}
          ${analysis.case?.date ? `
          <div class="info-item">
            <strong>Data do Caso:</strong> ${this.escapeHtml(analysis.case.date)}
          </div>
          ` : ''}
          ${analysis.triage?.confidence ? `
          <div class="info-item">
            <strong>Confiança da Análise:</strong> ${(analysis.triage.confidence * 100).toFixed(1)}%
          </div>
          ` : ''}
        </div>
        
        ${analysis.case?.description ? `
        <h3>Descrição do Caso:</h3>
        <div class="content-block">
          <div class="text-content">${this.escapeHtml(analysis.case.description)}</div>
        </div>
        ` : ''}
        
        ${analysis.case?.documents && analysis.case.documents.length > 0 ? `
        <h3>Documentos Mencionados:</h3>
        <div class="content-block">
          <ul>
            ${analysis.case.documents.map(doc => `<li>${this.escapeHtml(doc)}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </div>

      ${analysis.legal_solution ? `
      <!-- Legal Solution -->
      <div class="section">
        <h2>⚖️ ANÁLISE JURÍDICA</h2>
        
        ${analysis.legal_solution.summary ? `
        <h3>Resumo Legal:</h3>
        <div class="content-block">
          <div class="text-content">${this.escapeHtml(analysis.legal_solution.summary)}</div>
        </div>
        ` : ''}
        
        ${analysis.legal_solution.legal_basis ? `
        <h3>Base Legal:</h3>
        <div class="content-block">
          <div class="text-content">${this.escapeHtml(analysis.legal_solution.legal_basis)}</div>
        </div>
        ` : ''}
        
        ${analysis.legal_solution.success_probability ? `
        <h3>Probabilidade de Sucesso:</h3>
        <div class="content-block">
          <div class="text-content">${this.escapeHtml(analysis.legal_solution.success_probability)}</div>
        </div>
        ` : ''}
        
        ${analysis.legal_solution.recommended_actions ? `
        <h3>Ações Recomendadas:</h3>
        <div class="content-block">
          <div class="text-content">${this.escapeHtml(analysis.legal_solution.recommended_actions)}</div>
        </div>
        ` : ''}
        
        ${analysis.legal_solution.timeline ? `
        <h3>Cronograma:</h3>
        <div class="content-block">
          <div class="text-content">${this.escapeHtml(analysis.legal_solution.timeline)}</div>
        </div>
        ` : ''}
        
        ${analysis.legal_solution.estimated_costs ? `
        <h3>Custos Estimados:</h3>
        <div class="content-block">
          <div class="text-content">${this.escapeHtml(analysis.legal_solution.estimated_costs)}</div>
        </div>
        ` : ''}
        
        ${analysis.legal_solution.required_documents ? `
        <h3>Documentos Necessários:</h3>
        <div class="content-block">
          <div class="text-content">${analysis.legal_solution.required_documents}</div>
        </div>
        ` : ''}
        
        ${analysis.legal_solution.risks_and_alternatives ? `
        <h3>Riscos e Alternativas:</h3>
        <div class="content-block">
          <div class="text-content">${analysis.legal_solution.risks_and_alternatives}</div>
        </div>
        ` : ''}
      </div>
      ` : ''}
      ` : ''}

      ${preAnalysis ? `
      <!-- Pre-Analysis -->
      <div class="section">
        <h2>🔍 PRÉ-ANÁLISE JURÍDICA</h2>
        <div class="content-block">
          <div class="text-content">${this.markdownToPlainText(preAnalysis)}</div>
        </div>
      </div>
      ` : ''}

      ${analysis?.triage ? `
      <!-- Triage Information -->
      <div class="section">
        <h2>🎯 INFORMAÇÕES DE TRIAGEM</h2>
        <div class="info-grid">
          <div class="info-item">
            <strong>Escalação Necessária:</strong> ${analysis.triage.escalate ? 'Sim' : 'Não'}
          </div>
          ${analysis.triage.recommended_action ? `
          <div class="info-item">
            <strong>Ação Recomendada:</strong> ${this.escapeHtml(analysis.triage.recommended_action)}
          </div>
          ` : ''}
        </div>
        
        ${analysis.triage.flags && analysis.triage.flags.length > 0 ? `
        <h3>Flags:</h3>
        <div class="content-block">
          <ul>
            ${analysis.triage.flags.map(flag => `<li>${this.escapeHtml(flag)}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </div>
      ` : ''}

      <div class="footer">
        Gerado em: ${new Date().toLocaleString('pt-BR')} | BriseWare - Sistema de Triagem Jurídica
      </div>
    </body>
    </html>
    `;
  }

  generateSummaryHtml(conversations) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page {
          margin: 2cm;
          size: A4;
        }
        
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        
        .header {
          text-align: center;
          border-bottom: 2px solid #25d366;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        
        .header h1 {
          color: #25d366;
          margin: 0;
          font-size: 24px;
        }
        
        .section {
          margin-bottom: 25px;
        }
        
        .section h2 {
          color: #25d366;
          border-bottom: 1px solid #eee;
          padding-bottom: 8px;
          margin-bottom: 15px;
          font-size: 18px;
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 15px;
          margin-bottom: 30px;
        }
        
        .stat-item {
          background: #f9f9f9;
          padding: 20px;
          border-radius: 5px;
          text-align: center;
          border-left: 4px solid #25d366;
        }
        
        .stat-number {
          font-size: 24px;
          font-weight: bold;
          color: #25d366;
        }
        
        .stat-label {
          font-size: 12px;
          color: #666;
          margin-top: 5px;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        
        th, td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
          font-size: 10px;
        }
        
        th {
          background-color: #25d366;
          color: white;
          font-weight: bold;
        }
        
        tr:nth-child(even) {
          background-color: #f9f9f9;
        }
        
        .urgency-alta {
          background: #ffebee !important;
        }
        
        .urgency-media {
          background: #fff3e0 !important;
        }
        
        .urgency-baixa {
          background: #e8f5e8 !important;
        }
        
        .footer {
          position: fixed;
          bottom: 1cm;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 10px;
          color: #666;
          border-top: 1px solid #eee;
          padding-top: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>RELATÓRIO GERAL DE CONVERSAS</h1>
        <div class="subtitle">BriseWare - Sistema de Triagem Jurídica</div>
      </div>

      <div class="section">
        <h2>📊 ESTATÍSTICAS GERAIS</h2>
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-number">${conversations.length}</div>
            <div class="stat-label">Total de Conversas</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">${conversations.filter(c => c.urgency === 'alta').length}</div>
            <div class="stat-label">Urgência Alta</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">${conversations.filter(c => c.state !== 'COMPLETED').length}</div>
            <div class="stat-label">Em Andamento</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">${conversations.filter(c => c.state === 'COMPLETED').length}</div>
            <div class="stat-label">Concluídas</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>📋 LISTA DETALHADA DE CONVERSAS</h2>
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>WhatsApp</th>
              <th>Categoria</th>
              <th>Urgência</th>
              <th>Estado</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            ${conversations.map(conv => `
            <tr class="urgency-${conv.triageAnalysis?.case?.urgency || 'baixa'}">
              <td>${conv.client.name || 'N/A'}</td>
              <td>${conv.client.phone}</td>
              <td>${conv.triageAnalysis?.case?.category || 'N/A'}</td>
              <td>${conv.triageAnalysis?.case?.urgency || 'N/A'}</td>
              <td>${this.getStateLabel(conv.state)}</td>
              <td>${new Date(conv.startTime || conv.startedAt).toLocaleDateString('pt-BR')}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="footer">
        Gerado em: ${new Date().toLocaleString('pt-BR')} | BriseWare - Sistema de Triagem Jurídica
      </div>
    </body>
    </html>
    `;
  }

  getStateLabel(state) {
    const stateLabels = {
      'GREETING': 'Saudação',
      'COLLECTING_NAME': 'Coletando Nome',
      'COLLECTING_EMAIL': 'Coletando Email',
      'ANALYZING_CASE': 'Analisando Caso',
      'COLLECTING_DETAILS': 'Coletando Detalhes',
      'COLLECTING_DOCUMENTS': 'Coletando Documentos',
      'AWAITING_PREANALYSIS_DECISION': 'Aguardando Decisão Pré-Análise',
      'GENERATING_PREANALYSIS': 'Gerando Pré-Análise',
      'AWAITING_LAWYER': 'Aguardando Advogado',
      'COMPLETED': 'Concluído'
    };
    return stateLabels[state] || state;
  }

  async generateConversationPdf(conversation) {
    let page = null;
    let retries = 2;
    
    while (retries > 0) {
      try {
        await this.initialize();
        
        page = await this.browser.newPage();
        const html = this.generateConversationHtml(conversation);
        
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        const pdf = await page.pdf({
          format: 'A4',
          margin: {
            top: '2cm',
            right: '2cm',
            bottom: '2cm',
            left: '2cm'
          },
          printBackground: true
        });
        
        await page.close();
        return pdf;
        
      } catch (error) {
        console.error(`Error generating conversation PDF (attempt ${3 - retries}):`, error.message);
        
        // Clean up page if it exists
        if (page) {
          try {
            await page.close();
          } catch (closeError) {
            console.log('Error closing page:', closeError.message);
          }
        }
        
        // Force browser reconnection on connection errors
        if (error.message.includes('Connection closed') || error.message.includes('Target closed')) {
          this.browser = null;
        }
        
        retries--;
        if (retries === 0) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async generateSummaryPdf(conversations) {
    let page = null;
    let retries = 2;
    
    while (retries > 0) {
      try {
        await this.initialize();
        
        page = await this.browser.newPage();
        const html = this.generateSummaryHtml(conversations);
        
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        const pdf = await page.pdf({
          format: 'A4',
          margin: {
            top: '2cm',
            right: '2cm',
            bottom: '2cm',
            left: '2cm'
          },
          printBackground: true
        });
        
        await page.close();
        return pdf;
        
      } catch (error) {
        console.error(`Error generating summary PDF (attempt ${3 - retries}):`, error.message);
        
        // Clean up page if it exists
        if (page) {
          try {
            await page.close();
          } catch (closeError) {
            console.log('Error closing page:', closeError.message);
          }
        }
        
        // Force browser reconnection on connection errors
        if (error.message.includes('Connection closed') || error.message.includes('Target closed')) {
          this.browser = null;
        }
        
        retries--;
        if (retries === 0) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

export default new PdfGenerationService();

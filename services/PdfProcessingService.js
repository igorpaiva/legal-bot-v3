import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import PDFParser from 'pdf2json';

dotenv.config();

export class PdfProcessingService {
  constructor() {
    // We'll use pdf-parse for text extraction - it's free and works well
    this.maxFileSizeMB = 10; // Reasonable limit for WhatsApp PDFs
    this.maxTextLength = 50000; // Limit extracted text to prevent overwhelming the LLM
  }

  /**
   * Process PDF from WhatsApp media object or file path
   * NOTE: Text extraction disabled - PDFs are accepted but content is not read
   * @param {Object|string} mediaInput - WhatsApp media object or PDF file path
   * @returns {Promise<string>} - Acknowledgment message
   */
  async processPdf(mediaInput) {
    let tempFilePath = null;
    
    try {
      let pdfFilePath;
      
      // Handle WhatsApp media object
      if (typeof mediaInput === 'object' && mediaInput.data) {
        console.log(`Processing PDF from WhatsApp media object - mimetype: ${mediaInput.mimetype} (content reading disabled)`);
        
        // Validate it's a PDF
        if (!this.isPdfMimetype(mediaInput.mimetype)) {
          throw new Error(`Invalid file type: ${mediaInput.mimetype}. Only PDF files are supported.`);
        }
        
        // Create temporary file from media data
        tempFilePath = path.join(process.cwd(), 'temp', `pdf_${Date.now()}.pdf`);
        
        // Ensure temp directory exists
        const tempDir = path.dirname(tempFilePath);
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Write media data to temporary file
        const pdfBuffer = Buffer.from(mediaInput.data, 'base64');
        fs.writeFileSync(tempFilePath, pdfBuffer);
        pdfFilePath = tempFilePath;
        
        console.log(`Created temporary PDF file: ${pdfFilePath} (${pdfBuffer.length} bytes) - content reading disabled`);
      } else if (typeof mediaInput === 'string') {
        // Handle file path
        pdfFilePath = mediaInput;
        console.log(`Processing PDF file: ${pdfFilePath} (content reading disabled)`);
      } else {
        throw new Error('Invalid input: expected WhatsApp media object or file path');
      }
      
      // Check if file exists
      if (!fs.existsSync(pdfFilePath)) {
        throw new Error(`PDF file not found: ${pdfFilePath}`);
      }

      // Get file size
      const stats = fs.statSync(pdfFilePath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      
      console.log(`PDF file info - Size: ${fileSizeInMB.toFixed(2)}MB, Path: ${pdfFilePath} - content reading disabled`);
      
      if (fileSizeInMB > this.maxFileSizeMB) {
        throw new Error(`PDF file too large: ${fileSizeInMB.toFixed(2)}MB (max ${this.maxFileSizeMB}MB)`);
      }

      // TEXT EXTRACTION DISABLED - Just acknowledge receipt
      console.log(`PDF file received and stored - content reading disabled`);
      
      return 'DOCUMENTO PDF RECEBIDO - processamento de conteúdo desabilitado';

    } catch (error) {
      console.error('Error processing PDF:', error);
      
      // Return fallback message based on error type
      if (error.message.includes('too large')) {
        return `Desculpe, o PDF é muito grande (máximo ${this.maxFileSizeMB}MB). Pode enviar um arquivo menor ou me contar sobre o conteúdo por texto/áudio?`;
      } else if (error.message.includes('Invalid file type')) {
        return 'Desculpe, apenas arquivos PDF são suportados. Pode enviar um PDF ou me contar sobre o documento por texto/áudio?';
      } else {
        return 'Desculpe, não consegui processar o PDF. Pode tentar enviar novamente ou me contar sobre o conteúdo por texto/áudio?';
      }
    } finally {
      // Clean up temporary file if it was created
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          // Small delay to ensure processing is complete
          setTimeout(async () => {
            try {
              await this.cleanupPdfFile(tempFilePath);
            } catch (cleanupError) {
              console.error('Error during PDF cleanup:', cleanupError);
            }
          }, 500);
        } catch (cleanupError) {
          console.error('Error scheduling PDF cleanup:', cleanupError);
        }
      }
    }
  }

  /**
   * Extract text from PDF file using pdf2json
   * NOTE: FUNCTION DISABLED - Text extraction not performed
   * @param {string} pdfFilePath - Path to PDF file
   * @returns {Promise<string>} - Extracted text
   */
  async extractTextFromPdf(pdfFilePath) {
    // TEXT EXTRACTION DISABLED
    console.log(`[DISABLED] extractTextFromPdf called for: ${pdfFilePath} - function disabled`);
    return 'EXTRAÇÃO DE TEXTO DESABILITADA';
    
    /* DISABLED CODE - Text extraction functionality
    try {
      return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        
        // Set up event handlers
        pdfParser.on('pdfParser_dataError', (errData) => {
          console.error('PDF Parser Error:', errData);
          reject(new Error(`Failed to parse PDF: ${errData.parserError || 'Unknown error'}`));
        });
        
        pdfParser.on('pdfParser_dataReady', (pdfData) => {
          try {
            // Extract text from all pages
            let fullText = '';
            
            if (pdfData.Pages && pdfData.Pages.length > 0) {
              for (const page of pdfData.Pages) {
                if (page.Texts && page.Texts.length > 0) {
                  for (const textItem of page.Texts) {
                    if (textItem.R && textItem.R.length > 0) {
                      for (const textRun of textItem.R) {
                        if (textRun.T) {
                          // Decode URI-encoded text
                          const decodedText = decodeURIComponent(textRun.T);
                          fullText += decodedText + ' ';
                        }
                      }
                    }
                  }
                  fullText += '\n'; // Add line break after each page
                }
              }
            }
            
            const cleanText = fullText.trim();
            
            if (!cleanText || cleanText.length === 0) {
              reject(new Error('No text found in PDF or PDF might be image-based'));
              return;
            }
            
            console.log(`Extracted ${cleanText.length} characters from PDF`);
            resolve(cleanText);
          } catch (parseError) {
            reject(new Error(`Error processing PDF data: ${parseError.message}`));
          }
        });
        
        // Add timeout
        const timeout = setTimeout(() => {
          reject(new Error('PDF parsing timeout after 30 seconds'));
        }, 30000);
        
        // Clean up timeout when done
        pdfParser.on('pdfParser_dataReady', () => clearTimeout(timeout));
        pdfParser.on('pdfParser_dataError', () => clearTimeout(timeout));
        
        // Load and parse the PDF
        pdfParser.loadPDF(pdfFilePath);
      });
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
    */
  }

  /**
   * Check if MIME type is PDF
   * @param {string} mimetype - MIME type to check
   * @returns {boolean} - Whether it's a PDF MIME type
   */
  isPdfMimetype(mimetype) {
    const pdfMimeTypes = [
      'application/pdf',
      'application/x-pdf',
      'application/acrobat',
      'application/vnd.pdf'
    ];
    
    return pdfMimeTypes.includes(mimetype.toLowerCase());
  }

  /**
   * Get PDF file info
   * @param {string} pdfFilePath - Path to PDF file
   * @returns {Object} - File info including size, pages, etc.
   */
  async getPdfInfo(pdfFilePath) {
    try {
      const stats = fs.statSync(pdfFilePath);
      
      // Try to get additional PDF info
      let pages = null;
      try {
        // Use pdf2json to get page count
        const pdfInfo = await new Promise((resolve, reject) => {
          const pdfParser = new PDFParser();
          
          pdfParser.on('pdfParser_dataError', (errData) => {
            reject(new Error(errData.parserError || 'Unknown error'));
          });
          
          pdfParser.on('pdfParser_dataReady', (pdfData) => {
            resolve(pdfData);
          });
          
          pdfParser.loadPDF(pdfFilePath);
        });
        
        if (pdfInfo && pdfInfo.Pages) {
          pages = pdfInfo.Pages.length;
        }
      } catch (error) {
        console.warn('Could not extract PDF page count:', error.message);
      }
      
      return {
        size: stats.size,
        sizeInMB: (stats.size / (1024 * 1024)).toFixed(2),
        pages: pages,
        path: pdfFilePath,
        supported: true
      };
    } catch (error) {
      console.error('Error getting PDF info:', error);
      return null;
    }
  }

  /**
   * Clean up temporary PDF files
   * @param {string} pdfFilePath - Path to file to delete
   */
  async cleanupPdfFile(pdfFilePath) {
    try {
      if (fs.existsSync(pdfFilePath)) {
        await fs.promises.unlink(pdfFilePath);
        console.log(`Cleaned up PDF file: ${pdfFilePath}`);
      }
    } catch (error) {
      console.error('Error cleaning up PDF file:', error);
    }
  }

  /**
   * Format extracted PDF text for legal context
   * NOTE: FUNCTION DISABLED - Text extraction disabled
   * @param {string} text - Raw extracted text
   * @returns {string} - Formatted text with context
   */
  formatPdfTextForLegal(text) {
    // TEXT FORMATTING DISABLED since text extraction is disabled
    console.log(`[DISABLED] formatPdfTextForLegal called - function disabled`);
    return '[DOCUMENTO PDF ANEXADO - leitura de conteúdo desabilitada]';
    
    /* DISABLED CODE - Text formatting functionality
    if (!text || text.trim().length === 0) {
      return '';
    }
    
    const formattedText = `DOCUMENTO PDF ANEXADO:

${text.trim()}

---
FIM DO DOCUMENTO

Com base neste documento, `;
    
    return formattedText;
    */
  }
}

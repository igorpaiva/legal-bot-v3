import { Groq } from 'groq-sdk';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export class AudioTranscriptionService {
  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
  }

  /**
   * Transcribe audio from WhatsApp media object or file path using Groq's Whisper model (FREE)
   * @param {Object|string} mediaInput - WhatsApp media object or audio file path
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribeAudio(mediaInput) {
    let tempFilePath = null;
    
    try {
      let audioFilePath;
      
      // Handle Buffer (from Baileys downloadMediaMessage)
      if (Buffer.isBuffer(mediaInput)) {
        console.log(`Transcribing audio from Buffer - size: ${mediaInput.length} bytes`);
        
        // Create temporary file from buffer data
        const audioExtension = 'ogg'; // Default to ogg for WhatsApp audio
        tempFilePath = path.join(process.cwd(), 'temp', `audio_${Date.now()}.${audioExtension}`);
        
        // Ensure temp directory exists
        const tempDir = path.dirname(tempFilePath);
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Write buffer data to temporary file
        fs.writeFileSync(tempFilePath, mediaInput);
        audioFilePath = tempFilePath;
        
        console.log(`Created temporary audio file from buffer: ${audioFilePath} (${mediaInput.length} bytes)`);
      } else if (typeof mediaInput === 'object' && mediaInput.data) {
        console.log(`Transcribing audio from WhatsApp media object - mimetype: ${mediaInput.mimetype}`);
        
        // Create temporary file from media data
        const audioExtension = this.getExtensionFromMimetype(mediaInput.mimetype);
        tempFilePath = path.join(process.cwd(), 'temp', `audio_${Date.now()}.${audioExtension}`);
        
        // Ensure temp directory exists
        const tempDir = path.dirname(tempFilePath);
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Write media data to temporary file
        const audioBuffer = Buffer.from(mediaInput.data, 'base64');
        fs.writeFileSync(tempFilePath, audioBuffer);
        audioFilePath = tempFilePath;
        
        console.log(`Created temporary audio file: ${audioFilePath} (${audioBuffer.length} bytes)`);
      } else if (typeof mediaInput === 'string') {
        // Handle file path
        audioFilePath = mediaInput;
        console.log(`Transcribing audio file: ${audioFilePath}`);
      } else {
        throw new Error('Invalid input: expected Buffer, WhatsApp media object or file path');
      }
      
      // Check if file exists
      if (!fs.existsSync(audioFilePath)) {
        throw new Error(`Audio file not found: ${audioFilePath}`);
      }

      // Get file size (Groq has a 25MB limit)
      const stats = fs.statSync(audioFilePath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      
      console.log(`Audio file info - Size: ${fileSizeInMB.toFixed(2)}MB, Path: ${audioFilePath}`);
      
      if (fileSizeInMB > 25) {
        throw new Error(`Audio file too large: ${fileSizeInMB.toFixed(2)}MB (max 25MB)`);
      }
      
      // Validate that it's actually an audio file
      const extension = path.extname(audioFilePath).toLowerCase().slice(1);
      if (!this.getSupportedFormats().includes(extension)) {
        console.warn(`Potentially unsupported audio format: ${extension}`);
      }

      // Create file stream
      const audioFile = fs.createReadStream(audioFilePath);

      // Transcribe using Groq's Whisper model with enhanced parameters
      let transcription;
      try {
        transcription = await this.groq.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-large-v3', // Groq's free Whisper model
          language: 'pt', // Portuguese
          response_format: 'verbose_json', // Get more detailed response with timestamps
          temperature: 0.0 // Lower temperature for more accurate transcription
        });
        
        // Extract text from verbose response
        const transcribedText = transcription.text || transcription;
        
        console.log(`Transcription completed - Duration: ${transcription.duration || 'unknown'}s, Text length: ${transcribedText.length} chars`);
        console.log(`Full transcription: ${transcribedText}`);
        
        // Validate transcription completeness
        if (!this.isTranscriptionComplete(transcribedText)) {
          console.warn('Transcription may be incomplete, but proceeding...');
        }
        
        return transcribedText.trim();
        
      } catch (verboseError) {
        console.warn('Verbose JSON format failed, trying simple text format:', verboseError.message);
        
        // Fallback to simple text format
        transcription = await this.groq.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-large-v3',
          language: 'pt',
          response_format: 'text',
          temperature: 0.0
        });
        
        console.log(`Fallback transcription completed - Text length: ${transcription.length} chars`);
        console.log(`Full transcription: ${transcription}`);
        
        // Validate transcription completeness
        if (!this.isTranscriptionComplete(transcription)) {
          console.warn('Fallback transcription may be incomplete, but proceeding...');
        }
        
        return transcription.trim();
      }

    } catch (error) {
      console.error('Error transcribing audio:', error);
      
      // Return fallback message
      return 'Desculpe, não consegui processar o áudio. Pode enviar sua mensagem por texto, por favor?';
    } finally {
      // Clean up temporary file if it was created
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          await this.cleanupAudioFile(tempFilePath);
        } catch (cleanupError) {
          console.error('Error during audio cleanup:', cleanupError);
        }
      }
    }
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimetype - MIME type of the file
   * @returns {string} - File extension
   */
  getExtensionFromMimetype(mimetype) {
    const mimeToExt = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/x-wav': 'wav',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/opus': 'opus',
      'audio/flac': 'flac',
      'audio/aac': 'aac',
      'audio/amr': 'amr',
      'audio/3gpp': '3gp'
    };
    
    return mimeToExt[mimetype] || 'mp3'; // Default to mp3 if unknown
  }

  /**
   * Get supported audio formats
   * @returns {Array<string>} - List of supported formats
   */
  getSupportedFormats() {
    return [
      'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm',
      'ogg', 'oga', 'flac', 'aac', 'amr', 'opus'
    ];
  }

  /**
   * Check if audio format is supported
   * @param {string} filename - Name of the file
   * @returns {boolean} - Whether format is supported
   */
  isFormatSupported(filename) {
    const extension = path.extname(filename).toLowerCase().slice(1);
    return this.getSupportedFormats().includes(extension);
  }

  /**
   * Get audio file info
   * @param {string} audioFilePath - Path to audio file
   * @returns {Object} - File info including size, format, etc.
   */
  getAudioInfo(audioFilePath) {
    try {
      const stats = fs.statSync(audioFilePath);
      const extension = path.extname(audioFilePath).toLowerCase().slice(1);
      
      return {
        size: stats.size,
        sizeInMB: (stats.size / (1024 * 1024)).toFixed(2),
        format: extension,
        supported: this.isFormatSupported(audioFilePath),
        path: audioFilePath
      };
    } catch (error) {
      console.error('Error getting audio info:', error);
      return null;
    }
  }

  /**
   * Check if transcription appears to be truncated
   * @param {string} transcription - The transcribed text
   * @returns {boolean} - Whether the transcription seems complete
   */
  isTranscriptionComplete(transcription) {
    if (!transcription || transcription.length < 10) {
      return false;
    }
    
    // Check for common truncation indicators
    const truncationIndicators = [
      /\.\.\.$/, // ends with "..."
      /\w+$/, // ends abruptly without punctuation (but allow words)
      /\s+$/ // ends with just whitespace
    ];
    
    const text = transcription.trim();
    
    // If it ends with proper punctuation, it's likely complete
    if (/[.!?]$/.test(text)) {
      return true;
    }
    
    // If it's very short and doesn't end properly, might be truncated
    if (text.length < 50 && !/[.!?]$/.test(text)) {
      console.warn('Potentially truncated transcription (too short without proper ending)');
      return false;
    }
    
    return true; // Assume complete if no clear truncation signs
  }

  /**
   * Clean up temporary audio files
   * @param {string} audioFilePath - Path to file to delete
   */
  async cleanupAudioFile(audioFilePath) {
    try {
      if (fs.existsSync(audioFilePath)) {
        await fs.promises.unlink(audioFilePath);
        console.log(`Cleaned up audio file: ${audioFilePath}`);
      }
    } catch (error) {
      console.error('Error cleaning up audio file:', error);
    }
  }
}

import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import GoogleDriveService from './GoogleDriveService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Document Processing Service for WhatsApp documents
 * Handles downloading, processing, and uploading documents to Google Drive
 */
class DocumentProcessingService {
  constructor() {
    this.googleDriveService = new GoogleDriveService();
    this.downloadDir = path.join(process.cwd(), 'downloads');
    this.ensureDownloadDirectory();
  }

  /**
   * Ensure download directory exists
   */
  async ensureDownloadDirectory() {
    try {
      await fs.mkdir(this.downloadDir, { recursive: true });
    } catch (error) {
      console.error('Error creating download directory:', error);
    }
  }

  /**
   * Process WhatsApp document and upload to Google Drive
   * @param {Object} message - WhatsApp message object
   * @param {string} clientPhone - Client phone number
   * @param {string} clientName - Client name
   * @param {string} ownerId - Law office owner ID
   * @returns {Object} - Processing result
   */
  async processWhatsAppDocument(message, clientPhone, clientName, ownerId) {
    try {
      console.log(`[DOCUMENT] Processing document for client: ${clientName} (${clientPhone})`);

      // Initialize Google Drive for this office
      const driveInitialized = await this.googleDriveService.initializeForOffice(ownerId);
      if (!driveInitialized) {
        throw new Error('Google Drive not configured for this office');
      }

      // Download the document
      const downloadResult = await this.downloadWhatsAppMedia(message);
      if (!downloadResult.success) {
        throw new Error(`Failed to download document: ${downloadResult.error}`);
      }

      // Upload to Google Drive
      const uploadResult = await this.uploadToGoogleDrive(
        downloadResult.filePath,
        downloadResult.fileName,
        clientPhone,
        clientName,
        ownerId
      );

      // Clean up local file
      await this.cleanupLocalFile(downloadResult.filePath);

      return {
        success: true,
        driveFileId: uploadResult.fileId,
        driveFileUrl: uploadResult.webViewLink,
        fileName: downloadResult.fileName,
        fileSize: downloadResult.fileSize,
        mimeType: downloadResult.mimeType
      };

    } catch (error) {
      console.error('[DOCUMENT] Processing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Download WhatsApp media to local storage
   * @param {Object} message - WhatsApp message object
   * @returns {Object} - Download result
   */
  async downloadWhatsAppMedia(message) {
    try {
      if (!message.hasMedia) {
        throw new Error('Message does not contain media');
      }

      const media = await message.downloadMedia();
      if (!media) {
        throw new Error('Failed to download media');
      }

      // Generate unique filename
      const timestamp = Date.now();
      const extension = this.getFileExtension(media.mimetype);
      const fileName = `whatsapp_document_${timestamp}${extension}`;
      const filePath = path.join(this.downloadDir, fileName);

      // Save file to disk
      const buffer = Buffer.from(media.data, 'base64');
      await fs.writeFile(filePath, buffer);

      console.log(`[DOCUMENT] Downloaded: ${fileName} (${buffer.length} bytes)`);

      return {
        success: true,
        filePath: filePath,
        fileName: fileName,
        fileSize: buffer.length,
        mimeType: media.mimetype,
        buffer: buffer
      };

    } catch (error) {
      console.error('[DOCUMENT] Download error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Upload document to Google Drive
   * @param {string} filePath - Local file path
   * @param {string} fileName - File name
   * @param {string} clientPhone - Client phone
   * @param {string} clientName - Client name
   * @param {string} ownerId - Owner ID
   * @returns {Object} - Upload result
   */
  async uploadToGoogleDrive(filePath, fileName, clientPhone, clientName, ownerId) {
    try {
      // Create or get client folder
      const folderResult = await this.googleDriveService.createClientFolder(
        clientPhone,
        clientName,
        ownerId
      );

      if (!folderResult.success) {
        throw new Error(`Failed to create/get client folder: ${folderResult.error}`);
      }

      // Read file
      const fileBuffer = await fs.readFile(filePath);
      const stats = await fs.stat(filePath);

      // Upload to Google Drive
      const uploadResult = await this.googleDriveService.uploadClientDocuments(
        ownerId,
        clientPhone,
        clientName,
        [{
          name: fileName,
          buffer: fileBuffer,
          mimeType: this.getMimeTypeFromPath(filePath),
          size: stats.size
        }]
      );

      if (!uploadResult.success) {
        throw new Error(`Google Drive upload failed: ${uploadResult.error}`);
      }

      console.log(`[DOCUMENT] Uploaded to Google Drive: ${fileName}`);

      return {
        success: true,
        fileId: uploadResult.uploadedFiles[0]?.id,
        webViewLink: uploadResult.uploadedFiles[0]?.webViewLink,
        fileName: fileName
      };

    } catch (error) {
      console.error('[DOCUMENT] Upload error:', error);
      throw error;
    }
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} - File extension
   */
  getFileExtension(mimeType) {
    const extensions = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'text/plain': '.txt',
      'video/mp4': '.mp4',
      'audio/mpeg': '.mp3',
      'audio/ogg': '.ogg'
    };

    return extensions[mimeType] || '.bin';
  }

  /**
   * Get MIME type from file path
   * @param {string} filePath - File path
   * @returns {string} - MIME type
   */
  getMimeTypeFromPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.txt': 'text/plain',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Clean up local file
   * @param {string} filePath - File path to delete
   */
  async cleanupLocalFile(filePath) {
    try {
      await fs.unlink(filePath);
      console.log(`[DOCUMENT] Cleaned up local file: ${filePath}`);
    } catch (error) {
      console.error(`[DOCUMENT] Failed to cleanup file ${filePath}:`, error);
    }
  }

  /**
   * Process legal report and upload to Google Drive
   * @param {Object} reportData - Report data
   * @param {string} clientPhone - Client phone
   * @param {string} clientName - Client name
   * @param {string} ownerId - Owner ID
   * @returns {Object} - Processing result
   */
  async processLegalReport(reportData, clientPhone, clientName, ownerId) {
    try {
      console.log(`[REPORT] Processing legal report for client: ${clientName}`);

      // Initialize Google Drive for this office
      const driveInitialized = await this.googleDriveService.initializeForOffice(ownerId);
      if (!driveInitialized) {
        throw new Error('Google Drive not configured for this office');
      }

      // Upload report to Google Drive
      const uploadResult = await this.googleDriveService.uploadLegalReport(
        ownerId,
        clientPhone,
        clientName,
        reportData
      );

      if (!uploadResult.success) {
        throw new Error(`Report upload failed: ${uploadResult.error}`);
      }

      console.log(`[REPORT] Legal report uploaded successfully`);

      return {
        success: true,
        fileId: uploadResult.fileId,
        webViewLink: uploadResult.webViewLink,
        fileName: uploadResult.fileName
      };

    } catch (error) {
      console.error('[REPORT] Processing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if message contains document
   * @param {Object} message - WhatsApp message
   * @returns {boolean} - True if message has document
   */
  hasDocument(message) {
    return message.hasMedia && message.type !== 'sticker';
  }

  /**
   * Get document info from message
   * @param {Object} message - WhatsApp message
   * @returns {Object} - Document info
   */
  getDocumentInfo(message) {
    if (!this.hasDocument(message)) {
      return null;
    }

    return {
      type: message.type,
      hasMedia: message.hasMedia,
      timestamp: message.timestamp,
      from: message.from
    };
  }
}

export default DocumentProcessingService;

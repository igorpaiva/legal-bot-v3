import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

/**
 * Google Drive Service for document upload and management
 */
class GoogleDriveService {
  constructor(userId = null) {
    this.userId = userId; // User ID for isolated storage
    this.drive = null;
    this.auth = null;
    this.initialized = false;
    this.rootFolderId = null; // Main "Clientes Legal Bot" folder
    this.clientFolders = new Map(); // Cache for client folder IDs
  }

  /**
   * Initialize Google Drive service with OAuth2 credentials
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Load OAuth2 credentials from environment variables
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;

      if (!clientId || !clientSecret || !redirectUri) {
        throw new Error('Missing Google OAuth2 credentials in environment variables');
      }

      // Create OAuth2 client
      this.auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

      // Try to load saved tokens
      await this.loadTokens();

      // Initialize Drive API
      this.drive = google.drive({ version: 'v3', auth: this.auth });
      this.initialized = true;

      console.log('Google Drive service initialized successfully');
    } catch (error) {
      console.error('Error initializing Google Drive service:', error);
      throw error;
    }
  }

  /**
   * Load saved OAuth tokens for this user
   */
  async loadTokens() {
    try {
      const tokenPath = this.getTokenPath();
      const tokenData = await fs.readFile(tokenPath, 'utf8');
      const tokens = JSON.parse(tokenData);
      
      this.auth.setCredentials(tokens);
      console.log(`Google Drive tokens loaded successfully for user ${this.userId}`);
    } catch (error) {
      console.warn(`No saved Google Drive tokens found for user ${this.userId}:`, error.message);
      // Don't throw here - tokens might be set through other means
    }
  }

  /**
   * Get token file path for this user
   */
  getTokenPath() {
    if (!this.userId) {
      // Fallback to global tokens for backward compatibility
      return path.join(process.cwd(), 'config', 'google-tokens.json');
    }
    return path.join(process.cwd(), 'config', `google-tokens-${this.userId}.json`);
  }

  /**
   * Save OAuth tokens for this user
   */
  async saveTokens(tokens) {
    try {
      const tokenPath = this.getTokenPath();
      const configDir = path.dirname(tokenPath);
      
      // Ensure config directory exists
      await fs.mkdir(configDir, { recursive: true });
      
      await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2));
      console.log(`Google Drive tokens saved successfully for user ${this.userId}`);
    } catch (error) {
      console.error(`Error saving Google Drive tokens for user ${this.userId}:`, error);
    }
  }

  /**
   * Get authorization URL for OAuth flow
   */
  getAuthUrl() {
    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.readonly'
    ];

    return this.auth.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: this.userId || 'global' // Include user ID in state parameter
    });
  }

  /**
   * Set credentials from OAuth flow
   */
  async setCredentials(tokens) {
    if (this.auth) {
      this.auth.setCredentials(tokens);
      await this.saveTokens(tokens);
    }
  }

  /**
   * Upload file to Google Drive
   */
  async uploadFile(filePath, fileName, parentFolderId = null) {
    await this.initialize();

    if (!this.drive) {
      throw new Error('Google Drive service not initialized');
    }

    try {
      const fileMetadata = {
        name: fileName,
        parents: parentFolderId ? [parentFolderId] : undefined
      };

      const media = {
        body: await fs.readFile(filePath),
      };

      const response = await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id,name,webViewLink'
      });

      console.log(`File uploaded to Google Drive: ${response.data.name} (ID: ${response.data.id})`);
      
      return {
        id: response.data.id,
        name: response.data.name,
        webViewLink: response.data.webViewLink
      };
    } catch (error) {
      console.error('Error uploading file to Google Drive:', error);
      throw error;
    }
  }

  /**
   * Upload file from buffer (for WhatsApp media)
   */
  async uploadFileFromBuffer(buffer, fileName, mimeType, parentFolderId = null) {
    if (!this.initialized || !this.drive) {
      throw new Error('Google Drive service not initialized');
    }

    try {
      const fileMetadata = {
        name: fileName,
        parents: parentFolderId ? [parentFolderId] : undefined
      };

      const media = {
        mimeType: mimeType,
        body: Readable.from(buffer),
      };

      const response = await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id,name,webViewLink,mimeType,size'
      });

      console.log(`File uploaded to Google Drive: ${response.data.name} (ID: ${response.data.id})`);
      
      return {
        id: response.data.id,
        name: response.data.name,
        webViewLink: response.data.webViewLink,
        mimeType: response.data.mimeType,
        size: response.data.size
      };
    } catch (error) {
      console.error('Error uploading file buffer to Google Drive:', error);
      throw error;
    }
  }

  /**
   * Create or get the main "Clientes Legal Bot" folder
   */
  async ensureRootFolder() {
    if (this.rootFolderId) {
      return this.rootFolderId;
    }

    try {
      const folderName = 'Clientes Legal Bot';
      
      // Search for existing folder
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)'
      });

      if (response.data.files.length > 0) {
        this.rootFolderId = response.data.files[0].id;
        console.log(`Found existing root folder: ${folderName} (ID: ${this.rootFolderId})`);
        return this.rootFolderId;
      }

      // Create new folder
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      };

      const folderResponse = await this.drive.files.create({
        resource: folderMetadata,
        fields: 'id, name'
      });

      this.rootFolderId = folderResponse.data.id;
      console.log(`Created root folder: ${folderName} (ID: ${this.rootFolderId})`);
      
      return this.rootFolderId;
    } catch (error) {
      console.error('Error ensuring root folder:', error);
      throw error;
    }
  }

  /**
   * Create or get a client-specific folder
   */
  async ensureClientFolder(clientName, clientPhone) {
    const clientKey = `${clientName}_${clientPhone}`;
    
    // Check cache first
    if (this.clientFolders.has(clientKey)) {
      return this.clientFolders.get(clientKey);
    }

    try {
      // Ensure root folder exists
      const rootFolderId = await this.ensureRootFolder();

      // Clean client name for folder (remove special characters)
      const cleanClientName = clientName.replace(/[<>:"/\|?*]/g, '_');
      const folderName = `${cleanClientName} (${clientPhone})`;

      // Search for existing client folder
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${rootFolderId}' in parents and trashed=false`,
        fields: 'files(id, name)'
      });

      let clientFolderId;

      if (response.data.files.length > 0) {
        clientFolderId = response.data.files[0].id;
        console.log(`Found existing client folder: ${folderName} (ID: ${clientFolderId})`);
      } else {
        // Create new client folder
        const folderMetadata = {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [rootFolderId]
        };

        const folderResponse = await this.drive.files.create({
          resource: folderMetadata,
          fields: 'id, name'
        });

        clientFolderId = folderResponse.data.id;
        console.log(`Created client folder: ${folderName} (ID: ${clientFolderId})`);
      }

      // Cache the folder ID
      this.clientFolders.set(clientKey, clientFolderId);
      
      return clientFolderId;
    } catch (error) {
      console.error('Error ensuring client folder:', error);
      throw error;
    }
  }

  /**
   * Upload client document to their specific folder
   */
  async uploadClientDocument(clientName, clientPhone, buffer, fileName, mimeType) {
    try {
      // Get or create client folder
      const clientFolderId = await this.ensureClientFolder(clientName, clientPhone);

      // Add timestamp to filename to avoid conflicts
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const timestampedFileName = `${timestamp}_${fileName}`;

      // Upload file to client folder
      const uploadResult = await this.uploadFileFromBuffer(
        buffer, 
        timestampedFileName, 
        mimeType, 
        clientFolderId
      );

      console.log(`Document uploaded for client ${clientName}: ${uploadResult.name}`);
      
      return {
        ...uploadResult,
        clientFolder: clientFolderId,
        originalFileName: fileName,
        uploadedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error uploading client document:', error);
      throw error;
    }
  }

  /**
   * List files in a client folder
   */
  async listClientDocuments(clientName, clientPhone) {
    try {
      const clientFolderId = await this.ensureClientFolder(clientName, clientPhone);

      const response = await this.drive.files.list({
        q: `'${clientFolderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, size, createdTime, webViewLink)',
        orderBy: 'createdTime desc'
      });

      return response.data.files || [];
    } catch (error) {
      console.error('Error listing client documents:', error);
      throw error;
    }
  }

  /**
   * Get Google Drive storage info
   */
  async getStorageInfo() {
    try {
      const response = await this.drive.about.get({
        fields: 'storageQuota,user'
      });

      const quota = response.data.storageQuota;
      const user = response.data.user;

      return {
        user: {
          emailAddress: user.emailAddress,
          displayName: user.displayName
        },
        storage: {
          limit: parseInt(quota.limit),
          usage: parseInt(quota.usage),
          usageInDrive: parseInt(quota.usageInDrive),
          usageInDriveTrash: parseInt(quota.usageInDriveTrash)
        }
      };
    } catch (error) {
      console.error('Error getting storage info:', error);
      throw error;
    }
  }

  /**
   * Check if service is properly authenticated
   */
  async checkAuthentication() {
    try {
      await this.initialize();
      
      if (!this.drive) {
        return { authenticated: false, error: 'Drive service not initialized' };
      }

      // Try to make a simple API call to test authentication
      await this.drive.files.list({ pageSize: 1 });
      
      return { authenticated: true };
    } catch (error) {
      return { 
        authenticated: false, 
        error: error.message,
        needsAuth: error.message.includes('invalid_grant') || error.message.includes('unauthorized')
      };
    }
  }
}

export default GoogleDriveService;

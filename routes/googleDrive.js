import express from 'express';
import multer from 'multer';
import { google } from 'googleapis';
import GoogleDriveService from '../services/GoogleDriveService.js';

const router = express.Router();
const publicRouter = express.Router(); // For routes that don't need authentication

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * Get Google Drive authentication URL
 */
router.get('/auth-url', async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).json({
        success: false,
        error: 'Google OAuth credentials not configured'
      });
    }

    // Initialize service for this specific user
    const userGoogleDriveService = new GoogleDriveService(req.user.id);
    await userGoogleDriveService.initialize();
    const authUrl = userGoogleDriveService.getAuthUrl();

    res.json({
      success: true,
      authUrl: authUrl
    });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate authentication URL'
    });
  }
});

/**
 * Handle OAuth callback (matches the redirect URI in .env)
 */
publicRouter.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send(`
        <html>
          <body>
            <h1>Google Drive Authentication Error</h1>
            <p>No authorization code provided</p>
            <p><a href="/admin">Back to Admin Panel</a></p>
          </body>
        </html>
      `);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // Get user ID from state parameter
    const userId = state && state !== 'global' ? state : null;
    
    // Create user-specific Google Drive service and initialize it
    const userGoogleDriveService = new GoogleDriveService(userId);
    await userGoogleDriveService.initialize();
    await userGoogleDriveService.setCredentials(tokens);

    console.log(`Google Drive tokens saved successfully for user ${userId || 'global'}`);

    // Show success page
    res.send(`
      <html>
        <body>
          <h1>Google Drive Authentication Successful!</h1>
          <p>Your Google Drive has been connected successfully.</p>
          <p><a href="/admin">Back to Admin Panel</a></p>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send(`
      <html>
        <body>
          <h1>Google Drive Authentication Error</h1>
          <p>Error: ${error.message}</p>
          <p><a href="/admin">Back to Admin Panel</a></p>
        </body>
      </html>
    `);
  }
});

/**
 * Handle OAuth callback (legacy route for backward compatibility)
 */
publicRouter.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send(`
        <html>
          <body>
            <h1>Google Drive Authentication Error</h1>
            <p>No authorization code provided</p>
            <p><a href="/admin">Back to Admin Panel</a></p>
          </body>
        </html>
      `);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // Get user ID from state parameter
    const userId = state && state !== 'global' ? state : null;
    
    // Create user-specific Google Drive service and initialize it
    const userGoogleDriveService = new GoogleDriveService(userId);
    await userGoogleDriveService.initialize();
    await userGoogleDriveService.setCredentials(tokens);

    console.log(`Google Drive tokens saved successfully for user ${userId || 'global'}`);

    // Show success page
    res.send(`
      <html>
        <body>
          <h1>Google Drive Authentication Successful!</h1>
          <p>Your Google Drive has been connected successfully.</p>
          <p><a href="/admin">Back to Admin Panel</a></p>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send(`
      <html>
        <body>
          <h1>Google Drive Authentication Error</h1>
          <p>Error: ${error.message}</p>
          <p><a href="/admin">Back to Admin Panel</a></p>
        </body>
      </html>
    `);
  }
});

/**
 * Check authentication status
 */
router.get('/auth-status', async (req, res) => {
  try {
    console.log('[GoogleDrive] Auth status check - User:', req.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : 'No user');
    
    if (!req.user || !req.user.id) {
      console.log('[GoogleDrive] No authenticated user found');
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }
    
    const userGoogleDriveService = new GoogleDriveService(req.user.id);
    const status = await userGoogleDriveService.checkAuthentication();
    
    res.json({
      success: true,
      authenticated: status.authenticated,
      error: status.error,
      needsAuth: status.needsAuth
    });
  } catch (error) {
    console.error('Error checking auth status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check authentication status'
    });
  }
});

/**
 * Get Google Drive storage information
 */
router.get('/storage-info', async (req, res) => {
  try {
    const userGoogleDriveService = new GoogleDriveService(req.user.id);
    await userGoogleDriveService.initialize();
    const storageInfo = await userGoogleDriveService.getStorageInfo();
    
    res.json({
      success: true,
      data: storageInfo
    });
  } catch (error) {
    console.error('Error getting storage info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get storage information'
    });
  }
});

/**
 * Upload file to client folder
 */
router.post('/upload-client-document', upload.single('file'), async (req, res) => {
  try {
    const { clientName, clientPhone } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided'
      });
    }

    if (!clientName || !clientPhone) {
      return res.status(400).json({
        success: false,
        error: 'Client name and phone are required'
      });
    }

    const userGoogleDriveService = new GoogleDriveService(req.user.id);
    const result = await userGoogleDriveService.uploadClientDocument(
      clientName,
      clientPhone,
      file.buffer,
      file.originalname,
      file.mimetype
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error uploading client document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload document'
    });
  }
});

/**
 * List documents for a specific client
 */
router.get('/client-documents/:clientName/:clientPhone', async (req, res) => {
  try {
    const { clientName, clientPhone } = req.params;

    const userGoogleDriveService = new GoogleDriveService(req.user.id);
    const documents = await userGoogleDriveService.listClientDocuments(
      decodeURIComponent(clientName),
      clientPhone
    );

    res.json({
      success: true,
      data: documents
    });
  } catch (error) {
    console.error('Error listing client documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list documents'
    });
  }
});

/**
 * Create or ensure client folder exists
 */
router.post('/ensure-client-folder', async (req, res) => {
  try {
    const { clientName, clientPhone } = req.body;

    if (!clientName || !clientPhone) {
      return res.status(400).json({
        success: false,
        error: 'Client name and phone are required'
      });
    }

    const userGoogleDriveService = new GoogleDriveService(req.user.id);
    const folderId = await userGoogleDriveService.ensureClientFolder(clientName, clientPhone);

    res.json({
      success: true,
      data: {
        folderId: folderId,
        clientName: clientName,
        clientPhone: clientPhone
      }
    });
  } catch (error) {
    console.error('Error ensuring client folder:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create or access client folder'
    });
  }
});

export default router;
export { publicRouter };

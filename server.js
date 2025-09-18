import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import botRoutes from './routes/bot.js';
import adminRoutes from './routes/admin.js';
import pdfRoutes from './routes/pdf.js';
import lawyersRoutes from './routes/lawyers.js';
import authRoutes from './routes/auth.js';
import monitoringRoutes from './routes/monitoring.js';
import googleDriveRoutes, { publicRouter as googleDrivePublicRoutes } from './routes/googleDrive.js';
import { BotManager } from './services/BotManager.js';
import UserService from './services/UserService.js';
import DatabaseService from './services/DatabaseService.js';
import DataMigration from './scripts/migrate-data.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticateUser, requireLawOffice } from './middleware/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Initialize database and services
async function initializeApplication() {
  try {
    console.log('🗃️  Initializing database...');
    DatabaseService.init();
    
    console.log('📦 Running data migration...');
    await DataMigration.run();
    
    console.log('👥 Initializing user service...');
    const userService = new UserService();
    
    console.log('🤖 Initializing bot manager...');
    const botManager = new BotManager(io);
    
    // Make services available to routes
    app.locals.userService = userService;
    app.locals.botManager = botManager;
    
    // Register routes after database initialization
    app.use('/api/pdf', pdfRoutes);
    app.use('/api/auth', authRoutes);
    
    // Google Drive public routes (no authentication required)
    app.use('/api/google-drive', googleDrivePublicRoutes);
    
    app.use('/api/bot', authenticateUser, botRoutes);
    app.use('/api/admin', authenticateUser, adminRoutes);
    app.use('/api/lawyers', authenticateUser, requireLawOffice, lawyersRoutes);
    app.use('/api/monitoring', authenticateUser, monitoringRoutes);
    app.use('/api/google-drive', authenticateUser, requireLawOffice, googleDriveRoutes);
    
    // Debug endpoints
    app.get('/api/debug/bots', (req, res) => {
      try {
        const allBots = botManager.getAllBots();
        console.log('Debug endpoint - All bots:', allBots);
        res.json({
          totalBots: allBots.length,
          bots: allBots,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Debug endpoint error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/debug/user', authenticateUser, (req, res) => {
      try {
        console.log('Debug endpoint - User:', req.user);
        res.json({
          user: req.user,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Debug endpoint error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Catch-all handler for React app (must be last)
    app.get('*', (req, res) => {
      const buildPath = path.join(__dirname, 'client/build');
      if (fs.existsSync(path.join(buildPath, 'index.html'))) {
        res.sendFile(path.join(buildPath, 'index.html'));
      } else {
        res.status(404).json({ error: 'Frontend not built' });
      }
    });
    
    console.log('✅ Application initialization completed');
  } catch (error) {
    console.error('❌ Application initialization failed:', error);
    process.exit(1);
  }
}

// Initialize bot manager and user service (kept for backward compatibility)
const botManager = new BotManager(io);
const userService = new UserService();

// Initialize default admin user (removed as it's now handled in initializeApplication)

// Make botManager and userService available to routes first
app.use((req, res, next) => {
  req.botManager = botManager;
  req.userService = userService;
  req.io = io;
  next();
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

// Rate limiting
app.use(rateLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files - check if build exists
try {
  if (fs.existsSync(path.join(__dirname, 'client/build'))) {
    console.log('📁 Frontend build found. Serving static files...');
    app.use(express.static(path.join(__dirname, 'client/build')));
  } else {
    console.log('⚠️  Frontend build not found. API-only mode enabled.');
  }
} catch (err) {
  console.log('⚠️  Error checking frontend build:', err.message);
  console.log('⚠️  Frontend build not found. API-only mode enabled.');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    bots: botManager.getBotsStatus()
  });
});

// Debug endpoint to check bot status (no auth required for debugging)
app.get('/api/debug/bots', (req, res) => {
  try {
    const botsStatus = botManager.getBotsStatus();
    const allBots = botManager.getAllBots();
    
    res.json({
      mapSize: botManager.bots.size,
      mapKeys: Array.from(botManager.bots.keys()),
      botsStatus,
      allBots,
      databaseCount: DatabaseService.getAllBotsExtended().length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use(errorHandler);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Handle authentication
  socket.on('authenticate', async (data) => {
    try {
      const { token } = data;
      
      if (!token) {
        socket.emit('auth-error', { message: 'No token provided' });
        return;
      }
      
      // Verify JWT token
      const jwt = await import('jsonwebtoken');
      const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
      
      // Get user from database
      const user = DatabaseService.getUserById(decoded.id);
      if (!user) {
        socket.emit('auth-error', { message: 'User not found' });
        return;
      }
      
      // Join user to their own room
      socket.join(user.id);
      socket.userId = user.id;
      socket.user = user;
      
      console.log(`User ${user.email} authenticated and joined room ${user.id}`);
      
      // Send filtered bot status to authenticated user
      let botStatus = botManager.getBotsStatus();
      
      console.log(`📊 Sending bot status to ${user.email}:`, JSON.stringify(botStatus, null, 2));
      
      if (user.role === 'law_office') {
        const userBots = botStatus.bots.filter(bot => bot.ownerId === user.id);
        botStatus = {
          total: userBots.length,
          active: userBots.filter(bot => bot.isActive).length,
          bots: userBots
        };
        console.log(`📊 Filtered bot status for law_office ${user.email}:`, JSON.stringify(botStatus, null, 2));
      }
      
      socket.emit('bots-status', botStatus);
      socket.emit('authenticated', { user: { id: user.id, email: user.email, role: user.role } });
      
    } catch (error) {
      console.error('WebSocket authentication error:', error);
      socket.emit('auth-error', { message: 'Authentication failed' });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id, socket.userId ? `(user: ${socket.userId})` : '');
  });
});

const PORT = process.env.PORT || 3001;

// Start server with proper initialization
async function startServer() {
  await initializeApplication();
  
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`📱 Admin Panel: http://localhost:3000`);
    }
  });
}

startServer().catch(console.error);

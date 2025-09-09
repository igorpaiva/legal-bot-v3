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
import { BotManager } from './services/BotManager.js';
import UserService from './services/UserService.js';
import DatabaseService from './services/DatabaseService.js';
import DataMigration from './scripts/migrate-data.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? false 
      : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST']
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

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? false 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

// Rate limiting
app.use(rateLimiter);

// Make botManager and userService available to routes first
app.use((req, res, next) => {
  req.botManager = botManager;
  req.userService = userService;
  req.io = io;
  next();
});

// PDF routes without JSON middleware (for binary data)
app.use('/api/pdf', pdfRoutes);

// Body parsing middleware for other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Other routes
app.use('/api/auth', authRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/lawyers', lawyersRoutes);
app.use('/api/monitoring', monitoringRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  // Check if frontend build exists
  const frontendPath = path.join(__dirname, 'client/dist/index.html');
  
  if (fs.existsSync(frontendPath)) {
    app.use(express.static(path.join(__dirname, 'client/dist')));
    
    app.get('*', (req, res) => {
      res.sendFile(frontendPath);
    });
  } else {
    console.log('⚠️  Frontend build not found. API-only mode enabled.');
    
    // Serve a simple message for non-API routes
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found' });
      } else {
        res.json({ 
          message: 'Legal Bot API Server', 
          status: 'running',
          mode: 'api-only',
          note: 'Frontend build not available. Use API endpoints.',
          health: '/api/monitoring/health',
          admin: 'admin@legal-bot.com / admin123'
        });
      }
    });
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    bots: botManager.getBotsStatus()
  });
});

// Error handling middleware
app.use(errorHandler);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Admin client connected:', socket.id);
  
  // Send current bot status to new connection
  socket.emit('bots-status', botManager.getBotsStatus());
  
  socket.on('disconnect', () => {
    console.log('Admin client disconnected:', socket.id);
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

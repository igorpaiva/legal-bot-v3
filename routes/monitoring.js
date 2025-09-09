import express from 'express';
import BackupService from '../services/BackupService.js';
import MonitoringService from '../services/MonitoringService.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Initialize services
const backupService = new BackupService();
const monitoringService = new MonitoringService();

// Simple metrics endpoint for Prometheus
const getPrometheusMetrics = async (req, res) => {
  try {
    const metrics = await monitoringService.collectSystemMetrics();
    
    if (!metrics) {
      throw new Error('No metrics data available');
    }
    
    const dbStats = { userCount: 1, botCount: 0, messageCount: 0 }; // Placeholder
    
    // Convert to Prometheus format
    const prometheusMetrics = [
      '# HELP legal_bot_cpu_usage CPU usage percentage',
      '# TYPE legal_bot_cpu_usage gauge',
      `legal_bot_cpu_usage ${metrics.cpu || 0}`,
      
      '# HELP legal_bot_memory_usage Memory usage percentage', 
      '# TYPE legal_bot_memory_usage gauge',
      `legal_bot_memory_usage ${metrics.memory || 0}`,
      
      '# HELP legal_bot_uptime_seconds Application uptime in seconds',
      '# TYPE legal_bot_uptime_seconds gauge',
      `legal_bot_uptime_seconds ${Math.floor(process.uptime())}`,
      
      '# HELP legal_bot_users_total Total number of users',
      '# TYPE legal_bot_users_total gauge',
      `legal_bot_users_total ${dbStats.userCount}`,
      
      '# HELP legal_bot_health_score Application health score (0-1)',
      '# TYPE legal_bot_health_score gauge',
      `legal_bot_health_score ${metrics.healthScore || 1}`
    ].join('\n');
    
    res.set('Content-Type', 'text/plain');
    res.send(prometheusMetrics);
  } catch (error) {
    console.error('Error generating metrics:', error);
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
};

// Prometheus metrics endpoint (public)
router.get('/metrics', getPrometheusMetrics);

// Health check endpoint (public)
router.get('/health', async (req, res) => {
  try {
    const healthStatus = await monitoringService.getHealthStatus();
    
    res.json({
      success: true,
      ...healthStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'ERROR',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Dashboard metrics (admin only)
router.get('/dashboard', requireAdmin, (req, res) => {
  try {
    const metrics = monitoringService.getDashboardMetrics();
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get recent alerts (admin only)
router.get('/alerts', requireAdmin, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const alerts = monitoringService.getRecentAlerts(limit);
    
    res.json({
      success: true,
      data: alerts
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create backup (admin only)
router.post('/backup/create', requireAdmin, async (req, res) => {
  try {
    const backupPath = await backupService.createFullBackup();
    
    res.json({
      success: true,
      message: 'Backup created successfully',
      backupPath: backupPath
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List backups (admin only)
router.get('/backup/list', requireAdmin, async (req, res) => {
  try {
    const backups = await backupService.listBackups();
    const backupInfo = await backupService.getBackupInfo();
    
    res.json({
      success: true,
      data: {
        backups: backups,
        info: backupInfo
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Verify backup (admin only)
router.post('/backup/:backupName/verify', requireAdmin, async (req, res) => {
  try {
    const { backupName } = req.params;
    const backupPath = path.join(backupService.backupDir, backupName);
    
    const verification = await backupService.verifyBackup(backupPath);
    
    res.json({
      success: true,
      data: verification
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Restore from backup (admin only)
router.post('/backup/:backupName/restore', requireAdmin, async (req, res) => {
  try {
    const { backupName } = req.params;
    const backupPath = path.join(backupService.backupDir, backupName);
    
    const manifest = await backupService.restoreFromBackup(backupPath);
    
    res.json({
      success: true,
      message: 'Backup restored successfully',
      manifest: manifest,
      warning: 'Please restart the application to use the restored data'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get system information (admin only)
router.get('/system/info', requireAdmin, (req, res) => {
  try {
    const systemInfo = {
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptime: process.uptime()
      },
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
      versions: process.versions
    };
    
    res.json({
      success: true,
      data: systemInfo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get security events (admin only)
router.get('/security/events', requireAdmin, (req, res) => {
  try {
    const userId = req.query.userId;
    const limit = parseInt(req.query.limit) || 100;
    
    let events;
    if (userId) {
      events = req.userService.getUserSecurityEvents(userId, limit);
    } else {
      // Get all security events
      events = DatabaseService.db.prepare(`
        SELECT level, message, metadata, user_id, ip_address, created_at
        FROM system_logs 
        WHERE category = 'SECURITY'
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);
    }
    
    res.json({
      success: true,
      data: events
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user sessions (admin or own sessions)
router.get('/security/sessions/:userId?', (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUser = req.user;
    
    // Admin can view any user's sessions, others can only view their own
    if (userId && userId !== requestingUser.id && requestingUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    const targetUserId = userId || requestingUser.id;
    const sessions = req.userService.getUserSessions(targetUserId);
    
    res.json({
      success: true,
      data: sessions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Record API metrics middleware
export const recordMetrics = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    monitoringService.recordRequest(
      req.method,
      req.route?.path || req.path,
      res.statusCode,
      responseTime
    );
  });
  
  next();
};

// Export services for use in other parts of the application
export { backupService, monitoringService };

export default router;

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { performance } from 'perf_hooks';
import DatabaseService from './DatabaseService.js';

class MonitoringService {
  constructor() {
    this.metrics = new Map();
    this.alerts = [];
    this.thresholds = {
      memoryUsage: 85, // %
      cpuUsage: 90, // %
      diskUsage: 90, // %
      responseTime: 5000, // ms
      errorRate: 5, // %
      activeConnections: 1000,
      databaseSize: 1000 * 1024 * 1024, // 1GB
      failedLogins: 10 // per hour
    };
    
    this.startTime = Date.now();
    this.requestCounts = new Map();
    this.responseTimes = [];
    this.errorCounts = new Map();
    
    // Start monitoring
    this.startSystemMonitoring();
    this.startPerformanceMonitoring();
    this.scheduleReports();
  }

  /**
   * Start system resource monitoring
   */
  startSystemMonitoring() {
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000); // Every 30 seconds
    
    setInterval(() => {
      this.checkHealthThresholds();
    }, 60000); // Every minute
  }

  /**
   * Start application performance monitoring
   */
  startPerformanceMonitoring() {
    setInterval(() => {
      this.collectPerformanceMetrics();
    }, 60000); // Every minute
    
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 300000); // Every 5 minutes
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    try {
      const timestamp = Date.now();
      
      // Memory usage
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memoryUsagePercent = ((totalMem - freeMem) / totalMem) * 100;
      
      // CPU usage (simplified)
      const cpuUsage = await this.getCpuUsage();
      
      // Disk usage
      const diskUsage = await this.getDiskUsage();
      
      // Database metrics
      const dbMetrics = await this.getDatabaseMetrics();
      
      const systemMetrics = {
        timestamp,
        memory: {
          used: memUsage.heapUsed,
          total: memUsage.heapTotal,
          external: memUsage.external,
          percentage: memoryUsagePercent
        },
        cpu: {
          usage: cpuUsage,
          loadAverage: os.loadavg()
        },
        disk: diskUsage,
        database: dbMetrics,
        uptime: Date.now() - this.startTime,
        processId: process.pid
      };
      
      this.metrics.set(`system_${timestamp}`, systemMetrics);
      
      // Store in database for historical tracking
      this.storeMetrics('SYSTEM', systemMetrics);
      
    } catch (error) {
      console.error('Error collecting system metrics:', error);
      this.logError('MONITORING', 'Failed to collect system metrics', error);
    }
  }

  /**
   * Collect application performance metrics
   */
  async collectPerformanceMetrics() {
    try {
      const timestamp = Date.now();
      
      // Calculate averages for the last period
      const avgResponseTime = this.calculateAverageResponseTime();
      const errorRate = this.calculateErrorRate();
      const requestsPerMinute = this.calculateRequestsPerMinute();
      
      // WhatsApp bot metrics
      const botMetrics = await this.getBotMetrics();
      
      // Database performance
      const dbPerformance = await this.getDatabasePerformance();
      
      const performanceMetrics = {
        timestamp,
        api: {
          avgResponseTime,
          errorRate,
          requestsPerMinute,
          activeRequests: this.getActiveRequestCount()
        },
        bots: botMetrics,
        database: dbPerformance,
        memory: {
          rss: process.memoryUsage().rss,
          heapUsed: process.memoryUsage().heapUsed,
          heapTotal: process.memoryUsage().heapTotal
        }
      };
      
      this.metrics.set(`performance_${timestamp}`, performanceMetrics);
      this.storeMetrics('PERFORMANCE', performanceMetrics);
      
    } catch (error) {
      console.error('Error collecting performance metrics:', error);
      this.logError('MONITORING', 'Failed to collect performance metrics', error);
    }
  }

  /**
   * Get CPU usage percentage
   */
  async getCpuUsage() {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const startTime = Date.now();
      
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = Date.now();
        
        const userPercent = (endUsage.user / 1000 / (endTime - startTime)) * 100;
        const systemPercent = (endUsage.system / 1000 / (endTime - startTime)) * 100;
        
        resolve(userPercent + systemPercent);
      }, 100);
    });
  }

  /**
   * Get disk usage information
   */
  async getDiskUsage() {
    try {
      const dataDir = path.join(process.cwd(), 'data');
      const stats = await fs.stat(dataDir);
      
      // Get available disk space (simplified for cross-platform)
      const { size } = await fs.stat(process.cwd());
      
      return {
        dataDirectory: {
          size: stats.size,
          modified: stats.mtime
        },
        available: 'unknown', // Would need platform-specific implementation
        usage: 'unknown'
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Get database metrics
   */
  async getDatabaseMetrics() {
    try {
      const dbPath = DatabaseService.getDatabasePath();
      const stats = await fs.stat(dbPath);
      
      return {
        size: stats.size,
        sizeHuman: this.formatBytes(stats.size),
        lastModified: stats.mtime,
        isHealthy: DatabaseService.isHealthy(),
        tableStats: {
          users: DatabaseService.getUserCount(),
          bots: DatabaseService.getBotCount(),
          lawyers: DatabaseService.getLawyerCount(),
          conversations: DatabaseService.getConversationCount(),
          messages: DatabaseService.getMessageCount()
        }
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Get bot metrics
   */
  async getBotMetrics() {
    try {
      // This would integrate with BotManager
      // For now, return basic database stats
      const bots = DatabaseService.getAllBots();
      const activeBots = bots.filter(bot => bot.isActive);
      
      return {
        total: bots.length,
        active: activeBots.length,
        inactive: bots.length - activeBots.length,
        statusBreakdown: this.groupBy(bots, 'status'),
        totalMessages: DatabaseService.getMessageCount()
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Get database performance metrics
   */
  async getDatabasePerformance() {
    try {
      const start = performance.now();
      
      // Test query performance
      DatabaseService.db.prepare('SELECT COUNT(*) FROM users').get();
      
      const queryTime = performance.now() - start;
      
      return {
        queryResponseTime: queryTime,
        connectionPool: 'N/A', // SQLite doesn't use connection pooling
        cacheHitRate: 'N/A'
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Check health thresholds and generate alerts
   */
  checkHealthThresholds() {
    const latestSystemMetrics = this.getLatestMetrics('system');
    
    if (!latestSystemMetrics) return;
    
    const alerts = [];
    
    // Memory usage alert
    if (latestSystemMetrics.memory.percentage > this.thresholds.memoryUsage) {
      alerts.push({
        type: 'HIGH_MEMORY_USAGE',
        severity: 'WARNING',
        message: `Memory usage is ${latestSystemMetrics.memory.percentage.toFixed(1)}%`,
        value: latestSystemMetrics.memory.percentage,
        threshold: this.thresholds.memoryUsage
      });
    }
    
    // CPU usage alert
    if (latestSystemMetrics.cpu.usage > this.thresholds.cpuUsage) {
      alerts.push({
        type: 'HIGH_CPU_USAGE',
        severity: 'WARNING',
        message: `CPU usage is ${latestSystemMetrics.cpu.usage.toFixed(1)}%`,
        value: latestSystemMetrics.cpu.usage,
        threshold: this.thresholds.cpuUsage
      });
    }
    
    // Database size alert
    if (latestSystemMetrics.database.size > this.thresholds.databaseSize) {
      alerts.push({
        type: 'LARGE_DATABASE_SIZE',
        severity: 'INFO',
        message: `Database size is ${latestSystemMetrics.database.sizeHuman}`,
        value: latestSystemMetrics.database.size,
        threshold: this.thresholds.databaseSize
      });
    }
    
    // Process alerts
    alerts.forEach(alert => this.processAlert(alert));
  }

  /**
   * Process and store alerts
   */
  processAlert(alert) {
    const alertWithTimestamp = {
      ...alert,
      id: this.generateAlertId(),
      timestamp: new Date().toISOString(),
      acknowledged: false
    };
    
    this.alerts.push(alertWithTimestamp);
    
    // Log to database
    this.logAlert(alertWithTimestamp);
    
    // Console output based on severity
    const message = `[${alert.severity}] ${alert.type}: ${alert.message}`;
    
    switch (alert.severity) {
      case 'CRITICAL':
        console.error('🚨', message);
        break;
      case 'WARNING':
        console.warn('⚠️ ', message);
        break;
      case 'INFO':
        console.info('ℹ️ ', message);
        break;
    }
    
    // Keep only recent alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-50);
    }
  }

  /**
   * Record API request metrics
   */
  recordRequest(method, path, statusCode, responseTime) {
    const key = `${method}_${path}`;
    const timestamp = Date.now();
    
    // Track response times
    this.responseTimes.push({
      timestamp,
      responseTime,
      endpoint: key
    });
    
    // Track request counts
    const requests = this.requestCounts.get(key) || [];
    requests.push(timestamp);
    this.requestCounts.set(key, requests);
    
    // Track errors
    if (statusCode >= 400) {
      const errors = this.errorCounts.get(key) || [];
      errors.push({ timestamp, statusCode });
      this.errorCounts.set(key, errors);
    }
    
    // Clean old data (keep last hour)
    const oneHourAgo = timestamp - (60 * 60 * 1000);
    this.responseTimes = this.responseTimes.filter(r => r.timestamp > oneHourAgo);
  }

  /**
   * Calculate average response time
   */
  calculateAverageResponseTime() {
    if (this.responseTimes.length === 0) return 0;
    
    const totalTime = this.responseTimes.reduce((sum, r) => sum + r.responseTime, 0);
    return totalTime / this.responseTimes.length;
  }

  /**
   * Calculate error rate
   */
  calculateErrorRate() {
    const totalRequests = Array.from(this.requestCounts.values())
      .reduce((sum, requests) => sum + requests.length, 0);
    
    if (totalRequests === 0) return 0;
    
    const totalErrors = Array.from(this.errorCounts.values())
      .reduce((sum, errors) => sum + errors.length, 0);
    
    return (totalErrors / totalRequests) * 100;
  }

  /**
   * Calculate requests per minute
   */
  calculateRequestsPerMinute() {
    const oneMinuteAgo = Date.now() - (60 * 1000);
    
    return Array.from(this.requestCounts.values())
      .reduce((sum, requests) => {
        const recentRequests = requests.filter(timestamp => timestamp > oneMinuteAgo);
        return sum + recentRequests.length;
      }, 0);
  }

  /**
   * Get active request count
   */
  getActiveRequestCount() {
    // This would need to be implemented with middleware tracking
    return 0;
  }

  /**
   * Get health status summary
   */
  getHealthStatus() {
    const latestSystem = this.getLatestMetrics('system');
    const latestPerformance = this.getLatestMetrics('performance');
    
    if (!latestSystem || !latestPerformance) {
      return { status: 'UNKNOWN', message: 'Insufficient metrics data' };
    }
    
    const recentAlerts = this.alerts.filter(
      alert => Date.now() - new Date(alert.timestamp).getTime() < 300000 // Last 5 minutes
    );
    
    const criticalAlerts = recentAlerts.filter(alert => alert.severity === 'CRITICAL');
    const warningAlerts = recentAlerts.filter(alert => alert.severity === 'WARNING');
    
    let status = 'HEALTHY';
    let message = 'All systems operational';
    
    if (criticalAlerts.length > 0) {
      status = 'CRITICAL';
      message = `${criticalAlerts.length} critical issue(s) detected`;
    } else if (warningAlerts.length > 0) {
      status = 'WARNING';
      message = `${warningAlerts.length} warning(s) active`;
    }
    
    return {
      status,
      message,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      metrics: {
        memory: latestSystem.memory.percentage,
        cpu: latestSystem.cpu.usage,
        database: latestSystem.database.isHealthy,
        responseTime: latestPerformance.api.avgResponseTime,
        errorRate: latestPerformance.api.errorRate
      },
      alerts: {
        total: recentAlerts.length,
        critical: criticalAlerts.length,
        warning: warningAlerts.length
      }
    };
  }

  /**
   * Get metrics for dashboard
   */
  getDashboardMetrics() {
    const latestSystem = this.getLatestMetrics('system');
    const latestPerformance = this.getLatestMetrics('performance');
    
    return {
      system: latestSystem,
      performance: latestPerformance,
      health: this.getHealthStatus(),
      alerts: this.getRecentAlerts(10)
    };
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit = 50) {
    return this.alerts
      .slice(-limit)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Store metrics in database
   */
  storeMetrics(category, metrics) {
    try {
      DatabaseService.db.prepare(`
        INSERT INTO system_logs (level, category, message, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'INFO',
        category,
        'System metrics collected',
        JSON.stringify(metrics),
        new Date().toISOString()
      );
    } catch (error) {
      console.error('Error storing metrics:', error);
    }
  }

  /**
   * Log alert to database
   */
  logAlert(alert) {
    try {
      DatabaseService.db.prepare(`
        INSERT INTO system_logs (level, category, message, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        alert.severity === 'CRITICAL' ? 'ERROR' : 'WARN',
        'ALERT',
        alert.message,
        JSON.stringify(alert),
        alert.timestamp || new Date().toISOString()
      );
    } catch (error) {
      console.error('Error logging alert:', error);
    }
  }

  /**
   * Log error to database
   */
  logError(category, message, error) {
    try {
      DatabaseService.db.prepare(`
        INSERT INTO system_logs (level, category, message, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'ERROR',
        category,
        message,
        JSON.stringify({
          error: error.message,
          stack: error.stack
        }),
        new Date().toISOString()
      );
    } catch (dbError) {
      console.error('Error logging to database:', dbError);
    }
  }

  /**
   * Schedule periodic reports
   */
  scheduleReports() {
    // Daily report at midnight
    const scheduleDaily = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setDate(now.getDate() + 1);
      nextMidnight.setHours(0, 0, 0, 0);
      
      const timeUntilMidnight = nextMidnight - now;
      
      setTimeout(() => {
        this.generateDailyReport();
        scheduleDaily(); // Schedule next report
      }, timeUntilMidnight);
    };
    
    scheduleDaily();
  }

  /**
   * Generate daily report
   */
  async generateDailyReport() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const report = {
        date: yesterday.toISOString().split('T')[0],
        summary: await this.getDailySummary(yesterday),
        alerts: await this.getDailyAlerts(yesterday),
        metrics: await this.getDailyMetrics(yesterday)
      };
      
      // Store report
      DatabaseService.db.prepare(`
        INSERT INTO system_logs (level, category, message, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'INFO',
        'DAILY_REPORT',
        `Daily monitoring report for ${report.date}`,
        JSON.stringify(report),
        new Date().toISOString()
      );
      
      console.log('📊 Daily monitoring report generated');
      
    } catch (error) {
      console.error('Error generating daily report:', error);
    }
  }

  /**
   * Clean up old metrics
   */
  cleanupOldMetrics() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    // Clean request counts
    for (const [key, requests] of this.requestCounts) {
      const recentRequests = requests.filter(timestamp => timestamp > oneHourAgo);
      if (recentRequests.length === 0) {
        this.requestCounts.delete(key);
      } else {
        this.requestCounts.set(key, recentRequests);
      }
    }
    
    // Clean error counts
    for (const [key, errors] of this.errorCounts) {
      const recentErrors = errors.filter(error => error.timestamp > oneHourAgo);
      if (recentErrors.length === 0) {
        this.errorCounts.delete(key);
      } else {
        this.errorCounts.set(key, recentErrors);
      }
    }
    
    // Clean metrics map (keep last 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const [key] of this.metrics) {
      const timestamp = parseInt(key.split('_').pop());
      if (timestamp < oneDayAgo) {
        this.metrics.delete(key);
      }
    }
  }

  // Utility methods
  getLatestMetrics(type) {
    const keys = Array.from(this.metrics.keys())
      .filter(key => key.startsWith(type))
      .sort((a, b) => {
        const timestampA = parseInt(a.split('_').pop());
        const timestampB = parseInt(b.split('_').pop());
        return timestampB - timestampA;
      });
    
    return keys.length > 0 ? this.metrics.get(keys[0]) : null;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  groupBy(array, key) {
    return array.reduce((groups, item) => {
      const value = item[key];
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {});
  }

  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getDailySummary(date) {
    // Implementation for daily summary
    return {
      requests: 0,
      errors: 0,
      uptime: '100%',
      avgResponseTime: 0
    };
  }

  async getDailyAlerts(date) {
    // Implementation for daily alerts
    return [];
  }

  async getDailyMetrics(date) {
    // Implementation for daily metrics
    return {};
  }
}

export default MonitoringService;

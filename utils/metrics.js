// Simple metrics endpoint for Prometheus
function getPrometheusMetrics(monitoringService, databaseService) {
  return async (req, res) => {
    try {
      const metrics = await monitoringService.collectSystemMetrics();
      const dbStats = await databaseService.getStats();
      
      // Convert to Prometheus format
      const prometheusMetrics = [
        '# HELP legal_bot_cpu_usage CPU usage percentage',
        '# TYPE legal_bot_cpu_usage gauge',
        `legal_bot_cpu_usage ${metrics.cpu.usage}`,
        
        '# HELP legal_bot_memory_usage Memory usage percentage', 
        '# TYPE legal_bot_memory_usage gauge',
        `legal_bot_memory_usage ${metrics.memory.usage}`,
        
        '# HELP legal_bot_disk_usage Disk usage percentage',
        '# TYPE legal_bot_disk_usage gauge', 
        `legal_bot_disk_usage ${metrics.disk.usage}`,
        
        '# HELP legal_bot_uptime_seconds Application uptime in seconds',
        '# TYPE legal_bot_uptime_seconds gauge',
        `legal_bot_uptime_seconds ${Math.floor(process.uptime())}`,
        
        '# HELP legal_bot_users_total Total number of users',
        '# TYPE legal_bot_users_total gauge',
        `legal_bot_users_total ${dbStats.userCount}`,
        
        '# HELP legal_bot_bots_total Total number of bots',
        '# TYPE legal_bot_bots_total gauge', 
        `legal_bot_bots_total ${dbStats.botCount}`,
        
        '# HELP legal_bot_messages_total Total number of messages',
        '# TYPE legal_bot_messages_total gauge',
        `legal_bot_messages_total ${dbStats.messageCount}`,
        
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
}

module.exports = { getPrometheusMetrics };

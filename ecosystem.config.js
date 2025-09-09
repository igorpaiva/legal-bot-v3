module.exports = {
  apps: [{
    // Application configuration
    name: 'legal-bot-api',
    script: 'server.js',
    
    // Process management
    instances: 1,
    exec_mode: 'cluster',
    
    // Environment variables
    env: {
      NODE_ENV: 'development',
      PORT: 3001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001,
      HOST: '0.0.0.0'
    },
    
    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Restart configuration
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '1G',
    
    // Monitoring
    pmx: true,
    
    // Auto restart on file changes (only for development)
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'data', 'uploads', 'sessions'],
    
    // Advanced settings
    kill_timeout: 5000,
    listen_timeout: 8000,
    
    // Health monitoring
    health_check_grace_period: 10000
  }]
};

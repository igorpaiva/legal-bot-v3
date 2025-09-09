# 🚀 Legal Bot Production Deployment Guide

## Complete Tutorial: From Code Changes to Cloud Deployment

This guide covers the entire deployment process for your Legal Bot application on a cloud VM (Oracle Cloud Infrastructure, AWS EC2, Google Cloud, etc.) via SSH.

---

## 📋 Prerequisites

### Local Development Environment
- Git repository with your Legal Bot code
- Docker installed locally (for testing)
- SSH client (Terminal/PowerShell)

### Cloud VM Requirements
- **Operating System:** Ubuntu 20.04+ / CentOS 8+ / Amazon Linux 2
- **Minimum Specs:** 2 vCPU, 4GB RAM, 20GB storage
- **Network:** Ports 22 (SSH), 80 (HTTP), 443 (HTTPS), 3001 (API) open
- **Root/sudo access**

---

## 🎯 Phase 1: Initial Cloud VM Setup

### Step 1: Connect to Your VM
```bash
# Connect via SSH (replace with your VM details)
ssh -i your-key.pem ubuntu@your-vm-ip
# OR for password authentication:
ssh username@your-vm-ip
```

### Step 2: Update System and Install Dependencies
```bash
# Update package manager
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y curl wget git unzip nano htop

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

### Step 3: Install Docker
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group (replace 'ubuntu' with your username)
sudo usermod -aG docker ubuntu

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login again for group changes to take effect
exit
ssh -i your-key.pem ubuntu@your-vm-ip
```

### Step 4: Install PM2 (Process Manager)
```bash
# Install PM2 globally
sudo npm install -g pm2

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions PM2 provides
```

### Step 5: Setup Firewall (if not managed by cloud provider)
```bash
# Configure UFW firewall
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 3001/tcp  # API
sudo ufw --force enable
```

---

## 🎯 Phase 2: Application Deployment

### Step 1: Clone Your Repository
```bash
# Navigate to home directory
cd ~

# Clone your repository
git clone https://github.com/yourusername/legal-bot-v3.git
cd legal-bot-v3

# Verify files
ls -la
```

### Step 2: Setup Environment Variables
```bash
# Copy production environment template
cp .env.production .env

# Edit environment variables for production
nano .env
```

**Update these critical variables:**
```env
# Database
NODE_ENV=production
DATABASE_URL=sqlite:./data/legal-bot.db

# Server Configuration
PORT=3001
HOST=0.0.0.0

# Security - CHANGE THESE!
JWT_SECRET=your-super-secure-jwt-secret-here
JWT_REFRESH_SECRET=your-super-secure-refresh-secret-here

# Groq API (if using)
GROQ_API_KEY=your-groq-api-key

# Email Configuration (optional)
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_USER=your-email@domain.com
SMTP_PASS=your-email-password

# Production URLs
CLIENT_URL=https://yourdomain.com
API_URL=https://yourdomain.com/api

# Backup Configuration
BACKUP_RETENTION_DAYS=30
BACKUP_SCHEDULE=0 2 * * *  # Daily at 2 AM
```

### Step 3: Build and Test with Docker
```bash
# Build the Docker image
docker build -t legal-bot-production .

# Test run (temporary)
docker run -d -p 3001:3001 --env-file .env --name legal-bot-test legal-bot-production

# Check if it's working
curl http://localhost:3001/
curl http://localhost:3001/api/monitoring/health

# Stop test container
docker stop legal-bot-test && docker rm legal-bot-test
```

---

## 🎯 Phase 3: Production Deployment with PM2

### Step 1: Install Application Dependencies
```bash
# Install Node.js dependencies
npm install --production

# Verify installation
npm ls
```

### Step 2: Setup PM2 Configuration
```bash
# Create PM2 ecosystem file
nano ecosystem.config.js
```

**Add this configuration:**
```javascript
module.exports = {
  apps: [{
    name: 'legal-bot-api',
    script: 'server.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

### Step 3: Start Application with PM2
```bash
# Create logs directory
mkdir -p logs

# Start application
pm2 start ecosystem.config.js --env production

# Check status
pm2 status
pm2 logs legal-bot-api

# Save PM2 configuration
pm2 save
```

---

## 🎯 Phase 4: Setup Reverse Proxy (Nginx)

### Step 1: Install and Configure Nginx
```bash
# Install Nginx
sudo apt install -y nginx

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/legal-bot
```

**Add this configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # API routes
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3001/health;
        access_log off;
    }
    
    # Root and other routes
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
}
```

### Step 2: Enable Nginx Site
```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/legal-bot /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## 🎯 Phase 5: SSL Certificate (Optional but Recommended)

### Step 1: Install Certbot
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

---

## 🎯 Phase 6: Deployment Automation Script

### Step 1: Create Deployment Script
```bash
# Create deployment script
nano deploy.sh
chmod +x deploy.sh
```

**Add this content:**
```bash
#!/bin/bash

echo "🚀 Starting Legal Bot Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as correct user
if [ "$EUID" -eq 0 ]; then 
    print_error "Don't run this script as root"
    exit 1
fi

# Navigate to application directory
cd /home/$(whoami)/legal-bot-v3 || {
    print_error "Application directory not found"
    exit 1
}

print_status "Pulling latest changes..."
git pull origin main || {
    print_error "Failed to pull changes"
    exit 1
}

print_status "Installing dependencies..."
npm install --production || {
    print_error "Failed to install dependencies"
    exit 1
}

print_status "Running database migrations..."
# Add migration commands here if needed

print_status "Restarting application..."
pm2 restart legal-bot-api || {
    print_error "Failed to restart application"
    exit 1
}

print_status "Waiting for application to start..."
sleep 10

print_status "Checking application health..."
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/monitoring/health)
if [ "$response" = "200" ]; then
    print_status "✅ Deployment successful! Application is healthy."
else
    print_error "❌ Application health check failed (HTTP $response)"
    print_warning "Check logs: pm2 logs legal-bot-api"
    exit 1
fi

print_status "🎉 Deployment completed successfully!"
```

---

## 🎯 Phase 7: Complete Deployment Workflow

### For Code Changes and Updates:

#### 1. **Local Development:**
```bash
# Make your changes locally
git add .
git commit -m "Your change description"
git push origin main
```

#### 2. **Deploy to Production:**
```bash
# SSH into your VM
ssh -i your-key.pem ubuntu@your-vm-ip

# Run deployment script
cd ~/legal-bot-v3
./deploy.sh
```

#### 3. **Monitor Deployment:**
```bash
# Check application status
pm2 status
pm2 logs legal-bot-api --lines 50

# Check system resources
htop

# Test endpoints
curl http://yourdomain.com/api/monitoring/health
curl http://yourdomain.com/
```

---

## 🎯 Phase 8: Monitoring and Maintenance

### Daily Monitoring Commands:
```bash
# Check application status
pm2 status

# View recent logs
pm2 logs legal-bot-api --lines 20

# Check system resources
df -h        # Disk usage
free -h      # Memory usage
htop         # System processes

# Check Nginx status
sudo systemctl status nginx

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Backup Commands:
```bash
# Manual backup
cd ~/legal-bot-v3
tar -czf backup-$(date +%Y%m%d).tar.gz data/ logs/ .env

# Automated backup (add to crontab)
crontab -e
# Add: 0 2 * * * cd /home/ubuntu/legal-bot-v3 && tar -czf ~/backups/backup-$(date +\%Y\%m\%d).tar.gz data/ logs/ .env
```

### Update Process:
```bash
# Update system packages (monthly)
sudo apt update && sudo apt upgrade -y

# Update Node.js dependencies (as needed)
cd ~/legal-bot-v3
npm update
pm2 restart legal-bot-api
```

---

## 🔧 Troubleshooting Common Issues

### Application Won't Start:
```bash
# Check PM2 logs
pm2 logs legal-bot-api

# Check environment variables
cat .env

# Check file permissions
ls -la

# Restart PM2
pm2 restart legal-bot-api
```

### Database Issues:
```bash
# Check database file
ls -la data/
sqlite3 data/legal-bot.db ".tables"

# Backup and restore
cp data/legal-bot.db data/legal-bot.db.backup
```

### Network Issues:
```bash
# Check if port is open
sudo netstat -tulpn | grep 3001

# Check firewall
sudo ufw status

# Test local connection
curl http://localhost:3001/api/monitoring/health
```

---

## 📊 Production Checklist

Before going live, ensure:

- [ ] Environment variables are properly set
- [ ] SSL certificate is installed and working
- [ ] Firewall rules are configured
- [ ] Backups are automated
- [ ] Monitoring is set up
- [ ] Domain name points to your VM
- [ ] Database is properly initialized
- [ ] Application passes health checks
- [ ] PM2 is configured for auto-restart
- [ ] Nginx is serving requests properly

---

## 🎉 Success!

Your Legal Bot application is now production-ready and deployed! 

**Access your application:**
- API: `https://yourdomain.com/api/monitoring/health`
- Login: `https://yourdomain.com/` (admin@legal-bot.com / admin123)

**Next Steps:**
1. Change default admin password
2. Set up automated monitoring alerts
3. Configure regular backups
4. Set up CI/CD pipeline (optional)
5. Monitor performance and scale as needed

---

*This deployment guide ensures your Legal Bot application is secure, scalable, and production-ready! 🚀*

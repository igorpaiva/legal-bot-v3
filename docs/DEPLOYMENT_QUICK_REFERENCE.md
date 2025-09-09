# 🚀 Legal Bot Deployment Quick Reference

## 📋 Essential Commands

### Initial Setup (Run Once)
```bash
# On new VM (as root)
sudo ./scripts/server-setup.sh

# Clone repository
git clone https://github.com/yourusername/legal-bot-v3.git
cd legal-bot-v3

# Setup environment
cp .env.production .env
nano .env  # Update with your values

# First deployment
npm install --production
pm2 start ecosystem.config.js --env production
pm2 save
```

### Regular Deployment (After Code Changes)
```bash
# Simple deployment
./scripts/quick-deploy.sh

# Manual deployment
git pull origin main
npm install --production
pm2 restart legal-bot-api
```

### Monitoring Commands
```bash
pm2 status                    # Check application status
pm2 logs legal-bot-api        # View logs
pm2 monit                     # Real-time monitoring
htop                          # System resources
```

### Health Checks
```bash
curl http://localhost:3001/api/monitoring/health
curl http://localhost:3001/
pm2 logs legal-bot-api --lines 20
```

## 🔧 Troubleshooting

### Application Won't Start
```bash
pm2 logs legal-bot-api        # Check logs
pm2 restart legal-bot-api     # Restart app
pm2 delete legal-bot-api && pm2 start ecosystem.config.js --env production  # Fresh start
```

### Database Issues
```bash
ls -la data/                  # Check database file
sqlite3 data/legal-bot.db ".tables"  # Verify tables
```

### Network Issues
```bash
sudo netstat -tulpn | grep 3001  # Check if port is open
sudo ufw status                   # Check firewall
curl http://localhost:3001/       # Test local connection
```

## 📁 Important Files

- `/home/user/legal-bot-v3/.env` - Environment configuration
- `/home/user/legal-bot-v3/data/legal-bot.db` - Database
- `/home/user/legal-bot-v3/logs/` - Application logs
- `/etc/nginx/sites-available/legal-bot` - Nginx config

## 🔑 Default Credentials

- **Admin Email:** admin@legal-bot.com
- **Admin Password:** admin123
- ⚠️ **Change these immediately in production!**

## 🌐 Production URLs

- API Health: `https://yourdomain.com/api/monitoring/health`
- Admin Panel: `https://yourdomain.com/`
- API Base: `https://yourdomain.com/api/`

## 🔄 Deployment Workflow

1. **Make changes locally**
2. **Test locally**
3. **Commit and push to Git**
4. **SSH to production server**
5. **Run deployment script**
6. **Verify deployment**

---
*Keep this reference handy for quick production operations! 🚀*

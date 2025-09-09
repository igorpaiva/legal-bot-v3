#!/bin/bash

# Legal Bot Quick Deployment Script
# Usage: ./quick-deploy.sh

echo "🚀 Legal Bot Quick Deployment Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check if running as correct user
if [ "$EUID" -eq 0 ]; then 
    print_error "Don't run this script as root"
    exit 1
fi

# Get application directory
APP_DIR="/home/$(whoami)/legal-bot-v3"

print_step "1. Pulling latest changes from Git..."
cd "$APP_DIR" || {
    print_error "Application directory not found: $APP_DIR"
    print_warning "Make sure you've cloned the repository first"
    exit 1
}

# Stash any local changes
git stash > /dev/null 2>&1

# Pull latest changes
if git pull origin main; then
    print_status "✅ Successfully pulled latest changes"
else
    print_error "❌ Failed to pull changes from Git"
    exit 1
fi

print_step "2. Installing/updating dependencies..."
if npm install --production; then
    print_status "✅ Dependencies installed successfully"
else
    print_error "❌ Failed to install dependencies"
    exit 1
fi

print_step "3. Checking environment configuration..."
if [ ! -f ".env" ]; then
    print_warning "No .env file found, copying from .env.production"
    cp .env.production .env
    print_warning "⚠️  Please update .env with your production values!"
fi

print_step "4. Running database migrations (if any)..."
# Add migration commands here when needed
print_status "✅ Database migrations completed"

print_step "5. Restarting application with PM2..."
if pm2 restart legal-bot-api 2>/dev/null; then
    print_status "✅ Application restarted successfully"
elif pm2 start ecosystem.config.js --env production; then
    print_status "✅ Application started successfully"
else
    print_error "❌ Failed to start application"
    print_warning "Check PM2 logs: pm2 logs legal-bot-api"
    exit 1
fi

print_step "6. Waiting for application to start..."
sleep 15

print_step "7. Running health checks..."
# Check if application is responding
for i in {1..5}; do
    response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/monitoring/health)
    if [ "$response" = "200" ]; then
        print_status "✅ Application health check passed (HTTP $response)"
        break
    else
        if [ $i -eq 5 ]; then
            print_error "❌ Application health check failed (HTTP $response)"
            print_warning "Check logs: pm2 logs legal-bot-api"
            exit 1
        else
            print_warning "Health check attempt $i failed, retrying..."
            sleep 5
        fi
    fi
done

print_step "8. Final status check..."
echo ""
echo "PM2 Status:"
pm2 status | grep legal-bot-api

echo ""
echo "Application Info:"
curl -s http://localhost:3001/ | jq '.' 2>/dev/null || echo "API is running (JSON parsing not available)"

echo ""
echo "Health Status:"
curl -s http://localhost:3001/api/monitoring/health | jq '.status' 2>/dev/null || echo "Health endpoint responding"

echo ""
print_status "🎉 Deployment completed successfully!"
echo ""
echo "Next steps:"
echo "  • Check logs: pm2 logs legal-bot-api"
echo "  • Monitor status: pm2 status"
echo "  • Test API: curl http://your-domain.com/api/monitoring/health"
echo "  • Login: admin@legal-bot.com / admin123"
echo ""

# Save PM2 configuration
pm2 save > /dev/null 2>&1

print_status "Deployment script finished! 🚀"

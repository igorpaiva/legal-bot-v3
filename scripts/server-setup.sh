#!/bin/bash

# Legal Bot Server Setup Script
# Run this on a fresh Ubuntu/Debian VM to prepare it for deployment

echo "🔧 Legal Bot Server Setup Script"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run this script as root (use sudo)"
    exit 1
fi

print_step "1. Updating system packages..."
apt update && apt upgrade -y
print_status "✅ System packages updated"

print_step "2. Installing essential packages..."
apt install -y curl wget git unzip nano htop jq sqlite3 nginx
print_status "✅ Essential packages installed"

print_step "3. Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
print_status "✅ Node.js installed: $(node --version)"

print_step "4. Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
rm get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

systemctl start docker
systemctl enable docker
print_status "✅ Docker installed and started"

print_step "5. Installing PM2..."
npm install -g pm2
print_status "✅ PM2 installed"

print_step "6. Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 3001/tcp  # API
ufw --force enable
print_status "✅ Firewall configured"

print_step "7. Setting up users and permissions..."
# Get the user who ran sudo
REAL_USER=${SUDO_USER:-$USER}
if [ "$REAL_USER" != "root" ]; then
    usermod -aG docker $REAL_USER
    print_status "✅ Added $REAL_USER to docker group"
else
    print_warning "⚠️  Please add your user to docker group manually: sudo usermod -aG docker username"
fi

print_step "8. Installing SSL certificate tools..."
apt install -y certbot python3-certbot-nginx
print_status "✅ Certbot installed for SSL certificates"

print_step "9. Creating application directories..."
sudo -u $REAL_USER mkdir -p /home/$REAL_USER/backups
sudo -u $REAL_USER mkdir -p /home/$REAL_USER/logs
print_status "✅ Application directories created"

echo ""
print_status "🎉 Server setup completed!"
echo ""
echo "Next steps:"
echo "  1. Logout and login again (for docker group changes)"
echo "  2. Clone your repository:"
echo "     git clone https://github.com/yourusername/legal-bot-v3.git"
echo "  3. Configure your domain DNS to point to this server"
echo "  4. Run the deployment script"
echo ""
echo "Useful commands:"
echo "  • Check Docker: docker --version"
echo "  • Check Node.js: node --version"
echo "  • Check PM2: pm2 --version"
echo "  • Check firewall: ufw status"
echo ""

print_warning "⚠️  Remember to:"
print_warning "  • Change default passwords"
print_warning "  • Configure SSH key authentication"
print_warning "  • Set up automated backups"
print_warning "  • Update .env file with production values"

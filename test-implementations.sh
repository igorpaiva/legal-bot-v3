#!/bin/bash

echo "🔧 WhatsApp Bot Session Persistence Test Script"
echo "================================================"

# Function to check if process is running
check_process() {
    if pgrep -f "$1" > /dev/null; then
        echo "✅ $1 is running"
        return 0
    else
        echo "❌ $1 is not running"
        return 1
    fi
}

# Function to install playwright if needed
install_playwright() {
    echo "📦 Installing Playwright..."
    cd /home/igor/dev/legal-bot-v3
    npm install playwright
    npx playwright install chromium
    echo "✅ Playwright installed"
}

# Function to test implementation
test_implementation() {
    local impl=$1
    local name=$2
    
    echo ""
    echo "🧪 Testing $name Implementation"
    echo "=================================="
    
    # Backup current BotManager
    if [ -f "services/BotManager.js" ]; then
        cp services/BotManager.js services/BotManager.backup.js
        echo "📋 Current BotManager backed up"
    fi
    
    # Copy test implementation
    cp "services/BotManager.$impl.js" services/BotManager.js
    echo "🔄 Using $name implementation"
    
    # Start server
    echo "🚀 Starting server..."
    npm run dev &
    SERVER_PID=$!
    
    # Wait for server to start
    sleep 10
    
    # Check if server is running
    if check_process "node.*server.js"; then
        echo "✅ Server started successfully"
        echo "📱 Open http://localhost:3000 to scan QR code"
        echo "⏱️  Test for session persistence..."
        echo "    1. Scan QR code"
        echo "    2. Send a test message"
        echo "    3. Restart server (Ctrl+C and restart)"
        echo "    4. Check if session persists"
        echo ""
        echo "Press Enter when ready to stop this test..."
        read
    else
        echo "❌ Server failed to start"
    fi
    
    # Stop server
    kill $SERVER_PID 2>/dev/null || true
    sleep 3
    
    # Restore backup
    if [ -f "services/BotManager.backup.js" ]; then
        cp services/BotManager.backup.js services/BotManager.js
        echo "🔄 Original BotManager restored"
    fi
}

echo "🎯 Available implementations to test:"
echo "1. WORKING - Optimized Puppeteer (temporary success)"
echo "2. playwright - New Playwright implementation"
echo "3. whatsappweb - Connect to existing WhatsApp Web"
echo ""

# Check if Playwright is installed
if ! npm list playwright > /dev/null 2>&1; then
    echo "❗ Playwright not found. Installing..."
    install_playwright
fi

while true; do
    echo "Choose implementation to test (1-3) or 'q' to quit:"
    read -p "Enter choice: " choice
    
    case $choice in
        1)
            test_implementation "WORKING" "Optimized Puppeteer"
            ;;
        2)
            test_implementation "playwright" "Playwright"
            ;;
        3)
            test_implementation "whatsappweb" "WhatsApp Web Bridge"
            ;;
        q|Q)
            echo "👋 Exiting test script"
            exit 0
            ;;
        *)
            echo "❌ Invalid choice. Please enter 1-3 or 'q'"
            ;;
    esac
done

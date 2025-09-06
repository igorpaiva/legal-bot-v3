# WhatsApp Bot Admin Panel

A comprehensive WhatsApp bot system with an admin panel that allows you to manage multiple bot instances, each with independent QR code authentication and human-like AI responses powered by Groq.

## Features

### 🤖 Multiple Bot Management
- Create and manage multiple WhatsApp bot instances
- Each bot operates independently with its own session
- Individual QR code generation for each bot
- Real-time status monitoring and control

### 🎯 Human-like Behavior
- Human-like random delays between messages
- Simulated typing indicators
- **Intelligent reading delay simulation** - Longer messages require more reading time (configurable reading speed)
- **Dynamic complexity adjustment** - Longer/complex messages take proportionally more time to process
- Time-based response patterns (faster during business hours)
- Anti-detection mechanisms to prevent WhatsApp from identifying bot activity

### 🧠 AI-Powered Responses
- Powered by Groq's fast LLM models
- Natural, conversational responses
- Context-aware messaging
- Configurable response templates

### 📊 Admin Dashboard
- Real-time bot status monitoring
- Message statistics and analytics
- System health monitoring
- Bulk bot operations
- Live QR code display for authentication

### 🔒 Security Features
- Rate limiting to prevent abuse
- Session-based authentication storage
- Error handling and recovery
- Safe environment configuration

## Tech Stack

### Backend
- **Node.js** with Express.js
- **Socket.IO** for real-time communication
- **whatsapp-web.js** for WhatsApp integration
- **Groq SDK** for AI responses
- **TypeScript** support

### Frontend
- **React** with TypeScript
- **Material-UI** for components
- **Socket.IO Client** for real-time updates
- **Responsive design**

### Key Dependencies
- `whatsapp-web.js` - WhatsApp Web API integration
- `groq-sdk` - Groq AI API client
- `socket.io` - Real-time bidirectional communication
- `qrcode` - QR code generation
- `rate-limiter-flexible` - API rate limiting
- `helmet` - Security middleware

## Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Chrome/Chromium browser (for WhatsApp Web)

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd legal-bot-v3
   ```

2. **Install backend dependencies**
   ```bash
   npm install
   ```

3. **Install frontend dependencies**
   ```bash
   cd client
   npm install
   cd ..
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file with your configuration:
   ```env
   # Groq API Configuration
   GROQ_API_KEY=your_groq_api_key_here
   
   # Bot Configuration
   BOT_RESPONSE_DELAY_MIN=1000
   BOT_RESPONSE_DELAY_MAX=5000
   BOT_TYPING_DELAY_MIN=500
   BOT_TYPING_DELAY_MAX=2000
   
   # Reading Delay Configuration (realistic reading times)
   BOT_READING_SPEED_WPM=250
   BOT_READING_COMPLEXITY_THRESHOLD=200
   BOT_READING_MIN_DELAY=500
   BOT_READING_MAX_DELAY=45000
   
   # Server Configuration
   PORT=3001
   NODE_ENV=development
   ```

5. **Get Groq API Key**
   - Visit [Groq Console](https://console.groq.com/)
   - Create an account and generate an API key
   - Add the key to your `.env` file

   > ⚠️ **Security Note**: Never commit your `.env` file to version control. The `.env` file contains sensitive information like API keys and should always be kept secret.

6. **Verify Setup**
   - Ensure your `.env` file is listed in `.gitignore`
   - Double-check that your API key is correctly set
   - Test the connection by starting the development server

## Usage

### Development Mode

1. **Start the backend server**
   ```bash
   npm run dev
   ```

2. **Start the frontend (in a new terminal)**
   ```bash
   npm run client
   ```

3. **Access the admin panel**
   - Open http://localhost:3000 in your browser
   - The backend runs on http://localhost:3001

### Production Mode

1. **Build the frontend**
   ```bash
   npm run build
   ```

2. **Start the production server**
   ```bash
   npm start
   ```

### Creating Your First Bot

1. **Access the Admin Panel**
   - Open the admin dashboard in your browser
   - Click "Create New Bot"
   - Enter a name for your bot

2. **Authenticate with WhatsApp**
   - A QR code will be generated for your bot
   - Open WhatsApp on your phone
   - Go to Settings > Linked Devices > Link a Device
   - Scan the QR code displayed in the admin panel

3. **Bot is Ready**
   - Once authenticated, the bot status will change to "Connected"
   - The bot will now automatically respond to incoming messages
   - Monitor activity through the admin dashboard

## Configuration

### Human-like Delays
Configure realistic response timing in `.env`:

```env
# Response delays (milliseconds)
BOT_RESPONSE_DELAY_MIN=1000    # Minimum delay before responding
BOT_RESPONSE_DELAY_MAX=5000    # Maximum delay before responding

# Typing simulation delays
BOT_TYPING_DELAY_MIN=500       # Minimum typing indicator duration
BOT_TYPING_DELAY_MAX=2000      # Maximum typing indicator duration

# Reading delay simulation (intelligent message processing)
BOT_READING_SPEED_WPM=250           # Words per minute reading speed (default: 250)
BOT_READING_COMPLEXITY_THRESHOLD=200 # Character count where complexity factor starts
BOT_READING_MIN_DELAY=500           # Minimum reading delay in milliseconds
BOT_READING_MAX_DELAY=45000         # Maximum reading delay (45 seconds for very long messages)
```

### AI Response Configuration
The bot uses Groq's Llama 3 model for generating responses. You can modify the system prompt in `services/GroqService.js` to customize the bot's personality and behavior.

### Rate Limiting
Protect your server with configurable rate limits:

```env
RATE_LIMIT_WINDOW_MS=60000     # Time window (1 minute)
RATE_LIMIT_MAX_REQUESTS=100    # Max requests per window
```

## API Endpoints

### Bot Management
- `GET /api/bot` - List all bots
- `POST /api/bot` - Create new bot
- `GET /api/bot/:id` - Get bot details
- `POST /api/bot/:id/stop` - Stop bot
- `POST /api/bot/:id/restart` - Restart bot
- `DELETE /api/bot/:id` - Delete bot
- `GET /api/bot/:id/qr` - Get bot QR code

### Admin Dashboard
- `GET /api/admin/dashboard` - Dashboard data
- `GET /api/admin/stats` - Bot statistics
- `GET /api/admin/config` - System configuration
- `GET /api/admin/test-groq` - Test Groq connection

## Security Considerations

### Safe Environment Features
- **Session Isolation**: Each bot has its own session directory
- **Rate Limiting**: Prevents API abuse
- **Error Handling**: Graceful failure recovery
- **Input Validation**: Sanitized user inputs
- **CORS Protection**: Configured for development/production

### Anti-Detection Measures
- **Random Delays**: Simulates human response timing
- **Typing Indicators**: Shows natural typing behavior
- **Reading Simulation**: Delays based on message length
- **Time-based Patterns**: Different response speeds throughout the day
- **Browser Fingerprinting**: Uses realistic browser headers

## Monitoring

### Dashboard Features
- **Real-time Bot Status**: Live status updates via WebSocket
- **Message Statistics**: Track message volume and activity
- **System Health**: Monitor server performance and uptime
- **Error Reporting**: Real-time error notifications

### Logs
- Bot authentication events
- Message processing logs
- Error tracking and recovery
- Performance metrics

## Troubleshooting

### Common Issues

**Bot Won't Connect**
- Ensure Groq API key is valid
- Check internet connection
- Verify WhatsApp account isn't banned
- Try restarting the bot

**QR Code Not Showing**
- Check browser console for errors
- Ensure backend is running
- Verify WebSocket connection
- Refresh the admin panel

**Messages Not Responding**
- Check Groq API key and credits
- Verify bot status is "Connected"
- Check server logs for errors
- Ensure rate limits aren't exceeded

**High Memory Usage**
- Monitor session data growth
- Restart bots periodically
- Clean up old session files
- Check for memory leaks in logs

### Performance Optimization

**For High Volume**
- Increase server resources
- Use Redis for session storage
- Implement database for bot data
- Add load balancing for multiple instances

**For Better Reliability**
- Set up PM2 for process management
- Implement health checks
- Add automated restarts
- Monitor with external services

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This bot is for educational and legitimate business purposes only. Ensure compliance with WhatsApp's Terms of Service and applicable laws in your jurisdiction. The developers are not responsible for any misuse of this software.

## Support

For support, issues, or feature requests, please open an issue on the GitHub repository.

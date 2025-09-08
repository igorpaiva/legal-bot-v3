import React, { useState, useEffect } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Container,
  AppBar,
  Toolbar,
  Typography,
  Box,
  Alert,
  Snackbar,
  Tabs,
  Tab
} from '@mui/material';
import { io, Socket } from 'socket.io-client';
import Dashboard from './components/Dashboard';
import BotManager from './components/BotManager';
import Reports from './components/Reports';
import Lawyers from './components/Lawyers';
import { Bot, SystemStatus } from './types';
import './App.css';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#25D366', // WhatsApp green
    },
    secondary: {
      main: '#128C7E',
    },
  },
});

interface AppState {
  bots: Bot[];
  systemStatus: SystemStatus | null;
  socket: Socket | null;
  notification: {
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'warning' | 'info';
  };
}

function App() {
  const [tabValue, setTabValue] = useState(0);
  const [state, setState] = useState<AppState>({
    bots: [],
    systemStatus: null,
    socket: null,
    notification: {
      open: false,
      message: '',
      severity: 'info'
    }
  });

  useEffect(() => {
    // Initialize socket connection
    const socket = io(process.env.REACT_APP_SERVER_URL || 'http://localhost:3001');
    
    setState(prev => ({ ...prev, socket }));

    // Socket event listeners
    socket.on('connect', () => {
      console.log('Connected to server');
      showNotification('Connected to server', 'success');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      showNotification('Disconnected from server', 'warning');
    });

    socket.on('bots-status', (data: { bots: Bot[], total: number, active: number }) => {
      setState(prev => ({ ...prev, bots: data.bots }));
    });

    socket.on('bot-created', (bot: Bot) => {
      console.log('Bot created:', bot);
      setState(prev => ({ ...prev, bots: [...prev.bots, bot] }));
    });

    socket.on('bot-updated', (bot: Bot) => {
      setState(prev => {
        const existingBotIndex = prev.bots.findIndex(b => b.id === bot.id);
        if (existingBotIndex >= 0) {
          // Update existing bot
          const updatedBots = [...prev.bots];
          updatedBots[existingBotIndex] = bot;
          return { ...prev, bots: updatedBots };
        } else {
          // Add new bot (fallback if bot-created wasn't received)
          return { ...prev, bots: [...prev.bots, bot] };
        }
      });
    });

    socket.on('bot-deleted', (data: { botId: string }) => {
      setState(prev => ({
        ...prev,
        bots: prev.bots.filter(b => b.id !== data.botId)
      }));
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  const showNotification = (message: string, severity: 'success' | 'error' | 'warning' | 'info') => {
    setState(prev => ({
      ...prev,
      notification: { open: true, message, severity }
    }));
  };

  const closeNotification = () => {
    setState(prev => ({
      ...prev,
      notification: { ...prev.notification, open: false }
    }));
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ flexGrow: 1 }}>
        <AppBar position="static">
          <Toolbar>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              WhatsApp Bot Admin Panel
            </Typography>
          </Toolbar>
        </AppBar>
        
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={tabValue} onChange={handleTabChange} aria-label="admin panel tabs">
              <Tab label="Dashboard" />
              <Tab label="Relatórios" />
              <Tab label="Advogados" />
            </Tabs>
          </Box>

          {tabValue === 0 && (
            <>
              <Dashboard 
                bots={state.bots} 
                systemStatus={state.systemStatus}
              />
              
              <Box sx={{ mt: 4 }}>
                <BotManager 
                  bots={state.bots}
                  onNotification={showNotification}
                />
              </Box>
            </>
          )}

          {tabValue === 1 && (
            <Reports />
          )}

          {tabValue === 2 && (
            <Lawyers />
          )}
        </Container>

        <Snackbar
          open={state.notification.open}
          autoHideDuration={6000}
          onClose={closeNotification}
        >
          <Alert 
            onClose={closeNotification} 
            severity={state.notification.severity}
            sx={{ width: '100%' }}
          >
            {state.notification.message}
          </Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}

export default App;

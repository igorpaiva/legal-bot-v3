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
  Tab,
  Button,
  Menu,
  MenuItem,
  Avatar
} from '@mui/material';
import { AccountCircle as AccountIcon, ExitToApp as LogoutIcon } from '@mui/icons-material';
import { io, Socket } from 'socket.io-client';
import Dashboard from './components/Dashboard';
import BotManager from './components/BotManager';
import Reports from './components/Reports';
import Lawyers from './components/Lawyers';
import GoogleDrive from './components/GoogleDrive';
import AdminDashboard from './components/AdminDashboard';
import Login from './components/Login';
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

interface User {
  id: string;
  email: string;
  role: 'admin' | 'law_office';
  lawOfficeName?: string;
  botCredits?: number;
}

function App() {
  const [tabValue, setTabValue] = useState(0);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
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
    // Check for existing authentication
    const token = localStorage.getItem('authToken');
    const userData = localStorage.getItem('userData');
    
    if (token && userData) {
      try {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Error parsing user data:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
      }
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Initialize socket connection only when authenticated
    const socket = io(process.env.REACT_APP_SERVER_URL || 'http://localhost:3001');
    
    setState(prev => ({ ...prev, socket }));

    // Load bots via API as fallback while socket connects
    const loadBotsViaAPI = async () => {
      try {
        const token = localStorage.getItem('authToken');
        if (!token) return;

        const response = await fetch(`${process.env.REACT_APP_SERVER_URL || 'http://localhost:3001'}/api/admin/dashboard`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            console.log('Loaded bots via API:', data.data.bots);
            setState(prev => ({ ...prev, bots: data.data.bots }));
          }
        }
      } catch (error) {
        console.error('Error loading bots via API:', error);
      }
    };

    // Load bots immediately via API
    loadBotsViaAPI();

    // Socket event listeners
    socket.on('connect', () => {
      console.log('Connected to server');
      showNotification('Connected to server', 'success');
      
      // Authenticate socket with token
      const token = localStorage.getItem('authToken');
      if (token) {
        console.log('Authenticating socket with token:', token.substring(0, 20) + '...');
        socket.emit('authenticate', { token });
      } else {
        console.error('No token found for socket authentication');
      }
    });

    socket.on('authenticated', (data) => {
      console.log('Socket authenticated successfully:', data);
    });

    socket.on('auth-error', (error) => {
      console.error('Socket authentication failed:', error);
      showNotification('Socket authentication failed', 'error');
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
  }, [isAuthenticated]);

  const handleLogin = (token: string, userData: User) => {
    setUser(userData);
    setIsAuthenticated(true);
    setTabValue(0); // Start at first tab
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    setUser(null);
    setIsAuthenticated(false);
    setTabValue(0); // Reset to first tab
    if (state.socket) {
      state.socket.disconnect();
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const refreshUserData = async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) return;

      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        localStorage.setItem('userData', JSON.stringify(userData));
      }
    } catch (error) {
      console.error('Error refreshing user data:', error);
    }
  };

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

  // Get available tabs based on user role
  const getAvailableTabs = () => {
    if (user?.role === 'law_office') {
      return [
        { label: 'Dashboard', key: 'dashboard' },
        { label: 'Gerenciar Bots', key: 'bots' },
        { label: 'Relatórios', key: 'reports' },
        { label: 'Advogados', key: 'lawyers' },
        { label: 'Google Drive', key: 'google-drive' }
      ];
    } else if (user?.role === 'admin') {
      return [
        { label: 'Painel Admin', key: 'admin-dashboard' },
        { label: 'Escritórios', key: 'law-offices' }
      ];
    }
    return [];
  };

  const getCurrentTabKey = () => {
    const tabs = getAvailableTabs();
    return tabs[tabValue]?.key || '';
  };

  // Don't show main app if not authenticated
  if (!isAuthenticated) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Login onLogin={handleLogin} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ flexGrow: 1 }}>
        <AppBar position="static">
          <Toolbar>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              Painel Admin Legal Bot - {user?.role === 'admin' ? 'Administrador' : user?.lawOfficeName}
            </Typography>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">
                {user?.email}
              </Typography>
              <Button
                color="inherit"
                onClick={handleMenuOpen}
                startIcon={<AccountIcon />}
              >
                Conta
              </Button>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleMenuClose}
              >
                <MenuItem onClick={handleLogout}>
                  <LogoutIcon sx={{ mr: 1 }} />
                  Sair
                </MenuItem>
              </Menu>
            </Box>
          </Toolbar>
        </AppBar>

        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={tabValue} onChange={handleTabChange}>
              {getAvailableTabs().map((tab, index) => (
                <Tab key={tab.key} label={tab.label} />
              ))}
            </Tabs>
          </Box>

          {/* Law Office User Content */}
          {user?.role === 'law_office' && (
            <>
              {getCurrentTabKey() === 'dashboard' && (
                <>
                  <Dashboard 
                    bots={state.bots} 
                    systemStatus={state.systemStatus}
                    user={user}
                  />
                  
                  <Box sx={{ mt: 4 }}>
                    <BotManager 
                      bots={state.bots}
                      onNotification={showNotification}
                      onUserDataRefresh={refreshUserData}
                      user={user}
                    />
                  </Box>
                </>
              )}

              {getCurrentTabKey() === 'bots' && (
                <BotManager 
                  bots={state.bots}
                  onNotification={showNotification}
                  onUserDataRefresh={refreshUserData}
                  user={user}
                />
              )}

              {getCurrentTabKey() === 'reports' && (
                <Reports />
              )}

              {getCurrentTabKey() === 'lawyers' && (
                <Lawyers />
              )}

              {getCurrentTabKey() === 'google-drive' && (
                <GoogleDrive />
              )}
            </>
          )}

          {/* Admin User Content */}
          {user?.role === 'admin' && (
            <>
              {getCurrentTabKey() === 'admin-dashboard' && (
                <AdminDashboard />
              )}

              {getCurrentTabKey() === 'law-offices' && (
                <AdminDashboard />
              )}
            </>
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

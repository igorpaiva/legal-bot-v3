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
  MenuItem
} from '@mui/material';
import { AccountCircle as AccountIcon, ExitToApp as LogoutIcon } from '@mui/icons-material';
import { io, Socket } from 'socket.io-client';
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
      main: '#1976d2', // Modern blue
      light: '#42a5f5',
      dark: '#1565c0',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#2196f3', // Lighter blue
      light: '#64b5f6',
      dark: '#1976d2',
      contrastText: '#ffffff',
    },
    background: {
      default: '#f5f5f5',
      paper: '#ffffff',
    },
    text: {
      primary: '#1e293b',
      secondary: '#64748b',
    },
    success: {
      main: '#4caf50',
      light: '#81c784',
      dark: '#388e3c',
    },
    warning: {
      main: '#ff9800',
      light: '#ffb74d',
      dark: '#f57c00',
    },
    error: {
      main: '#f44336',
      light: '#ef5350',
      dark: '#d32f2f',
    },
  },
  typography: {
    fontFamily: '"Poppins", "Roboto", "Helvetica", "Arial", sans-serif',
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: {
      fontWeight: 700,
      fontSize: '2.5rem',
      lineHeight: 1.2,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontWeight: 600,
      fontSize: '2rem',
      lineHeight: 1.3,
      letterSpacing: '-0.01em',
    },
    h3: {
      fontWeight: 600,
      fontSize: '1.75rem',
      lineHeight: 1.3,
      letterSpacing: '-0.01em',
    },
    h4: {
      fontWeight: 600,
      fontSize: '1.5rem',
      lineHeight: 1.2,
      letterSpacing: '-0.01em',
    },
    h5: {
      fontWeight: 600,
      fontSize: '1.25rem',
      lineHeight: 1.4,
    },
    h6: {
      fontWeight: 600,
      fontSize: '1.125rem',
      lineHeight: 1.4,
    },
    body1: {
      fontSize: '1rem',
      lineHeight: 1.6,
      fontWeight: 400,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
      fontWeight: 400,
    },
    button: {
      fontWeight: 500,
      fontSize: '0.875rem',
      textTransform: 'none',
      letterSpacing: '0.01em',
    },
    caption: {
      fontSize: '0.75rem',
      lineHeight: 1.4,
      fontWeight: 400,
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#1976d2',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          boxShadow: 'none',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)',
            transform: 'translateY(-1px)',
          },
        },
        contained: {
          backgroundColor: '#1976d2',
          '&:hover': {
            backgroundColor: '#1565c0',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: '0 8px 25px rgba(0, 0, 0, 0.15)',
            transform: 'translateY(-2px)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: 'rgba(25, 118, 210, 0.04)',
            transition: 'background-color 0.2s ease',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(10px)',
        },
        indicator: {
          height: 3,
          backgroundColor: '#1976d2',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.95rem',
          minHeight: 48,
          margin: '0 4px',
          transition: 'all 0.3s ease',
          '&:hover': {
            backgroundColor: 'rgba(25, 118, 210, 0.08)',
          },
          '&.Mui-selected': {
            backgroundColor: 'rgba(25, 118, 210, 0.12)',
            color: '#1976d2',
          },
        },
      },
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

  // Ensure menu is closed when not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      setAnchorEl(null);
    }
  }, [isAuthenticated]);
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
      console.log('Received bots-status:', data.bots.length, 'bots');
      // Completely replace bots array to avoid duplicates
      setState(prev => ({ 
        ...prev, 
        bots: [...data.bots] // Force new array reference
      }));
    });

    socket.on('bot-created', (bot: Bot) => {
      console.log('Bot created:', bot);
      setState(prev => {
        // Check if bot already exists to prevent duplicates
        const existingBotIndex = prev.bots.findIndex(b => b.id === bot.id);
        if (existingBotIndex >= 0) {
          console.warn('Bot creation ignored - bot already exists:', bot.id);
          return prev;
        }
        return { ...prev, bots: [...prev.bots, bot] };
      });
    });

    socket.on('bot-updated', (bot: Bot) => {
      console.log('Bot updated via socket:', {
        id: bot.id,
        name: bot.name,
        status: bot.status,
        phoneNumber: bot.phoneNumber
      });
      setState(prev => {
        const existingBotIndex = prev.bots.findIndex(b => b.id === bot.id);
        if (existingBotIndex >= 0) {
          // Update existing bot
          const updatedBots = [...prev.bots];
          updatedBots[existingBotIndex] = { ...bot };
          return { ...prev, bots: updatedBots };
        } else {
          // Bot doesn't exist - this should not happen as bot-created handles new bots
          console.warn('Bot update received for non-existent bot:', bot.id);
          return prev;
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
    event.preventDefault();
    event.stopPropagation();
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
        { label: 'Gerenciar Bots', key: 'bots' },
        { label: 'Relatórios', key: 'reports' },
        { label: 'Advogados', key: 'lawyers' },
        { label: 'Google Drive', key: 'google-drive' }
      ];
    } else if (user?.role === 'admin') {
      return [
        { label: 'Painel Admin', key: 'admin-dashboard' }
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
        <AppBar position="static" className="fade-in-up">
          <Toolbar sx={{ py: 1, justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <img 
                src="/temis-icon-white.svg" 
                alt="Temis Logo"
                style={{ 
                  height: '32px',
                  width: 'auto'
                }}
              />
              <Typography 
                variant="h5" 
                component="div" 
                sx={{ 
                  fontWeight: 700,
                  color: 'white',
                  fontSize: '1.8rem'
                }}
              >
                Temis
              </Typography>
            </Box>
            
            <Typography 
              variant="body1" 
              sx={{ 
                color: 'rgba(255, 255, 255, 0.9)',
                fontWeight: 500,
                fontSize: '1.1rem',
                mr: 2
              }}
            >
              {user?.role === 'admin' ? 'Administrador' : user?.lawOfficeName}
            </Typography>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography 
                variant="body2"
                sx={{ 
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontWeight: 500,
                  display: { xs: 'none', sm: 'block' }
                }}
              >
                {user?.email}
              </Typography>
              <Button
                color="inherit"
                onClick={handleMenuOpen}
                startIcon={<AccountIcon />}
                sx={{
                  borderRadius: 2,
                  px: 2,
                  py: 1,
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    transform: 'translateY(-1px)',
                  },
                  transition: 'all 0.3s ease',
                }}
              >
                Conta
              </Button>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl) && !!anchorEl}
                onClose={handleMenuClose}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'right',
                }}
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                PaperProps={{
                  sx: {
                    mt: 1,
                    borderRadius: 2,
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
                    backdropFilter: 'blur(10px)',
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  }
                }}
              >
                <MenuItem 
                  onClick={handleLogout}
                  sx={{
                    borderRadius: 1,
                    mx: 1,
                    my: 0.5,
                    '&:hover': {
                      backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    }
                  }}
                >
                  <LogoutIcon sx={{ mr: 1, color: 'error.main' }} />
                  Sair
                </MenuItem>
              </Menu>
            </Box>
          </Toolbar>
        </AppBar>

        <Container maxWidth="xl" sx={{ mt: 4, mb: 4, px: { xs: 1, sm: 2, md: 3 }, maxWidth: '100% !important' }}>
          <Box 
            sx={{ 
              borderBottom: 1, 
              borderColor: 'rgba(0, 212, 170, 0.2)', 
              mb: 4,
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(10px)',
              p: 1,
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
            }}
            className="slide-in-right"
          >
            <Tabs 
              value={tabValue} 
              onChange={handleTabChange}
              variant="standard"
              sx={{
                '& .MuiTabs-indicator': {
                  display: 'none',
                }
              }}
            >
              {getAvailableTabs().map((tab, index) => (
                <Tab 
                  key={tab.key} 
                  label={tab.label}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    minHeight: 48,
                    borderRadius: 2,
                    mx: 0.5,
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      backgroundColor: 'rgba(25, 118, 210, 0.08)',
                      transform: 'translateY(-1px)',
                    },
                    '&.Mui-selected': {
                      backgroundColor: 'rgba(25, 118, 210, 0.12)',
                      color: '#1976d2',
                      boxShadow: '0 2px 8px rgba(0, 212, 170, 0.2)',
                    },
                  }}
                />
              ))}
            </Tabs>
          </Box>

          {/* Law Office User Content */}
          {user?.role === 'law_office' && (
            <>
              {getCurrentTabKey() === 'bots' && (
                <BotManager 
                  bots={state.bots}
                  onNotification={showNotification}
                  onUserDataRefresh={refreshUserData}
                  user={user}
                  systemStatus={state.systemStatus}
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
            </>
          )}
        </Container>

        <Snackbar
          open={state.notification.open}
          autoHideDuration={6000}
          onClose={closeNotification}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right',
          }}
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

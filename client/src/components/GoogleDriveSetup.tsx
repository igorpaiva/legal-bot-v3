import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Button, 
  Alert, 
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField
} from '@mui/material';
import { 
  CloudUpload as CloudUploadIcon,
  Folder as FolderIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Link as LinkIcon
} from '@mui/icons-material';

interface DriveStats {
  overall?: {
    total_documents?: number;
    successful_uploads?: number;
    unique_clients?: number;
    total_size?: number;
  };
}

interface DriveFolder {
  id: string;
  folder_name: string;
  client_phone: string;
  document_count?: number;
  total_size?: number;
  created_at: string;
}

const GoogleDriveSetup: React.FC = () => {
  const [connected, setConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [stats, setStats] = useState<DriveStats | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [showAuthDialog, setShowAuthDialog] = useState<boolean>(false);
  const [authCode, setAuthCode] = useState<string>('');

  useEffect(() => {
    checkConnectionStatus();
    fetchStats();
    fetchFolders();
    
    // Check for success/error parameters from OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const googleDriveSuccess = urlParams.get('google_drive_success');
    const googleDriveError = urlParams.get('google_drive_error');
    const email = urlParams.get('email');
    const errorMessage = urlParams.get('message');
    
    if (googleDriveSuccess === 'true') {
      setSuccess(`Google Drive connected successfully! ${email ? `Connected as: ${email}` : ''}`);
      setConnected(true);
      if (email) {
        setUserEmail(email);
      }
      // Clean URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (googleDriveError === 'true') {
      setError(errorMessage || 'Failed to connect Google Drive');
      // Clean URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch('/api/google-drive/status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setConnected(data.connected);
        setUserEmail(data.userEmail || '');
      }
    } catch (error) {
      console.error('Error checking Google Drive status:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/google-drive/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching Google Drive stats:', error);
    }
  };

  const fetchFolders = async () => {
    try {
      const response = await fetch('/api/google-drive/folders', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setFolders(data.folders);
      }
    } catch (error) {
      console.error('Error fetching folders:', error);
    }
  };

  const initiateConnection = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await fetch('/api/google-drive/auth-url', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Open Google authorization URL in new tab
        window.open(data.authUrl, '_blank');
        setShowAuthDialog(true);
      } else {
        setError(data.error || 'Failed to generate authorization URL');
      }
    } catch (error) {
      setError('Failed to connect to Google Drive');
    } finally {
      setLoading(false);
    }
  };

  const completeConnection = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await fetch('/api/google-drive/callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: authCode,
          state: localStorage.getItem('userData') ? JSON.parse(localStorage.getItem('userData')!).id : ''
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSuccess('Google Drive connected successfully!');
        setConnected(true);
        setUserEmail(data.userEmail);
        setShowAuthDialog(false);
        setAuthCode('');
        checkConnectionStatus();
        fetchStats();
      } else {
        setError(data.error || 'Failed to complete Google Drive connection');
      }
    } catch (error) {
      setError('Failed to complete connection');
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await fetch('/api/google-drive/disconnect', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSuccess('Google Drive disconnected successfully');
        setConnected(false);
        setUserEmail('');
        setStats(null);
        setFolders([]);
      } else {
        setError(data.error || 'Failed to disconnect');
      }
    } catch (error) {
      setError('Failed to disconnect');
    } finally {
      setLoading(false);
    }
  };

  const testUpload = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await fetch('/api/google-drive/test-upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSuccess('Test upload successful!');
        fetchStats();
        fetchFolders();
      } else {
        setError(data.error || 'Test upload failed');
      }
    } catch (error) {
      setError('Test upload failed');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: '0 auto', padding: 2 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, color: 'primary.main' }}>
        Integração Google Drive
      </Typography>
      
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4, lineHeight: 1.6 }}>
        Conecte o Google Drive do seu escritório para armazenar automaticamente documentos dos clientes e relatórios de conversas.
        Cada cliente terá sua própria pasta organizada com todos os documentos e relatórios jurídicos.
      </Typography>

      {loading && <LinearProgress sx={{ mb: 2 }} />}
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {/* Connection Status Card */}
      <Card sx={{ 
        mb: 3,
        transition: 'all 0.3s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: 3
        }
      }}>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              {connected ? (
                <Box sx={{ 
                  bgcolor: '#25D36615',
                  borderRadius: '50%',
                  p: 1.5,
                  mr: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <CheckCircleIcon sx={{ color: '#25D366', fontSize: 32 }} />
                </Box>
              ) : (
                <Box sx={{ 
                  bgcolor: '#f4433615',
                  borderRadius: '50%',
                  p: 1.5,
                  mr: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <ErrorIcon sx={{ color: '#f44336', fontSize: 32 }} />
                </Box>
              )}
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Google Drive {connected ? 'Conectado' : 'Não Conectado'}
                </Typography>
                {connected && userEmail && (
                  <Typography variant="body2" color="text.secondary">
                    Conectado como: {userEmail}
                  </Typography>
                )}
              </Box>
            </Box>
            
            <Box>
              {connected ? (
                <>
                  <Button 
                    variant="outlined" 
                    onClick={testUpload}
                    disabled={loading}
                    sx={{ mr: 1 }}
                  >
                    Test Upload
                  </Button>
                  <Button 
                    variant="outlined" 
                    color="error"
                    onClick={disconnect}
                    disabled={loading}
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button 
                  variant="contained" 
                  onClick={initiateConnection}
                  disabled={loading}
                  startIcon={<CloudUploadIcon />}
                >
                  Connect Google Drive
                </Button>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Statistics */}
      {connected && stats && (
        <Card sx={{ 
          mb: 3,
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3
          }
        }}>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
              Estatísticas de Documentos
            </Typography>
            <Box sx={{ 
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, 1fr)',
                sm: 'repeat(4, 1fr)'
              },
              gap: 2
            }}>
              <Box sx={{ 
                textAlign: 'center',
                p: 2,
                borderRadius: 2,
                backgroundColor: '#25D36608'
              }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: '#25D366' }}>
                  {stats.overall?.total_documents || 0}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Total de Documentos
                </Typography>
              </Box>
              <Box sx={{ 
                textAlign: 'center',
                p: 2,
                borderRadius: 2,
                backgroundColor: '#4caf5008'
              }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: '#4caf50' }}>
                  {stats.overall?.successful_uploads || 0}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Uploads Bem-sucedidos
                </Typography>
              </Box>
              <Box sx={{ 
                textAlign: 'center',
                p: 2,
                borderRadius: 2,
                backgroundColor: '#2196f308'
              }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: '#2196f3' }}>
                  {stats.overall?.unique_clients || 0}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Pastas de Clientes
                </Typography>
              </Box>
              <Box sx={{ 
                textAlign: 'center',
                p: 2,
                borderRadius: 2,
                backgroundColor: '#ff980008'
              }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: '#ff9800' }}>
                  {formatFileSize(stats.overall?.total_size || 0)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Tamanho Total
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Client Folders */}
      {connected && folders.length > 0 && (
        <Card sx={{ 
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3
          }
        }}>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
              Pastas dos Clientes ({folders.length})
            </Typography>
            <List>
              {folders.slice(0, 10).map((folder) => (
                <ListItem key={folder.id} divider sx={{ 
                  borderRadius: 1,
                  mb: 1,
                  '&:hover': {
                    backgroundColor: 'action.hover'
                  }
                }}>
                  <ListItemIcon>
                    <Box sx={{ 
                      bgcolor: '#2196f315',
                      borderRadius: '50%',
                      p: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <FolderIcon sx={{ color: '#2196f3' }} />
                    </Box>
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {folder.folder_name}
                      </Typography>
                    }
                    secondary={
                      <Box>
                        <Typography variant="body2" component="span" color="text.secondary">
                          {folder.client_phone} • {folder.document_count || 0} documentos
                        </Typography>
                        {folder.total_size && (
                          <Typography variant="body2" component="span" sx={{ ml: 1 }} color="text.secondary">
                            • {formatFileSize(folder.total_size)}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                  <Chip 
                    label={new Date(folder.created_at).toLocaleDateString()}
                    size="small"
                    variant="outlined"
                  />
                </ListItem>
              ))}
            </List>
            {folders.length > 10 && (
              <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2 }}>
                And {folders.length - 10} more folders...
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {/* Authorization Dialog */}
      <Dialog open={showAuthDialog} onClose={() => setShowAuthDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Complete Google Drive Connection</DialogTitle>
        <DialogContent>
          <Typography paragraph>
            After authorizing in the new tab, copy the authorization code and paste it below:
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Authorization Code"
            fullWidth
            variant="outlined"
            value={authCode}
            onChange={(e) => setAuthCode(e.target.value)}
            placeholder="Paste the authorization code here"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAuthDialog(false)}>Cancel</Button>
          <Button 
            onClick={completeConnection} 
            variant="contained"
            disabled={!authCode.trim() || loading}
          >
            Complete Connection
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GoogleDriveSetup;

import React, { useState } from 'react';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';

interface LoginProps {
  onLogin: (token: string, user: any) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [firstLoginData, setFirstLoginData] = useState<any>(null);
  const [passwordSetupData, setPasswordSetupData] = useState({
    password: '',
    confirmPassword: ''
  });
  const [settingPassword, setSettingPassword] = useState(false);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handlePasswordSetupChange = (field: string, value: string) => {
    setPasswordSetupData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSetFirstPassword = async () => {
    if (passwordSetupData.password !== passwordSetupData.confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (passwordSetupData.password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    try {
      setSettingPassword(true);
      setError('');

      const response = await fetch('/api/auth/set-first-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: firstLoginData.user.id,
          password: passwordSetupData.password
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to set password');
      }

      // Now login normally with the new password
      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: formData.email,
          password: passwordSetupData.password
        })
      });

      const loginData = await loginResponse.json();

      if (!loginResponse.ok) {
        throw new Error(loginData.error || 'Login failed after password setup');
      }

      // Store token and user data
      localStorage.setItem('authToken', loginData.token);
      localStorage.setItem('userData', JSON.stringify(loginData.user));
      
      onLogin(loginData.token, loginData.user);

    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSettingPassword(false);
    }
  };

  const handleClosePasswordSetup = () => {
    setFirstLoginData(null);
    setPasswordSetupData({ password: '', confirmPassword: '' });
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.email || !formData.password) {
      setError('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Check if user needs to set password on first login
      if (data.requiresPasswordSetup) {
        setFirstLoginData(data);
        return;
      }

      // Store token and user data
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('userData', JSON.stringify(data.user));
      
      onLogin(data.token, data.user);

    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Card>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
            <LockIcon sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
            <Typography variant="h4" component="h1" gutterBottom>
              Admin Legal Bot
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Faça login para acessar o painel de administração
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="E-mail"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              margin="normal"
              required
              autoFocus
            />
            <TextField
              fullWidth
              label="Senha"
              type="password"
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              margin="normal"
              required
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading}
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </Box>

          <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="body2" color="text.secondary" align="center">
              <strong>Admin Padrão:</strong><br />
              E-mail: admin@legal-bot.com<br />
              Senha: admin123
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* First Login Password Setup Dialog */}
      <Dialog open={!!firstLoginData} onClose={handleClosePasswordSetup} maxWidth="sm" fullWidth>
        <DialogTitle>
          🔐 Definir Senha de Acesso
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Bem-vindo! Esta é a sua primeira vez fazendo login. 
            Por favor, defina uma senha segura para sua conta.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <TextField
            fullWidth
            label="Nova Senha"
            type="password"
            value={passwordSetupData.password}
            onChange={(e) => handlePasswordSetupChange('password', e.target.value)}
            margin="normal"
            required
            autoFocus
          />
          <TextField
            fullWidth
            label="Confirmar Senha"
            type="password"
            value={passwordSetupData.confirmPassword}
            onChange={(e) => handlePasswordSetupChange('confirmPassword', e.target.value)}
            margin="normal"
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClosePasswordSetup} disabled={settingPassword}>
            Cancelar
          </Button>
          <Button
            onClick={handleSetFirstPassword}
            variant="contained"
            disabled={settingPassword || !passwordSetupData.password || !passwordSetupData.confirmPassword}
          >
            {settingPassword ? 'Definindo...' : 'Definir Senha'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default Login;

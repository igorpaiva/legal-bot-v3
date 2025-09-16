import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  IconButton,
  Tooltip,
  Switch,
  FormControlLabel,
  CircularProgress,
  Avatar
} from '@mui/material';
import {
  Add as AddIcon,
  Business as BusinessIcon,
  SmartToy as BotIcon,
  AccountBox as UserIcon,
  TrendingUp as TrendingUpIcon,
  Edit as EditIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';

interface LawOffice {
  id: string;
  email: string;
  lawOfficeName: string;
  botCredits: number;
  isActive: boolean;
  createdAt: string;
}

interface SystemMetrics {
  totalLawOffices: number;
  activeLawOffices: number;
  totalBotCredits: number;
  usedBotCredits: number;
  totalBots: number;
}

interface FormData {
  email: string;
  lawOfficeName: string;
  botCredits: number;
}

const AdminDashboard: React.FC = () => {
  const [lawOffices, setLawOffices] = useState<LawOffice[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics>({
    totalLawOffices: 0,
    activeLawOffices: 0,
    totalBotCredits: 0,
    usedBotCredits: 0,
    totalBots: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOffice, setEditingOffice] = useState<LawOffice | null>(null);
  const [togglingOffice, setTogglingOffice] = useState<string | null>(null);
  const [animatingOffices, setAnimatingOffices] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState<FormData>({
    email: '',
    lawOfficeName: '',
    botCredits: 1
  });

  const calculateMetrics = useCallback(async (offices: LawOffice[]) => {
    const token = localStorage.getItem('authToken');
    
    try {
      // Get bots data for metrics
      const botsResponse = await fetch('/api/bot', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      let totalBots = 0;
      if (botsResponse.ok) {
        const botsData = await botsResponse.json();
        totalBots = botsData.bots?.length || 0;
      }

      // Calculate metrics from law offices data
      const totalLawOffices = offices.length;
      const activeLawOffices = offices.filter(office => office.isActive).length;
      const totalBotCredits = offices.reduce((sum, office) => sum + office.botCredits, 0);
      const usedBotCredits = totalBots; // Assuming each bot uses 1 credit

      setMetrics({
        totalLawOffices,
        activeLawOffices,
        totalBotCredits,
        usedBotCredits,
        totalBots
      });
    } catch (error) {
      console.warn('Failed to load metrics:', error);
    }
  }, []);

  const loadLawOffices = useCallback(async () => {
    const token = localStorage.getItem('authToken');
    
    const response = await fetch('/api/auth/law-offices', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to load law offices');
    }

    const data = await response.json();
    setLawOffices(data);
    
    // Calculate metrics after loading law offices
    calculateMetrics(data);
  }, [calculateMetrics]);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      await loadLawOffices();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadLawOffices]);

  // Load data on component mount
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleSubmitLawOffice = async () => {
    try {
      setError('');
      const token = localStorage.getItem('authToken');
      
      if (editingOffice) {
        // Update existing law office
        const updateData: any = {
          lawOfficeName: formData.lawOfficeName
        };

        const response = await fetch(`/api/auth/law-offices/${editingOffice.id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updateData)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to update law office');
        }

        // Update bot credits if changed
        if (formData.botCredits !== editingOffice.botCredits) {
          await handleUpdateBotCredits(editingOffice.id, formData.botCredits.toString());
        }

        setSuccess('Law office updated successfully');
      } else {
        // Create new law office
        const response = await fetch('/api/auth/law-offices', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: formData.email,
            lawOfficeName: formData.lawOfficeName
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create law office');
        }

        // Update bot credits after creation
        const newOfficeData = await response.json();
        if (formData.botCredits > 0) {
          await handleUpdateBotCredits(newOfficeData.lawOffice.id, formData.botCredits.toString());
        }

        setSuccess('Law office created successfully. User will set their password on first login.');
      }

      setDialogOpen(false);
      resetForm();
      await loadDashboardData();
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handleUpdateBotCredits = async (officeId: string, newCredits: string) => {
    try {
      setError('');
      const token = localStorage.getItem('authToken');
      
      const response = await fetch(`/api/auth/law-offices/${officeId}/bot-credits`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ botCredits: parseInt(newCredits) })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update bot credits');
      }

      setSuccess('Bot credits updated successfully');
      await loadLawOffices();
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handleDeleteLawOffice = async (officeId: string) => {
    if (!window.confirm('Are you sure you want to PERMANENTLY DELETE this law office? This action cannot be undone and all associated data will be lost.')) {
      return;
    }

    try {
      setError('');
      const token = localStorage.getItem('authToken');
      
      const response = await fetch(`/api/auth/law-offices/${officeId}/permanent`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete law office');
      }

      setSuccess('Law office permanently deleted successfully');
      await loadDashboardData();
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handleToggleLawOfficeStatus = async (officeId: string) => {
    try {
      setError('');
      setTogglingOffice(officeId);
      
      const token = localStorage.getItem('authToken');
      
      const response = await fetch(`/api/auth/law-offices/${officeId}/toggle-active`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to toggle law office status');
      }

      const result = await response.json();
      
      // Add animation for the office being toggled
      setAnimatingOffices(prev => new Set(prev).add(officeId));
      
      // Wait for animation to complete before updating data
      setTimeout(async () => {
        setSuccess(result.message);
        await loadDashboardData();
        setTogglingOffice(null);
        
        // Remove animation after data reload
        setTimeout(() => {
          setAnimatingOffices(prev => {
            const newSet = new Set(prev);
            newSet.delete(officeId);
            return newSet;
          });
        }, 300);
      }, 600);
      
    } catch (error) {
      setError((error as Error).message);
      setTogglingOffice(null);
    }
  };

  const resetForm = () => {
    setFormData({
      email: '',
      lawOfficeName: '',
      botCredits: 5
    });
    setEditingOffice(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (office: LawOffice) => {
    setEditingOffice(office);
    setFormData({
      email: office.email,
      lawOfficeName: office.lawOfficeName,
      botCredits: office.botCredits
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    resetForm();
  };

  const handleInputChange = (field: keyof FormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3 } }}>
        <Box 
          sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            minHeight: '60vh',
            gap: 3,
          }}
        >
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              backgroundColor: '#1976d2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'pulse 2s infinite',
            }}
          >
            <CircularProgress size={40} sx={{ color: 'white' }} />
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
              Carregando painel administrativo...
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Aguarde enquanto carregamos os dados
            </Typography>
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3 } }}>
      <Box 
        sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: { xs: 'stretch', sm: 'center' }, 
          mb: 4,
          p: 3,
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(10px)',
          borderRadius: 3,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: { xs: 2, sm: 0 }
        }}
        className="fade-in-up"
      >
        <Box>
          <Typography 
            variant="h4" 
            component="h1"
            sx={{
              color: '#1976d2',
              fontWeight: 700,
              mb: 1,
            }}
          >
            Painel Administrativo
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Gerencie escritórios e monitore o sistema
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreateDialog}
          sx={{
            borderRadius: 2,
            px: 3,
            py: 1.5,
            fontWeight: 600,
            backgroundColor: '#1976d2',
            boxShadow: '0 4px 15px rgba(25, 118, 210, 0.3)',
            '&:hover': {
              backgroundColor: '#1565c0',
              transform: 'translateY(-2px)',
              boxShadow: '0 8px 25px rgba(25, 118, 210, 0.4)',
            },
            alignSelf: { xs: 'center', sm: 'auto' }
          }}
        >
          Criar Escritório
        </Button>
      </Box>

      {error && (
        <Alert 
          severity="error" 
          sx={{ 
            mb: 3, 
            borderRadius: 2,
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            '& .MuiAlert-icon': {
              color: '#ef4444',
            },
          }} 
          onClose={() => setError('')}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {error}
          </Typography>
        </Alert>
      )}

      {success && (
        <Alert 
          severity="success" 
          sx={{ 
            mb: 3, 
            borderRadius: 2,
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            '& .MuiAlert-icon': {
              color: '#10b981',
            },
          }} 
          onClose={() => setSuccess('')}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {success}
          </Typography>
        </Alert>
      )}

      {/* System Metrics */}
      <Box 
        sx={{ 
          display: 'flex', 
          gap: { xs: 2, sm: 3 }, 
          mb: 4, 
          flexWrap: 'wrap',
          flexDirection: { xs: 'column', sm: 'row' },
          '& > *': {
            animation: 'fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
          },
          '& > *:nth-of-type(1)': { animationDelay: '0.1s' },
          '& > *:nth-of-type(2)': { animationDelay: '0.2s' },
          '& > *:nth-of-type(3)': { animationDelay: '0.3s' },
          '& > *:nth-of-type(4)': { animationDelay: '0.4s' },
        }}
      >
        <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 250px' }, minWidth: { xs: '100%', sm: '250px' }, maxWidth: '100%' }}>
          <Card
            sx={{
              backgroundColor: '#5c6bc0',
              color: 'white',
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                right: 0,
                width: '100px',
                height: '100px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '50%',
                transform: 'translate(30px, -30px)',
              },
            }}
          >
            <CardContent sx={{ position: 'relative', zIndex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography 
                    color="rgba(255, 255, 255, 0.8)" 
                    gutterBottom
                    sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                  >
                    Escritórios
                  </Typography>
                  <Typography 
                    variant="h3" 
                    sx={{ 
                      fontWeight: 700,
                      mb: 1,
                      color: '#ffffff',
                    }}
                  >
                    {metrics.activeLawOffices}/{metrics.totalLawOffices}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    Ativos / Total
                  </Typography>
                </Box>
                <BusinessIcon sx={{ fontSize: 48, opacity: 0.8 }} />
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 250px' }, minWidth: { xs: '100%', sm: '250px' }, maxWidth: '100%' }}>
          <Card
            sx={{
              backgroundColor: '#e91e63',
              color: 'white',
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                right: 0,
                width: '100px',
                height: '100px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '50%',
                transform: 'translate(30px, -30px)',
              },
            }}
          >
            <CardContent sx={{ position: 'relative', zIndex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography 
                    color="rgba(255, 255, 255, 0.8)" 
                    gutterBottom
                    sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                  >
                    Bots Ativos
                  </Typography>
                  <Typography 
                    variant="h3" 
                    sx={{ 
                      fontWeight: 700,
                      mb: 1,
                      color: '#ffffff',
                    }}
                  >
                    {metrics.totalBots}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    Em execução
                  </Typography>
                </Box>
                <BotIcon sx={{ fontSize: 48, opacity: 0.8 }} />
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 250px' }, minWidth: { xs: '100%', sm: '250px' }, maxWidth: '100%' }}>
          <Card
            sx={{
              backgroundColor: '#03a9f4',
              color: 'white',
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                right: 0,
                width: '100px',
                height: '100px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '50%',
                transform: 'translate(30px, -30px)',
              },
            }}
          >
            <CardContent sx={{ position: 'relative', zIndex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography 
                    color="rgba(255, 255, 255, 0.8)" 
                    gutterBottom
                    sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                  >
                    Créditos Bot
                  </Typography>
                  <Typography 
                    variant="h3" 
                    sx={{ 
                      fontWeight: 700,
                      mb: 1,
                      color: '#ffffff',
                    }}
                  >
                    {metrics.usedBotCredits}/{metrics.totalBotCredits}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    Utilizados / Total
                  </Typography>
                </Box>
                <TrendingUpIcon sx={{ fontSize: 48, opacity: 0.8 }} />
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 250px' }, minWidth: { xs: '100%', sm: '250px' }, maxWidth: '100%' }}>
          <Card
            sx={{
              backgroundColor: '#4caf50',
              color: 'white',
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                right: 0,
                width: '100px',
                height: '100px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '50%',
                transform: 'translate(30px, -30px)',
              },
            }}
          >
            <CardContent sx={{ position: 'relative', zIndex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography 
                    color="rgba(255, 255, 255, 0.8)" 
                    gutterBottom
                    sx={{ fontSize: '0.875rem', fontWeight: 500 }}
                  >
                    Utilização
                  </Typography>
                  <Typography 
                    variant="h3" 
                    sx={{ 
                      fontWeight: 700,
                      mb: 1,
                      color: '#ffffff',
                    }}
                  >
                    {metrics.totalBotCredits > 0 ? Math.round((metrics.usedBotCredits / metrics.totalBotCredits) * 100) : 0}%
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    Taxa de uso
                  </Typography>
                </Box>
                <UserIcon sx={{ fontSize: 48, opacity: 0.8 }} />
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* Law Offices Management */}
      <Paper 
        sx={{
          borderRadius: 3,
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        }}
        className="slide-in-right"
      >
        <Box 
          sx={{ 
            p: 3, 
            backgroundColor: '#1976d2',
            color: 'white',
          }}
        >
          <Typography 
            variant="h6" 
            gutterBottom
            sx={{ 
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <BusinessIcon />
            Gerenciamento de Escritórios
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9 }}>
            Gerencie todos os escritórios cadastrados no sistema
          </Typography>
        </Box>
        <TableContainer sx={{ overflowX: { xs: 'auto', sm: 'visible' } }}>
          <Table sx={{ minWidth: { xs: 600, sm: 'auto' } }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: 'rgba(0, 212, 170, 0.05)' }}>
                <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Escritório</TableCell>
                <TableCell sx={{ fontWeight: 600, color: '#374151' }}>E-mail</TableCell>
                <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Créditos Bot</TableCell>
                <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Criado</TableCell>
                <TableCell sx={{ fontWeight: 600, color: '#374151' }}>Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lawOffices.map((office) => (
                <TableRow 
                  key={office.id}
                  sx={{
                    opacity: animatingOffices.has(office.id) ? 0.5 : 1,
                    transform: animatingOffices.has(office.id) ? 'translateY(10px)' : 'translateY(0px)',
                    transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                    backgroundColor: animatingOffices.has(office.id) ? 'rgba(0, 0, 0, 0.04)' : 'inherit',
                    '&:hover': {
                      backgroundColor: 'rgba(25, 118, 210, 0.04)',
                      transform: 'translateY(-1px)',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar 
                        sx={{ 
                          width: 32, 
                          height: 32, 
                          backgroundColor: '#1976d2',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                        }}
                      >
                        {office.lawOfficeName.charAt(0).toUpperCase()}
                      </Avatar>
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        {office.lawOfficeName}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                      {office.email}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      type="number"
                      size="small"
                      value={office.botCredits}
                      onChange={(e) => handleUpdateBotCredits(office.id, e.target.value)}
                      inputProps={{ min: 0 }}
                      sx={{ 
                        width: 80,
                        '& .MuiOutlinedInput-root': {
                          borderRadius: 2,
                          backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <FormControlLabel
                      control={
                        togglingOffice === office.id ? (
                          <CircularProgress size={20} />
                        ) : (
                          <Switch
                            checked={office.isActive}
                            onChange={() => handleToggleLawOfficeStatus(office.id)}
                            color="primary"
                            sx={{
                              '& .MuiSwitch-switchBase.Mui-checked': {
                                color: '#10b981',
                                '& + .MuiSwitch-track': {
                                  backgroundColor: '#10b981',
                                },
                              },
                              '& .MuiSwitch-track': {
                                borderRadius: 12,
                              },
                            }}
                          />
                        )
                      }
                      label=""
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                      {formatDate(office.createdAt)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Tooltip title="Editar Escritório">
                        <IconButton
                          size="small"
                          onClick={() => openEditDialog(office)}
                          sx={{ 
                            color: '#1976d2',
                            '&:hover': {
                              backgroundColor: 'rgba(25, 118, 210, 0.1)',
                              transform: 'scale(1.1)',
                            },
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Excluir Permanentemente">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteLawOffice(office.id)}
                          sx={{
                            '&:hover': {
                              backgroundColor: 'rgba(239, 68, 68, 0.1)',
                              transform: 'scale(1.1)',
                            },
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {lawOffices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Box sx={{ textAlign: 'center', color: '#9ca3af' }}>
                      <BusinessIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
                      <Typography variant="body1" gutterBottom>
                        Nenhum escritório encontrado
                      </Typography>
                      <Typography variant="body2">
                        Clique em "Criar Escritório" para adicionar o primeiro escritório
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Create Law Office Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={closeDialog} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(10px)',
          }
        }}
      >
        <DialogTitle 
          sx={{
            backgroundColor: '#1976d2',
            color: 'white',
            borderRadius: '12px 12px 0 0',
            pb: 3,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddIcon />
            {editingOffice ? 'Editar Escritório' : 'Criar Novo Escritório'}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
              fullWidth
              label="Nome do Escritório"
              value={formData.lawOfficeName}
              onChange={(e) => handleInputChange('lawOfficeName', e.target.value)}
              margin="none"
              required
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  },
                  '&.Mui-focused': {
                    backgroundColor: 'white',
                    boxShadow: '0 0 0 3px rgba(0, 212, 170, 0.1)',
                  },
                },
              }}
            />
            <TextField
              fullWidth
              label="E-mail"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              margin="none"
              required={!editingOffice}
              disabled={!!editingOffice}
              helperText={editingOffice ? "E-mail não pode ser alterado" : ""}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  },
                  '&.Mui-focused': {
                    backgroundColor: 'white',
                    boxShadow: '0 0 0 3px rgba(0, 212, 170, 0.1)',
                  },
                },
              }}
            />
            <TextField
              fullWidth
              label="Créditos Iniciais de Bot"
              type="number"
              value={formData.botCredits}
              onChange={(e) => handleInputChange('botCredits', parseInt(e.target.value) || 0)}
              margin="none"
              inputProps={{ min: 0 }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  },
                  '&.Mui-focused': {
                    backgroundColor: 'white',
                    boxShadow: '0 0 0 3px rgba(0, 212, 170, 0.1)',
                  },
                },
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 2 }}>
          <Button 
            onClick={closeDialog}
            sx={{
              borderRadius: 2,
              px: 3,
              color: '#6b7280',
              '&:hover': {
                backgroundColor: 'rgba(107, 114, 128, 0.1)',
              },
            }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmitLawOffice}
            variant="contained"
            disabled={!formData.lawOfficeName || (!editingOffice && !formData.email)}
            sx={{
              borderRadius: 2,
              px: 3,
              backgroundColor: '#1976d2',
              boxShadow: '0 4px 15px rgba(25, 118, 210, 0.3)',
              '&:hover': {
                backgroundColor: '#1565c0',
                transform: 'translateY(-1px)',
                boxShadow: '0 6px 20px rgba(25, 118, 210, 0.4)',
              },
              '&:disabled': {
                background: '#e5e7eb',
                color: '#9ca3af',
              },
            }}
          >
            {editingOffice ? 'Atualizar Escritório' : 'Criar Escritório'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default AdminDashboard;

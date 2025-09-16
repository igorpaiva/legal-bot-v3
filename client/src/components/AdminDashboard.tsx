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
  Chip,
  IconButton,
  Tooltip,
  Switch,
  FormControlLabel,
  CircularProgress
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
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Typography>Carregando painel administrativo...</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          Painel Administrativo
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreateDialog}
        >
          Criar Escritório
        </Button>
      </Box>

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

      {/* System Metrics */}
      <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 250px' }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <BusinessIcon sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Escritórios
                  </Typography>
                  <Typography variant="h4">
                    {metrics.activeLawOffices}/{metrics.totalLawOffices}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ flex: '1 1 250px' }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <BotIcon sx={{ fontSize: 40, color: 'secondary.main', mr: 2 }} />
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Bots Ativos
                  </Typography>
                  <Typography variant="h4">
                    {metrics.totalBots}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ flex: '1 1 250px' }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TrendingUpIcon sx={{ fontSize: 40, color: 'success.main', mr: 2 }} />
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Créditos Bot
                  </Typography>
                  <Typography variant="h4">
                    {metrics.usedBotCredits}/{metrics.totalBotCredits}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ flex: '1 1 250px' }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <UserIcon sx={{ fontSize: 40, color: 'warning.main', mr: 2 }} />
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Utilização
                  </Typography>
                  <Typography variant="h4">
                    {metrics.totalBotCredits > 0 ? Math.round((metrics.usedBotCredits / metrics.totalBotCredits) * 100) : 0}%
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* Law Offices Management */}
      <Paper>
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Gerenciamento de Escritórios
          </Typography>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Escritório</TableCell>
                <TableCell>E-mail</TableCell>
                <TableCell>Créditos Bot</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Criado</TableCell>
                <TableCell>Ações</TableCell>
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
                    backgroundColor: animatingOffices.has(office.id) ? 'rgba(0, 0, 0, 0.04)' : 'inherit'
                  }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <BusinessIcon sx={{ mr: 1, color: 'primary.main' }} />
                      {office.lawOfficeName}
                    </Box>
                  </TableCell>
                  <TableCell>{office.email}</TableCell>
                  <TableCell>
                    <TextField
                      type="number"
                      size="small"
                      value={office.botCredits}
                      onChange={(e) => handleUpdateBotCredits(office.id, e.target.value)}
                      inputProps={{ min: 0 }}
                      sx={{ width: 80 }}
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
                                color: '#4caf50',
                                '& + .MuiSwitch-track': {
                                  backgroundColor: '#4caf50',
                                },
                              },
                            }}
                          />
                        )
                      }
                      label=""
                    />
                  </TableCell>
                  <TableCell>{formatDate(office.createdAt)}</TableCell>
                  <TableCell>
                    <Tooltip title="Editar Escritório">
                      <IconButton
                        size="small"
                        onClick={() => openEditDialog(office)}
                        sx={{ mr: 1 }}
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Excluir Permanentemente">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDeleteLawOffice(office.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {lawOffices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary">
                      Nenhum escritório encontrado
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Create Law Office Dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingOffice ? 'Editar Escritório' : 'Criar Novo Escritório'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <TextField
              fullWidth
              label="Nome do Escritório"
              value={formData.lawOfficeName}
              onChange={(e) => handleInputChange('lawOfficeName', e.target.value)}
              margin="normal"
              required
            />
            <TextField
              fullWidth
              label="E-mail"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              margin="normal"
              required={!editingOffice}
              disabled={!!editingOffice}
              helperText={editingOffice ? "E-mail não pode ser alterado" : ""}
            />
            <TextField
              fullWidth
              label="Créditos Iniciais de Bot"
              type="number"
              value={formData.botCredits}
              onChange={(e) => handleInputChange('botCredits', parseInt(e.target.value) || 0)}
              margin="normal"
              inputProps={{ min: 0 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancelar</Button>
          <Button
            onClick={handleSubmitLawOffice}
            variant="contained"
            disabled={!formData.lawOfficeName || (!editingOffice && !formData.email)}
          >
            {editingOffice ? 'Atualizar Escritório' : 'Criar Escritório'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default AdminDashboard;

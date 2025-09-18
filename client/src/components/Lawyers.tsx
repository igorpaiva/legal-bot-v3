import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Alert,
  Chip,
  Card,
  CardContent
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Cancel as CancelIcon
} from '@mui/icons-material';
import api from '../services/api';

// Legal field options (same as Reports)
const legalFields = [
  'Trabalhista',
  'Civil',
  'Penal',
  'Empresarial',
  'Tributário',
  'Administrativo',
  'Constitucional',
  'Família',
  'Consumidor',
  'Imobiliário',
  'Previdenciário',
  'Internacional',
  'Outros'
];

interface Lawyer {
  id: string;
  name: string;
  specialty: string;
  phone: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LawyerFormData {
  name: string;
  specialty: string;
  phone: string;
  email: string;
}

const Lawyers: React.FC = () => {
  const [lawyers, setLawyers] = useState<Lawyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [lawyerToDelete, setLawyerToDelete] = useState<Lawyer | null>(null);
  const [editingLawyer, setEditingLawyer] = useState<Lawyer | null>(null);
  const [formData, setFormData] = useState<LawyerFormData>({
    name: '',
    specialty: '',
    phone: '',
    email: ''
  });
  const [errors, setErrors] = useState<Partial<LawyerFormData>>({});
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadLawyers();
  }, []);

  const loadLawyers = async () => {
    setLoading(true);
    try {
      const response = await api.get('/lawyers');
      setLawyers(response.data);
    } catch (error) {
      console.error('Error loading lawyers:', error);
      setAlert({ type: 'error', message: 'Erro ao carregar advogados' });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (lawyer?: Lawyer) => {
    if (lawyer) {
      setEditingLawyer(lawyer);
      setFormData({
        name: lawyer.name,
        specialty: lawyer.specialty,
        phone: lawyer.phone,
        email: lawyer.email || ''
      });
    } else {
      setEditingLawyer(null);
      setFormData({
        name: '',
        specialty: '',
        phone: '',
        email: ''
      });
    }
    setErrors({});
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingLawyer(null);
    setFormData({ name: '', specialty: '', phone: '', email: '' });
    setErrors({});
  };

  const formatPhoneInput = (value: string): string => {
    // Remove all non-numeric characters
    const numbers = value.replace(/\D/g, '');
    
    // Limit to 11 digits (DDD + 9 digits)
    const limited = numbers.slice(0, 11);
    
    // Format as (0XX) XXXXX-XXXX
    if (limited.length <= 2) {
      return limited;
    } else if (limited.length <= 7) {
      return `(${limited.slice(0, 2)}) ${limited.slice(2)}`;
    } else {
      return `(${limited.slice(0, 2)}) ${limited.slice(2, 7)}-${limited.slice(7)}`;
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<LawyerFormData> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Nome é obrigatório';
    }

    if (!formData.specialty) {
      newErrors.specialty = 'Especialidade é obrigatória';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Telefone é obrigatório';
    } else {
      const phoneNumbers = formData.phone.replace(/\D/g, '');
      if (phoneNumbers.length !== 11) {
        newErrors.phone = 'Telefone deve ter 11 dígitos (DDD + 9 dígitos)';
      }
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Email inválido';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    try {
      const lawyerData = {
        ...formData,
        phone: formData.phone.replace(/\D/g, '') // Store only numbers
      };

      if (editingLawyer) {
        await api.put(`/lawyers/${editingLawyer.id}`, lawyerData);
        setAlert({ type: 'success', message: 'Advogado atualizado com sucesso' });
      } else {
        await api.post('/lawyers', lawyerData);
        setAlert({ type: 'success', message: 'Advogado cadastrado com sucesso' });
      }

      handleCloseDialog();
      loadLawyers();
    } catch (error) {
      console.error('Error saving lawyer:', error);
      setAlert({ type: 'error', message: 'Erro ao salvar advogado' });
    }
  };

  const handleDelete = (lawyer: Lawyer) => {
    setLawyerToDelete(lawyer);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!lawyerToDelete) return;

    try {
      await api.delete(`/lawyers/${lawyerToDelete.id}`);
      setAlert({ type: 'success', message: 'Advogado excluído com sucesso' });
      loadLawyers();
    } catch (error) {
      console.error('Error deleting lawyer:', error);
      setAlert({ type: 'error', message: 'Erro ao excluir advogado' });
    } finally {
      setDeleteDialogOpen(false);
      setLawyerToDelete(null);
    }
  };

  const handleToggleActive = async (lawyer: Lawyer) => {
    try {
      await api.patch(`/lawyers/${lawyer.id}/toggle-active`);
      setAlert({ 
        type: 'success', 
        message: `Advogado ${lawyer.isActive ? 'desativado' : 'ativado'} com sucesso` 
      });
      loadLawyers();
    } catch (error) {
      console.error('Error toggling lawyer status:', error);
      setAlert({ type: 'error', message: 'Erro ao alterar status do advogado' });
    }
  };

  const formatPhoneDisplay = (phone: string): string => {
    if (phone.length === 11) {
      return `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
    }
    return phone;
  };

  const getSpecialtyColor = (specialty: string) => {
    const colors = [
      'primary', 'secondary', 'success', 'warning', 'info', 'error'
    ];
    const index = legalFields.indexOf(specialty);
    return colors[index % colors.length] as any;
  };

  const getSpecialtyStats = () => {
    const stats = legalFields.map(field => ({
      field,
      count: lawyers.filter(l => l.specialty === field && l.isActive).length
    }));
    return stats.filter(s => s.count > 0);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography>Carregando advogados...</Typography>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={4} flexDirection={{ xs: 'column', sm: 'row' }} gap={{ xs: 3, sm: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, color: 'primary.main' }}>
            Gestão de Advogados
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ lineHeight: 1.6 }}>
            Gerencie a equipe de advogados, suas especialidades e disponibilidade para atendimento
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
          size="large"
          sx={{ 
            minWidth: { xs: '100%', sm: 'auto' },
            py: 1.5,
            px: 3,
            fontWeight: 600
          }}
        >
          Novo Advogado
        </Button>
      </Box>

      {alert && (
        <Alert 
          severity={alert.type} 
          onClose={() => setAlert(null)}
          sx={{ mb: 3 }}
        >
          {alert.message}
        </Alert>
      )}

      {/* Statistics Cards */}
      <Box sx={{ 
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, 1fr)',
          md: 'repeat(4, 1fr)'
        },
        gap: 2,
        mb: 4
      }}>
        <Card sx={{ 
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3
          }
        }}>
          <CardContent sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            py: 2
          }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography color="textSecondary" gutterBottom variant="body2" sx={{ fontWeight: 500 }}>
                Total de Advogados
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#25D366' }}>
                {lawyers.length}
              </Typography>
            </Box>
            <Box sx={{ 
              color: '#25D366', 
              fontSize: 36,
              backgroundColor: '#25D36615',
              borderRadius: '50%',
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              👨‍⚖️
            </Box>
          </CardContent>
        </Card>
        <Card sx={{ 
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3
          }
        }}>
          <CardContent sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            py: 2
          }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography color="textSecondary" gutterBottom variant="body2" sx={{ fontWeight: 500 }}>
                Advogados Ativos
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#4caf50' }}>
                {lawyers.filter(l => l.isActive).length}
              </Typography>
            </Box>
            <Box sx={{ 
              color: '#4caf50', 
              fontSize: 36,
              backgroundColor: '#4caf5015',
              borderRadius: '50%',
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              ✅
            </Box>
          </CardContent>
        </Card>
        <Card sx={{ 
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3
          }
        }}>
          <CardContent sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            py: 2
          }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography color="textSecondary" gutterBottom variant="body2" sx={{ fontWeight: 500 }}>
                Especialidades Cobertas
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#2196f3' }}>
                {getSpecialtyStats().length}
              </Typography>
            </Box>
            <Box sx={{ 
              color: '#2196f3', 
              fontSize: 36,
              backgroundColor: '#2196f315',
              borderRadius: '50%',
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              📚
            </Box>
          </CardContent>
        </Card>
        <Card sx={{ 
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3
          }
        }}>
          <CardContent sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            py: 2
          }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography color="textSecondary" gutterBottom variant="body2" sx={{ fontWeight: 500 }}>
                Advogados Inativos
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#ff9800' }}>
                {lawyers.filter(l => !l.isActive).length}
              </Typography>
            </Box>
            <Box sx={{ 
              color: '#ff9800', 
              fontSize: 36,
              backgroundColor: '#ff980015',
              borderRadius: '50%',
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              ⏸️
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Specialty Coverage */}
      {getSpecialtyStats().length > 0 && (
        <Paper sx={{ 
          p: 3, 
          mb: 3,
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3
          }
        }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
            Cobertura por Especialidade
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1.5}>
            {getSpecialtyStats().map(stat => (
              <Chip
                key={stat.field}
                label={`${stat.field} (${stat.count})`}
                color={getSpecialtyColor(stat.field)}
                variant="filled"
              />
            ))}
          </Box>
        </Paper>
      )}

      {/* Lawyers Table */}
      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Nome</TableCell>
                <TableCell>Especialidade</TableCell>
                <TableCell>Telefone</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lawyers.map((lawyer) => (
                <TableRow key={lawyer.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {lawyer.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={lawyer.specialty}
                      color={getSpecialtyColor(lawyer.specialty)}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    {formatPhoneDisplay(lawyer.phone)}
                  </TableCell>
                  <TableCell>
                    {lawyer.email || '-'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={lawyer.isActive ? 'Ativo' : 'Inativo'}
                      color={lawyer.isActive ? 'success' : 'default'}
                      size="small"
                      onClick={() => handleToggleActive(lawyer)}
                      style={{ cursor: 'pointer' }}
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Editar">
                      <IconButton
                        size="small"
                        onClick={() => handleOpenDialog(lawyer)}
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Excluir">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(lawyer)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {lawyers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography color="textSecondary" py={4}>
                      Nenhum advogado cadastrado
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingLawyer ? 'Editar Advogado' : 'Novo Advogado'}
        </DialogTitle>
        <DialogContent>
          <Box component="form" noValidate sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label="Nome Completo"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              error={!!errors.name}
              helperText={errors.name}
              margin="normal"
              required
            />
            
            <FormControl fullWidth margin="normal" error={!!errors.specialty} required>
              <InputLabel>Especialidade</InputLabel>
              <Select
                value={formData.specialty}
                label="Especialidade"
                onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
              >
                {legalFields.map((field) => (
                  <MenuItem key={field} value={field}>
                    {field}
                  </MenuItem>
                ))}
              </Select>
              {errors.specialty && (
                <Typography variant="caption" color="error" sx={{ mt: 1, ml: 2 }}>
                  {errors.specialty}
                </Typography>
              )}
            </FormControl>

            <TextField
              fullWidth
              label="Telefone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: formatPhoneInput(e.target.value) })}
              error={!!errors.phone}
              helperText={errors.phone || 'Formato: (011) 99999-9999'}
              margin="normal"
              required
              placeholder="(011) 99999-9999"
            />

            <TextField
              fullWidth
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              error={!!errors.email}
              helperText={errors.email || 'Email opcional para notificações'}
              margin="normal"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} startIcon={<CancelIcon />}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} variant="contained" startIcon={<SaveIcon />}>
            {editingLawyer ? 'Atualizar' : 'Cadastrar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog 
        open={deleteDialogOpen} 
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Confirmar Exclusão</DialogTitle>
        <DialogContent>
          <Typography>
            Tem certeza que deseja excluir o advogado <strong>{lawyerToDelete?.name}</strong>?
            Esta ação não pode ser desfeita.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={confirmDelete} variant="contained" color="error">
            Excluir
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Lawyers;

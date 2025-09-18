import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Avatar,
  Tooltip,
  Alert
} from '@mui/material';
import {
  Add,
  PlayArrow,
  Stop,
  RestartAlt,
  Delete,
  QrCode,
  Phone,
  Error,
  CheckCircle,
  Schedule,
  SmartToy,
  PhoneAndroid,
  Message
} from '@mui/icons-material';
import { Bot, SystemStatus } from '../types';
import api from '../services/api';

interface BotManagerProps {
  bots: Bot[];
  onNotification: (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;
  onUserDataRefresh?: () => void;
  user?: {
    id: string;
    email: string;
    role: 'admin' | 'law_office';
    lawOfficeName?: string;
    botCredits?: number;
  };
  systemStatus?: SystemStatus | null;
}

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon, color, subtitle }) => (
  <Card sx={{ 
    minWidth: { xs: '100%', sm: 240 }, 
    maxWidth: { xs: '100%', sm: 280 },
    m: 1, 
    transition: 'all 0.3s ease',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: 2
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
          {title}
        </Typography>
        <Typography variant="h4" component="h2" sx={{ fontWeight: 700, mb: 0.5 }}>
          {value}
        </Typography>
        {subtitle && (
          <Typography color="textSecondary" variant="body2" sx={{ fontSize: '0.8rem' }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ 
        color, 
        fontSize: 36,
        backgroundColor: `${color}15`,
        borderRadius: '50%',
        p: 1.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {icon}
      </Box>
    </CardContent>
  </Card>
);

interface QRCodeDialogProps {
  open: boolean;
  onClose: () => void;
  bot: Bot | null;
}

const QRCodeDialog: React.FC<QRCodeDialogProps> = ({ open, onClose, bot }) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        QR Code para {bot?.name}
      </DialogTitle>
      <DialogContent>
        {bot?.qrCode ? (
          <Box sx={{ textAlign: 'center', p: 2 }}>
            <img 
              src={bot.qrCode} 
              alt="QR Code do WhatsApp" 
              style={{ maxWidth: '100%', height: 'auto' }}
            />
            <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
              Escaneie este QR code com seu aplicativo WhatsApp mobile
            </Typography>
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', p: 4 }}>
            <Typography>QR Code não disponível</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
};

const BotCard: React.FC<{ 
  bot: Bot; 
  onAction: (action: string, botId: string) => void;
  onShowQR: (bot: Bot) => void;
}> = ({ bot, onAction, onShowQR }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'success';
      case 'waiting_for_scan': return 'warning';
      case 'error': return 'error';
      case 'disconnected': return 'default';
      case 'stopped': return 'default';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return <CheckCircle />;
      case 'waiting_for_scan': return <QrCode />;
      case 'error': return <Error />;
      case 'disconnected': return <Phone />;
      default: return <Schedule />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Card sx={{ 
      minWidth: { xs: '100%', sm: 320 }, 
      maxWidth: { xs: '100%', sm: 400 },
      m: 1, 
      height: 'fit-content',
      transition: 'all 0.3s ease',
      '&:hover': {
        transform: 'translateY(-4px)',
        boxShadow: 3
      }
    }}>
      <CardContent sx={{ pb: 1 }}>
        {/* Header with Status */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Avatar sx={{ 
            mr: 2, 
            bgcolor: getStatusColor(bot.status) === 'success' ? '#25D366' : '#ccc',
            width: 48,
            height: 48
          }}>
            {getStatusIcon(bot.status)}
          </Avatar>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }} noWrap>
              {bot.name}
            </Typography>
            {bot.assistantName && (
              <Typography variant="body2" color="textSecondary" sx={{ fontStyle: 'italic', mb: 0.5 }} noWrap>
                Assistente: {bot.assistantName}
              </Typography>
            )}
            <Chip 
              label={bot.status.replace(/_/g, ' ')} 
              color={getStatusColor(bot.status)} 
              size="small"
              sx={{ fontWeight: 500 }}
            />
          </Box>
        </Box>

        {/* Bot Information */}
        <Box sx={{ mb: 2 }}>
          {bot.phoneNumber && (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <PhoneAndroid sx={{ mr: 1, fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="textSecondary">
                {bot.phoneNumber}
              </Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Message sx={{ mr: 1, fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" color="textSecondary">
              {bot.messageCount} mensagens processadas
            </Typography>
          </Box>

          {bot.lastActivity && (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Schedule sx={{ mr: 1, fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="textSecondary" noWrap>
                Última atividade: {formatDate(bot.lastActivity)}
              </Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Schedule sx={{ mr: 1, fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" color="textSecondary" noWrap>
              Criado em: {formatDate(bot.createdAt)}
            </Typography>
          </Box>
        </Box>

        {bot.error && (
          <Alert severity="error" sx={{ mt: 1, fontSize: '0.875rem' }}>
            {bot.error}
          </Alert>
        )}
      </CardContent>

      <CardActions sx={{ 
        justifyContent: 'space-between', 
        px: 2, 
        py: 1.5,
        borderTop: 1,
        borderColor: 'divider',
        backgroundColor: 'grey.50'
      }}>
        {/* QR Code Button */}
        {bot.status === 'waiting_for_scan' && bot.qrCode && (
          <Tooltip title="Mostrar QR Code para conectar">
            <Button 
              onClick={() => onShowQR(bot)} 
              color="primary"
              variant="outlined"
              size="small"
              startIcon={<QrCode />}
            >
              QR Code
            </Button>
          </Tooltip>
        )}
        
        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          {bot.isActive ? (
            <Tooltip title="Parar Bot">
              <IconButton 
                onClick={() => onAction('stop', bot.id)} 
                color="error"
                size="small"
                sx={{ 
                  bgcolor: 'error.light',
                  color: 'white',
                  '&:hover': { bgcolor: 'error.main' }
                }}
              >
                <Stop />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Iniciar Bot">
              <IconButton 
                onClick={() => onAction('restart', bot.id)} 
                color="success"
                size="small"
                sx={{ 
                  bgcolor: 'success.light',
                  color: 'white',
                  '&:hover': { bgcolor: 'success.main' }
                }}
              >
                <PlayArrow />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title="Reiniciar Bot">
            <IconButton 
              onClick={() => onAction('restart', bot.id)} 
              color="warning"
              size="small"
              sx={{ 
                bgcolor: 'warning.light',
                color: 'white',
                '&:hover': { bgcolor: 'warning.main' }
              }}
            >
              <RestartAlt />
            </IconButton>
          </Tooltip>

          <Tooltip title="Excluir Bot">
            <IconButton 
              onClick={() => onAction('delete', bot.id)} 
              color="error"
              size="small"
              sx={{ 
                bgcolor: 'error.light',
                color: 'white',
                '&:hover': { bgcolor: 'error.main' }
              }}
            >
              <Delete />
            </IconButton>
          </Tooltip>
        </Box>
      </CardActions>
    </Card>
  );
};

const BotManager: React.FC<BotManagerProps> = ({ bots, onNotification, onUserDataRefresh, user, systemStatus }) => {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const [newBotName, setNewBotName] = useState('');
  const [newAssistantName, setNewAssistantName] = useState('Ana'); // Default to Ana
  const [loading, setLoading] = useState(false);

  // Statistics calculations
  const activeBots = bots.filter(bot => bot.isActive).length;
  const totalMessages = bots.reduce((sum, bot) => sum + bot.messageCount, 0);
  const connectedBots = bots.filter(bot => bot.status === 'connected').length;

  // Auto-close QR dialog when bot connects
  useEffect(() => {
    if (selectedBot && qrDialogOpen) {
      // Find the updated bot data
      const updatedBot = bots.find(bot => bot.id === selectedBot.id);
      console.log('QR Dialog Check:', {
        selectedBotId: selectedBot.id,
        updatedBot: updatedBot ? {
          id: updatedBot.id,
          name: updatedBot.name,
          status: updatedBot.status
        } : null,
        shouldClose: updatedBot && (updatedBot.status === 'ready' || updatedBot.status === 'connected' || updatedBot.status === 'authenticated')
      });
      
      // Check for 'ready', 'connected' or 'authenticated' status - backend uses 'ready' for connected bots
      if (updatedBot && (updatedBot.status === 'ready' || updatedBot.status === 'connected' || updatedBot.status === 'authenticated')) {
        console.log('Closing QR dialog - bot connected!');
        setQrDialogOpen(false);
        setSelectedBot(null);
        onNotification(`Bot ${updatedBot.name} conectado com sucesso!`, 'success');
      }
    }
  }, [bots, selectedBot, qrDialogOpen, onNotification]);

  const handleCreateBot = async () => {
    if (!newBotName.trim()) return;

    setLoading(true);
    try {
      const response = await api.post('/bot', { 
        name: newBotName,
        assistantName: newAssistantName.trim() || 'Ana' 
      });
      if (response.data.success) {
        onNotification('Bot created successfully!', 'success');
        setCreateDialogOpen(false);
        setNewBotName('');
        setNewAssistantName('Ana'); // Reset to default
        
        // Refresh user data to update bot credits
        if (onUserDataRefresh) {
          onUserDataRefresh();
        }
        
        // The bot will be added via socket.io events
      } else {
        onNotification(response.data.error || 'Failed to create bot', 'error');
      }
    } catch (error: any) {
      onNotification(error.response?.data?.error || 'Failed to create bot', 'error');
    }
    setLoading(false);
  };

  const handleBotAction = async (action: string, botId: string) => {
    setLoading(true);
    try {
      let response;
      switch (action) {
        case 'stop':
          response = await api.post(`/bot/${botId}/stop`);
          break;
        case 'restart':
          response = await api.post(`/bot/${botId}/restart`);
          break;
        case 'delete':
          response = await api.delete(`/bot/${botId}`);
          break;
        default:
          return;
      }

      if (response.data.success) {
        onNotification(response.data.message || `Bot ${action} successful`, 'success');
      } else {
        onNotification(response.data.error || `Failed to ${action} bot`, 'error');
      }
    } catch (error: any) {
      onNotification(error.response?.data?.error || `Failed to ${action} bot`, 'error');
    }
    setLoading(false);
  };

  const showQRCode = (bot: Bot) => {
    setSelectedBot(bot);
    setQrDialogOpen(true);
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start', 
        mb: 4, 
        flexDirection: { xs: 'column', sm: 'row' }, 
        gap: { xs: 3, sm: 2 }
      }}>
        <Box sx={{ maxWidth: { xs: '100%', sm: '60%' } }}>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, color: 'primary.main' }}>
            Gerenciar Bots WhatsApp
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ lineHeight: 1.6 }}>
            Gerencie seus bots de atendimento automatizado, monitore estatísticas em tempo real 
            e acompanhe o desempenho da sua automação jurídica.
          </Typography>
        </Box>
        
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
          disabled={loading || (user?.role === 'law_office' && (user.botCredits || 0) <= bots.length)}
          size="large"
          sx={{ 
            minWidth: { xs: '100%', sm: 'auto' },
            py: 1.5,
            px: 3,
            fontWeight: 600
          }}
        >
          Criar Novo Bot
        </Button>
      </Box>

      {/* Statistics Cards */}
      <Box sx={{ 
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(auto-fit, minmax(240px, 1fr))',
        },
        gap: 2,
        mb: 4,
        maxWidth: '100%'
      }}>
        <StatsCard
          title="Total de Bots"
          value={bots.length}
          icon={<SmartToy />}
          color="#25D366"
        />
        
        <StatsCard
          title="Bots Conectados"
          value={connectedBots}
          icon={<PhoneAndroid />}
          color="#128C7E"
          subtitle={`${activeBots} ativos`}
        />
        
        <StatsCard
          title="Mensagens Processadas"
          value={totalMessages.toLocaleString()}
          icon={<Message />}
          color="#075E54"
        />

        {user?.role === 'law_office' && (
          <StatsCard
            title="Créditos Disponíveis"
            value={(user.botCredits || 0) - bots.length}
            icon={<SmartToy />}
            color="#FF6B35"
            subtitle={`${bots.length} em uso de ${user.botCredits || 0}`}
          />
        )}
      </Box>

      {/* Credits Warning for Law Office Users */}
      {user?.role === 'law_office' && (
        <>
          {(user.botCredits || 0) <= bots.length && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Você não possui créditos suficientes para criar novos bots. Entre em contato com o administrador para obter mais créditos.
            </Alert>
          )}
          
          {(user.botCredits || 0) - bots.length <= 1 && (user.botCredits || 0) > bots.length && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Você possui apenas {(user.botCredits || 0) - bots.length} crédito(s) restante(s). Considere solicitar mais créditos ao administrador.
            </Alert>
          )}
        </>
      )}

      {/* Bots Grid */}
      <Box sx={{ 
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(auto-fill, minmax(320px, 1fr))',
          lg: 'repeat(auto-fill, minmax(350px, 1fr))'
        },
        gap: 3,
        mt: 2
      }}>
        {bots.length === 0 ? (
          <Box sx={{ 
            gridColumn: '1 / -1',
            display: 'flex',
            justifyContent: 'center'
          }}>
            <Card sx={{ 
              minWidth: { xs: '100%', sm: 400 }, 
              maxWidth: 500,
              textAlign: 'center',
              py: 4
            }}>
              <CardContent>
                <SmartToy sx={{ 
                  fontSize: 64, 
                  color: 'text.secondary', 
                  mb: 2 
                }} />
                <Typography variant="h6" color="textSecondary" gutterBottom>
                  Nenhum bot criado ainda
                </Typography>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
                  Comece criando seu primeiro bot WhatsApp para automatizar o atendimento jurídico
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={() => setCreateDialogOpen(true)}
                  disabled={loading || (user?.role === 'law_office' && (user.botCredits || 0) <= bots.length)}
                  size="large"
                >
                  Criar Primeiro Bot
                </Button>
              </CardContent>
            </Card>
          </Box>
        ) : (
          bots.map(bot => (
            <BotCard
              key={bot.id}
              bot={bot}
              onAction={handleBotAction}
              onShowQR={showQRCode}
            />
          ))
        )}
      </Box>

      {/* Create Bot Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>Criar Novo Bot</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Nome do Bot"
            fullWidth
            variant="outlined"
            value={newBotName}
            onChange={(e) => setNewBotName(e.target.value)}
            placeholder="Digite um nome para seu bot"
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Nome do Assistente"
            fullWidth
            variant="outlined"
            value={newAssistantName}
            onChange={(e) => setNewAssistantName(e.target.value)}
            placeholder="Digite o nome do assistente (ex: Ana, Maria, João)"
            helperText="Este é o nome que seu bot usará ao conversar com clientes"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setCreateDialogOpen(false);
            setNewBotName('');
            setNewAssistantName('Ana');
          }}>Cancelar</Button>
          <Button 
            onClick={handleCreateBot} 
            variant="contained"
            disabled={!newBotName.trim() || !newAssistantName.trim() || loading}
          >
            Criar
          </Button>
        </DialogActions>
      </Dialog>

      {/* QR Code Dialog */}
      <QRCodeDialog
        open={qrDialogOpen}
        onClose={() => setQrDialogOpen(false)}
        bot={selectedBot}
      />
    </Box>
  );
};

export default BotManager;

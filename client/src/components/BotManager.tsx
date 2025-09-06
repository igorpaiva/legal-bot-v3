import React, { useState } from 'react';
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
  Message,
  Error,
  CheckCircle,
  Schedule
} from '@mui/icons-material';
import { Bot } from '../types';
import api from '../services/api';

interface BotManagerProps {
  bots: Bot[];
  onNotification: (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;
}

interface QRCodeDialogProps {
  open: boolean;
  onClose: () => void;
  bot: Bot | null;
}

const QRCodeDialog: React.FC<QRCodeDialogProps> = ({ open, onClose, bot }) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        QR Code for {bot?.name}
      </DialogTitle>
      <DialogContent>
        {bot?.qrCode ? (
          <Box sx={{ textAlign: 'center', p: 2 }}>
            <img 
              src={bot.qrCode} 
              alt="WhatsApp QR Code" 
              style={{ maxWidth: '100%', height: 'auto' }}
            />
            <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
              Scan this QR code with your WhatsApp mobile app
            </Typography>
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', p: 4 }}>
            <Typography>QR Code not available</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
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
    <Card sx={{ minWidth: 300, m: 1 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Avatar sx={{ mr: 2, bgcolor: getStatusColor(bot.status) === 'success' ? '#25D366' : '#ccc' }}>
            {getStatusIcon(bot.status)}
          </Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6">{bot.name}</Typography>
            {bot.assistantName && (
              <Typography variant="body2" color="textSecondary" sx={{ fontStyle: 'italic' }}>
                Assistant: {bot.assistantName}
              </Typography>
            )}
            <Chip 
              label={bot.status.replace(/_/g, ' ')} 
              color={getStatusColor(bot.status)} 
              size="small"
            />
          </Box>
        </Box>

        {bot.phoneNumber && (
          <Typography variant="body2" color="textSecondary">
            📱 {bot.phoneNumber}
          </Typography>
        )}

        <Typography variant="body2" color="textSecondary">
          💬 {bot.messageCount} messages
        </Typography>

        {bot.lastActivity && (
          <Typography variant="body2" color="textSecondary">
            🕒 Last active: {formatDate(bot.lastActivity)}
          </Typography>
        )}

        <Typography variant="body2" color="textSecondary">
          📅 Created: {formatDate(bot.createdAt)}
        </Typography>

        {bot.error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {bot.error}
          </Alert>
        )}
      </CardContent>

      <CardActions>
        {bot.status === 'waiting_for_scan' && bot.qrCode && (
          <Tooltip title="Show QR Code">
            <IconButton onClick={() => onShowQR(bot)} color="primary">
              <QrCode />
            </IconButton>
          </Tooltip>
        )}
        
        {bot.isActive ? (
          <Tooltip title="Stop Bot">
            <IconButton onClick={() => onAction('stop', bot.id)} color="error">
              <Stop />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Start Bot">
            <IconButton onClick={() => onAction('restart', bot.id)} color="success">
              <PlayArrow />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title="Restart Bot">
          <IconButton onClick={() => onAction('restart', bot.id)} color="warning">
            <RestartAlt />
          </IconButton>
        </Tooltip>

        <Tooltip title="Delete Bot">
          <IconButton onClick={() => onAction('delete', bot.id)} color="error">
            <Delete />
          </IconButton>
        </Tooltip>
      </CardActions>
    </Card>
  );
};

const BotManager: React.FC<BotManagerProps> = ({ bots, onNotification }) => {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const [newBotName, setNewBotName] = useState('');
  const [newAssistantName, setNewAssistantName] = useState('Ana'); // Default to Ana
  const [loading, setLoading] = useState(false);

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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          Bot Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
          disabled={loading}
        >
          Create New Bot
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
        {bots.length === 0 ? (
          <Card sx={{ minWidth: 300, m: 1 }}>
            <CardContent>
              <Typography variant="h6" align="center" color="textSecondary">
                No bots created yet
              </Typography>
              <Typography variant="body2" align="center" color="textSecondary">
                Click "Create New Bot" to get started
              </Typography>
            </CardContent>
          </Card>
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
        <DialogTitle>Create New Bot</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Bot Name"
            fullWidth
            variant="outlined"
            value={newBotName}
            onChange={(e) => setNewBotName(e.target.value)}
            placeholder="Enter a name for your bot"
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Assistant Name"
            fullWidth
            variant="outlined"
            value={newAssistantName}
            onChange={(e) => setNewAssistantName(e.target.value)}
            placeholder="Enter the assistant's name (e.g., Ana, Maria, João)"
            helperText="This is the name your bot will use when talking to clients"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setCreateDialogOpen(false);
            setNewBotName('');
            setNewAssistantName('Ana');
          }}>Cancel</Button>
          <Button 
            onClick={handleCreateBot} 
            variant="contained"
            disabled={!newBotName.trim() || !newAssistantName.trim() || loading}
          >
            Create
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

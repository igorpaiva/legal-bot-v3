import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  LinearProgress
} from '@mui/material';
import {
  SmartToy,
  PhoneAndroid,
  Message,
  TrendingUp
} from '@mui/icons-material';
import { Bot, SystemStatus } from '../types';
import api from '../services/api';

interface DashboardProps {
  bots: Bot[];
  systemStatus: SystemStatus | null;
  user?: {
    id: string;
    email: string;
    role: 'admin' | 'law_office';
    lawOfficeName?: string;
    botCredits?: number;
  };
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

const Dashboard: React.FC<DashboardProps> = ({ bots, systemStatus, user }) => {
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await api.get('/admin/config');
        if (response.data.success) {
          setConfig(response.data.config);
        }
      } catch (error) {
        console.error('Failed to fetch config:', error);
      }
    };

    fetchConfig();
  }, []);

  const activeBots = bots.filter(bot => bot.isActive).length;
  const totalMessages = bots.reduce((sum, bot) => sum + bot.messageCount, 0);
  const connectedBots = bots.filter(bot => bot.status === 'connected').length;

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    return `${Math.round(bytes / 1024 / 1024)}MB`;
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, color: 'primary.main' }}>
        Dashboard
      </Typography>
      
      <Typography variant="body1" color="textSecondary" sx={{ mb: 4, lineHeight: 1.6 }}>
        Visão geral do sistema, estatísticas em tempo real e status dos seus bots WhatsApp
      </Typography>
      
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
            title="Créditos de Bot"
            value={user.botCredits || 0}
            icon={<SmartToy />}
            color="#FF6B35"
            subtitle={`${bots.length} em uso`}
          />
        )}
        
        <StatsCard
          title="Tempo Online"
          value={systemStatus ? formatUptime(systemStatus.uptime) : 'N/A'}
          icon={<TrendingUp />}
          color="#34B7F1"
          subtitle={systemStatus ? formatMemory(systemStatus.memory.heapUsed) : ''}
        />
      </Box>

      <Box sx={{ 
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          lg: 'repeat(2, 1fr)'
        },
        gap: 3,
        mt: 2
      }}>
        <Card sx={{ 
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3
          }
        }}>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
              Status dos Bots
            </Typography>
            <Box sx={{ mb: 2 }}>
              {['connected', 'waiting_for_scan', 'disconnected', 'error'].map(status => {
                const count = bots.filter(bot => bot.status === status).length;
                const color = {
                  connected: 'success',
                  waiting_for_scan: 'warning',
                  disconnected: 'default',
                  error: 'error'
                }[status] as 'success' | 'warning' | 'default' | 'error';
                
                return (
                  <Box key={status} sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    mb: 1.5,
                    p: 1,
                    borderRadius: 1,
                    backgroundColor: count > 0 ? `${color === 'success' ? '#25D366' : color === 'warning' ? '#FF6B35' : color === 'error' ? '#f44336' : '#ccc'}08` : 'transparent'
                  }}>
                    <Typography variant="body2" sx={{ textTransform: 'capitalize', fontWeight: 500 }}>
                      {status.replace(/_/g, ' ')}
                    </Typography>
                    <Chip 
                      label={count} 
                      color={color}
                      size="small"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>
                );
              })}
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
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
              Configuração do Sistema
            </Typography>
            {config ? (
              <Box>
                <Box sx={{ mb: 2, p: 1, borderRadius: 1, backgroundColor: config.groqConfigured ? '#25D36608' : '#f4433608' }}>
                  <Typography variant="body2" color="textSecondary" sx={{ fontWeight: 500 }}>
                    Status Groq LLM
                  </Typography>
                  <Chip 
                    label={config.groqConfigured ? 'Conectado' : 'Não Configurado'} 
                    color={config.groqConfigured ? 'success' : 'error'}
                    size="small"
                    sx={{ fontWeight: 600 }}
                  />
                </Box>
                
                <Box sx={{ mb: 2, p: 1, borderRadius: 1, backgroundColor: '#34B7F108' }}>
                  <Typography variant="body2" color="textSecondary" sx={{ fontWeight: 500 }}>
                    Delays de Resposta
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {config.responseDelays.min}ms - {config.responseDelays.max}ms
                  </Typography>
                </Box>
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="textSecondary">
                    Rate Limit
                  </Typography>
                  <Typography variant="body2">
                    {config.rateLimit.maxRequests} requests per minute
                  </Typography>
                </Box>
              </Box>
            ) : (
              <LinearProgress />
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default Dashboard;

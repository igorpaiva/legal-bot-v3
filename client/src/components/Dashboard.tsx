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
  <Card sx={{ minWidth: { xs: '100%', sm: 275 }, m: 1, width: { xs: '100%', sm: 'auto' } }}>
    <CardContent>
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography color="textSecondary" gutterBottom variant="h6">
            {title}
          </Typography>
          <Typography variant="h4" component="h2">
            {value}
          </Typography>
          {subtitle && (
            <Typography color="textSecondary" variant="body2">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{ color, fontSize: 40 }}>
          {icon}
        </Box>
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
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>
      
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: { xs: 'center', sm: 'space-around' }, gap: 1 }}>
        <StatsCard
          title="Total Bots"
          value={bots.length}
          icon={<SmartToy />}
          color="#25D366"
        />
        
        <StatsCard
          title="Active Bots"
          value={activeBots}
          icon={<PhoneAndroid />}
          color="#128C7E"
          subtitle={`${connectedBots} connected`}
        />
        
        <StatsCard
          title="Total Messages"
          value={totalMessages}
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
          title="System Uptime"
          value={systemStatus ? formatUptime(systemStatus.uptime) : 'N/A'}
          icon={<TrendingUp />}
          color="#34B7F1"
          subtitle={systemStatus ? formatMemory(systemStatus.memory.heapUsed) : ''}
        />
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 2, gap: 1 }}>
        <Card sx={{ minWidth: { xs: '100%', sm: 400 }, m: 1, flex: 1 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Bot Status Overview
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
                  <Box key={status} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                      {status.replace(/_/g, ' ')}
                    </Typography>
                    <Chip 
                      label={count} 
                      color={color}
                      size="small"
                    />
                  </Box>
                );
              })}
            </Box>
          </CardContent>
        </Card>

        <Card sx={{ minWidth: { xs: '100%', sm: 400 }, m: 1, flex: 1 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              System Configuration
            </Typography>
            {config ? (
              <Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="textSecondary">
                    Groq LLM Status
                  </Typography>
                  <Chip 
                    label={config.groqConfigured ? 'Connected' : 'Not Configured'} 
                    color={config.groqConfigured ? 'success' : 'error'}
                    size="small"
                  />
                </Box>
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="textSecondary">
                    Response Delays
                  </Typography>
                  <Typography variant="body2">
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

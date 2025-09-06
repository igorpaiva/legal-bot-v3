export interface Bot {
  id: string;
  name: string;
  assistantName?: string; // Add assistant name field
  status: 'initializing' | 'waiting_for_scan' | 'authenticated' | 'connected' | 'disconnected' | 'auth_failed' | 'error' | 'stopped';
  phoneNumber?: string;
  isActive: boolean;
  messageCount: number;
  lastActivity?: string;
  createdAt: string;
  qrCode?: string;
  error?: string;
}

export interface SystemStatus {
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  nodeVersion: string;
  environment: string;
}

export interface DashboardData {
  total: number;
  active: number;
  bots: Bot[];
  systemStatus: SystemStatus;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface BotConfig {
  responseDelays: {
    min: number;
    max: number;
  };
  typingDelays: {
    min: number;
    max: number;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  groqConfigured: boolean;
}

export interface BotStats {
  totalBots: number;
  activeBots: number;
  totalMessages: number;
  botsByStatus: Record<string, number>;
  recentActivity: Array<{
    id: string;
    name: string;
    lastActivity: string;
    messageCount: number;
  }>;
}

import React, { useState, useEffect } from 'react';
import './GoogleDrive.css';

interface GoogleDriveInfo {
  user: {
    emailAddress: string;
    displayName: string;
  };
  storage: {
    limit: number;
    usage: number;
    usageInDrive: number;
    usageInDriveTrash: number;
  };
}

interface AuthStatus {
  authenticated: boolean;
  error?: string;
  needsAuth?: boolean;
}

const GoogleDrive: React.FC = () => {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [googleDriveInfo, setGoogleDriveInfo] = useState<GoogleDriveInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/google-drive/auth-status');
      const data = await response.json();
      
      if (data.success) {
        setAuthStatus({
          authenticated: data.authenticated,
          error: data.error,
          needsAuth: data.needsAuth
        });

        if (data.authenticated) {
          await fetchGoogleDriveInfo();
        }
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      setAuthStatus({
        authenticated: false,
        error: 'Failed to check authentication status'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchGoogleDriveInfo = async () => {
    try {
      const response = await fetch('/api/google-drive/storage-info');
      const data = await response.json();
      
      if (data.success) {
        setGoogleDriveInfo(data.data);
      }
    } catch (error) {
      console.error('Error fetching Google Drive info:', error);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const response = await fetch('/api/google-drive/auth-url');
      const data = await response.json();
      
      if (data.success && data.authUrl) {
        // Open authentication URL in new window
        const authWindow = window.open(
          data.authUrl,
          'GoogleDriveAuth',
          'width=500,height=600,scrollbars=yes,resizable=yes'
        );

        // Check if window is closed and refresh status
        const checkClosed = setInterval(() => {
          if (authWindow?.closed) {
            clearInterval(checkClosed);
            setConnecting(false);
            // Wait a moment then check auth status
            setTimeout(() => {
              checkAuthStatus();
            }, 1000);
          }
        }, 1000);
      }
    } catch (error) {
      console.error('Error getting auth URL:', error);
      setConnecting(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getUsagePercentage = (): number => {
    if (!googleDriveInfo?.storage.limit || !googleDriveInfo?.storage.usage) {
      return 0;
    }
    return Math.round((googleDriveInfo.storage.usage / googleDriveInfo.storage.limit) * 100);
  };

  if (loading) {
    return (
      <div className="google-drive-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Verificando conexão com Google Drive...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="google-drive-container">
      <div className="google-drive-header">
        <h2>Integração Google Drive</h2>
        <p>Conecte seu Google Drive para organizar automaticamente os documentos dos clientes</p>
      </div>

      {!authStatus?.authenticated ? (
        <div className="auth-section">
          <div className="auth-card">
            <div className="auth-icon">
              <svg width="48" height="48" viewBox="0 0 24 24">
                <path fill="#4285f4" d="M6,2L3,6V14.5L5,18.5L18.5,18.5L21,14.5V6L18,2H6M12,4.5C13.66,4.5 15,5.84 15,7.5C15,9.16 13.66,10.5 12,10.5C10.34,10.5 9,9.16 9,7.5C9,5.84 10.34,4.5 12,4.5M6,13C6.45,13 7,12.55 7,12C7,11.45 6.55,11 6,11C5.45,11 5,11.45 5,12C5,12.55 5.45,13 6,13M18,13C18.55,13 19,12.55 19,12C19,11.45 18.55,11 18,11C17.45,11 17,11.45 17,12C17,12.55 17.45,13 18,13Z"/>
              </svg>
            </div>
            <h3>Conectar Google Drive</h3>
            <p>Autorize o acesso para organizar automaticamente os documentos dos clientes em pastas do Google Drive</p>
            
            {authStatus?.error && (
              <div className="error-message">
                <strong>Erro:</strong> {authStatus.error}
              </div>
            )}

            <button
              className="connect-button"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? (
                <>
                  <div className="button-spinner"></div>
                  Conectando...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M6.26,10.5L12,4.76L17.74,10.5H14.5V16.5H9.5V10.5H6.26M12,2L2,12H6V18H18V12H22L12,2Z"/>
                  </svg>
                  Conectar Google Drive
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="connected-section">
          <div className="connection-status">
            <div className="status-indicator connected">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="currentColor" d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"/>
              </svg>
            </div>
            <div className="status-text">
              <h3>Google Drive Conectado</h3>
              <p>Os documentos serão organizados automaticamente por cliente</p>
            </div>
          </div>

          {googleDriveInfo && (
            <div className="drive-info">
              <div className="user-info">
                <h4>Informações da Conta</h4>
                <div className="info-row">
                  <span className="label">Conta:</span>
                  <span className="value">{googleDriveInfo.user.displayName}</span>
                </div>
                <div className="info-row">
                  <span className="label">Email:</span>
                  <span className="value">{googleDriveInfo.user.emailAddress}</span>
                </div>
              </div>

              <div className="storage-info">
                <h4>Uso do Armazenamento</h4>
                <div className="storage-bar">
                  <div 
                    className="storage-fill" 
                    style={{ width: `${getUsagePercentage()}%` }}
                  ></div>
                </div>
                <div className="storage-details">
                  <span className="usage-text">
                    {formatBytes(googleDriveInfo.storage.usage)} de {formatBytes(googleDriveInfo.storage.limit)} usados
                  </span>
                  <span className="usage-percentage">
                    {getUsagePercentage()}%
                  </span>
                </div>
              </div>

              <div className="features-info">
                <h4>Organização Automática</h4>
                <div className="feature-list">
                  <div className="feature-item">
                    <svg width="16" height="16" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"/>
                    </svg>
                    <span>Pastas de clientes criadas automaticamente</span>
                  </div>
                  <div className="feature-item">
                    <svg width="16" height="16" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"/>
                    </svg>
                    <span>Documentos do WhatsApp salvos nas pastas dos clientes</span>
                  </div>
                  <div className="feature-item">
                    <svg width="16" height="16" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"/>
                    </svg>
                    <span>Carimbos de data/hora adicionados para evitar conflitos</span>
                  </div>
                  <div className="feature-item">
                    <svg width="16" height="16" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"/>
                    </svg>
                    <span>Pasta principal: "Clientes Legal Bot"</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="actions">
            <button
              className="disconnect-button"
              onClick={() => {
                setAuthStatus({ authenticated: false });
                setGoogleDriveInfo(null);
              }}
            >
              Desconectar
            </button>
            <button
              className="refresh-button"
              onClick={checkAuthStatus}
            >
              Atualizar Status
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoogleDrive;

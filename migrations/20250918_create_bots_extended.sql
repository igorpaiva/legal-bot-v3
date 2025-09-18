-- Migration to create extended bots table for proper bot management
-- This maintains all current functionality while adding persistence

CREATE TABLE IF NOT EXISTS bots_extended (
  id TEXT PRIMARY KEY,                    -- UUID do bot
  name TEXT NOT NULL,                     -- Nome do bot
  assistant_name TEXT DEFAULT 'Ana',     -- Nome do assistente
  owner_id INTEGER,                       -- ID do usuário/escritório proprietário
  status TEXT DEFAULT 'initializing',    -- Status atual (initializing, waiting_for_scan, ready, etc)
  phone_number TEXT,                      -- Número do WhatsApp conectado
  is_active BOOLEAN DEFAULT false,       -- Se o bot está ativo
  message_count INTEGER DEFAULT 0,       -- Contador de mensagens
  last_activity DATETIME,                -- Última atividade
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  session_path TEXT,                      -- Caminho da sessão WhatsApp
  qr_code TEXT,                          -- QR code atual (se existir)
  connection_attempts INTEGER DEFAULT 0, -- Tentativas de conexão
  last_error TEXT,                       -- Último erro ocorrido
  has_connected_before BOOLEAN DEFAULT false, -- Se já conectou antes (para lógica de mensagens)
  last_qr_generated DATETIME,           -- Quando o último QR foi gerado
  restoration_attempts INTEGER DEFAULT 0, -- Tentativas de restauração
  
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_bots_extended_owner_id ON bots_extended(owner_id);
CREATE INDEX IF NOT EXISTS idx_bots_extended_status ON bots_extended(status);
CREATE INDEX IF NOT EXISTS idx_bots_extended_is_active ON bots_extended(is_active);
CREATE INDEX IF NOT EXISTS idx_bots_extended_last_activity ON bots_extended(last_activity);

-- Criar trigger para atualizar updated_at automaticamente
CREATE TRIGGER IF NOT EXISTS update_bots_extended_updated_at 
AFTER UPDATE ON bots_extended
BEGIN
  UPDATE bots_extended SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Database Migration: Add Enhanced Security Features
-- Version: 2.0.0
-- Description: Add refresh tokens, enhanced user fields, and security logging

-- Add new columns to users table
ALTER TABLE users ADD COLUMN last_login_at DATETIME;
ALTER TABLE users ADD COLUMN last_login_ip TEXT;
ALTER TABLE users ADD COLUMN password_changed_at DATETIME;

-- Create refresh tokens table for enhanced authentication
CREATE TABLE refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Update system_logs table to support security events
-- First, create new table with enhanced structure
CREATE TABLE system_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),
    category TEXT NOT NULL, -- e.g., 'SECURITY', 'BOT', 'DATABASE', 'API'
    message TEXT NOT NULL,
    metadata TEXT, -- JSON field for structured data
    user_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Copy existing data to new table
INSERT INTO system_logs_new (level, category, message, metadata, created_at)
SELECT 
    UPPER(level) as level,
    COALESCE(source, 'SYSTEM') as category,
    message,
    data as metadata,
    timestamp as created_at
FROM system_logs;

-- Drop old table and rename new one
DROP TABLE system_logs;
ALTER TABLE system_logs_new RENAME TO system_logs;

-- Create indexes for new tables
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_created_at ON refresh_tokens(created_at);

-- Create indexes for enhanced system_logs
CREATE INDEX idx_system_logs_category ON system_logs(category);
CREATE INDEX idx_system_logs_level ON system_logs(level);
CREATE INDEX idx_system_logs_user_id ON system_logs(user_id);
CREATE INDEX idx_system_logs_created_at ON system_logs(created_at);

-- Add indexes for new user columns
CREATE INDEX idx_users_last_login_at ON users(last_login_at);
CREATE INDEX idx_users_last_login_ip ON users(last_login_ip);

-- Create trigger for refresh token cleanup
CREATE TRIGGER cleanup_expired_refresh_tokens
    AFTER INSERT ON refresh_tokens
    WHEN (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = NEW.user_id AND revoked_at IS NULL) > 5
    BEGIN
        UPDATE refresh_tokens 
        SET revoked_at = CURRENT_TIMESTAMP 
        WHERE user_id = NEW.user_id 
        AND revoked_at IS NULL 
        AND id NOT IN (
            SELECT id FROM refresh_tokens 
            WHERE user_id = NEW.user_id AND revoked_at IS NULL 
            ORDER BY created_at DESC 
            LIMIT 5
        );
    END;

-- Legal Bot Database Schema
-- SQLite database for WhatsApp Legal Bot system

-- Users table (Law offices and admins)
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'law_office')),
    law_office_name TEXT,
    bot_credits INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bots table
CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    assistant_name TEXT DEFAULT 'Ana',
    owner_id TEXT NOT NULL,
    status TEXT DEFAULT 'waiting_for_scan',
    phone_number TEXT,
    is_active BOOLEAN DEFAULT 1,
    message_count INTEGER DEFAULT 0,
    last_activity DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Lawyers table
CREATE TABLE lawyers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    legal_field TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Conversations table
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    owner_id TEXT,
    client_phone TEXT NOT NULL,
    client_name TEXT,
    client_email TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    legal_field TEXT,
    urgency TEXT,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    summary TEXT,
    lawyer_notified BOOLEAN DEFAULT 0,
    notified_lawyer_id TEXT,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
    FOREIGN KEY (notified_lawyer_id) REFERENCES lawyers(id)
);

-- Messages table
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender TEXT NOT NULL CHECK (sender IN ('bot', 'client')),
    message_text TEXT NOT NULL,
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'audio', 'document', 'image')),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_from_bot BOOLEAN DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Bot statistics table
CREATE TABLE bot_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    date DATE NOT NULL,
    total_messages INTEGER DEFAULT 0,
    total_conversations INTEGER DEFAULT 0,
    completed_conversations INTEGER DEFAULT 0,
    average_response_time REAL DEFAULT 0,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
    UNIQUE(bot_id, date)
);

-- System logs table
CREATE TABLE system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'debug')),
    message TEXT NOT NULL,
    data TEXT, -- JSON data
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT NOT NULL -- Which service/component generated the log
);

-- Indexes for performance
CREATE INDEX idx_bots_owner_id ON bots(owner_id);
CREATE INDEX idx_lawyers_owner_id ON lawyers(owner_id);
CREATE INDEX idx_lawyers_legal_field ON lawyers(legal_field);
CREATE INDEX idx_conversations_bot_id ON conversations(bot_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_legal_field ON conversations(legal_field);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_bot_stats_bot_id ON bot_stats(bot_id);
CREATE INDEX idx_bot_stats_date ON bot_stats(date);
CREATE INDEX idx_system_logs_timestamp ON system_logs(timestamp);
CREATE INDEX idx_system_logs_level ON system_logs(level);

CREATE TRIGGER update_users_timestamp 
    AFTER UPDATE ON users
    BEGIN
        UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER update_lawyers_timestamp 
    AFTER UPDATE ON lawyers
    BEGIN
        UPDATE lawyers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Triages table: stores full JSON triage analysis for each conversation
CREATE TABLE triages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    triage_json TEXT NOT NULL, -- Full JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_triages_conversation_id ON triages(conversation_id);

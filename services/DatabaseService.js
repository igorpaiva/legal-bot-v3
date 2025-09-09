import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseService {
  constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'legal-bot.db');
    this.schemaPath = path.join(process.cwd(), 'database', 'schema.sql');
    this.db = null;
    this.init();
  }

  init() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Initialize database
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL'); // Better concurrency
      this.db.pragma('synchronous = NORMAL'); // Better performance
      this.db.pragma('foreign_keys = ON'); // Enable foreign key constraints

      console.log('Database connected:', this.dbPath);
      this.initializeSchema();
    } catch (error) {
      console.error('Database initialization error:', error);
      throw error;
    }
  }

  initializeSchema() {
    try {
      // Check if database is already initialized
      const tableCount = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM sqlite_master 
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).get().count;

      if (tableCount === 0) {
        console.log('Initializing database schema...');
        
        if (fs.existsSync(this.schemaPath)) {
          const schema = fs.readFileSync(this.schemaPath, 'utf-8');
          this.db.exec(schema);
          console.log('Database schema initialized successfully');
        } else {
          console.warn('Schema file not found, creating basic tables...');
          this.createBasicTables();
        }
      } else {
        console.log('Database already initialized with', tableCount, 'tables');
      }
    } catch (error) {
      console.error('Schema initialization error:', error);
      throw error;
    }
  }

  createBasicTables() {
    // Fallback basic schema if schema.sql is not found
    const basicSchema = `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        law_office_name TEXT,
        bot_credits INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
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
    `;
    
    this.db.exec(basicSchema);
  }

  // User operations
  createUser(userData) {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, password, role, law_office_name, bot_credits, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      userData.id,
      userData.email,
      userData.password,
      userData.role,
      userData.lawOfficeName || null,
      userData.botCredits || 0,
      userData.isActive !== false ? 1 : 0
    );
  }

  getUserById(id) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(id);
    return user ? this.formatUser(user) : null;
  }

  getUserByEmail(email) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    const user = stmt.get(email);
    return user ? this.formatUser(user) : null;
  }

  getAllUsers() {
    const stmt = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC');
    return stmt.all().map(user => this.formatUser(user));
  }

  getLawOffices() {
    const stmt = this.db.prepare(`
      SELECT * FROM users 
      WHERE role = 'law_office' 
      ORDER BY created_at DESC
    `);
    return stmt.all().map(user => this.formatUser(user));
  }

  updateUserBotCredits(userId, botCredits) {
    const stmt = this.db.prepare(`
      UPDATE users 
      SET bot_credits = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    return stmt.run(botCredits, userId);
  }

  deactivateUser(userId) {
    const stmt = this.db.prepare(`
      UPDATE users 
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    return stmt.run(userId);
  }

  // Bot operations
  createBot(botData) {
    const stmt = this.db.prepare(`
      INSERT INTO bots (id, name, assistant_name, owner_id, status, phone_number, is_active, message_count, last_activity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      botData.id,
      botData.name,
      botData.assistantName || 'Ana',
      botData.ownerId,
      botData.status || 'waiting_for_scan',
      botData.phoneNumber || null,
      botData.isActive !== false ? 1 : 0,
      botData.messageCount || 0,
      botData.lastActivity || null
    );
  }

  getBotById(id) {
    const stmt = this.db.prepare('SELECT * FROM bots WHERE id = ?');
    const bot = stmt.get(id);
    return bot ? this.formatBot(bot) : null;
  }

  getBotsByOwner(ownerId) {
    const stmt = this.db.prepare('SELECT * FROM bots WHERE owner_id = ? ORDER BY created_at DESC');
    return stmt.all(ownerId).map(bot => this.formatBot(bot));
  }

  getAllBots() {
    const stmt = this.db.prepare('SELECT * FROM bots ORDER BY created_at DESC');
    return stmt.all().map(bot => this.formatBot(bot));
  }

  updateBot(botId, updates) {
    const setClause = Object.keys(updates).map(key => `${this.camelToSnake(key)} = ?`).join(', ');
    const values = Object.values(updates);
    
    const stmt = this.db.prepare(`
      UPDATE bots 
      SET ${setClause}
      WHERE id = ?
    `);
    
    return stmt.run(...values, botId);
  }

  deleteBot(botId) {
    const stmt = this.db.prepare('DELETE FROM bots WHERE id = ?');
    return stmt.run(botId);
  }

  // Lawyer operations
  createLawyer(lawyerData) {
    const stmt = this.db.prepare(`
      INSERT INTO lawyers (id, name, phone, legal_field, owner_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      lawyerData.id,
      lawyerData.name,
      lawyerData.phone,
      lawyerData.legalField,
      lawyerData.ownerId
    );
  }

  getLawyersByOwner(ownerId) {
    const stmt = this.db.prepare('SELECT * FROM lawyers WHERE owner_id = ? ORDER BY created_at DESC');
    return stmt.all(ownerId).map(lawyer => this.formatLawyer(lawyer));
  }

  getLawyersByField(legalField, ownerId = null) {
    let query = 'SELECT * FROM lawyers WHERE legal_field = ?';
    const params = [legalField];
    
    if (ownerId) {
      query += ' AND owner_id = ?';
      params.push(ownerId);
    }
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params).map(lawyer => this.formatLawyer(lawyer));
  }

  // Conversation operations
  createConversation(conversationData) {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, bot_id, client_phone, client_name, status, legal_field, urgency, start_time, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      conversationData.id,
      conversationData.botId,
      conversationData.clientPhone,
      conversationData.clientName || null,
      conversationData.status || 'active',
      conversationData.legalField || null,
      conversationData.urgency || null,
      conversationData.startTime || new Date().toISOString(),
      conversationData.summary || null
    );
  }

  // Message operations
  addMessage(messageData) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, sender, message_text, message_type, timestamp, is_from_bot)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      messageData.id,
      messageData.conversationId,
      messageData.sender,
      messageData.messageText,
      messageData.messageType || 'text',
      messageData.timestamp || new Date().toISOString(),
      messageData.isFromBot ? 1 : 0
    );
  }

  // Utility methods
  formatUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      password: user.password,
      role: user.role,
      lawOfficeName: user.law_office_name,
      botCredits: user.bot_credits,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
      updatedAt: user.updated_at
    };
  }

  formatBot(bot) {
    if (!bot) return null;
    return {
      id: bot.id,
      name: bot.name,
      assistantName: bot.assistant_name,
      ownerId: bot.owner_id,
      status: bot.status,
      phoneNumber: bot.phone_number,
      isActive: Boolean(bot.is_active),
      messageCount: bot.message_count,
      lastActivity: bot.last_activity,
      createdAt: bot.created_at,
      error: bot.error_message
    };
  }

  formatLawyer(lawyer) {
    if (!lawyer) return null;
    return {
      id: lawyer.id,
      name: lawyer.name,
      phone: lawyer.phone,
      legalField: lawyer.legal_field,
      ownerId: lawyer.owner_id,
      createdAt: lawyer.created_at,
      updatedAt: lawyer.updated_at
    };
  }

  camelToSnake(camelCase) {
    return camelCase.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  // Transaction support
  transaction(fn) {
    return this.db.transaction(fn);
  }

  // Backup and restore
  backup(backupPath) {
    return this.db.backup(backupPath);
  }

  // Close database
  close() {
    if (this.db) {
      this.db.close();
    }
  }

  // Health check method
  static isHealthy() {
    try {
      if (!databaseInstance || !databaseInstance.db) return false;
      
      // Test a simple query
      const result = databaseInstance.db.prepare('SELECT 1 as test').get();
      return result && result.test === 1;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }

  // Get database file path
  static getDatabasePath() {
    return databaseInstance.dbPath;
  }

  // Create backup connection
  static createBackupConnection(backupPath) {
    return new Database(backupPath);
  }

  // Backup database
  static backupDatabase(targetDb) {
    try {
      // Use SQLite backup API
      const backup = databaseInstance.db.backup(targetDb);
      backup.step(-1); // Copy all pages
      backup.finish();
      return true;
    } catch (error) {
      console.error('Database backup failed:', error);
      throw error;
    }
  }

  // Get database version/schema info
  static getVersion() {
    try {
      const result = databaseInstance.db.prepare('SELECT sql FROM sqlite_master WHERE type="table"').all();
      return {
        tables: result.length,
        schemaHash: this.generateSchemaHash(result)
      };
    } catch (error) {
      return { tables: 0, schemaHash: 'unknown' };
    }
  }

  // Generate schema hash for version tracking
  static generateSchemaHash(schema) {
    const crypto = require('crypto');
    const schemaString = schema.map(s => s.sql).join('');
    return crypto.createHash('md5').update(schemaString).digest('hex').substring(0, 8);
  }

  // Get all data from a table (for SQL dumps)
  static getAllFromTable(tableName) {
    try {
      return databaseInstance.db.prepare(`SELECT * FROM ${tableName}`).all();
    } catch (error) {
      console.error(`Error getting data from table ${tableName}:`, error);
      return [];
    }
  }

  // Count methods for statistics
  static getUserCount() {
    try {
      const result = databaseInstance.db.prepare('SELECT COUNT(*) as count FROM users').get();
      return result.count;
    } catch (error) {
      return 0;
    }
  }

  static getBotCount() {
    try {
      const result = databaseInstance.db.prepare('SELECT COUNT(*) as count FROM bots').get();
      return result.count;
    } catch (error) {
      return 0;
    }
  }

  static getLawyerCount() {
    try {
      const result = databaseInstance.db.prepare('SELECT COUNT(*) as count FROM lawyers').get();
      return result.count;
    } catch (error) {
      return 0;
    }
  }

  static getConversationCount() {
    try {
      const result = databaseInstance.db.prepare('SELECT COUNT(*) as count FROM conversations').get();
      return result.count;
    } catch (error) {
      return 0;
    }
  }

  static getMessageCount() {
    try {
      const result = this.db.prepare('SELECT COUNT(*) as count FROM messages').get();
      return result.count;
    } catch (error) {
      return 0;
    }
  }
}

// Create and export a singleton instance
const databaseInstance = new DatabaseService();
export default databaseInstance;

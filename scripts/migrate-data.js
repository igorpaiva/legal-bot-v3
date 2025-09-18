import fs from 'fs/promises';
import path from 'path';
import DatabaseService from '../services/DatabaseService.js';
import { v4 as uuidv4 } from 'uuid';

class DataMigration {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
  }

  async migrateAllData() {
    console.log('🚀 Starting data migration from JSON to SQLite...');
    
    try {
      // Check if database is healthy
      if (!DatabaseService.db) {
        throw new Error('Database is not accessible');
      }

      await this.migrateUsers();
      await this.migrateBots();
      await this.migrateLawyers();
      await this.migrateConversations();
      
      console.log('✅ Data migration completed successfully!');
      
      // Create backup of JSON files
      await this.backupJsonFiles();
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  async migrateUsers() {
    console.log('📤 Migrating users...');
    
    try {
      const usersFile = path.join(this.dataDir, 'users.json');
      
      if (await this.fileExists(usersFile)) {
        const usersData = JSON.parse(await fs.readFile(usersFile, 'utf-8'));
        
        for (const user of usersData) {
          try {
            DatabaseService.createUser({
              id: user.id,
              email: user.email,
              password: user.password,
              role: user.role,
              lawOfficeName: user.lawOfficeName,
              botCredits: user.botCredits || 0,
              isActive: user.isActive !== false
            });
            console.log(`  ✓ Migrated user: ${user.email}`);
          } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
              console.log(`  ⚠️  User already exists: ${user.email}`);
            } else {
              console.error(`  ❌ Failed to migrate user ${user.email}:`, error);
            }
          }
        }
        
        console.log(`📋 Users migration completed: ${usersData.length} users processed`);
      } else {
        console.log('📋 No users.json file found, skipping users migration');
      }
    } catch (error) {
      console.error('❌ Users migration failed:', error);
    }
  }

  async migrateBots() {
    console.log('🤖 Migrating bots...');
    
    try {
      const botsFile = path.join(this.dataDir, 'bots.json');
      
      if (await this.fileExists(botsFile)) {
        const botsData = JSON.parse(await fs.readFile(botsFile, 'utf-8'));
        
        for (const bot of botsData) {
          try {
            DatabaseService.createBot({
              id: bot.id,
              name: bot.name,
              assistantName: bot.assistantName || 'Ana',
              ownerId: bot.ownerId || this.getRandomLawOfficeId(), // Assign to random law office if no owner
              status: bot.status || 'waiting_for_scan',
              phoneNumber: bot.phoneNumber,
              isActive: bot.isActive !== false,
              messageCount: bot.messageCount || 0,
              lastActivity: bot.lastActivity
            });
            console.log(`  ✓ Migrated bot: ${bot.name} (${bot.id})`);
          } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
              console.log(`  ⚠️  Bot already exists: ${bot.name}`);
            } else {
              console.error(`  ❌ Failed to migrate bot ${bot.name}:`, error);
            }
          }
        }
        
        console.log(`🤖 Bots migration completed: ${botsData.length} bots processed`);
      } else {
        console.log('🤖 No bots.json file found, skipping bots migration');
      }
    } catch (error) {
      console.error('❌ Bots migration failed:', error);
    }
  }

  async migrateLawyers() {
    console.log('⚖️  Migrating lawyers...');
    
    try {
      const lawyersFile = path.join(this.dataDir, 'lawyers.json');
      
      if (await this.fileExists(lawyersFile)) {
        const lawyersData = JSON.parse(await fs.readFile(lawyersFile, 'utf-8'));
        
        for (const lawyer of lawyersData) {
          try {
            const lawyerObj = {
              id: lawyer.id || uuidv4(),
              name: lawyer.name,
              phone: lawyer.phone,
              legalField: lawyer.specialty || lawyer.legalField,
              email: lawyer.email,
              isActive: lawyer.isActive,
              ownerId: lawyer.ownerId || this.getRandomLawOfficeId()
            };
            
            DatabaseService.createLawyer(lawyerObj);
            console.log(`  ✓ Migrated lawyer: ${lawyer.name}`);
          } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
              console.log(`  ⚠️  Lawyer already exists: ${lawyer.name}`);
            } else {
              console.error(`  ❌ Failed to migrate lawyer ${lawyer.name}:`, error);
            }
          }
        }
        
        console.log(`⚖️  Lawyers migration completed: ${lawyersData.length} lawyers processed`);
      } else {
        console.log('⚖️  No lawyers.json file found, skipping lawyers migration');
      }
    } catch (error) {
      console.error('❌ Lawyers migration failed:', error);
    }
  }

  async migrateConversations() {
    console.log('💬 Migrating conversations...');
    
    try {
      const conversationsFile = path.join(this.dataDir, 'conversations.json');
      
      if (await this.fileExists(conversationsFile)) {
        const rawData = JSON.parse(await fs.readFile(conversationsFile, 'utf-8'));
        
        // Handle different JSON structures
        let conversationsData;
        if (Array.isArray(rawData)) {
          // Old format: direct array
          conversationsData = rawData;
        } else if (rawData.conversations) {
          // New format: object with conversations property
          conversationsData = Object.values(rawData.conversations);
        } else {
          console.log('💬 No conversations found in JSON structure');
          return;
        }
        
        if (!Array.isArray(conversationsData) || conversationsData.length === 0) {
          console.log('💬 No conversations to migrate');
          return;
        }
        
        for (const conversation of conversationsData) {
          try {
            // Ensure we have a valid bot_id
            let botId = conversation.botId;
            if (!botId) {
              botId = this.getOrCreateDefaultBot();
              if (!botId) {
                console.error(`  ❌ Skipping conversation ${conversation.id}: No bot available`);
                continue;
              }
            }

            DatabaseService.createConversation({
              id: conversation.id || uuidv4(),
              botId: botId,
              clientPhone: conversation.client?.phone || conversation.clientPhone,
              clientName: conversation.client?.name || conversation.clientName,
              status: conversation.status || 'active',
              legalField: conversation.legalField,
              urgency: conversation.urgency,
              startTime: conversation.startedAt || conversation.startTime,
              summary: conversation.summary
            });

            // Migrate messages for this conversation - handle both old and new formats
            let messagesArray = [];
            if (conversation.messages && Array.isArray(conversation.messages)) {
              messagesArray = conversation.messages;
            } else if (rawData.messages && rawData.messages[conversation.id]) {
              messagesArray = rawData.messages[conversation.id];
            }
            
            if (messagesArray.length > 0) {
              for (const message of messagesArray) {
                try {
                  DatabaseService.addMessage({
                    id: uuidv4(),
                    conversationId: conversation.id,
                    sender: message.isFromBot || message.direction === 'OUT' ? 'bot' : 'client',
                    messageText: message.text || message.body,
                    messageType: message.type || 'text',
                    timestamp: message.timestamp,
                    isFromBot: message.isFromBot || message.direction === 'OUT' || false
                  });
                } catch (msgError) {
                  console.error(`    ❌ Failed to migrate message:`, msgError);
                }
              }
            }

            console.log(`  ✓ Migrated conversation: ${conversation.id} (${messagesArray.length} messages)`);
          } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
              console.log(`  ⚠️  Conversation already exists: ${conversation.id}`);
            } else {
              console.error(`  ❌ Failed to migrate conversation ${conversation.id}:`, error);
            }
          }
        }
        
        console.log(`💬 Conversations migration completed: ${conversationsData.length} conversations processed`);
      } else {
        console.log('💬 No conversations.json file found, skipping conversations migration');
      }
    } catch (error) {
      console.error('❌ Conversations migration failed:', error);
    }
  }

  async backupJsonFiles() {
    console.log('📦 Creating backup of JSON files...');
    
    const backupDir = path.join(this.dataDir, 'json-backup-' + Date.now());
    
    try {
      await fs.mkdir(backupDir, { recursive: true });
      
      const jsonFiles = ['users.json', 'bots.json', 'lawyers.json', 'conversations.json'];
      
      for (const file of jsonFiles) {
        const sourcePath = path.join(this.dataDir, file);
        const targetPath = path.join(backupDir, file);
        
        if (await this.fileExists(sourcePath)) {
          await fs.copyFile(sourcePath, targetPath);
          console.log(`  ✓ Backed up: ${file}`);
        }
      }
      
      console.log(`📦 JSON backup created in: ${backupDir}`);
    } catch (error) {
      console.error('❌ Backup failed:', error);
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getRandomLawOfficeId() {
    // Get a random law office user to assign orphaned data
    const lawOffices = DatabaseService.getLawOffices();
    if (lawOffices.length > 0) {
      return lawOffices[0].id;
    }
    return null;
  }

  getOrCreateDefaultBot() {
    try {
      // Try to get existing bots
      const bots = DatabaseService.getAllBots();
      if (bots.length > 0) {
        return bots[0].id;
      }

      // No bots exist, create a default one
      const defaultOwnerId = this.getRandomLawOfficeId();
      if (!defaultOwnerId) {
        throw new Error('No law office found to assign default bot');
      }

      const defaultBotId = uuidv4();
      DatabaseService.createBot({
        id: defaultBotId,
        name: 'Bot Padrão',
        assistantName: 'Ana',
        ownerId: defaultOwnerId,
        status: 'waiting_for_scan',
        phoneNumber: null,
        isActive: true,
        messageCount: 0,
        lastActivity: null
      });

      console.log(`🤖 Created default bot: ${defaultBotId}`);
      return defaultBotId;
    } catch (error) {
      console.error('Error getting/creating default bot:', error);
      return null;
    }
  }

  // Run migration
  static async run() {
    const migration = new DataMigration();
    await migration.migrateAllData();
  }
}

// Allow running this script directly
if (import.meta.url === `file://${process.argv[1]}`) {
  DataMigration.run().catch(console.error);
}

export default DataMigration;

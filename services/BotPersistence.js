import fs from 'fs/promises';
import path from 'path';

export class BotPersistence {
  constructor() {
    this.botsFilePath = path.join(process.cwd(), 'data', 'bots.json');
    this.conversationsFilePath = path.join(process.cwd(), 'data', 'conversations.json');
    this.ensureDataDirectory();
  }

  async ensureDataDirectory() {
    try {
      await fs.mkdir(path.dirname(this.botsFilePath), { recursive: true });
    } catch (error) {
      console.error('Error creating data directory:', error);
    }
  }

  // Save bot configuration (without the WhatsApp client instance)
  async saveBotConfig(botData) {
    try {
      const existingBots = await this.loadBotConfigs();
      
      // Create a serializable version of bot data
      const botConfig = {
        id: botData.id,
        name: botData.name,
        status: botData.status,
        phoneNumber: botData.phoneNumber,
        isActive: botData.isActive,
        messageCount: botData.messageCount,
        lastActivity: botData.lastActivity,
        createdAt: botData.createdAt,
        error: botData.error || null
      };

      // Update or add bot config
      const botIndex = existingBots.findIndex(bot => bot.id === botConfig.id);
      if (botIndex >= 0) {
        existingBots[botIndex] = botConfig;
      } else {
        existingBots.push(botConfig);
      }

      await fs.writeFile(this.botsFilePath, JSON.stringify(existingBots, null, 2));
      console.log(`Bot config saved: ${botConfig.name} (${botConfig.id})`);
      
    } catch (error) {
      console.error('Error saving bot config:', error);
    }
  }

  // Load all bot configurations
  async loadBotConfigs() {
    try {
      const data = await fs.readFile(this.botsFilePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return empty array
        return [];
      }
      console.error('Error loading bot configs:', error);
      return [];
    }
  }

  // Remove bot configuration
  async removeBotConfig(botId) {
    try {
      const existingBots = await this.loadBotConfigs();
      const filteredBots = existingBots.filter(bot => bot.id !== botId);
      
      await fs.writeFile(this.botsFilePath, JSON.stringify(filteredBots, null, 2));
      console.log(`Bot config removed: ${botId}`);
      
    } catch (error) {
      console.error('Error removing bot config:', error);
    }
  }

  // Save conversation states for legal triage
  async saveConversations(conversations) {
    try {
      // Convert Map to serializable format
      const conversationData = {};
      for (const [contactId, conversation] of conversations.entries()) {
        conversationData[contactId] = {
          ...conversation,
          startTime: conversation.startTime?.toISOString(),
          answers: conversation.answers?.map(answer => ({
            ...answer,
            timestamp: answer.timestamp?.toISOString()
          }))
        };
      }

      await fs.writeFile(this.conversationsFilePath, JSON.stringify(conversationData, null, 2));
      console.log(`Saved ${Object.keys(conversationData).length} conversations`);
      
    } catch (error) {
      console.error('Error saving conversations:', error);
    }
  }

  // Load conversation states
  async loadConversations() {
    try {
      const data = await fs.readFile(this.conversationsFilePath, 'utf8');
      const conversationData = JSON.parse(data);
      
      // Convert back to Map with proper Date objects
      const conversations = new Map();
      for (const [contactId, conversation] of Object.entries(conversationData)) {
        const restoredConversation = {
          ...conversation,
          startTime: conversation.startTime ? new Date(conversation.startTime) : new Date(),
          answers: conversation.answers?.map(answer => ({
            ...answer,
            timestamp: answer.timestamp ? new Date(answer.timestamp) : new Date()
          })) || []
        };
        conversations.set(contactId, restoredConversation);
      }
      
      console.log(`Loaded ${conversations.size} conversations`);
      return conversations;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return empty Map
        return new Map();
      }
      console.error('Error loading conversations:', error);
      return new Map();
    }
  }

  // Clean up old conversations (older than 7 days)
  async cleanupOldConversations() {
    try {
      const conversations = await this.loadConversations();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      let cleanedCount = 0;
      for (const [contactId, conversation] of conversations.entries()) {
        if (conversation.startTime < sevenDaysAgo) {
          conversations.delete(contactId);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        await this.saveConversations(conversations);
        console.log(`Cleaned up ${cleanedCount} old conversations`);
      }
      
      return conversations;
      
    } catch (error) {
      console.error('Error cleaning up conversations:', error);
      return new Map();
    }
  }

  // Save bot statistics
  async saveBotStats(botId, stats) {
    try {
      const statsFilePath = path.join(process.cwd(), 'data', `bot-${botId}-stats.json`);
      await fs.writeFile(statsFilePath, JSON.stringify(stats, null, 2));
    } catch (error) {
      console.error('Error saving bot stats:', error);
    }
  }

  // Load bot statistics
  async loadBotStats(botId) {
    try {
      const statsFilePath = path.join(process.cwd(), 'data', `bot-${botId}-stats.json`);
      const data = await fs.readFile(statsFilePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          totalMessages: 0,
          conversationsStarted: 0,
          conversationsCompleted: 0,
          lastActivity: null
        };
      }
      console.error('Error loading bot stats:', error);
      return null;
    }
  }

  // Export all data for backup
  async exportAllData() {
    try {
      const bots = await this.loadBotConfigs();
      const conversations = await this.loadConversations();
      
      const exportData = {
        exportDate: new Date().toISOString(),
        bots: bots,
        conversations: Object.fromEntries(conversations),
        version: '1.0'
      };
      
      const exportPath = path.join(process.cwd(), 'data', `backup-${Date.now()}.json`);
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      
      console.log(`Data exported to: ${exportPath}`);
      return exportPath;
      
    } catch (error) {
      console.error('Error exporting data:', error);
      throw error;
    }
  }

  // Import data from backup
  async importData(backupPath) {
    try {
      const data = await fs.readFile(backupPath, 'utf8');
      const importData = JSON.parse(data);
      
      if (importData.bots) {
        await fs.writeFile(this.botsFilePath, JSON.stringify(importData.bots, null, 2));
      }
      
      if (importData.conversations) {
        // Convert object back to Map format
        const conversations = new Map(Object.entries(importData.conversations));
        await this.saveConversations(conversations);
      }
      
      console.log('Data imported successfully');
      
    } catch (error) {
      console.error('Error importing data:', error);
      throw error;
    }
  }
}

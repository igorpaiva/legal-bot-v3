import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import DatabaseService from '../services/DatabaseService.js';
import { promisify } from 'util';

class BackupService {
  constructor() {
    this.backupDir = path.join(process.cwd(), 'backups');
    this.maxBackups = 30; // Keep 30 days of backups
    this.compressionLevel = 6; // Good balance of speed vs compression
    
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      console.log('✅ Backup service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize backup service:', error);
    }
  }

  /**
   * Create a full database backup
   */
  async createFullBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `legal-bot-backup-${timestamp}`;
      const backupPath = path.join(this.backupDir, backupName);
      
      console.log(`📦 Creating backup: ${backupName}`);
      
      // Create backup directory
      await fs.mkdir(backupPath, { recursive: true });
      
      // Backup database
      await this.backupDatabase(backupPath, timestamp);
      
      // Backup configuration files
      await this.backupConfigFiles(backupPath);
      
      // Backup uploaded files (if any)
      await this.backupUserFiles(backupPath);
      
      // Create backup manifest
      await this.createBackupManifest(backupPath, timestamp);
      
      // Compress the backup
      const compressedPath = await this.compressBackup(backupPath, backupName);
      
      // Clean up uncompressed backup
      await fs.rm(backupPath, { recursive: true, force: true });
      
      // Clean old backups
      await this.cleanOldBackups();
      
      console.log(`✅ Backup created successfully: ${compressedPath}`);
      return compressedPath;
      
    } catch (error) {
      console.error('❌ Backup failed:', error);
      throw error;
    }
  }

  /**
   * Backup the SQLite database
   */
  async backupDatabase(backupPath, timestamp) {
    try {
      const dbPath = DatabaseService.getDatabasePath();
      const backupDbPath = path.join(backupPath, 'database.db');
      
      // Use SQLite backup API for consistent backup
      const backupDb = DatabaseService.createBackupConnection(backupDbPath);
      DatabaseService.backupDatabase(backupDb);
      backupDb.close();
      
      console.log('  ✓ Database backed up');
      
      // Also create SQL dump for human readability
      const sqlDumpPath = path.join(backupPath, 'database-dump.sql');
      await this.createSQLDump(sqlDumpPath);
      
    } catch (error) {
      console.error('  ❌ Database backup failed:', error);
      throw error;
    }
  }

  /**
   * Create SQL dump for human-readable backup
   */
  async createSQLDump(dumpPath) {
    try {
      const tables = [
        'users', 'bots', 'lawyers', 'conversations', 
        'messages', 'bot_stats', 'system_logs'
      ];
      
      let sqlDump = '-- Legal Bot Database Dump\n';
      sqlDump += `-- Generated: ${new Date().toISOString()}\n\n`;
      
      for (const table of tables) {
        try {
          const rows = DatabaseService.getAllFromTable(table);
          if (rows.length > 0) {
            sqlDump += `-- Table: ${table}\n`;
            sqlDump += `DELETE FROM ${table};\n`;
            
            for (const row of rows) {
              const columns = Object.keys(row).join(', ');
              const values = Object.values(row).map(v => 
                v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
              ).join(', ');
              
              sqlDump += `INSERT INTO ${table} (${columns}) VALUES (${values});\n`;
            }
            sqlDump += '\n';
          }
        } catch (error) {
          console.warn(`  ⚠️  Could not dump table ${table}:`, error.message);
        }
      }
      
      await fs.writeFile(dumpPath, sqlDump, 'utf-8');
      console.log('  ✓ SQL dump created');
      
    } catch (error) {
      console.error('  ❌ SQL dump failed:', error);
    }
  }

  /**
   * Backup configuration files
   */
  async backupConfigFiles(backupPath) {
    try {
      const configPath = path.join(backupPath, 'config');
      await fs.mkdir(configPath, { recursive: true });
      
      const filesToBackup = [
        'package.json',
        'package-lock.json',
        '.env.example',
        'README.md'
      ];
      
      for (const file of filesToBackup) {
        try {
          const sourcePath = path.join(process.cwd(), file);
          const destPath = path.join(configPath, file);
          await fs.copyFile(sourcePath, destPath);
        } catch (error) {
          // File might not exist, skip
        }
      }
      
      console.log('  ✓ Configuration files backed up');
      
    } catch (error) {
      console.error('  ❌ Config backup failed:', error);
    }
  }

  /**
   * Backup user uploaded files
   */
  async backupUserFiles(backupPath) {
    try {
      const dataDir = path.join(process.cwd(), 'data');
      const uploadsDir = path.join(process.cwd(), 'uploads');
      const sessionsDir = path.join(process.cwd(), 'sessions');
      
      const userFilesPath = path.join(backupPath, 'user-files');
      await fs.mkdir(userFilesPath, { recursive: true });
      
      // Backup any user data files (excluding the database)
      try {
        const dataFiles = await fs.readdir(dataDir);
        for (const file of dataFiles) {
          if (!file.endsWith('.db') && !file.startsWith('json-backup-')) {
            await fs.copyFile(
              path.join(dataDir, file),
              path.join(userFilesPath, file)
            );
          }
        }
      } catch (error) {
        // Data directory might not exist or be empty
      }
      
      // Note: We don't backup sessions as they contain WhatsApp session data
      // that should not be transferred between environments
      
      console.log('  ✓ User files backed up');
      
    } catch (error) {
      console.error('  ❌ User files backup failed:', error);
    }
  }

  /**
   * Create backup manifest with metadata
   */
  async createBackupManifest(backupPath, timestamp) {
    try {
      const manifest = {
        version: '1.0',
        timestamp: timestamp,
        created: new Date().toISOString(),
        type: 'full-backup',
        application: 'legal-bot-v3',
        database: {
          type: 'sqlite',
          version: DatabaseService.getVersion()
        },
        stats: await this.getBackupStats(backupPath),
        restoreInstructions: [
          '1. Stop the application',
          '2. Replace database.db with the backed up version',
          '3. Restore configuration files if needed',
          '4. Restart the application',
          '5. Verify data integrity'
        ]
      };
      
      const manifestPath = path.join(backupPath, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      
      console.log('  ✓ Backup manifest created');
      
    } catch (error) {
      console.error('  ❌ Manifest creation failed:', error);
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(backupPath) {
    try {
      const stats = {
        users: DatabaseService.getUserCount(),
        bots: DatabaseService.getBotCount(),
        lawyers: DatabaseService.getLawyerCount(),
        conversations: DatabaseService.getConversationCount(),
        messages: DatabaseService.getMessageCount()
      };
      
      // Calculate backup size
      const files = await fs.readdir(backupPath, { withFileTypes: true });
      let totalSize = 0;
      
      for (const file of files) {
        if (file.isFile()) {
          const filePath = path.join(backupPath, file.name);
          const stat = await fs.stat(filePath);
          totalSize += stat.size;
        }
      }
      
      stats.backupSize = totalSize;
      stats.backupSizeHuman = this.formatBytes(totalSize);
      
      return stats;
      
    } catch (error) {
      console.error('Error getting backup stats:', error);
      return {};
    }
  }

  /**
   * Compress backup directory
   */
  async compressBackup(backupPath, backupName) {
    try {
      const compressedPath = `${backupPath}.tar.gz`;
      
      // Create tar.gz archive
      const { exec } = await import('child_process');
      const execPromise = promisify(exec);
      
      await execPromise(
        `tar -czf "${compressedPath}" -C "${path.dirname(backupPath)}" "${backupName}"`
      );
      
      console.log('  ✓ Backup compressed');
      return compressedPath;
      
    } catch (error) {
      console.error('  ❌ Compression failed:', error);
      throw error;
    }
  }

  /**
   * Clean old backups based on retention policy
   */
  async cleanOldBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files
        .filter(file => file.startsWith('legal-bot-backup-') && file.endsWith('.tar.gz'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          stat: null
        }));
      
      // Get file stats
      for (const backup of backupFiles) {
        try {
          backup.stat = await fs.stat(backup.path);
        } catch (error) {
          // File might have been deleted
        }
      }
      
      // Sort by creation time (oldest first)
      const validBackups = backupFiles
        .filter(b => b.stat)
        .sort((a, b) => a.stat.mtime - b.stat.mtime);
      
      // Remove old backups if we exceed the limit
      if (validBackups.length > this.maxBackups) {
        const toDelete = validBackups.slice(0, validBackups.length - this.maxBackups);
        
        for (const backup of toDelete) {
          await fs.unlink(backup.path);
          console.log(`  🗑️  Removed old backup: ${backup.name}`);
        }
      }
      
    } catch (error) {
      console.error('  ❌ Cleanup failed:', error);
    }
  }

  /**
   * Schedule automatic backups
   */
  scheduleBackups() {
    // Daily backup at 2 AM
    const scheduleDaily = () => {
      const now = new Date();
      const tomorrow2AM = new Date(now);
      tomorrow2AM.setDate(now.getDate() + 1);
      tomorrow2AM.setHours(2, 0, 0, 0);
      
      const timeUntilBackup = tomorrow2AM - now;
      
      setTimeout(async () => {
        try {
          await this.createFullBackup();
          console.log('📅 Scheduled backup completed');
        } catch (error) {
          console.error('📅 Scheduled backup failed:', error);
        }
        
        // Schedule next backup
        scheduleDaily();
      }, timeUntilBackup);
      
      console.log(`📅 Next backup scheduled for: ${tomorrow2AM.toLocaleString()}`);
    };
    
    scheduleDaily();
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupPath) {
    try {
      console.log(`🔄 Restoring from backup: ${backupPath}`);
      
      // Verify backup exists
      await fs.access(backupPath);
      
      // Extract backup if compressed
      let extractedPath = backupPath;
      if (backupPath.endsWith('.tar.gz')) {
        extractedPath = await this.extractBackup(backupPath);
      }
      
      // Read manifest
      const manifestPath = path.join(extractedPath, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
      
      console.log(`📋 Backup info: ${manifest.type} from ${manifest.created}`);
      
      // Restore database
      await this.restoreDatabase(extractedPath);
      
      console.log('✅ Backup restored successfully');
      console.log('⚠️  Please restart the application to use the restored data');
      
      return manifest;
      
    } catch (error) {
      console.error('❌ Restore failed:', error);
      throw error;
    }
  }

  /**
   * Extract compressed backup
   */
  async extractBackup(compressedPath) {
    try {
      const extractDir = path.join(this.backupDir, 'temp-restore');
      await fs.mkdir(extractDir, { recursive: true });
      
      const { exec } = await import('child_process');
      const execPromise = promisify(exec);
      
      await execPromise(
        `tar -xzf "${compressedPath}" -C "${extractDir}"`
      );
      
      // Find the extracted directory
      const files = await fs.readdir(extractDir);
      const backupDir = files.find(f => f.startsWith('legal-bot-backup-'));
      
      return path.join(extractDir, backupDir);
      
    } catch (error) {
      console.error('  ❌ Extraction failed:', error);
      throw error;
    }
  }

  /**
   * Restore database from backup
   */
  async restoreDatabase(backupPath) {
    try {
      const backupDbPath = path.join(backupPath, 'database.db');
      const currentDbPath = DatabaseService.getDatabasePath();
      
      // Create backup of current database
      const currentBackupPath = `${currentDbPath}.backup-${Date.now()}`;
      await fs.copyFile(currentDbPath, currentBackupPath);
      console.log(`  📋 Current database backed up to: ${currentBackupPath}`);
      
      // Restore database
      await fs.copyFile(backupDbPath, currentDbPath);
      console.log('  ✓ Database restored');
      
    } catch (error) {
      console.error('  ❌ Database restore failed:', error);
      throw error;
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupPath) {
    try {
      console.log(`🔍 Verifying backup: ${backupPath}`);
      
      let extractedPath = backupPath;
      if (backupPath.endsWith('.tar.gz')) {
        extractedPath = await this.extractBackup(backupPath);
      }
      
      // Check manifest
      const manifestPath = path.join(extractedPath, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
      
      // Check database file
      const dbPath = path.join(extractedPath, 'database.db');
      await fs.access(dbPath);
      
      // Verify database integrity
      const tempDb = DatabaseService.createBackupConnection(dbPath);
      const result = tempDb.prepare('PRAGMA integrity_check').get();
      tempDb.close();
      
      if (result.integrity_check !== 'ok') {
        throw new Error('Database integrity check failed');
      }
      
      console.log('✅ Backup verification passed');
      return {
        valid: true,
        manifest: manifest,
        checks: {
          manifest: true,
          database: true,
          integrity: true
        }
      };
      
    } catch (error) {
      console.error('❌ Backup verification failed:', error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * List available backups
   */
  async listBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];
      
      for (const file of files) {
        if (file.startsWith('legal-bot-backup-') && file.endsWith('.tar.gz')) {
          const filePath = path.join(this.backupDir, file);
          const stat = await fs.stat(filePath);
          
          backups.push({
            name: file,
            path: filePath,
            size: stat.size,
            sizeHuman: this.formatBytes(stat.size),
            created: stat.mtime,
            age: this.getAge(stat.mtime)
          });
        }
      }
      
      return backups.sort((a, b) => b.created - a.created);
      
    } catch (error) {
      console.error('Error listing backups:', error);
      return [];
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupInfo() {
    try {
      const backups = await this.listBackups();
      const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
      
      return {
        count: backups.length,
        totalSize: totalSize,
        totalSizeHuman: this.formatBytes(totalSize),
        oldest: backups.length > 0 ? backups[backups.length - 1] : null,
        newest: backups.length > 0 ? backups[0] : null,
        retention: this.maxBackups
      };
      
    } catch (error) {
      console.error('Error getting backup info:', error);
      return null;
    }
  }

  // Utility methods
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getAge(date) {
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days} days ago`;
    if (hours > 0) return `${hours} hours ago`;
    return 'Less than an hour ago';
  }
}

export default BackupService;

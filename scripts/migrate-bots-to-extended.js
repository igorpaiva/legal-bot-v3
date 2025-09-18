#!/usr/bin/env node

/**
 * Script de migração para mover bots da tabela 'bots' para 'bots_extended'
 * E limpar inconsistências de dados
 */

import DatabaseService from '../services/DatabaseService.js';

console.log('🔄 Iniciando migração de bots...');

try {
  const db = DatabaseService;
  
  // 1. Verificar bots na tabela antiga que não estão na nova
  console.log('📋 Verificando bots não migrados...');
  const unmigrated = db.db.prepare(`
    SELECT * FROM bots 
    WHERE id NOT IN (SELECT id FROM bots_extended)
  `).all();
  
  console.log(`📊 Encontrados ${unmigrated.length} bots para migrar`);
  
  // 2. Migrar bots não migrados
  for (const bot of unmigrated) {
    console.log(`🔄 Migrando bot: ${bot.name} (${bot.id})`);
    
    try {
      db.createBotExtended({
        id: bot.id,
        name: bot.name,
        assistantName: 'Ana', // Valor padrão
        ownerId: bot.owner_id,
        status: bot.status,
        phoneNumber: bot.phone_number,
        isActive: Boolean(bot.is_active),
        messageCount: bot.message_count || 0,
        lastActivity: bot.last_activity,
        sessionPath: `./sessions/session-${bot.id}`,
        qrCode: null,
        connectionAttempts: 0,
        lastError: bot.error_message,
        hasConnectedBefore: Boolean(bot.phone_number),
        lastQrGenerated: null
      });
      console.log(`✅ Bot ${bot.name} migrado com sucesso`);
    } catch (error) {
      console.error(`❌ Erro ao migrar bot ${bot.name}:`, error.message);
    }
  }
  
  // 3. Verificar e corrigir inconsistências
  console.log('🔍 Verificando inconsistências...');
  
  const botsWithIssues = db.db.prepare(`
    SELECT * FROM bots_extended 
    WHERE is_active = 0 AND status IN ('waiting_for_scan', 'ready', 'authenticated')
  `).all();
  
  if (botsWithIssues.length > 0) {
    console.log(`🔧 Corrigindo ${botsWithIssues.length} bots com status inconsistente...`);
    
    for (const bot of botsWithIssues) {
      db.updateBotExtended(bot.id, {
        isActive: true,
        status: 'waiting_for_scan'
      });
      console.log(`✅ Bot ${bot.name} reativado`);
    }
  }
  
  // 4. Relatório final
  console.log('\n📊 Relatório final:');
  const totalBots = db.getAllBotsExtended().length;
  const activeBots = db.getActiveBotsExtended().length;
  
  console.log(`Total de bots: ${totalBots}`);
  console.log(`Bots ativos: ${activeBots}`);
  console.log(`Bots inativos: ${totalBots - activeBots}`);
  
  console.log('\n✅ Migração concluída com sucesso!');
  
} catch (error) {
  console.error('❌ Erro durante a migração:', error);
  process.exit(1);
}

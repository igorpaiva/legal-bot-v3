#!/usr/bin/env node

/**
 * Script de limpeza de bancos de dados duplicados e verificação de integridade
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';
const MAIN_DB = 'legal-bot.db';
const BACKUP_PATTERN = /legal.*bot.*\.db$/;

console.log('🧹 Iniciando limpeza de bancos de dados...');

try {
  // Listar todos os arquivos .db na pasta data
  const files = fs.readdirSync(DATA_DIR).filter(file => file.endsWith('.db'));
  
  console.log(`📁 Encontrados ${files.length} arquivos .db`);
  
  const mainDbPath = path.join(DATA_DIR, MAIN_DB);
  const mainDbExists = fs.existsSync(mainDbPath);
  
  if (!mainDbExists) {
    console.error(`❌ Banco principal não encontrado: ${MAIN_DB}`);
    process.exit(1);
  }
  
  const mainDbSize = fs.statSync(mainDbPath).size;
  console.log(`✅ Banco principal: ${MAIN_DB} (${(mainDbSize / 1024 / 1024).toFixed(2)} MB)`);
  
  // Identificar bancos suspeitos (não são backups mas têm nomes similares)
  const suspiciousFiles = files.filter(file => {
    return file !== MAIN_DB && 
           !file.startsWith('legal-bot-backup-') && 
           BACKUP_PATTERN.test(file);
  });
  
  if (suspiciousFiles.length > 0) {
    console.log(`⚠️  Encontrados ${suspiciousFiles.length} bancos suspeitos:`);
    
    for (const file of suspiciousFiles) {
      const filePath = path.join(DATA_DIR, file);
      const fileSize = fs.statSync(filePath).size;
      const backupPath = `${filePath}.suspicious-backup`;
      
      console.log(`📦 ${file} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
      
      // Fazer backup antes de remover
      fs.renameSync(filePath, backupPath);
      console.log(`✅ Movido para: ${path.basename(backupPath)}`);
    }
  }
  
  // Listar backups legítimos
  const backupFiles = files.filter(file => file.startsWith('legal-bot-backup-'));
  console.log(`📦 Backups encontrados: ${backupFiles.length}`);
  
  // Limpar backups muito antigos (mais de 30 dias)
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  let oldBackups = 0;
  
  for (const backup of backupFiles) {
    const backupPath = path.join(DATA_DIR, backup);
    const stats = fs.statSync(backupPath);
    
    if (stats.mtime.getTime() < thirtyDaysAgo) {
      console.log(`🗑️  Removendo backup antigo: ${backup}`);
      fs.unlinkSync(backupPath);
      oldBackups++;
    }
  }
  
  console.log(`\n📊 Resumo da limpeza:`);
  console.log(`- Bancos suspeitos movidos: ${suspiciousFiles.length}`);
  console.log(`- Backups antigos removidos: ${oldBackups}`);
  console.log(`- Banco principal: ${MAIN_DB} ✅`);
  
  console.log('\n✅ Limpeza concluída com sucesso!');
  
} catch (error) {
  console.error('❌ Erro durante a limpeza:', error);
  process.exit(1);
}

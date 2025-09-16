-- Migration to add monitoring columns to system_logs table
-- This adds the missing columns needed by MonitoringService

-- Add category column to system_logs
ALTER TABLE system_logs ADD COLUMN category TEXT DEFAULT 'system';

-- Add metadata column to system_logs  
ALTER TABLE system_logs ADD COLUMN metadata TEXT;

-- Add created_at column if it doesn't exist (rename timestamp to created_at for consistency)
-- SQLite doesn't support column rename, so we'll work with existing timestamp column

-- Update the system_logs table structure to include the new columns
-- Add index for category
CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category);

-- Add index for metadata search
CREATE INDEX IF NOT EXISTS idx_system_logs_metadata ON system_logs(metadata);

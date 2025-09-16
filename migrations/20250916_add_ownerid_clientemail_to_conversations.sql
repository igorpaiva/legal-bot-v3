-- Migration: Add owner_id and client_email to conversations table
ALTER TABLE conversations ADD COLUMN owner_id TEXT;
ALTER TABLE conversations ADD COLUMN client_email TEXT;

-- Add password_set field to track if user has set their password
ALTER TABLE users ADD COLUMN password_set BOOLEAN DEFAULT 0;

-- Update existing users to have password_set = 1 (they already have passwords)
UPDATE users SET password_set = 1 WHERE password IS NOT NULL AND password != '';

-- Add index for performance
CREATE INDEX idx_users_password_set ON users(password_set);
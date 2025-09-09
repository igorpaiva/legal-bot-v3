import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import DatabaseService from './DatabaseService.js';

class EnhancedAuthService {
  constructor() {
    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET || 'your-super-secret-access-key-change-in-production';
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production';
    this.accessTokenExpiry = process.env.JWT_ACCESS_EXPIRY || '15m';
    this.refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRY || '7d';
    this.maxFailedAttempts = 5;
    this.lockoutDuration = 15 * 60 * 1000; // 15 minutes
    this.saltRounds = 12;
    
    // Initialize failed attempts tracking
    this.failedAttempts = new Map();
    this.lockedAccounts = new Map();
    
    // Clean up expired entries every hour
    setInterval(() => this.cleanupExpiredEntries(), 60 * 60 * 1000);
  }

  /**
   * Generate access and refresh tokens
   */
  generateTokens(user) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      lawOfficeName: user.lawOfficeName
    };

    const accessToken = jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiry,
      issuer: 'legal-bot-v3',
      audience: 'legal-bot-users'
    });

    const refreshToken = jwt.sign(
      { id: user.id, tokenVersion: this.generateTokenVersion() }, 
      this.refreshTokenSecret, 
      {
        expiresIn: this.refreshTokenExpiry,
        issuer: 'legal-bot-v3',
        audience: 'legal-bot-users'
      }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Generate a unique token version for refresh token rotation
   */
  generateTokenVersion() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Authenticate user with enhanced security
   */
  async authenticateUser(email, password, ipAddress, userAgent) {
    try {
      // Check if account is locked
      if (this.isAccountLocked(email)) {
        this.logSecurityEvent('account_locked_attempt', { email, ipAddress, userAgent });
        throw new Error('Account is temporarily locked due to multiple failed login attempts');
      }

      // Get user from database
      const user = DatabaseService.getUserByEmail(email);
      if (!user) {
        this.recordFailedAttempt(email, ipAddress);
        this.logSecurityEvent('login_failed_user_not_found', { email, ipAddress, userAgent });
        throw new Error('Invalid credentials');
      }

      // Check if user is active
      if (!user.isActive) {
        this.logSecurityEvent('login_failed_inactive_user', { email, ipAddress, userAgent });
        throw new Error('Account is deactivated');
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        this.recordFailedAttempt(email, ipAddress);
        this.logSecurityEvent('login_failed_invalid_password', { email, ipAddress, userAgent });
        throw new Error('Invalid credentials');
      }

      // Clear failed attempts on successful login
      this.clearFailedAttempts(email);

      // Generate tokens
      const tokens = this.generateTokens(user);

      // Store refresh token in database (for revocation capability)
      this.storeRefreshToken(user.id, tokens.refreshToken, ipAddress, userAgent);

      // Log successful login
      this.logSecurityEvent('login_success', { 
        userId: user.id, 
        email, 
        ipAddress, 
        userAgent 
      });

      // Update last login time
      DatabaseService.updateUser(user.id, {
        lastLoginAt: new Date().toISOString(),
        lastLoginIp: ipAddress
      });

      return {
        user: this.sanitizeUser(user),
        ...tokens
      };

    } catch (error) {
      console.error('Authentication failed:', error);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken, ipAddress, userAgent) {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, this.refreshTokenSecret);
      
      // Check if refresh token exists in database
      const storedToken = this.getStoredRefreshToken(decoded.id, refreshToken);
      if (!storedToken) {
        this.logSecurityEvent('refresh_token_not_found', { 
          userId: decoded.id, 
          ipAddress, 
          userAgent 
        });
        throw new Error('Invalid refresh token');
      }

      // Get user
      const user = DatabaseService.getUserById(decoded.id);
      if (!user || !user.isActive) {
        this.logSecurityEvent('refresh_token_invalid_user', { 
          userId: decoded.id, 
          ipAddress, 
          userAgent 
        });
        throw new Error('User not found or inactive');
      }

      // Generate new tokens (refresh token rotation)
      const newTokens = this.generateTokens(user);

      // Update refresh token in database
      this.updateRefreshToken(decoded.id, refreshToken, newTokens.refreshToken, ipAddress);

      this.logSecurityEvent('token_refresh_success', { 
        userId: user.id, 
        ipAddress, 
        userAgent 
      });

      return {
        user: this.sanitizeUser(user),
        ...newTokens
      };

    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Invalid or expired refresh token');
    }
  }

  /**
   * Logout user and revoke tokens
   */
  async logout(userId, refreshToken, ipAddress) {
    try {
      // Revoke refresh token
      this.revokeRefreshToken(userId, refreshToken);
      
      this.logSecurityEvent('logout_success', { userId, ipAddress });
      
      return true;
    } catch (error) {
      console.error('Logout failed:', error);
      return false;
    }
  }

  /**
   * Logout from all devices
   */
  async logoutFromAllDevices(userId, ipAddress) {
    try {
      // Revoke all refresh tokens for user
      this.revokeAllRefreshTokens(userId);
      
      this.logSecurityEvent('logout_all_devices', { userId, ipAddress });
      
      return true;
    } catch (error) {
      console.error('Logout from all devices failed:', error);
      return false;
    }
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, this.accessTokenSecret);
    } catch (error) {
      throw new Error('Invalid or expired access token');
    }
  }

  /**
   * Record failed login attempt
   */
  recordFailedAttempt(email, ipAddress) {
    const key = `${email}:${ipAddress}`;
    const attempts = this.failedAttempts.get(key) || [];
    attempts.push(new Date());
    
    // Keep only recent attempts (within lockout window)
    const recentAttempts = attempts.filter(
      time => Date.now() - time.getTime() < this.lockoutDuration
    );
    
    this.failedAttempts.set(key, recentAttempts);
    
    // Lock account if too many attempts
    if (recentAttempts.length >= this.maxFailedAttempts) {
      this.lockAccount(email);
    }
  }

  /**
   * Clear failed attempts for email
   */
  clearFailedAttempts(email) {
    // Clear all IP-based attempts for this email
    for (const [key] of this.failedAttempts) {
      if (key.startsWith(`${email}:`)) {
        this.failedAttempts.delete(key);
      }
    }
    
    // Remove from locked accounts
    this.lockedAccounts.delete(email);
  }

  /**
   * Lock account temporarily
   */
  lockAccount(email) {
    this.lockedAccounts.set(email, new Date());
    this.logSecurityEvent('account_locked', { email });
  }

  /**
   * Check if account is locked
   */
  isAccountLocked(email) {
    const lockTime = this.lockedAccounts.get(email);
    if (!lockTime) return false;
    
    const isLocked = Date.now() - lockTime.getTime() < this.lockoutDuration;
    
    // Auto-unlock if lockout period has passed
    if (!isLocked) {
      this.lockedAccounts.delete(email);
    }
    
    return isLocked;
  }

  /**
   * Store refresh token in database
   */
  storeRefreshToken(userId, refreshToken, ipAddress, userAgent) {
    try {
      // Hash the refresh token for storage
      const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
      
      DatabaseService.db.prepare(`
        INSERT INTO refresh_tokens (user_id, token_hash, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, hashedToken, ipAddress, userAgent, new Date().toISOString());
      
      // Clean up old tokens for this user (keep only last 5)
      this.cleanupOldRefreshTokens(userId);
      
    } catch (error) {
      console.error('Error storing refresh token:', error);
    }
  }

  /**
   * Get stored refresh token
   */
  getStoredRefreshToken(userId, refreshToken) {
    try {
      const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
      
      return DatabaseService.db.prepare(`
        SELECT * FROM refresh_tokens 
        WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL
      `).get(userId, hashedToken);
      
    } catch (error) {
      console.error('Error getting refresh token:', error);
      return null;
    }
  }

  /**
   * Update refresh token (for rotation)
   */
  updateRefreshToken(userId, oldToken, newToken, ipAddress) {
    try {
      const oldHashedToken = crypto.createHash('sha256').update(oldToken).digest('hex');
      const newHashedToken = crypto.createHash('sha256').update(newToken).digest('hex');
      
      // Revoke old token
      DatabaseService.db.prepare(`
        UPDATE refresh_tokens 
        SET revoked_at = ? 
        WHERE user_id = ? AND token_hash = ?
      `).run(new Date().toISOString(), userId, oldHashedToken);
      
      // Store new token
      DatabaseService.db.prepare(`
        INSERT INTO refresh_tokens (user_id, token_hash, ip_address, created_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, newHashedToken, ipAddress, new Date().toISOString());
      
    } catch (error) {
      console.error('Error updating refresh token:', error);
    }
  }

  /**
   * Revoke refresh token
   */
  revokeRefreshToken(userId, refreshToken) {
    try {
      const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
      
      DatabaseService.db.prepare(`
        UPDATE refresh_tokens 
        SET revoked_at = ? 
        WHERE user_id = ? AND token_hash = ?
      `).run(new Date().toISOString(), userId, hashedToken);
      
    } catch (error) {
      console.error('Error revoking refresh token:', error);
    }
  }

  /**
   * Revoke all refresh tokens for user
   */
  revokeAllRefreshTokens(userId) {
    try {
      DatabaseService.db.prepare(`
        UPDATE refresh_tokens 
        SET revoked_at = ? 
        WHERE user_id = ? AND revoked_at IS NULL
      `).run(new Date().toISOString(), userId);
      
    } catch (error) {
      console.error('Error revoking all refresh tokens:', error);
    }
  }

  /**
   * Clean up old refresh tokens
   */
  cleanupOldRefreshTokens(userId) {
    try {
      // Keep only the 5 most recent tokens per user
      const tokens = DatabaseService.db.prepare(`
        SELECT id FROM refresh_tokens 
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT -1 OFFSET 5
      `).all(userId);
      
      if (tokens.length > 0) {
        const tokenIds = tokens.map(t => t.id);
        DatabaseService.db.prepare(`
          UPDATE refresh_tokens 
          SET revoked_at = ? 
          WHERE id IN (${tokenIds.map(() => '?').join(',')})
        `).run(new Date().toISOString(), ...tokenIds);
      }
      
    } catch (error) {
      console.error('Error cleaning up old refresh tokens:', error);
    }
  }

  /**
   * Clean up expired entries
   */
  cleanupExpiredEntries() {
    const now = Date.now();
    
    // Clean failed attempts
    for (const [key, attempts] of this.failedAttempts) {
      const recentAttempts = attempts.filter(
        time => now - time.getTime() < this.lockoutDuration
      );
      
      if (recentAttempts.length === 0) {
        this.failedAttempts.delete(key);
      } else {
        this.failedAttempts.set(key, recentAttempts);
      }
    }
    
    // Clean locked accounts
    for (const [email, lockTime] of this.lockedAccounts) {
      if (now - lockTime.getTime() >= this.lockoutDuration) {
        this.lockedAccounts.delete(email);
      }
    }
    
    // Clean expired refresh tokens from database
    try {
      DatabaseService.db.prepare(`
        DELETE FROM refresh_tokens 
        WHERE created_at < datetime('now', '-30 days')
        OR revoked_at < datetime('now', '-7 days')
      `).run();
    } catch (error) {
      console.error('Error cleaning expired refresh tokens:', error);
    }
  }

  /**
   * Log security events
   */
  logSecurityEvent(event, data) {
    try {
      DatabaseService.db.prepare(`
        INSERT INTO system_logs (level, category, message, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'INFO',
        'SECURITY',
        event,
        JSON.stringify(data),
        new Date().toISOString()
      );
    } catch (error) {
      console.error('Error logging security event:', error);
    }
  }

  /**
   * Get user active sessions
   */
  getUserSessions(userId) {
    try {
      return DatabaseService.db.prepare(`
        SELECT ip_address, user_agent, created_at, 
               CASE WHEN revoked_at IS NULL THEN 'active' ELSE 'revoked' END as status
        FROM refresh_tokens 
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId);
    } catch (error) {
      console.error('Error getting user sessions:', error);
      return [];
    }
  }

  /**
   * Get security events for user
   */
  getUserSecurityEvents(userId, limit = 50) {
    try {
      return DatabaseService.db.prepare(`
        SELECT level, message, metadata, created_at
        FROM system_logs 
        WHERE category = 'SECURITY' 
        AND (metadata LIKE ? OR metadata LIKE ?)
        ORDER BY created_at DESC
        LIMIT ?
      `).all(`%"userId":"${userId}"%`, `%"email":"%`, limit);
    } catch (error) {
      console.error('Error getting security events:', error);
      return [];
    }
  }

  /**
   * Sanitize user object (remove sensitive data)
   */
  sanitizeUser(user) {
    const { password, ...sanitizedUser } = user;
    return sanitizedUser;
  }

  /**
   * Change user password with security checks
   */
  async changePassword(userId, currentPassword, newPassword, ipAddress) {
    try {
      const user = DatabaseService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        this.logSecurityEvent('password_change_failed_wrong_current', { 
          userId, 
          ipAddress 
        });
        throw new Error('Current password is incorrect');
      }

      // Validate new password strength
      this.validatePasswordStrength(newPassword);

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, this.saltRounds);

      // Update password
      DatabaseService.updateUser(userId, {
        password: hashedNewPassword,
        passwordChangedAt: new Date().toISOString()
      });

      // Revoke all refresh tokens (force re-login on all devices)
      this.revokeAllRefreshTokens(userId);

      this.logSecurityEvent('password_change_success', { userId, ipAddress });

      return true;
    } catch (error) {
      console.error('Password change failed:', error);
      throw error;
    }
  }

  /**
   * Validate password strength
   */
  validatePasswordStrength(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (password.length < minLength) {
      throw new Error(`Password must be at least ${minLength} characters long`);
    }

    if (!hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
      throw new Error('Password must contain uppercase, lowercase, numbers, and special characters');
    }

    return true;
  }
}

export default EnhancedAuthService;

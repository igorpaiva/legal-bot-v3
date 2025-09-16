export class User {
  constructor(data = {}, databaseService = null) {
    this.id = data.id;
    this.email = data.email;
    this.password = data.password; // Will be hashed
    this.role = data.role || 'law_office'; // 'admin' or 'law_office'
    this.lawOfficeName = data.lawOfficeName;
    this.botCredits = data.botCredits || (data.role === 'law_office' ? 1 : 0);
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.passwordSet = data.passwordSet !== undefined ? data.passwordSet : false;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.createdBy = data.createdBy; // Admin ID who created this account
    this._databaseService = databaseService;
  }

  // Get used bot credits from database
  getUsedBotCredits() {
    if (this._databaseService) {
      return this._databaseService.getUserBotCount(this.id);
    }
    return 0; // Fallback if no database service available
  }

  // Calculate available bot credits
  getAvailableBotCredits() {
    return Math.max(0, this.botCredits - this.getUsedBotCredits());
  }

  // Check if user can create a new bot
  canCreateBot() {
    return this.getAvailableBotCredits() > 0;
  }

  // Add bot credits (admin action)
  addBotCredits(amount) {
    this.botCredits += amount;
    this.updatedAt = new Date().toISOString();
  }

  // Convert to JSON for storage
  toJSON() {
    return {
      id: this.id,
      email: this.email,
      password: this.password,
      role: this.role,
      lawOfficeName: this.lawOfficeName,
      botCredits: this.botCredits,
      isActive: this.isActive,
      passwordSet: this.passwordSet,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy
    };
  }

  // Create from JSON
  static fromJSON(data, databaseService = null) {
    return new User(data, databaseService);
  }

  // Validation
  validate() {
    const errors = [];

    if (!this.email || !this.email.includes('@')) {
      errors.push('Valid email is required');
    }

    if (!this.password || this.password.length < 6) {
      errors.push('Password must be at least 6 characters');
    }

    if (!['admin', 'law_office'].includes(this.role)) {
      errors.push('Role must be admin or law_office');
    }

    if (this.role === 'law_office' && !this.lawOfficeName) {
      errors.push('Law office name is required for law office accounts');
    }

    return errors;
  }
}

export default User;

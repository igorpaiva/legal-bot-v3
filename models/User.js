export class User {
  constructor(data = {}) {
    this.id = data.id;
    this.email = data.email;
    this.password = data.password; // Will be hashed
    this.role = data.role || 'law_office'; // 'admin' or 'law_office'
    this.lawOfficeName = data.lawOfficeName;
    this.botCredits = data.botCredits || (data.role === 'law_office' ? 1 : 0);
    this.usedBotCredits = data.usedBotCredits || 0;
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.createdBy = data.createdBy; // Admin ID who created this account
  }

  // Calculate available bot credits
  getAvailableBotCredits() {
    return Math.max(0, this.botCredits - this.usedBotCredits);
  }

  // Check if user can create a new bot
  canCreateBot() {
    return this.getAvailableBotCredits() > 0;
  }

  // Use a bot credit
  useBotCredit() {
    if (this.canCreateBot()) {
      this.usedBotCredits += 1;
      this.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  // Return a bot credit (when bot is deleted)
  returnBotCredit() {
    if (this.usedBotCredits > 0) {
      this.usedBotCredits -= 1;
      this.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
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
      usedBotCredits: this.usedBotCredits,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy
    };
  }

  // Create from JSON
  static fromJSON(data) {
    return new User(data);
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

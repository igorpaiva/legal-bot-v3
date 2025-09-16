import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import User from '../models/User.js';
import DatabaseService from './DatabaseService.js';

export class UserService {
  constructor() {
    this.SALT_ROUNDS = 12;
    this.databaseService = DatabaseService; // Use the singleton instance
    this.initializeDefaultAdmin();
  }

  // Initialize default admin user if needed
  async initializeDefaultAdmin() {
    try {
      const adminExists = DatabaseService.getAllUsers().some(user => user.role === 'admin');
      
      if (!adminExists) {
        console.log('No admin user found. Creating default admin...');
        await this.createDefaultAdminUser();
        console.log('Default admin user created successfully');
      }
    } catch (error) {
      console.error('Error initializing default admin:', error);
    }
  }

  // Create default admin user if no users exist
  async createDefaultAdminUser() {
    try {
      // Check if admin already exists by email
      const existingAdmin = DatabaseService.getUserByEmail('admin@legal-bot.com');
      if (existingAdmin) {
        console.log('Default admin user already exists');
        return existingAdmin;
      }

      const adminUser = {
        id: uuidv4(),
        email: 'admin@legal-bot.com',
        password: await bcrypt.hash('admin123', this.SALT_ROUNDS),
        role: 'admin',
        lawOfficeName: null,
        botCredits: 0,
        isActive: true,
        passwordSet: true // Admin has a predefined password, no setup needed
      };

      DatabaseService.createUser(adminUser);
      console.log('Created default admin user: admin@legal-bot.com / admin123');
      return adminUser;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        console.log('Default admin user already exists (UNIQUE constraint)');
        return DatabaseService.getUserByEmail('admin@legal-bot.com');
      }
      throw error;
    }
  }

  // Get all law offices (for admin view)
  async getAllLawOffices() {
    return DatabaseService.getLawOffices();
  }

  // Get user by email
  async getUserByEmail(email) {
    const userData = DatabaseService.getUserByEmail(email);
    return userData ? User.fromJSON(userData, this.databaseService) : null;
  }

  // Get user by ID
  async getUserById(id) {
    const userData = DatabaseService.getUserById(id);
    return userData ? User.fromJSON(userData, this.databaseService) : null;
  }

  // Authenticate user
  async authenticateUser(email, password) {
    const user = await this.getUserByEmail(email);
    if (!user) {
      return null;
    }

    // Check if user needs to set password on first login
    if (!user.passwordSet) {
      return { ...user, requiresPasswordSetup: true };
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  // Set password for first-time login
  async setFirstPassword(userId, newPassword) {
    const user = DatabaseService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (user.passwordSet) {
      throw new Error('Password already set');
    }

    const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);
    DatabaseService.updateUser(userId, {
      password: hashedPassword,
      passwordSet: true
    });

    return true;
  }

  // Create new law office account (admin only)
  async createLawOffice(adminId, lawOfficeData) {
    // Verify admin exists
    const admin = DatabaseService.getUserById(adminId);
    if (!admin || admin.role !== 'admin') {
      throw new Error('Only admins can create law office accounts');
    }

    // Check if email already exists for an active user
    const existingUser = DatabaseService.getUserByEmail(lawOfficeData.email);
    if (existingUser && existingUser.isActive) {
      throw new Error('Email already exists');
    }

    // Generate a temporary password (user will set their own on first login)
    const tempPassword = uuidv4(); // Temporary password, user will change on first login
    const hashedPassword = await bcrypt.hash(tempPassword, this.SALT_ROUNDS);

    let createdUser;
    if (existingUser && !existingUser.isActive) {
      // Reactivate existing deactivated user with new data
      const updatedUserData = {
        password: hashedPassword,
        role: 'law_office',
        law_office_name: lawOfficeData.lawOfficeName,
        bot_credits: 1, // Default 1 bot credit
        is_active: true,
        password_set: false // User needs to set password on first login
      };
      createdUser = DatabaseService.updateUser(existingUser.id, updatedUserData);
    } else {
      // Create new law office user
      const newUserData = {
        id: uuidv4(),
        email: lawOfficeData.email,
        password: hashedPassword,
        role: 'law_office',
        law_office_name: lawOfficeData.lawOfficeName,
        bot_credits: 1, // Default 1 bot credit
        is_active: true,
        password_set: false // User needs to set password on first login
      };

      // Create user in database
      createdUser = DatabaseService.createUser(newUserData);
    }

    // Return user without password
    const userResponse = { ...createdUser };
    delete userResponse.password;
    return userResponse;
  }

  // Update law office bot credits (admin only)
  async updateBotCredits(adminId, lawOfficeId, newBotCredits) {
    // Verify admin exists
    const admin = DatabaseService.getUserById(adminId);
    if (!admin || admin.role !== 'admin') {
      throw new Error('Only admins can update bot credits');
    }

    // Find law office
    const lawOffice = DatabaseService.getUserById(lawOfficeId);
    if (!lawOffice || lawOffice.role !== 'law_office') {
      throw new Error('Law office not found');
    }

    // Update credits
    const updatedUser = DatabaseService.updateUser(lawOfficeId, {
      botCredits: newBotCredits
    });

    // Return updated user without password
    const userResponse = { ...updatedUser };
    delete userResponse.password;
    return userResponse;
  }

  // Use bot credit (when creating a bot)
  async useBotCredit(userId) {
    const user = DatabaseService.getUserById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    // Check if user has available credits
    const usedCredits = DatabaseService.getUserBotCount(userId);
    const availableCredits = user.botCredits - usedCredits;

    if (availableCredits <= 0) {
      throw new Error('No available bot credits');
    }

    // Credits are automatically managed through bot creation/deletion
    return availableCredits - 1;
  }

  // Return bot credit (when deleting a bot)
  async returnBotCredit(userId) {
    const user = DatabaseService.getUserById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    // Credits are automatically managed through bot creation/deletion
    const usedCredits = DatabaseService.getUserBotCount(userId);
    return user.botCredits - usedCredits;
  }

  // Deactivate law office (admin only)
  async deactivateLawOffice(adminId, lawOfficeId) {
    // Verify admin exists
    const admin = DatabaseService.getUserById(adminId);
    if (!admin || admin.role !== 'admin') {
      throw new Error('Only admins can deactivate law office accounts');
    }

    // Find and deactivate law office
    const lawOffice = DatabaseService.getUserById(lawOfficeId);
    if (!lawOffice || lawOffice.role !== 'law_office') {
      throw new Error('Law office not found');
    }

    DatabaseService.updateUser(lawOfficeId, { isActive: false });
    return true;
  }
}

export default UserService;

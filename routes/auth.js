import express from 'express';
import { generateToken, authenticateUser, requireAdmin } from '../middleware/auth.js';
import DatabaseService from '../services/DatabaseService.js';

const router = express.Router();

// POST /api/auth/login - Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await req.userService.authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user needs to set password
    if (user.requiresPasswordSetup) {
      return res.status(200).json({
        message: 'First login - password setup required',
        requiresPasswordSetup: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          lawOfficeName: user.lawOfficeName
        }
      });
    }

    const token = generateToken(user);
    
    // Return user data without password
    const userData = { ...user };
    delete userData.password;

    res.json({
      message: 'Login successful',
      token,
      user: userData
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me - Get current user info
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const userData = { ...req.user };
    delete userData.password;
    res.json(userData);
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// POST /api/auth/set-first-password - Set password on first login
router.post('/set-first-password', async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password || password.length < 6) {
      return res.status(400).json({ error: 'User ID and password (min 6 characters) are required' });
    }

    // Verify user exists and needs password setup
    const user = await req.userService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.passwordSet) {
      return res.status(400).json({ error: 'Password already set' });
    }

    await req.userService.setFirstPassword(userId, password);

    res.json({ message: 'Password set successfully' });

  } catch (error) {
    console.error('Set first password error:', error);
    
    if (error.message.includes('Password already set') || error.message.includes('User not found')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to set password' });
  }
});

// POST /api/auth/law-offices - Create law office account (admin only)
router.post('/law-offices', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { email, lawOfficeName } = req.body;

    if (!email || !lawOfficeName) {
      return res.status(400).json({ 
        error: 'Email and law office name are required' 
      });
    }

    const newLawOffice = await req.userService.createLawOffice(req.user.id, {
      email,
      lawOfficeName
    });

    res.status(201).json({
      message: 'Law office account created successfully. User will set their password on first login.',
      lawOffice: newLawOffice
    });

  } catch (error) {
    console.error('Create law office error:', error);
    
    if (error.message.includes('Email already exists')) {
      return res.status(409).json({ error: error.message });
    }
    
    if (error.message.includes('Validation errors')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to create law office account' });
  }
});

// GET /api/auth/law-offices - Get all law offices (admin only)
router.get('/law-offices', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const lawOffices = await req.userService.getAllLawOffices();
    
    // Remove passwords from response
    const safeLawOffices = lawOffices.map(office => {
      // DatabaseService returns plain objects, not User instances
      const officeData = { ...office };
      delete officeData.password;
      return officeData;
    });

    res.json(safeLawOffices);
  } catch (error) {
    console.error('Get law offices error:', error);
    res.status(500).json({ error: 'Failed to get law offices' });
  }
});

// PUT /api/auth/law-offices/:id/bot-credits - Update bot credits (admin only)
router.put('/law-offices/:id/bot-credits', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { botCredits } = req.body;

    if (typeof botCredits !== 'number' || botCredits < 0) {
      return res.status(400).json({ error: 'Bot credits must be a non-negative number' });
    }

    const updatedLawOffice = await req.userService.updateBotCredits(req.user.id, id, botCredits);

    res.json({
      message: 'Bot credits updated successfully',
      lawOffice: updatedLawOffice
    });

  } catch (error) {
    console.error('Update bot credits error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to update bot credits' });
  }
});

// PUT /api/auth/law-offices/:id - Update law office (admin only)
router.put('/law-offices/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { lawOfficeName, password } = req.body;
    
    // Find law office
    const lawOffice = DatabaseService.getUserById(id);
    if (!lawOffice || lawOffice.role !== 'law_office') {
      return res.status(404).json({ error: 'Law office not found' });
    }

    // Prepare update data
    const updateData = {};
    if (lawOfficeName) updateData.law_office_name = lawOfficeName;
    if (password) {
      const bcrypt = await import('bcrypt');
      updateData.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length > 0) {
      DatabaseService.updateUser(id, updateData);
    }

    // Get updated law office data
    const updatedLawOffice = DatabaseService.getUserById(id);
    
    res.json({
      message: 'Law office updated successfully',
      lawOffice: {
        id: updatedLawOffice.id,
        email: updatedLawOffice.email,
        lawOfficeName: updatedLawOffice.law_office_name,
        isActive: updatedLawOffice.is_active,
        botCredits: updatedLawOffice.bot_credits
      }
    });

  } catch (error) {
    console.error('Update law office error:', error);
    res.status(500).json({ error: 'Failed to update law office' });
  }
});

// DELETE /api/auth/law-offices/:id - Deactivate law office (admin only)
router.delete('/law-offices/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await req.userService.deactivateLawOffice(req.user.id, id);

    res.json({ message: 'Law office account deactivated successfully' });

  } catch (error) {
    console.error('Deactivate law office error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to deactivate law office account' });
  }
});

// DELETE /api/auth/law-offices/:id/permanent - Permanently delete law office (admin only)
router.delete('/law-offices/:id/permanent', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find law office
    const lawOffice = DatabaseService.getUserById(id);
    if (!lawOffice || lawOffice.role !== 'law_office') {
      return res.status(404).json({ error: 'Law office not found' });
    }

    // Permanently delete the user
    DatabaseService.deleteUser(id);

    res.json({ message: 'Law office account permanently deleted successfully' });

  } catch (error) {
    console.error('Delete law office error:', error);
    
    res.status(500).json({ error: 'Failed to delete law office account' });
  }
});

// PATCH /api/auth/law-offices/:id/toggle-active - Toggle law office active status (admin only)
router.patch('/law-offices/:id/toggle-active', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find law office
    const lawOffice = DatabaseService.getUserById(id);
    if (!lawOffice || lawOffice.role !== 'law_office') {
      return res.status(404).json({ error: 'Law office not found' });
    }

    // Toggle active status
    const newActiveStatus = !lawOffice.isActive;
    DatabaseService.updateUser(id, { isActive: newActiveStatus });

    // Get updated law office data
    const updatedLawOffice = DatabaseService.getUserById(id);
    
    res.json({
      message: `Law office ${newActiveStatus ? 'activated' : 'deactivated'} successfully`,
      lawOffice: {
        id: updatedLawOffice.id,
        email: updatedLawOffice.email,
        lawOfficeName: updatedLawOffice.law_office_name,
        isActive: updatedLawOffice.isActive,
        botCredits: updatedLawOffice.bot_credits
      }
    });

  } catch (error) {
    console.error('Toggle law office status error:', error);
    res.status(500).json({ error: 'Failed to toggle law office status' });
  }
});

export default router;

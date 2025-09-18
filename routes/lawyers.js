import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/DatabaseService.js';

const router = express.Router();

// Format lawyer data for frontend (convert legal_field to specialty)
function formatLawyerForFrontend(lawyer) {
  return {
    id: lawyer.id,
    name: lawyer.name,
    specialty: lawyer.legalField, // Convert legal_field to specialty
    phone: lawyer.phone,
    email: lawyer.email,
    isActive: lawyer.isActive,
    createdAt: lawyer.createdAt,
    updatedAt: lawyer.updatedAt,
    ownerId: lawyer.ownerId
  };
}

// Format phone number to WhatsApp format (+5511999999999)
function formatPhoneForWhatsApp(phone) {
  // Remove all non-numeric characters
  let numbers = phone.replace(/\D/g, '');
  
  // If it doesn't start with 55, add Brazil country code
  if (!numbers.startsWith('55')) {
    numbers = `55${numbers}`;
  }
  
  // Handle the extra '9' after area code issue
  // Brazilian mobile numbers: 55 + area code (2 digits) + 9 + number (8 digits)
  // WhatsApp sometimes expects: 55 + area code (2 digits) + number (8 digits)
  if (numbers.length === 13 && numbers.startsWith('55')) {
    // Format: 55 + XX + 9 + XXXXXXXX (13 digits total)
    // Remove the '9' after area code: 55 + XX + XXXXXXXX (12 digits total)
    const areaCode = numbers.substring(2, 4);
    const ninthDigit = numbers.substring(4, 5);
    const restOfNumber = numbers.substring(5);
    
    if (ninthDigit === '9' && restOfNumber.length === 8) {
      console.log(`Removing extra '9' from phone: ${numbers} -> 55${areaCode}${restOfNumber}`);
      numbers = `55${areaCode}${restOfNumber}`;
    }
  }
  
  return `+${numbers}`;
}

// GET /api/lawyers - Get all lawyers for the authenticated user
router.get('/', async (req, res) => {
  try {
    const lawyers = db.getLawyersByOwner(req.user.id);
    const formattedLawyers = lawyers.map(formatLawyerForFrontend);
    res.json(formattedLawyers);
  } catch (error) {
    console.error('Error loading lawyers:', error);
    res.status(500).json({ error: 'Failed to load lawyers' });
  }
});

// GET /api/lawyers/by-specialty/:specialty - Get lawyers by specialty for the authenticated user
router.get('/by-specialty/:specialty', async (req, res) => {
  try {
    const { specialty } = req.params;
    const lawyers = db.getLawyersByField(specialty, req.user.id);
    const formattedLawyers = lawyers.map(formatLawyerForFrontend);
    res.json(formattedLawyers);
  } catch (error) {
    console.error('Error loading lawyers by specialty:', error);
    res.status(500).json({ error: 'Failed to load lawyers by specialty' });
  }
});

// POST /api/lawyers - Create new lawyer
router.post('/', async (req, res) => {
  try {
    const { name, specialty, phone, email } = req.body;

    // Validation
    if (!name || !specialty || !phone) {
      return res.status(400).json({ error: 'Name, specialty, and phone are required' });
    }

    // Validate phone format (should be 11 digits)
    const phoneNumbers = phone.replace(/\D/g, '');
    if (phoneNumbers.length !== 11) {
      return res.status(400).json({ error: 'Phone must have 11 digits (DDD + 9 digits)' });
    }

    // Check if phone already exists for this user
    const existingLawyers = db.getLawyersByOwner(req.user.id);
    if (existingLawyers.some(lawyer => lawyer.phone === phoneNumbers)) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    const newLawyerData = {
      id: uuidv4(),
      name: name.trim(),
      legalField: specialty, // Frontend sends 'specialty', DB expects 'legalField'
      phone: phoneNumbers,
      email: email?.trim() || null,
      isActive: true,
      ownerId: req.user.id
    };

    db.createLawyer(newLawyerData);
    
    // Return formatted data for frontend
    const createdLawyer = formatLawyerForFrontend({
      ...newLawyerData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    res.status(201).json(createdLawyer);
  } catch (error) {
    console.error('Error creating lawyer:', error);
    res.status(500).json({ error: 'Failed to create lawyer' });
  }
});

// PUT /api/lawyers/:id - Update lawyer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, specialty, phone, email } = req.body;

    // Validation
    if (!name || !specialty || !phone) {
      return res.status(400).json({ error: 'Name, specialty, and phone are required' });
    }

    // Validate phone format
    const phoneNumbers = phone.replace(/\D/g, '');
    if (phoneNumbers.length !== 11) {
      return res.status(400).json({ error: 'Phone must have 11 digits (DDD + 9 digits)' });
    }

    // Check if lawyer exists and belongs to user
    const existingLawyer = db.getLawyerById(id, req.user.id);
    if (!existingLawyer) {
      return res.status(404).json({ error: 'Lawyer not found or access denied' });
    }

    // Check if phone already exists for this user (excluding current lawyer)
    const allLawyers = db.getLawyersByOwner(req.user.id);
    if (allLawyers.some(lawyer => lawyer.id !== id && lawyer.phone === phoneNumbers)) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    // Update lawyer
    const updateData = {
      name: name.trim(),
      legalField: specialty, // Frontend sends 'specialty', DB expects 'legalField'
      phone: phoneNumbers,
      email: email?.trim() || null,
      isActive: existingLawyer.isActive // Keep current status
    };

    db.updateLawyer(id, updateData, req.user.id);

    // Get updated lawyer
    const updatedLawyer = db.getLawyerById(id, req.user.id);
    res.json(formatLawyerForFrontend(updatedLawyer));
  } catch (error) {
    console.error('Error updating lawyer:', error);
    res.status(500).json({ error: 'Failed to update lawyer' });
  }
});

// PATCH /api/lawyers/:id/toggle-active - Toggle lawyer active status
router.patch('/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if lawyer exists and belongs to user
    const existingLawyer = db.getLawyerById(id, req.user.id);
    if (!existingLawyer) {
      return res.status(404).json({ error: 'Lawyer not found or access denied' });
    }

    // Toggle the isActive status
    const updateData = {
      name: existingLawyer.name,
      legalField: existingLawyer.legalField,
      phone: existingLawyer.phone,
      email: existingLawyer.email,
      isActive: !existingLawyer.isActive
    };

    db.updateLawyer(id, updateData, req.user.id);

    // Get updated lawyer
    const updatedLawyer = db.getLawyerById(id, req.user.id);
    res.json(formatLawyerForFrontend(updatedLawyer));
  } catch (error) {
    console.error('Error toggling lawyer status:', error);
    res.status(500).json({ error: 'Failed to toggle lawyer status' });
  }
});

// DELETE /api/lawyers/:id - Delete lawyer
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if lawyer exists and belongs to user
    const existingLawyer = db.getLawyerById(id, req.user.id);
    if (!existingLawyer) {
      return res.status(404).json({ error: 'Lawyer not found or access denied' });
    }

    db.deleteLawyer(id, req.user.id);
    res.json({ message: 'Lawyer deleted successfully' });
  } catch (error) {
    console.error('Error deleting lawyer:', error);
    res.status(500).json({ error: 'Failed to delete lawyer' });
  }
});

export { formatPhoneForWhatsApp };
export default router;

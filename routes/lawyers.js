import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const LAWYERS_FILE = path.join(process.cwd(), 'data', 'lawyers.json');

// Ensure data directory exists
async function ensureDataDirectory() {
  try {
    await fs.access(path.dirname(LAWYERS_FILE));
  } catch {
    await fs.mkdir(path.dirname(LAWYERS_FILE), { recursive: true });
  }
}

// Load lawyers from file
async function loadLawyers() {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(LAWYERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return empty array
    return [];
  }
}

// Save lawyers to file
async function saveLawyers(lawyers) {
  await ensureDataDirectory();
  await fs.writeFile(LAWYERS_FILE, JSON.stringify(lawyers, null, 2));
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

// GET /api/lawyers - Get all lawyers
router.get('/', async (req, res) => {
  try {
    const lawyers = await loadLawyers();
    res.json(lawyers);
  } catch (error) {
    console.error('Error loading lawyers:', error);
    res.status(500).json({ error: 'Failed to load lawyers' });
  }
});

// GET /api/lawyers/by-specialty/:specialty - Get lawyers by specialty
router.get('/by-specialty/:specialty', async (req, res) => {
  try {
    const { specialty } = req.params;
    const lawyers = await loadLawyers();
    const specialtyLawyers = lawyers.filter(
      lawyer => lawyer.specialty === specialty && lawyer.isActive
    );
    res.json(specialtyLawyers);
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

    const lawyers = await loadLawyers();

    // Check if phone already exists
    if (lawyers.some(lawyer => lawyer.phone === phoneNumbers)) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    const newLawyer = {
      id: uuidv4(),
      name: name.trim(),
      specialty,
      phone: phoneNumbers,
      email: email?.trim() || null,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    lawyers.push(newLawyer);
    await saveLawyers(lawyers);

    res.status(201).json(newLawyer);
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

    const lawyers = await loadLawyers();
    const lawyerIndex = lawyers.findIndex(lawyer => lawyer.id === id);

    if (lawyerIndex === -1) {
      return res.status(404).json({ error: 'Lawyer not found' });
    }

    // Check if phone already exists (excluding current lawyer)
    if (lawyers.some((lawyer, index) => index !== lawyerIndex && lawyer.phone === phoneNumbers)) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    // Update lawyer
    lawyers[lawyerIndex] = {
      ...lawyers[lawyerIndex],
      name: name.trim(),
      specialty,
      phone: phoneNumbers,
      email: email?.trim() || null,
      updatedAt: new Date().toISOString()
    };

    await saveLawyers(lawyers);
    res.json(lawyers[lawyerIndex]);
  } catch (error) {
    console.error('Error updating lawyer:', error);
    res.status(500).json({ error: 'Failed to update lawyer' });
  }
});

// PATCH /api/lawyers/:id/toggle-active - Toggle lawyer active status
router.patch('/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;
    const lawyers = await loadLawyers();
    const lawyerIndex = lawyers.findIndex(lawyer => lawyer.id === id);

    if (lawyerIndex === -1) {
      return res.status(404).json({ error: 'Lawyer not found' });
    }

    lawyers[lawyerIndex].isActive = !lawyers[lawyerIndex].isActive;
    lawyers[lawyerIndex].updatedAt = new Date().toISOString();

    await saveLawyers(lawyers);
    res.json(lawyers[lawyerIndex]);
  } catch (error) {
    console.error('Error toggling lawyer status:', error);
    res.status(500).json({ error: 'Failed to toggle lawyer status' });
  }
});

// DELETE /api/lawyers/:id - Delete lawyer
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const lawyers = await loadLawyers();
    const lawyerIndex = lawyers.findIndex(lawyer => lawyer.id === id);

    if (lawyerIndex === -1) {
      return res.status(404).json({ error: 'Lawyer not found' });
    }

    lawyers.splice(lawyerIndex, 1);
    await saveLawyers(lawyers);

    res.json({ message: 'Lawyer deleted successfully' });
  } catch (error) {
    console.error('Error deleting lawyer:', error);
    res.status(500).json({ error: 'Failed to delete lawyer' });
  }
});

export { formatPhoneForWhatsApp };
export default router;

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Generate JWT token
export function generateToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    lawOfficeName: user.lawOfficeName
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

// Verify JWT token
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Authentication middleware
export async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication token required' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get fresh user data
    const user = await req.userService.getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Add user to request
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// Admin-only middleware
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Law office-only middleware
export function requireLawOffice(req, res, next) {
  console.log('[requireLawOffice] Checking access - User:', req.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : 'No user');
  
  if (!req.user || req.user.role !== 'law_office') {
    console.log('[requireLawOffice] Access denied - User role:', req.user?.role || 'No user');
    return res.status(403).json({ error: 'Law office access required' });
  }
  
  console.log('[requireLawOffice] Access granted');
  next();
}

// Check bot credits middleware
export function requireBotCredits(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role === 'law_office' && !req.user.canCreateBot()) {
    return res.status(403).json({ 
      error: 'No available bot credits',
      availableCredits: req.user.getAvailableBotCredits(),
      totalCredits: req.user.botCredits,
      usedCredits: req.user.getUsedBotCredits()
    });
  }

  next();
}

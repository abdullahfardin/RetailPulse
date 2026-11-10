const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');

// Email validation helper regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Register a new shop owner and shop profile
 * Validates inputs, hashes password, saves to DB, returns JWT token
 */
async function register(req, res) {
  try {
    const { name, email, password, shop_name, address, phone } = req.body;

    // 1. Input Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Full name is required.' });
    }
    if (!email || !EMAIL_REGEX.test(email.trim().toLowerCase())) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }
    if (!shop_name || !shop_name.trim()) {
      return res.status(400).json({ success: false, error: 'Shop name is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 2. Check if user already exists
    const existing = await db.getAsync('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    // 3. Create the Shop
    const shopResult = await db.runAsync(`
      INSERT INTO shops (name, address, phone, currency)
      VALUES (?, ?, ?, 'BDT')
    `, [shop_name.trim(), address ? address.trim() : '', phone ? phone.trim() : '']);

    const shopId = shopResult.lastID;

    // 4. Secure Password Hashing with bcrypt (Salt rounds = 10)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 5. Insert New User
    const userResult = await db.runAsync(`
      INSERT INTO users (shop_id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, 'owner')
    `, [shopId, name.trim(), cleanEmail, passwordHash]);

    const userId = userResult.lastID;

    // 6. Generate JWT Token
    const tokenPayload = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      role: 'owner',
      shop_id: shopId,
      shop_name: shop_name.trim()
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      success: true,
      message: 'Account and shop registered successfully.',
      token,
      user: {
        id: userId,
        name: name.trim(),
        email: cleanEmail,
        role: 'owner'
      },
      shop: {
        id: shopId,
        name: shop_name.trim(),
        currency: 'BDT'
      }
    });
  } catch (error) {
    console.error('[Auth Register Error]:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during registration.' });
  }
}

/**
 * Authenticate existing user with email and password
 * Validates credentials using bcrypt comparison, returns JWT token
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    // 1. Input Validation
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 2. Query user from database
    const user = await db.getAsync(`
      SELECT u.id, u.shop_id, u.name, u.email, u.password_hash, u.role,
             s.name as shop_name, s.currency, s.address, s.phone
      FROM users u
      JOIN shops s ON u.shop_id = s.id
      WHERE u.email = ?
    `, [cleanEmail]);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // 3. Compare password with stored bcrypt hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // 4. Generate JWT Token
    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      shop_id: user.shop_id,
      shop_name: user.shop_name
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      shop: {
        id: user.shop_id,
        name: user.shop_name,
        currency: user.currency || 'BDT',
        address: user.address,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('[Auth Login Error]:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during login.' });
  }
}

/**
 * Get current authenticated user profile and shop details
 */
async function getMe(req, res) {
  try {
    const user = await db.getAsync(`
      SELECT u.id, u.name, u.email, u.role, u.shop_id,
             s.name as shop_name, s.currency, s.address, s.phone
      FROM users u
      JOIN shops s ON u.shop_id = s.id
      WHERE u.id = ?
    `, [req.user.id]);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      shop: {
        id: user.shop_id,
        name: user.shop_name,
        currency: user.currency || 'BDT',
        address: user.address,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('[Auth Me Error]:', error);
    return res.status(500).json({ success: false, error: 'Internal server error fetching user profile.' });
  }
}

module.exports = {
  register,
  login,
  getMe
};

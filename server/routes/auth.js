const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'email, password and displayName are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name)
      VALUES (?, ?, ?, ?)
    `).run(userId, email.toLowerCase(), passwordHash, displayName);

    const token = signToken(userId);
    res.status(201).json({
      token,
      user: { id: userId, email: email.toLowerCase(), displayName }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').run(user.id);

    const token = signToken(user.id);
    res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    const db = getDB();
    const user = db.prepare('SELECT id, email, display_name, created_at FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ id: user.id, email: user.email, displayName: user.display_name, createdAt: user.created_at });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;

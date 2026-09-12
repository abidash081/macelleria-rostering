const express = require('express');
const db = require('../db');
const { checkPassword, publicUser, requireAuth } = require('../auth');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email).toLowerCase().trim());
  if (!user || !checkPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;

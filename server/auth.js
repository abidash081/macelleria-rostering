const bcrypt = require('bcryptjs');
const db = require('./db');

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Session invalid' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    next();
  };
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

function checkPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

module.exports = { requireAuth, requireRole, publicUser, hashPassword, checkPassword };

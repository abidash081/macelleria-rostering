require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const cors = require('cors');

const db = require('./db');
const authRoutes = require('./routes/auth');
const organizationRoutes = require('./routes/organization');
const scheduleRoutes = require('./routes/schedule');
const timesheetRoutes = require('./routes/timesheets');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

// Render (and most PaaS hosts) terminate HTTPS at a proxy in front of the
// app - trust it so secure cookies and req.secure work correctly.
app.set('trust proxy', 1);
const isHostedProd = !!process.env.RENDER || process.env.NODE_ENV === 'production';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'macelleria-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, sameSite: 'lax', secure: isHostedProd }
}));

app.use('/api/auth', authRoutes);
app.use('/api', organizationRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// JSON error handler (catches errors passed to next(err), including from
// asyncHandler-wrapped routes) instead of Express's default HTML page.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function main() {
  await require('./seed').run(); // also runs the schema migration
  app.listen(PORT, () => {
    console.log(`Macelleria Rostering running at http://localhost:${PORT}`);
    console.log(process.env.TURSO_DATABASE_URL
      ? 'Database: Turso (persistent)'
      : 'Database: local file (data/macelleria.db) - fine for local use, but will not persist on most free hosts');
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

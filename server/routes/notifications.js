const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { providerStatus } = require('../services/notify');

const router = express.Router();
router.use(requireAuth);

router.get('/status', requireRole('admin', 'manager'), (req, res) => {
  res.json({ providers: providerStatus() });
});

module.exports = router;

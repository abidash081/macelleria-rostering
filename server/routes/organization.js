const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, publicUser, hashPassword } = require('../auth');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

// ---------- Locations ----------
router.get('/locations', asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM locations WHERE org_id = ? ORDER BY name').all(req.user.org_id);
  res.json({ locations: rows });
}));

router.post('/locations', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { name, address } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = await db.prepare('INSERT INTO locations (org_id, name, address) VALUES (?,?,?)').run(req.user.org_id, name, address || null);
  res.json({ location: await db.prepare('SELECT * FROM locations WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/locations/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { name, address, active } = req.body || {};
  await db.prepare('UPDATE locations SET name = COALESCE(?,name), address = COALESCE(?,address), active = COALESCE(?,active) WHERE id = ? AND org_id = ?')
    .run(name ?? null, address ?? null, active === undefined ? null : (active ? 1 : 0), req.params.id, req.user.org_id);
  res.json({ location: await db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id) });
}));

router.delete('/locations/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM locations WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
  res.json({ ok: true });
}));

// ---------- Positions ----------
router.get('/positions', asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM positions WHERE org_id = ? ORDER BY sort_order, name').all(req.user.org_id);
  res.json({ positions: rows });
}));

router.post('/positions', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { name, color, sort_order } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = await db.prepare('INSERT INTO positions (org_id, name, color, sort_order) VALUES (?,?,?,?)')
    .run(req.user.org_id, name, color || '#3a5a40', sort_order || 0);
  res.json({ position: await db.prepare('SELECT * FROM positions WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/positions/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { name, color, sort_order, active } = req.body || {};
  await db.prepare('UPDATE positions SET name = COALESCE(?,name), color = COALESCE(?,color), sort_order = COALESCE(?,sort_order), active = COALESCE(?,active) WHERE id = ? AND org_id = ?')
    .run(name ?? null, color ?? null, sort_order ?? null, active === undefined ? null : (active ? 1 : 0), req.params.id, req.user.org_id);
  res.json({ position: await db.prepare('SELECT * FROM positions WHERE id = ?').get(req.params.id) });
}));

router.delete('/positions/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM positions WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
  res.json({ ok: true });
}));

// ---------- Employees ----------
router.get('/employees', asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM users WHERE org_id = ? AND active = 1 ORDER BY name').all(req.user.org_id);
  const employeeIds = rows.map(r => r.id);
  const locByEmp = {}, posByEmp = {};
  if (employeeIds.length) {
    const placeholders = employeeIds.map(() => '?').join(',');
    const locs = await db.prepare(`SELECT el.employee_id, l.id, l.name FROM employee_locations el JOIN locations l ON l.id = el.location_id WHERE el.employee_id IN (${placeholders})`).all(...employeeIds);
    locs.forEach(l => { (locByEmp[l.employee_id] ||= []).push({ id: l.id, name: l.name }); });
    const poss = await db.prepare(`SELECT ep.employee_id, p.id, p.name FROM employee_positions ep JOIN positions p ON p.id = ep.position_id WHERE ep.employee_id IN (${placeholders})`).all(...employeeIds);
    poss.forEach(p => { (posByEmp[p.employee_id] ||= []).push({ id: p.id, name: p.name }); });
  }
  const employees = rows.map(u => ({ ...publicUser(u), locations: locByEmp[u.id] || [], positions: posByEmp[u.id] || [] }));
  res.json({ employees });
}));

router.post('/employees', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { name, email, phone, password, role, pay_rate, can_view_wages, location_ids, position_ids, notify_email, notify_sms } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  try {
    const empId = await db.transaction(async (tx) => {
      const info = await tx.prepare(`INSERT INTO users (org_id, name, email, phone, password_hash, role, pay_rate, can_view_wages, notify_email, notify_sms)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        req.user.org_id, name, String(email).toLowerCase().trim(), phone || null, hashPassword(password),
        role || 'employee', pay_rate || 0, can_view_wages ? 1 : 0,
        notify_email === undefined ? 1 : (notify_email ? 1 : 0),
        notify_sms === undefined ? 1 : (notify_sms ? 1 : 0)
      );
      const id = info.lastInsertRowid;
      for (const lid of (location_ids || [])) await tx.prepare('INSERT OR IGNORE INTO employee_locations (employee_id, location_id) VALUES (?,?)').run(id, lid);
      for (const pid of (position_ids || [])) await tx.prepare('INSERT OR IGNORE INTO employee_positions (employee_id, position_id) VALUES (?,?)').run(id, pid);
      return id;
    });
    res.json({ employee: publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(empId)) });
  } catch (e) {
    res.status(400).json({ error: /UNIQUE/i.test(e.message) ? 'That email is already in use' : e.message });
  }
}));

router.put('/employees/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const existing = await db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(id, req.user.org_id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, email, phone, role, pay_rate, can_view_wages, location_ids, position_ids, notify_email, notify_sms, active, password } = req.body || {};

  await db.prepare(`UPDATE users SET name = COALESCE(?,name), email = COALESCE(?,email), phone = COALESCE(?,phone),
      role = COALESCE(?,role), pay_rate = COALESCE(?,pay_rate), can_view_wages = COALESCE(?,can_view_wages),
      notify_email = COALESCE(?,notify_email), notify_sms = COALESCE(?,notify_sms), active = COALESCE(?,active),
      password_hash = COALESCE(?, password_hash)
      WHERE id = ? AND org_id = ?`)
    .run(
      name ?? null, email ? String(email).toLowerCase().trim() : null, phone ?? null,
      role ?? null, pay_rate ?? null, can_view_wages === undefined ? null : (can_view_wages ? 1 : 0),
      notify_email === undefined ? null : (notify_email ? 1 : 0),
      notify_sms === undefined ? null : (notify_sms ? 1 : 0),
      active === undefined ? null : (active ? 1 : 0),
      password ? hashPassword(password) : null,
      id, req.user.org_id);

  if (location_ids) {
    await db.prepare('DELETE FROM employee_locations WHERE employee_id = ?').run(id);
    for (const lid of location_ids) await db.prepare('INSERT OR IGNORE INTO employee_locations (employee_id, location_id) VALUES (?,?)').run(id, lid);
  }
  if (position_ids) {
    await db.prepare('DELETE FROM employee_positions WHERE employee_id = ?').run(id);
    for (const pid of position_ids) await db.prepare('INSERT OR IGNORE INTO employee_positions (employee_id, position_id) VALUES (?,?)').run(id, pid);
  }
  res.json({ employee: publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
}));

router.delete('/employees/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  // Soft-delete to preserve historical shifts/timesheets
  await db.prepare('UPDATE users SET active = 0 WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
  res.json({ ok: true });
}));

// ---------- Availability ----------
router.get('/availability', asyncHandler(async (req, res) => {
  const { employee_id, from, to } = req.query;
  let sql = `SELECT a.* FROM availability a JOIN users u ON u.id = a.employee_id WHERE u.org_id = ?`;
  const params = [req.user.org_id];
  if (employee_id) { sql += ' AND a.employee_id = ?'; params.push(employee_id); }
  if (from) { sql += ' AND a.date >= ?'; params.push(from); }
  if (to) { sql += ' AND a.date <= ?'; params.push(to); }
  sql += ' ORDER BY a.date';
  res.json({ availability: await db.prepare(sql).all(...params) });
}));

router.post('/availability', asyncHandler(async (req, res) => {
  const { employee_id, date, type, start_time, end_time, note } = req.body || {};
  const targetId = req.user.role === 'employee' ? req.user.id : (employee_id || req.user.id);
  if (req.user.role === 'employee' && Number(employee_id) !== req.user.id) {
    return res.status(403).json({ error: 'Employees can only set their own availability' });
  }
  const info = await db.prepare('INSERT INTO availability (employee_id, date, type, start_time, end_time, note) VALUES (?,?,?,?,?,?)')
    .run(targetId, date, type || 'unavailable', start_time || null, end_time || null, note || null);
  res.json({ availability: await db.prepare('SELECT * FROM availability WHERE id = ?').get(info.lastInsertRowid) });
}));

router.delete('/availability/:id', asyncHandler(async (req, res) => {
  const row = await db.prepare('SELECT a.* FROM availability a JOIN users u ON u.id=a.employee_id WHERE a.id=? AND u.org_id=?').get(req.params.id, req.user.org_id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'employee' && row.employee_id !== req.user.id) return res.status(403).json({ error: 'Not permitted' });
  await db.prepare('DELETE FROM availability WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;

const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { weekStartOf, weekDates, timeToMinutes } = require('../services/scheduleUtils');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

function hoursBetween(start, end, breakMin) {
  if (!start || !end) return 0;
  let s = timeToMinutes(start), e = timeToMinutes(end);
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s - (breakMin || 0)) / 60);
}

// Auto-generate a timesheet entry for every published shift in a week that
// doesn't already have one - this is the "timesheets automatically generated
// from your schedule" behaviour ZenShifts advertises.
async function ensureEntriesForWeek(org_id, location_id, weekStart) {
  const dates = weekDates(weekStart);
  const shifts = await db.prepare(`SELECT * FROM shifts WHERE location_id = ? AND date BETWEEN ? AND ? AND published = 1 AND employee_id IS NOT NULL`)
    .all(location_id, dates[0], dates[6]);
  for (const s of shifts) {
    const exists = await db.prepare('SELECT id FROM timesheet_entries WHERE shift_id = ?').get(s.id);
    if (exists) continue;
    const schedEnd = s.end_mode === 'time' ? s.end_time : null;
    await db.prepare(`INSERT INTO timesheet_entries (org_id, location_id, employee_id, position_id, shift_id, date, entry_type, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes)
        VALUES (?,?,?,?,?,?, 'worked', ?, ?, ?, ?, ?)`)
      .run(org_id, location_id, s.employee_id, s.position_id, s.id, s.date, s.start_time, schedEnd, s.start_time, schedEnd, s.break_minutes);
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const { location_id, week } = req.query;
  if (!location_id) return res.status(400).json({ error: 'location_id required' });
  const weekStart = weekStartOf(week || new Date().toISOString().slice(0, 10));
  const dates = weekDates(weekStart);
  await ensureEntriesForWeek(req.user.org_id, location_id, weekStart);

  const rows = await db.prepare(`SELECT t.*, u.name as employee_name, u.pay_rate, p.name as position_name
      FROM timesheet_entries t JOIN users u ON u.id = t.employee_id LEFT JOIN positions p ON p.id = t.position_id
      WHERE t.location_id = ? AND t.date BETWEEN ? AND ? ORDER BY t.date, u.name`).all(location_id, dates[0], dates[6]);

  const canViewWages = req.user.role !== 'employee' || req.user.can_view_wages;
  let plannedHours = 0, actualHours = 0, plannedCost = 0, actualCost = 0;
  const entries = rows.map(r => {
    const ph = hoursBetween(r.scheduled_start, r.scheduled_end, r.break_minutes);
    const ah = hoursBetween(r.actual_start, r.actual_end, r.break_minutes);
    plannedHours += ph; actualHours += ah;
    plannedCost += ph * (r.pay_rate || 0);
    actualCost += ah * (r.pay_rate || 0);
    return { ...r, planned_hours: Number(ph.toFixed(2)), actual_hours: Number(ah.toFixed(2)), pay_rate: canViewWages ? r.pay_rate : null };
  });

  res.json({
    week_start: weekStart, dates, entries,
    totals: {
      planned_hours: Number(plannedHours.toFixed(2)), actual_hours: Number(actualHours.toFixed(2)),
      planned_cost: canViewWages ? Number(plannedCost.toFixed(2)) : null,
      actual_cost: canViewWages ? Number(actualCost.toFixed(2)) : null
    }
  });
}));

router.post('/', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { location_id, employee_id, position_id, date, entry_type, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes, summary, notes } = req.body || {};
  if (!location_id || !employee_id || !date) return res.status(400).json({ error: 'location_id, employee_id, date required' });
  const info = await db.prepare(`INSERT INTO timesheet_entries (org_id, location_id, employee_id, position_id, date, entry_type, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes, summary, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    req.user.org_id, location_id, employee_id, position_id || null, date, entry_type || 'worked',
    scheduled_start || null, scheduled_end || null, actual_start || null, actual_end || null, break_minutes || 0, summary || null, notes || null
  );
  res.json({ entry: await db.prepare('SELECT * FROM timesheet_entries WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const existing = await db.prepare('SELECT * FROM timesheet_entries WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const isSelf = req.user.role === 'employee' && existing.employee_id === req.user.id;
  if (req.user.role === 'employee' && !isSelf) return res.status(403).json({ error: 'Not permitted' });
  const { entry_type, actual_start, actual_end, break_minutes, summary, notes, approved } = req.body || {};
  if (req.user.role === 'employee' && approved !== undefined) return res.status(403).json({ error: 'Only managers can approve entries' });
  await db.prepare(`UPDATE timesheet_entries SET entry_type = COALESCE(?,entry_type), actual_start = COALESCE(?,actual_start),
      actual_end = COALESCE(?,actual_end), break_minutes = COALESCE(?,break_minutes), summary = COALESCE(?,summary),
      notes = COALESCE(?,notes), approved = COALESCE(?,approved), updated_at = datetime('now') WHERE id = ?`)
    .run(entry_type ?? null, actual_start ?? null, actual_end ?? null, break_minutes ?? null, summary ?? null,
      notes ?? null, approved === undefined ? null : (approved ? 1 : 0), req.params.id);
  res.json({ entry: await db.prepare('SELECT * FROM timesheet_entries WHERE id = ?').get(req.params.id) });
}));

router.post('/approve-all', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { location_id, week } = req.body || {};
  const dates = weekDates(weekStartOf(week));
  const info = await db.prepare('UPDATE timesheet_entries SET approved = 1 WHERE location_id = ? AND date BETWEEN ? AND ?').run(location_id, dates[0], dates[6]);
  res.json({ ok: true, approved: info.changes });
}));

router.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM timesheet_entries WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
  res.json({ ok: true });
}));

// CSV export - a stand-in for ZenShifts' payroll (Xero/MYOB/Elmo/KINGpay) export
router.get('/export.csv', asyncHandler(async (req, res) => {
  const { location_id, week } = req.query;
  const weekStart = weekStartOf(week || new Date().toISOString().slice(0, 10));
  const dates = weekDates(weekStart);
  const rows = await db.prepare(`SELECT t.*, u.name as employee_name, u.pay_rate, p.name as position_name
      FROM timesheet_entries t JOIN users u ON u.id = t.employee_id LEFT JOIN positions p ON p.id = t.position_id
      WHERE t.location_id = ? AND t.date BETWEEN ? AND ? ORDER BY t.date, u.name`).all(location_id, dates[0], dates[6]);
  const canViewWages = req.user.role !== 'employee' || req.user.can_view_wages;
  const header = ['Date', 'Employee', 'Position', 'Entry Type', 'Scheduled Start', 'Scheduled End', 'Actual Start', 'Actual End', 'Break (min)', 'Hours', 'Approved'];
  if (canViewWages) header.push('Pay Rate', 'Cost');
  const lines = [header.join(',')];
  rows.forEach(r => {
    const hrs = hoursBetween(r.actual_start, r.actual_end, r.break_minutes);
    const line = [r.date, `"${r.employee_name}"`, `"${r.position_name || ''}"`, r.entry_type, r.scheduled_start || '', r.scheduled_end || '', r.actual_start || '', r.actual_end || '', r.break_minutes, hrs.toFixed(2), r.approved ? 'Yes' : 'No'];
    if (canViewWages) line.push(r.pay_rate || 0, (hrs * (r.pay_rate || 0)).toFixed(2));
    lines.push(line.join(','));
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="timesheets_${weekStart}.csv"`);
  res.send(lines.join('\n'));
}));

module.exports = router;

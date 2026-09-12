const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { weekStartOf, weekDates, shiftLabel, shiftHours, formatDateHuman } = require('../services/scheduleUtils');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

function weekParams(req) {
  const { location_id, week } = req.query;
  const weekStart = weekStartOf(week || new Date().toISOString().slice(0, 10));
  return { location_id, weekStart, dates: weekDates(weekStart) };
}

// ---------- Schedule by Employee (also covers Condensed / Enhanced variants -
// the frontend controls layout/print styling from the same data) ----------
router.get('/schedule-by-employee', asyncHandler(async (req, res) => {
  const { location_id, weekStart, dates } = weekParams(req);
  const publishedOnly = req.query.published_only === 'true';
  let sql = `SELECT s.*, u.name as employee_name, p.name as position_name FROM shifts s
      JOIN users u ON u.id = s.employee_id JOIN positions p ON p.id = s.position_id
      WHERE s.location_id = ? AND s.date BETWEEN ? AND ?`;
  const params = [location_id, dates[0], dates[6]];
  if (publishedOnly) sql += ' AND s.published = 1';
  sql += ' ORDER BY u.name, s.date, s.start_time';
  const rows = await db.prepare(sql).all(...params);

  const byEmployee = {};
  rows.forEach(r => {
    (byEmployee[r.employee_name] ||= []).push({ date: r.date, date_human: formatDateHuman(r.date), label: shiftLabel(r), position: r.position_name, hours: Number(shiftHours(r).toFixed(2)), notes: r.notes });
  });
  res.json({ week_start: weekStart, dates, report: byEmployee });
}));

router.get('/schedule-by-position', asyncHandler(async (req, res) => {
  const { location_id, weekStart, dates } = weekParams(req);
  const publishedOnly = req.query.published_only === 'true';
  let sql = `SELECT s.*, u.name as employee_name, p.name as position_name FROM shifts s
      LEFT JOIN users u ON u.id = s.employee_id JOIN positions p ON p.id = s.position_id
      WHERE s.location_id = ? AND s.date BETWEEN ? AND ?`;
  const params = [location_id, dates[0], dates[6]];
  if (publishedOnly) sql += ' AND s.published = 1';
  sql += ' ORDER BY p.sort_order, s.date, s.start_time';
  const rows = await db.prepare(sql).all(...params);

  const byPosition = {};
  rows.forEach(r => {
    (byPosition[r.position_name] ||= []).push({ date: r.date, date_human: formatDateHuman(r.date), label: shiftLabel(r), employee: r.employee_name || '(unfilled)', hours: Number(shiftHours(r).toFixed(2)) });
  });
  res.json({ week_start: weekStart, dates, report: byPosition });
}));

router.get('/availability-leave', asyncHandler(async (req, res) => {
  const { weekStart, dates } = weekParams(req);
  const rows = await db.prepare(`SELECT a.*, u.name as employee_name FROM availability a JOIN users u ON u.id = a.employee_id
      WHERE u.org_id = ? AND a.date BETWEEN ? AND ? ORDER BY u.name, a.date`).all(req.user.org_id, dates[0], dates[6]);
  const byEmployee = {};
  rows.forEach(r => {
    (byEmployee[r.employee_name] ||= []).push({ date: r.date, date_human: formatDateHuman(r.date), type: r.type, start_time: r.start_time, end_time: r.end_time, note: r.note });
  });
  res.json({ week_start: weekStart, dates, report: byEmployee });
}));

// The "Shift Notification" report - delivery status of every SMS/email sent
// for roster changes and publishes, exactly like ZenShifts' own report.
router.get('/shift-notifications', asyncHandler(async (req, res) => {
  const { weekStart, dates } = weekParams(req);
  const rows = await db.prepare(`SELECT n.*, u.name as employee_name FROM notification_log n LEFT JOIN users u ON u.id = n.employee_id
      WHERE n.org_id = ? AND date(n.created_at) BETWEEN ? AND ? ORDER BY n.created_at DESC`).all(req.user.org_id, dates[0], dates[6]);
  const summary = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  res.json({ week_start: weekStart, dates, log: rows, summary });
}));

router.get('/staff-listing', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT id, name, email, phone, role, pay_rate, can_view_wages, notify_email, notify_sms, active FROM users WHERE org_id = ? ORDER BY name').all(req.user.org_id);
  res.json({ staff: rows });
}));

router.get('/timesheets.csv', (req, res) => {
  res.redirect(307, `/api/timesheets/export.csv?${new URLSearchParams(req.query).toString()}`);
});

module.exports = router;

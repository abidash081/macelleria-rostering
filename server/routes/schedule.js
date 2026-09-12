const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const asyncHandler = require('../asyncHandler');
const { weekStartOf, weekDates, shiftHours, shiftLabel, formatDateHuman, timeToMinutes } = require('../services/scheduleUtils');
const { notifyEmployee } = require('../services/notify');

const router = express.Router();
router.use(requireAuth);

function getShift(id) {
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
}
function employeeById(id) {
  if (!id) return Promise.resolve(null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function locationById(id) {
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
}
function positionById(id) {
  return db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
}

// Detect: (a) double-booking - employee already has a shift that overlaps this
// date/time elsewhere, (b) availability conflicts - employee marked unavailable
// or on leave for that date/time. Mirrors ZenShifts' scheduling warnings.
async function findConflicts({ employee_id, date, start_time, end_time, end_mode, excludeShiftId }) {
  const conflicts = [];
  if (!employee_id) return conflicts;

  const sameDay = await db.prepare('SELECT * FROM shifts WHERE employee_id = ? AND date = ? AND id != ?')
    .all(employee_id, date, excludeShiftId || -1);
  const newStart = timeToMinutes(start_time);
  const newEnd = end_mode === 'time' && end_time ? timeToMinutes(end_time) : newStart + 24 * 60; // open-ended treated as blocking rest of day for overlap purposes
  for (const s of sameDay) {
    const sStart = timeToMinutes(s.start_time);
    const sEnd = s.end_mode === 'time' && s.end_time ? timeToMinutes(s.end_time) : sStart + 24 * 60;
    if (newStart < sEnd && sStart < newEnd) {
      conflicts.push({ type: 'double_booking', message: `Already rostered ${shiftLabel(s)} that day`, shift_id: s.id });
    }
  }

  const availRows = await db.prepare('SELECT * FROM availability WHERE employee_id = ? AND date = ?').all(employee_id, date);
  for (const a of availRows) {
    if (a.type === 'available') continue;
    const label = a.type === 'leave' ? 'is on leave' : 'marked themselves unavailable';
    if (!a.start_time && !a.end_time) {
      conflicts.push({ type: 'availability', message: `Employee ${label} all day`, availability_id: a.id });
    } else {
      const aStart = timeToMinutes(a.start_time || '00:00');
      const aEnd = timeToMinutes(a.end_time || '23:59');
      if (newStart < aEnd && aStart < newEnd) {
        conflicts.push({ type: 'availability', message: `Employee ${label} ${a.start_time || ''}-${a.end_time || ''}`, availability_id: a.id });
      }
    }
  }
  return conflicts;
}

router.get('/conflicts', asyncHandler(async (req, res) => {
  const { employee_id, date, start_time, end_time, end_mode, exclude_shift_id } = req.query;
  res.json({ conflicts: await findConflicts({ employee_id, date, start_time, end_time, end_mode: end_mode || 'time', excludeShiftId: exclude_shift_id }) });
}));

// ---------- Weekly schedule view ----------
router.get('/', asyncHandler(async (req, res) => {
  const { location_id, week } = req.query; // week = any date within the week, or a Monday
  if (!location_id) return res.status(400).json({ error: 'location_id required' });
  const weekStart = weekStartOf(week || new Date().toISOString().slice(0, 10));
  const dates = weekDates(weekStart);

  const shifts = await db.prepare(`SELECT s.*, u.name as employee_name, u.pay_rate as employee_pay_rate, p.name as position_name, p.color as position_color
      FROM shifts s LEFT JOIN users u ON u.id = s.employee_id JOIN positions p ON p.id = s.position_id
      WHERE s.location_id = ? AND s.date BETWEEN ? AND ?
      ORDER BY p.sort_order, s.start_time`).all(location_id, dates[0], dates[6]);

  const canViewWages = req.user.role !== 'employee' || req.user.can_view_wages;
  let totalCost = 0, totalHours = 0, filled = 0;
  const withCost = shifts.map(s => {
    const hours = shiftHours(s);
    const rate = s.employee_id ? (s.employee_pay_rate || 0) : 0;
    const cost = hours * rate;
    totalHours += hours;
    totalCost += cost;
    if (s.employee_id) filled++;
    return { ...s, hours: Number(hours.toFixed(2)), cost: canViewWages ? Number(cost.toFixed(2)) : null, label: shiftLabel(s) };
  });

  res.json({
    week_start: weekStart,
    dates,
    shifts: withCost,
    summary: {
      total_shifts: shifts.length,
      filled_shifts: filled,
      filled_hours: Number(totalHours.toFixed(2)),
      total_cost: canViewWages ? Number(totalCost.toFixed(2)) : null,
      unpublished: shifts.filter(s => !s.published).length
    }
  });
}));

// ---------- Shift CRUD ----------
router.post('/shifts', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { location_id, position_id, employee_id, date, start_time, end_mode, end_time, break_minutes, notes } = req.body || {};
  if (!location_id || !position_id || !date || !start_time) {
    return res.status(400).json({ error: 'location_id, position_id, date and start_time are required' });
  }
  const info = await db.prepare(`INSERT INTO shifts (org_id, location_id, position_id, employee_id, date, start_time, end_mode, end_time, break_minutes, notes, created_by, updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    req.user.org_id, location_id, position_id, employee_id || null, date, start_time,
    end_mode || 'time', end_mode === 'time' ? (end_time || null) : null, break_minutes || 0, notes || null,
    req.user.id, req.user.id
  );
  const shift = await getShift(info.lastInsertRowid);

  // New shifts start unpublished, same as ZenShifts - they go out to staff
  // when the roster is Published, not the moment they're drafted. The one
  // exception is force_notify, for a manager adding an urgent extra shift to
  // an already-published week and wanting it messaged out right away.
  if (employee_id && req.body.force_notify) {
    await notifyForShiftChange({ shift, event_type: 'shift_created', actingUser: req.user });
  }
  res.json({ shift });
}));

router.put('/shifts/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const existing = await getShift(req.params.id);
  if (!existing || existing.org_id !== req.user.org_id) return res.status(404).json({ error: 'Not found' });
  const { position_id, employee_id, date, start_time, end_mode, end_time, break_minutes, notes, notify } = req.body || {};
  const prevEmployeeId = existing.employee_id;
  const wasPublished = !!existing.published;
  const nextEndMode = end_mode || existing.end_mode;

  await db.prepare(`UPDATE shifts SET position_id = COALESCE(?,position_id), employee_id = ?, date = COALESCE(?,date),
      start_time = COALESCE(?,start_time), end_mode = COALESCE(?,end_mode), end_time = ?,
      break_minutes = COALESCE(?,break_minutes), notes = ?, updated_at = datetime('now'), updated_by = ?
      WHERE id = ?`).run(
    position_id ?? null,
    employee_id === undefined ? prevEmployeeId : (employee_id || null),
    date ?? null,
    start_time ?? null,
    end_mode ?? null,
    nextEndMode === 'time' ? (end_time !== undefined ? end_time : existing.end_time) : null,
    break_minutes ?? null,
    notes !== undefined ? notes : existing.notes,
    req.user.id, req.params.id
  );
  const updated = await getShift(req.params.id);

  if (wasPublished && notify !== false) {
    // Notify the newly assigned employee about the change
    if (updated.employee_id) {
      await notifyForShiftChange({ shift: updated, event_type: 'shift_updated', actingUser: req.user });
    }
    // If someone was removed/reassigned off this shift, tell them too
    if (prevEmployeeId && prevEmployeeId !== updated.employee_id) {
      const removedEmp = await employeeById(prevEmployeeId);
      if (removedEmp) {
        await notifyRemoval({ shift: existing, employee: removedEmp, actingUser: req.user });
      }
    }
  }
  res.json({ shift: updated });
}));

router.delete('/shifts/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const existing = await getShift(req.params.id);
  if (!existing || existing.org_id !== req.user.org_id) return res.status(404).json({ error: 'Not found' });
  await db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  if (existing.published && existing.employee_id) {
    const emp = await employeeById(existing.employee_id);
    if (emp) await notifyRemoval({ shift: existing, employee: emp, actingUser: req.user, deleted: true });
  }
  res.json({ ok: true });
}));

// ---------- Copy week / Clear week ----------
router.post('/copy-week', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { location_id, from_week, to_week } = req.body || {};
  if (!location_id || !from_week || !to_week) return res.status(400).json({ error: 'location_id, from_week, to_week required' });
  const fromStart = weekStartOf(from_week);
  const toStart = weekStartOf(to_week);
  const fromDates = weekDates(fromStart);
  const toDates = weekDates(toStart);
  const shifts = await db.prepare('SELECT * FROM shifts WHERE location_id = ? AND date BETWEEN ? AND ?').all(location_id, fromDates[0], fromDates[6]);

  const count = await db.transaction(async (tx) => {
    let n = 0;
    for (const s of shifts) {
      const idx = fromDates.indexOf(s.date);
      if (idx === -1) continue;
      await tx.prepare(`INSERT INTO shifts (org_id, location_id, position_id, employee_id, date, start_time, end_mode, end_time, break_minutes, notes, created_by, updated_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.org_id, location_id, s.position_id, s.employee_id, toDates[idx], s.start_time, s.end_mode, s.end_time, s.break_minutes, s.notes, req.user.id, req.user.id);
      n++;
    }
    return n;
  });
  res.json({ ok: true, copied: count });
}));

router.post('/clear-week', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { location_id, week } = req.body || {};
  if (!location_id || !week) return res.status(400).json({ error: 'location_id and week required' });
  const dates = weekDates(weekStartOf(week));
  const info = await db.prepare('DELETE FROM shifts WHERE location_id = ? AND date BETWEEN ? AND ? AND published = 0').run(location_id, dates[0], dates[6]);
  res.json({ ok: true, deleted: info.changes });
}));

// ---------- Templates ----------
router.get('/templates', asyncHandler(async (req, res) => {
  const { location_id } = req.query;
  const rows = await db.prepare('SELECT * FROM templates WHERE org_id = ? AND location_id = ? ORDER BY name').all(req.user.org_id, location_id);
  res.json({ templates: rows.map(r => ({ ...r, data: JSON.parse(r.data) })) });
}));

router.post('/templates', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { location_id, name, week } = req.body || {};
  if (!location_id || !name || !week) return res.status(400).json({ error: 'location_id, name, week required' });
  const dates = weekDates(weekStartOf(week));
  const shifts = await db.prepare('SELECT * FROM shifts WHERE location_id = ? AND date BETWEEN ? AND ?').all(location_id, dates[0], dates[6]);
  const data = shifts.map(s => ({
    day_of_week: dates.indexOf(s.date), position_id: s.position_id, employee_id: s.employee_id,
    start_time: s.start_time, end_mode: s.end_mode, end_time: s.end_time, break_minutes: s.break_minutes, notes: s.notes
  }));
  const info = await db.prepare('INSERT INTO templates (org_id, location_id, name, data) VALUES (?,?,?,?)')
    .run(req.user.org_id, location_id, name, JSON.stringify(data));
  res.json({ template: { id: info.lastInsertRowid, org_id: req.user.org_id, location_id, name, data } });
}));

router.post('/templates/:id/apply', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { week } = req.body || {};
  const tmpl = await db.prepare('SELECT * FROM templates WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  const data = JSON.parse(tmpl.data);
  const dates = weekDates(weekStartOf(week));

  await db.transaction(async (tx) => {
    for (const d of data) {
      await tx.prepare(`INSERT INTO shifts (org_id, location_id, position_id, employee_id, date, start_time, end_mode, end_time, break_minutes, notes, created_by, updated_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.org_id, tmpl.location_id, d.position_id, d.employee_id, dates[d.day_of_week], d.start_time, d.end_mode, d.end_time, d.break_minutes || 0, d.notes || null, req.user.id, req.user.id);
    }
  });
  res.json({ ok: true, applied: data.length });
}));

router.delete('/templates/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM templates WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
  res.json({ ok: true });
}));

// ---------- Publish & Notify ----------
// notify_scope: 'affected' (only shifts changed since last publish) |
//               'week_staff' (everyone with a shift this week) |
//               'all_staff'  (entire active staff list)
router.post('/publish', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { location_id, week, notify_scope, channels } = req.body || {};
  if (!location_id || !week) return res.status(400).json({ error: 'location_id and week required' });
  const dates = weekDates(weekStartOf(week));
  const chans = (channels && channels.length) ? channels : ['email', 'sms'];

  const unpublished = await db.prepare('SELECT * FROM shifts WHERE location_id = ? AND date BETWEEN ? AND ? AND published = 0')
    .all(location_id, dates[0], dates[6]);
  const affectedEmployeeIds = new Set(unpublished.filter(s => s.employee_id).map(s => s.employee_id));

  await db.prepare(`UPDATE shifts SET published = 1, last_notified_at = datetime('now') WHERE location_id = ? AND date BETWEEN ? AND ?`)
    .run(location_id, dates[0], dates[6]);

  let recipientIds;
  if (notify_scope === 'all_staff') {
    recipientIds = (await db.prepare('SELECT id FROM users WHERE org_id = ? AND active = 1').all(req.user.org_id)).map(r => r.id);
  } else if (notify_scope === 'week_staff') {
    const allWeekShifts = await db.prepare('SELECT DISTINCT employee_id FROM shifts WHERE location_id = ? AND date BETWEEN ? AND ? AND employee_id IS NOT NULL')
      .all(location_id, dates[0], dates[6]);
    recipientIds = allWeekShifts.map(r => r.employee_id);
  } else {
    recipientIds = Array.from(affectedEmployeeIds);
  }

  const location = await locationById(location_id);
  const results = [];
  for (const empId of recipientIds) {
    const emp = await employeeById(empId);
    if (!emp) continue;
    const myShifts = await db.prepare(`SELECT s.*, p.name as position_name FROM shifts s JOIN positions p ON p.id = s.position_id
        WHERE s.location_id = ? AND s.date BETWEEN ? AND ? AND s.employee_id = ? ORDER BY s.date, s.start_time`)
      .all(location_id, dates[0], dates[6], empId);
    const lines = myShifts.map(s => `${formatDateHuman(s.date)}: ${shiftLabel(s)} (${s.position_name})`);
    const subject = `Your roster at ${location.name} - week of ${formatDateHuman(dates[0])}`;
    const smsBody = myShifts.length
      ? `Hi ${emp.name}, your roster at ${location.name} (${formatDateHuman(dates[0])}-${formatDateHuman(dates[6])}) is ready:\n${lines.join('\n')}`
      : `Hi ${emp.name}, the roster for ${location.name} (${formatDateHuman(dates[0])}-${formatDateHuman(dates[6])}) has been published. You have no shifts this week.`;
    const emailHtml = `<p>Hi ${emp.name},</p><p>Your roster at <b>${location.name}</b> for ${formatDateHuman(dates[0])} - ${formatDateHuman(dates[6])} has been published:</p>
        <ul>${lines.map(l => `<li>${l}</li>`).join('') || '<li>No shifts this week</li>'}</ul>
        <p>&mdash; Macelleria Rostering</p>`;
    const r = await notifyEmployee({
      org_id: req.user.org_id, event_type: 'publish', shift_id: null, employee: emp,
      channels: chans, subject, smsBody, emailHtml, emailText: smsBody
    });
    results.push({ employee_id: empId, employee_name: emp.name, ...r });
  }

  res.json({ ok: true, published_shifts: unpublished.length, notified: results });
}));

// ---------- Notification helpers used by shift create/update/delete ----------
async function notifyForShiftChange({ shift, event_type, actingUser }) {
  const emp = await employeeById(shift.employee_id);
  if (!emp) return;
  const location = await locationById(shift.location_id);
  const position = await positionById(shift.position_id);
  const verb = event_type === 'shift_created' ? 'You have a new shift' : 'Your shift has been updated';
  const subject = `${verb} - ${location.name}, ${formatDateHuman(shift.date)}`;
  const smsBody = `Hi ${emp.name}, ${verb.toLowerCase()} at ${location.name} on ${formatDateHuman(shift.date)}: ${shiftLabel(shift)} (${position.name}).`;
  const emailHtml = `<p>Hi ${emp.name},</p><p>${verb} at <b>${location.name}</b>:</p>
      <p><b>${formatDateHuman(shift.date)}</b> &mdash; ${shiftLabel(shift)} (${position.name})</p>
      <p>&mdash; Macelleria Rostering</p>`;
  await notifyEmployee({
    org_id: actingUser.org_id, event_type, shift_id: shift.id, employee: emp,
    channels: ['email', 'sms'], subject, smsBody, emailHtml, emailText: smsBody
  });
}

async function notifyRemoval({ shift, employee, actingUser, deleted }) {
  const location = await locationById(shift.location_id);
  const position = await positionById(shift.position_id);
  const subject = `Shift ${deleted ? 'cancelled' : 'reassigned'} - ${location.name}, ${formatDateHuman(shift.date)}`;
  const smsBody = `Hi ${employee.name}, your shift at ${location.name} on ${formatDateHuman(shift.date)} (${shiftLabel(shift)}, ${position.name}) has been ${deleted ? 'cancelled' : 'reassigned to someone else'}.`;
  const emailHtml = `<p>Hi ${employee.name},</p><p>Your shift at <b>${location.name}</b> on ${formatDateHuman(shift.date)} (${shiftLabel(shift)}, ${position.name}) has been ${deleted ? 'cancelled' : 'reassigned'}.</p><p>&mdash; Macelleria Rostering</p>`;
  await notifyEmployee({
    org_id: actingUser.org_id, event_type: deleted ? 'shift_deleted' : 'shift_updated', shift_id: shift.id, employee,
    channels: ['email', 'sms'], subject, smsBody, emailHtml, emailText: smsBody
  });
}

module.exports = router;

// Shared helpers for shift time math, week ranges, and message formatting.

function pad(n) { return String(n).padStart(2, '0'); }

// Returns the Monday (YYYY-MM-DD) of the week containing the given date string.
function weekStartOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift so Monday = start
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return m === 0 ? `${hh}:00 ${period}` : `${hh}:${pad(m)} ${period}`;
}

function endLabel(shift) {
  if (shift.end_mode === 'until_required') return 'Required';
  if (shift.end_mode === 'close') return 'Close';
  return formatTime12(shift.end_time);
}

function shiftLabel(shift) {
  return `${formatTime12(shift.start_time)} - ${endLabel(shift)}`;
}

// Duration in hours. Open-ended shifts (until_required/close) fall back to
// a configurable default so budgeting/reporting still has a number, mirroring
// ZenShifts' "shift end times not required" behaviour.
function shiftHours(shift, fallbackHours = 4) {
  const start = timeToMinutes(shift.start_time);
  if (shift.end_mode === 'time' && shift.end_time) {
    let end = timeToMinutes(shift.end_time);
    if (end <= start) end += 24 * 60; // overnight shift
    const mins = end - start - (shift.break_minutes || 0);
    return Math.max(0, mins / 60);
  }
  return fallbackHours;
}

function dayName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short' });
}

function formatDateHuman(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

module.exports = {
  weekStartOf, addDays, weekDates, timeToMinutes, formatTime12, endLabel,
  shiftLabel, shiftHours, dayName, formatDateHuman
};

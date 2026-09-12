-- Macelleria Rostering database schema (SQLite)

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3a5a40',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee', -- admin | manager | employee
  pay_rate REAL DEFAULT 0,
  can_view_wages INTEGER NOT NULL DEFAULT 0,
  notify_email INTEGER NOT NULL DEFAULT 1,
  notify_sms INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which locations an employee can be rostered at
CREATE TABLE IF NOT EXISTS employee_locations (
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, location_id)
);

-- Which positions an employee is qualified/available for
CREATE TABLE IF NOT EXISTS employee_positions (
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, position_id)
);

CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, -- specific date this entry applies to
  type TEXT NOT NULL DEFAULT 'unavailable', -- available | unavailable | leave
  start_time TEXT, -- null = all day
  end_time TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- null = open/unfilled shift
  date TEXT NOT NULL, -- YYYY-MM-DD
  start_time TEXT NOT NULL, -- HH:MM 24h
  end_mode TEXT NOT NULL DEFAULT 'time', -- time | until_required | close
  end_time TEXT, -- HH:MM, required when end_mode = 'time'
  break_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  last_notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_shifts_loc_date ON shifts(location_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_employee ON shifts(employee_id);

-- Saved schedule templates (a reusable weekly pattern, not tied to specific dates)
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL, -- JSON array of {day_of_week, position_id, employee_id, start_time, end_mode, end_time, break_minutes}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id INTEGER REFERENCES positions(id),
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'worked', -- worked | sick | annual_leave | public_holiday | unpaid_leave
  scheduled_start TEXT,
  scheduled_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  notes TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_timesheets_loc_date ON timesheet_entries(location_id, date);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- shift_created | shift_updated | shift_deleted | publish
  shift_id INTEGER,
  employee_id INTEGER REFERENCES users(id),
  channel TEXT NOT NULL, -- sms | email
  recipient TEXT,
  message TEXT,
  status TEXT NOT NULL, -- sent | failed | simulated | skipped_no_contact | skipped_opted_out
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notiflog_org_date ON notification_log(org_id, created_at);

/* Macelleria Rostering - frontend SPA (no build step, vanilla JS) */
(function () {
  'use strict';

  const App = {};
  window.App = App;

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  App.state = {
    user: null,
    locations: [],
    positions: [],
    employees: [],
    locationId: null,
    weekStart: weekStartOf(todayISO()),
    scheduleBy: 'positions', // 'positions' | 'employees'
    showBudget: true,
    schedule: null,
    timesheets: null,
    tab: 'schedule',
    modal: null, // { type, data }
    collapsed: {}
  };

  // ---------------------------------------------------------------------
  // Date helpers (mirrors server/services/scheduleUtils.js)
  // ---------------------------------------------------------------------
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function weekStartOf(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function weekDates(ws) { return Array.from({ length: 7 }, (_, i) => addDays(ws, i)); }
  function fmtDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtDayShort(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { weekday: 'short' });
  }
  function fmtMoney(n) { return n === null || n === undefined ? '-' : `$${Number(n).toFixed(2)}`; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------------
  async function api(path, method, body) {
    const res = await fetch('/api' + path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }
  App.api = api;

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ---------------------------------------------------------------------
  // Boot / routing
  // ---------------------------------------------------------------------
  async function boot() {
    try {
      const { user } = await api('/auth/me');
      App.state.user = user;
      await loadOrgData();
      window.addEventListener('hashchange', route);
      route();
    } catch (e) {
      renderLogin();
    }
  }

  async function loadOrgData() {
    const [locRes, posRes, empRes] = await Promise.all([
      api('/locations'), api('/positions'), api('/employees')
    ]);
    App.state.locations = locRes.locations;
    App.state.positions = posRes.positions;
    App.state.employees = empRes.employees;
    if (!App.state.locationId && App.state.locations.length) {
      App.state.locationId = App.state.locations[0].id;
    }
  }

  function route() {
    const hash = location.hash.replace('#/', '') || 'schedule';
    App.state.tab = hash.split('?')[0];
    renderShell();
  }
  App.route = route;

  function goTab(tab) { location.hash = '#/' + tab; }
  App.goTab = goTab;

  // ---------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------
  function renderLogin() {
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <form class="login-card" onsubmit="return App.login(event)">
          <div class="mark-lg"></div>
          <h1>Macelleria Rostering</h1>
          <p class="sub">Sign in to manage your roster</p>
          <label class="field">Email
            <input class="input" type="email" name="email" required autofocus />
          </label>
          <label class="field">Password
            <input class="input" type="password" name="password" required />
          </label>
          <button class="btn primary" type="submit">Sign In</button>
          <div id="login-error" class="login-error"></div>
          <div class="login-hint">First time here? Log in with the owner account created during setup (see the README), then add your real staff under Organization.</div>
        </form>
      </div>`;
  }

  App.login = async function (ev) {
    ev.preventDefault();
    const form = ev.target;
    const email = form.email.value.trim();
    const password = form.password.value;
    try {
      const { user } = await api('/auth/login', 'POST', { email, password });
      App.state.user = user;
      await loadOrgData();
      window.addEventListener('hashchange', route);
      route();
    } catch (e) {
      document.getElementById('login-error').textContent = e.message;
    }
    return false;
  };

  App.logout = async function () {
    await api('/auth/logout', 'POST');
    App.state.user = null;
    window.removeEventListener('hashchange', route);
    renderLogin();
  };

  // ---------------------------------------------------------------------
  // Shell (top nav) + tab dispatch
  // ---------------------------------------------------------------------
  function renderShell() {
    const u = App.state.user;
    const tabs = [
      ['schedule', 'Schedule'],
      ['timesheets', 'Timesheets'],
      ['availability', 'Availability'],
      ['reports', 'Reports'],
      ['organization', 'Organization']
    ];
    const canSeeOrgTab = u.role !== 'employee';
    const navHtml = tabs.filter(([key]) => canSeeOrgTab || ['schedule', 'timesheets', 'availability'].includes(key)).map(([key, label]) =>
      `<a class="navlink ${App.state.tab === key ? 'active' : ''}" href="#/${key}">${label}</a>`
    ).join('');

    document.getElementById('app').innerHTML = `
      <div class="topnav">
        <div class="brand"><span class="mark"></span> Macelleria Rostering</div>
        ${navHtml}
        <div class="spacer"></div>
        <div class="user-menu">
          <button class="user-btn" onclick="App.toggleUserMenu()">${esc(u.name)} ▾</button>
          <div id="user-dropdown" class="dropdown" style="display:none">
            <div style="padding:10px 14px;font-size:12px;color:var(--text-light)">${esc(u.email)}<br>Role: ${u.role}</div>
            <button onclick="App.logout()">Log out</button>
          </div>
        </div>
      </div>
      <div class="page" id="page"></div>
    `;

    renderTab();
  }

  App.toggleUserMenu = function () {
    const el = document.getElementById('user-dropdown');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  };

  function renderTab() {
    const page = document.getElementById('page');
    if (App.state.tab === 'schedule') return renderSchedulePage(page);
    if (App.state.tab === 'timesheets') return renderTimesheetsPage(page);
    if (App.state.tab === 'availability') return renderAvailabilityPage(page);
    if (App.state.tab === 'reports') return renderReportsPage(page);
    if (App.state.tab === 'organization') return renderOrganizationPage(page);
    page.innerHTML = '<p>Not found</p>';
  }

  function locationSelectHtml() {
    return `<select class="input" onchange="App.setLocation(this.value)">
      ${App.state.locations.map(l => `<option value="${l.id}" ${l.id === App.state.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
    </select>`;
  }
  App.setLocation = function (id) {
    App.state.locationId = Number(id);
    renderTab();
  };

  // =======================================================================
  // SCHEDULE
  // =======================================================================
  async function renderSchedulePage(page) {
    if (!App.state.locationId) { page.innerHTML = '<p>No locations yet. Add one under Organization.</p>'; return; }
    page.innerHTML = `<div class="card">Loading schedule…</div>`;
    try {
      const data = await api(`/schedule?location_id=${App.state.locationId}&week=${App.state.weekStart}`);
      App.state.schedule = data;
    } catch (e) { page.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
    page.innerHTML = scheduleHtml();
    renderModalIfAny();
  }

  function scheduleHtml() {
    const s = App.state.schedule;
    const dates = s.dates;
    const isManager = App.state.user.role !== 'employee';
    const canBudget = App.state.user.role !== 'employee' || App.state.user.can_view_wages;

    const groups = App.state.scheduleBy === 'positions'
      ? App.state.positions.filter(p => p.active).map(p => ({ key: 'p' + p.id, label: p.name, position: p }))
      : App.state.employees.map(e => ({ key: 'e' + e.id, label: e.name, employee: e }));

    const rows = groups.map(g => groupRowHtml(g, dates, canBudget)).join('');

    const dayTotals = dates.map(d => {
      const shiftsOnDay = s.shifts.filter(sh => sh.date === d);
      const hours = shiftsOnDay.reduce((a, sh) => a + sh.hours, 0);
      const cost = shiftsOnDay.reduce((a, sh) => a + (sh.cost || 0), 0);
      return { hours, cost };
    });

    return `
      <div class="toolbar">
        <div>${locationSelectHtml()}</div>
        <div class="tabs" style="margin:0">
          <button class="tab ${App.state.scheduleBy === 'employees' ? 'active' : ''}" onclick="App.setScheduleBy('employees')">Employees</button>
          <button class="tab ${App.state.scheduleBy === 'positions' ? 'active' : ''}" onclick="App.setScheduleBy('positions')">Positions</button>
        </div>
        <div class="grow"></div>
        ${isManager ? `<button class="btn ghost small" onclick="App.openTemplatesMenu()">Templates / Copy</button>` : ''}
        ${isManager ? `<button class="btn ghost small" onclick="App.clearWeek()">Clear</button>` : ''}
        <button class="btn ghost small" onclick="window.print()">Print</button>
        ${canBudget ? `<button class="btn ${App.state.showBudget ? 'gold' : 'ghost'} small" onclick="App.toggleBudget()">Budget</button>` : ''}
        ${isManager ? `<button class="btn primary" onclick="App.openPublishModal()">Publish &amp; Notify${s.summary.unpublished ? ` (${s.summary.unpublished})` : ''}</button>` : ''}
      </div>

      <div class="toolbar">
        <button class="btn ghost small" onclick="App.goToday()">Today</button>
        <button class="btn ghost small" onclick="App.shiftWeek(-1)">‹</button>
        <strong>${fmtDate(dates[0])} – ${fmtDate(dates[6])}</strong>
        <button class="btn ghost small" onclick="App.shiftWeek(1)">›</button>
      </div>

      <div class="week-summary">
        <div class="stat"><div class="num">${s.summary.total_shifts}</div><div class="lbl">Total Shifts</div></div>
        <div class="stat"><div class="num">${s.summary.filled_shifts}</div><div class="lbl">Filled Shifts</div></div>
        <div class="stat"><div class="num">${s.summary.filled_hours}</div><div class="lbl">Filled Hours</div></div>
        ${canBudget ? `<div class="stat"><div class="num">${fmtMoney(s.summary.total_cost)}</div><div class="lbl">Total Cost</div></div>` : ''}
      </div>

      <div class="grid-wrap">
        <table class="roster">
          <thead>
            <tr>
              <th class="corner">${App.state.scheduleBy === 'positions' ? 'Position' : 'Employee'}</th>
              ${dates.map(d => `<th class="daycol">${fmtDayShort(d)} ${d.slice(8, 10)} ${new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { month: 'short' })}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td></td>
              ${dayTotals.map(t => `<td>${t.hours.toFixed(2)} hrs${canBudget ? ' | ' + fmtMoney(t.cost) : ''}</td>`).join('')}
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  function groupRowHtml(g, dates, canBudget) {
    const s = App.state.schedule;
    const shiftsForGroup = s.shifts.filter(sh => g.position ? sh.position_id === g.position.id : sh.employee_id === g.employee.id);
    const hours = shiftsForGroup.reduce((a, sh) => a + sh.hours, 0);
    const cost = shiftsForGroup.reduce((a, sh) => a + (sh.cost || 0), 0);
    const collapsed = !!App.state.collapsed[g.key];

    const cells = dates.map(d => {
      const shifts = shiftsForGroup.filter(sh => sh.date === d);
      const chips = shifts.map(sh => shiftChipHtml(sh)).join('');
      const isManager = App.state.user.role !== 'employee';
      const addBtn = isManager ? `<button class="add-shift-btn" onclick='App.openShiftModal(null, ${JSON.stringify({ date: d, position_id: g.position ? g.position.id : null, employee_id: g.employee ? g.employee.id : null })})'>+</button>` : '';
      return `<td class="daycell">${chips}${addBtn}</td>`;
    }).join('');

    return `
      <tr class="group-row">
        <td colspan="${dates.length + 1}" style="cursor:pointer" onclick="App.toggleGroup('${g.key}')">
          ${collapsed ? '▸' : '▾'} ${esc(g.label)}
          <span class="grouptotal" style="float:right">${hours.toFixed(2)} hrs${canBudget ? ' | ' + fmtMoney(cost) : ''}</span>
        </td>
      </tr>
      ${collapsed ? '' : `<tr>${cells}</tr>`}
    `;
  }

  function shiftChipHtml(sh) {
    const cls = ['shift-chip'];
    if (!sh.employee_id) cls.push('unfilled');
    if (!sh.published) cls.push('unpublished');
    return `<div class="${cls.join(' ')}" onclick='App.openShiftModal(${sh.id})'>
      ${!sh.published ? '<span class="badge-unpub" title="Not yet published"></span>' : ''}
      <span class="time">${esc(sh.label)}</span>
      <span class="who">${esc(sh.employee_name || 'Unassigned')}${App.state.scheduleBy === 'employees' ? ' · ' + esc(sh.position_name) : ''}</span>
    </div>`;
  }

  App.setScheduleBy = function (mode) { App.state.scheduleBy = mode; renderTab(); };
  App.toggleBudget = function () { App.state.showBudget = !App.state.showBudget; renderTab(); };
  App.toggleGroup = function (key) { App.state.collapsed[key] = !App.state.collapsed[key]; renderTab(); };
  App.goToday = function () { App.state.weekStart = weekStartOf(todayISO()); renderTab(); };
  App.shiftWeek = function (dir) {
    App.state.weekStart = addDays(App.state.weekStart, dir * 7);
    renderTab();
  };

  App.clearWeek = async function () {
    if (!confirm('Remove all unpublished shifts this week? Published shifts are kept.')) return;
    try {
      await api('/schedule/clear-week', 'POST', { location_id: App.state.locationId, week: App.state.weekStart });
      toast('Unpublished shifts cleared.');
      renderTab();
    } catch (e) { toast(e.message, true); }
  };

  // ---------------- Shift modal ----------------
  App.openShiftModal = function (shiftId, prefill) {
    let data;
    if (shiftId) {
      const sh = App.state.schedule.shifts.find(s => s.id === shiftId);
      data = { ...sh };
    } else {
      data = { id: null, date: (prefill && prefill.date) || App.state.schedule.dates[0], position_id: (prefill && prefill.position_id) || (App.state.positions[0] && App.state.positions[0].id), employee_id: (prefill && prefill.employee_id) || null, start_time: '09:00', end_mode: 'time', end_time: '17:00', break_minutes: 0, notes: '' };
    }
    App.state.modal = { type: 'shift', data, conflicts: [] };
    renderTab();
    checkShiftConflicts();
  };

  App.closeModal = function () { App.state.modal = null; renderModalIfAny(); };

  async function checkShiftConflicts() {
    const d = App.state.modal.data;
    if (!d.employee_id || !d.date || !d.start_time) { App.state.modal.conflicts = []; return; }
    try {
      const q = new URLSearchParams({
        employee_id: d.employee_id, date: d.date, start_time: d.start_time,
        end_time: d.end_time || '', end_mode: d.end_mode, exclude_shift_id: d.id || ''
      });
      const { conflicts } = await api('/schedule/conflicts?' + q.toString());
      App.state.modal.conflicts = conflicts;
      renderTab();
    } catch (e) { /* ignore */ }
  }

  App.updateShiftField = function (field, value) {
    App.state.modal.data[field] = value;
    if (['employee_id', 'date', 'start_time', 'end_time', 'end_mode'].includes(field)) checkShiftConflicts();
    else renderTab();
  };

  App.saveShift = async function () {
    const d = App.state.modal.data;
    const payload = {
      location_id: App.state.locationId, position_id: Number(d.position_id),
      employee_id: d.employee_id ? Number(d.employee_id) : null, date: d.date,
      start_time: d.start_time, end_mode: d.end_mode,
      end_time: d.end_mode === 'time' ? d.end_time : null,
      break_minutes: Number(d.break_minutes || 0), notes: d.notes || null
    };
    try {
      if (d.id) {
        await api(`/schedule/shifts/${d.id}`, 'PUT', payload);
        toast('Shift updated' + (d.published ? ' — the assigned employee has been notified.' : '.'));
      } else {
        await api('/schedule/shifts', 'POST', payload);
        toast('Shift added.');
      }
      App.state.modal = null;
      renderSchedulePage(document.getElementById('page'));
    } catch (e) { toast(e.message, true); }
  };

  App.deleteShift = async function () {
    const d = App.state.modal.data;
    if (!confirm('Delete this shift?')) return;
    try {
      await api(`/schedule/shifts/${d.id}`, 'DELETE');
      toast('Shift deleted' + (d.published ? ' — the employee has been notified.' : '.'));
      App.state.modal = null;
      renderSchedulePage(document.getElementById('page'));
    } catch (e) { toast(e.message, true); }
  };

  function shiftModalHtml(m) {
    const d = m.data;
    const eligibleEmployees = App.state.employees; // could filter by position qualification
    const dbl = m.conflicts.filter(c => c.type === 'double_booking');
    const avail = m.conflicts.filter(c => c.type === 'availability');
    return `
    <div class="modal-backdrop" onclick="if(event.target===this) App.closeModal()">
      <div class="modal">
        <h2>${d.id ? 'Edit Shift' : 'Add Shift'}</h2>
        <label class="field">Date
          <input class="input" type="date" value="${d.date}" onchange="App.updateShiftField('date', this.value)" />
        </label>
        <label class="field">Position
          <select class="input" onchange="App.updateShiftField('position_id', this.value)">
            ${App.state.positions.map(p => `<option value="${p.id}" ${Number(d.position_id) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">Employee
          <select class="input" onchange="App.updateShiftField('employee_id', this.value || null)">
            <option value="">Unassigned (open shift)</option>
            ${eligibleEmployees.map(e => `<option value="${e.id}" ${Number(d.employee_id) === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          </select>
        </label>
        <div class="row2">
          <label class="field">Start time
            <input class="input" type="time" value="${d.start_time || ''}" onchange="App.updateShiftField('start_time', this.value)" />
          </label>
          <label class="field">Finish
            <select class="input" onchange="App.updateShiftField('end_mode', this.value)">
              <option value="time" ${d.end_mode === 'time' ? 'selected' : ''}>Set time</option>
              <option value="until_required" ${d.end_mode === 'until_required' ? 'selected' : ''}>Until required</option>
              <option value="close" ${d.end_mode === 'close' ? 'selected' : ''}>Close</option>
            </select>
          </label>
        </div>
        ${d.end_mode === 'time' ? `<label class="field">End time
            <input class="input" type="time" value="${d.end_time || ''}" onchange="App.updateShiftField('end_time', this.value)" />
          </label>` : ''}
        <label class="field">Unpaid break (minutes)
          <input class="input" type="number" min="0" step="5" value="${d.break_minutes || 0}" onchange="App.updateShiftField('break_minutes', this.value)" />
        </label>
        <label class="field">Notes
          <textarea class="input" rows="2" onchange="App.updateShiftField('notes', this.value)">${esc(d.notes || '')}</textarea>
        </label>
        ${dbl.length ? `<div class="conflict-box dbl">⚠ Double booking: ${dbl.map(c => esc(c.message)).join('; ')}</div>` : ''}
        ${avail.length ? `<div class="conflict-box">⚠ Availability conflict: ${avail.map(c => esc(c.message)).join('; ')}</div>` : ''}
        ${d.published ? `<div class="help" style="margin-top:8px">This shift is already published — saving changes will text/email the affected employee(s) right away.</div>` : ''}
        <div class="modal-actions">
          <div class="left">
            ${d.id ? `<button class="btn danger" onclick="App.deleteShift()">Delete</button>` : ''}
          </div>
          <div class="left">
            <button class="btn ghost" onclick="App.closeModal()">Cancel</button>
            <button class="btn primary" onclick="App.saveShift()">Save</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ---------------- Publish modal ----------------
  App.openPublishModal = function () {
    App.state.modal = { type: 'publish', scope: 'affected', email: true, sms: true, sending: false };
    renderTab();
  };
  App.setPublishField = function (field, value) { App.state.modal[field] = value; renderTab(); };

  App.doPublish = async function () {
    const m = App.state.modal;
    const channels = [];
    if (m.email) channels.push('email');
    if (m.sms) channels.push('sms');
    App.state.modal.sending = true; renderTab();
    try {
      const result = await api('/schedule/publish', 'POST', {
        location_id: App.state.locationId, week: App.state.weekStart, notify_scope: m.scope, channels
      });
      App.state.modal = null;
      toast(`Published ${result.published_shifts} shift(s) and notified ${result.notified.length} employee(s).`);
      renderSchedulePage(document.getElementById('page'));
    } catch (e) {
      toast(e.message, true);
      App.state.modal.sending = false; renderTab();
    }
  };

  function publishModalHtml(m) {
    const s = App.state.schedule;
    return `
    <div class="modal-backdrop" onclick="if(event.target===this) App.closeModal()">
      <div class="modal">
        <h2>Publish &amp; Notify</h2>
        <p class="help">${s.summary.unpublished} unpublished shift(s) this week for ${esc(App.state.locations.find(l => l.id === App.state.locationId).name)}.</p>
        <div class="section-title" style="margin-top:14px">Who should be notified?</div>
        <div class="check-row"><label><input type="radio" name="scope" ${m.scope === 'affected' ? 'checked' : ''} onchange="App.setPublishField('scope','affected')" /> Only employees with new/changed shifts</label></div>
        <div class="check-row"><label><input type="radio" name="scope" ${m.scope === 'week_staff' ? 'checked' : ''} onchange="App.setPublishField('scope','week_staff')" /> Everyone rostered this week</label></div>
        <div class="check-row"><label><input type="radio" name="scope" ${m.scope === 'all_staff' ? 'checked' : ''} onchange="App.setPublishField('scope','all_staff')" /> Entire staff list</label></div>
        <div class="section-title">How?</div>
        <div class="check-row"><label><input type="checkbox" ${m.email ? 'checked' : ''} onchange="App.setPublishField('email', this.checked)" /> Email</label></div>
        <div class="check-row"><label><input type="checkbox" ${m.sms ? 'checked' : ''} onchange="App.setPublishField('sms', this.checked)" /> SMS text message</label></div>
        <p class="help">Employees who've opted out of a channel (Organization → employee profile) are skipped automatically.</p>
        <div class="modal-actions">
          <div></div>
          <div class="left">
            <button class="btn ghost" onclick="App.closeModal()">Cancel</button>
            <button class="btn primary" ${m.sending ? 'disabled' : ''} onclick="App.doPublish()">${m.sending ? 'Sending…' : 'Publish & Notify'}</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ---------------- Templates / Copy ----------------
  App.openTemplatesMenu = async function () {
    let templates = [];
    try { templates = (await api(`/schedule/templates?location_id=${App.state.locationId}`)).templates; } catch (e) {}
    App.state.modal = { type: 'templates', templates, copyFrom: addDays(App.state.weekStart, -7), newName: '' };
    renderTab();
  };

  App.copyWeek = async function () {
    const m = App.state.modal;
    try {
      const r = await api('/schedule/copy-week', 'POST', { location_id: App.state.locationId, from_week: m.copyFrom, to_week: App.state.weekStart });
      toast(`Copied ${r.copied} shift(s) into this week.`);
      App.state.modal = null;
      renderSchedulePage(document.getElementById('page'));
    } catch (e) { toast(e.message, true); }
  };

  App.saveTemplate = async function () {
    const m = App.state.modal;
    if (!m.newName.trim()) { toast('Give the template a name first.', true); return; }
    try {
      await api('/schedule/templates', 'POST', { location_id: App.state.locationId, name: m.newName.trim(), week: App.state.weekStart });
      toast('Template saved from this week.');
      App.openTemplatesMenu();
    } catch (e) { toast(e.message, true); }
  };

  App.applyTemplate = async function (id) {
    try {
      const r = await api(`/schedule/templates/${id}/apply`, 'POST', { week: App.state.weekStart });
      toast(`Applied template: ${r.applied} shift(s) added.`);
      App.state.modal = null;
      renderSchedulePage(document.getElementById('page'));
    } catch (e) { toast(e.message, true); }
  };

  App.deleteTemplate = async function (id) {
    if (!confirm('Delete this template?')) return;
    await api(`/schedule/templates/${id}`, 'DELETE');
    App.openTemplatesMenu();
  };

  function templatesModalHtml(m) {
    return `
    <div class="modal-backdrop" onclick="if(event.target===this) App.closeModal()">
      <div class="modal">
        <h2>Templates &amp; Copy Week</h2>
        <div class="section-title">Copy another week into this one</div>
        <label class="field">Copy from week starting
          <input class="input" type="date" value="${m.copyFrom}" onchange="App.state.modal.copyFrom=this.value" />
        </label>
        <button class="btn ghost small" onclick="App.copyWeek()">Copy into ${fmtDate(App.state.weekStart)}</button>

        <div class="section-title">Save this week as a template</div>
        <div style="display:flex;gap:8px">
          <input class="input" style="flex:1" placeholder="e.g. Standard week" oninput="App.state.modal.newName=this.value" />
          <button class="btn ghost small" onclick="App.saveTemplate()">Save</button>
        </div>

        <div class="section-title">Apply a saved template to this week</div>
        ${m.templates.length ? m.templates.map(t => `
          <div class="check-row" style="justify-content:space-between">
            <span>${esc(t.name)} <span class="help">(${t.data.length} shifts)</span></span>
            <span>
              <button class="btn ghost small" onclick="App.applyTemplate(${t.id})">Apply</button>
              <button class="btn ghost small" onclick="App.deleteTemplate(${t.id})">Delete</button>
            </span>
          </div>`).join('') : `<p class="help">No templates saved yet for this location.</p>`}
        <div class="modal-actions"><div></div><button class="btn ghost" onclick="App.closeModal()">Close</button></div>
      </div>
    </div>`;
  }

  function renderModalIfAny() {
    // Always clear any existing modal first so re-renders (conflict checks,
    // field edits, tab switches) never stack duplicate overlays.
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    const m = App.state.modal;
    if (!m) return;
    const container = document.createElement('div');
    if (m.type === 'shift') container.innerHTML = shiftModalHtml(m);
    else if (m.type === 'publish') container.innerHTML = publishModalHtml(m);
    else if (m.type === 'templates') container.innerHTML = templatesModalHtml(m);
    else if (m.type === 'employee') container.innerHTML = employeeModalHtml(m);
    document.body.appendChild(container.firstElementChild);
  }

  // =======================================================================
  // TIMESHEETS
  // =======================================================================
  async function renderTimesheetsPage(page) {
    if (!App.state.locationId) { page.innerHTML = '<p>No locations yet.</p>'; return; }
    page.innerHTML = `<div class="card">Loading timesheets…</div>`;
    let data;
    try { data = await api(`/timesheets?location_id=${App.state.locationId}&week=${App.state.weekStart}`); }
    catch (e) { page.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
    App.state.timesheets = data;
    const isManager = App.state.user.role !== 'employee';
    const canBudget = isManager || App.state.user.can_view_wages;

    const rows = data.entries.map(en => `
      <tr>
        <td>${fmtDate(en.date)}</td>
        <td>${esc(en.employee_name)}</td>
        <td>${esc(en.position_name || '')}</td>
        <td>${esc(en.entry_type)}</td>
        <td>${en.scheduled_start || ''}${en.scheduled_end ? ' - ' + en.scheduled_end : ''}</td>
        <td><input class="input" style="width:90px" type="time" value="${en.actual_start || ''}" onchange="App.updateTimesheet(${en.id},'actual_start',this.value)" ${!isManager && en.employee_id !== App.state.user.id ? 'disabled' : ''}/></td>
        <td><input class="input" style="width:90px" type="time" value="${en.actual_end || ''}" onchange="App.updateTimesheet(${en.id},'actual_end',this.value)" ${!isManager && en.employee_id !== App.state.user.id ? 'disabled' : ''}/></td>
        <td>${en.actual_hours}</td>
        ${canBudget ? `<td>${en.pay_rate !== null ? fmtMoney(en.actual_hours * en.pay_rate) : '-'}</td>` : ''}
        <td><input type="checkbox" ${en.approved ? 'checked' : ''} ${isManager ? '' : 'disabled'} onchange="App.updateTimesheet(${en.id},'approved',this.checked)"/></td>
      </tr>`).join('');

    page.innerHTML = `
      <div class="toolbar">
        <div>${locationSelectHtml()}</div>
        <div class="grow"></div>
        ${isManager ? `<a class="btn ghost small" href="/api/timesheets/export.csv?location_id=${App.state.locationId}&week=${App.state.weekStart}" target="_blank">Export CSV</a>` : ''}
        ${isManager ? `<button class="btn ghost small" onclick="App.approveAllTimesheets()">Approve all</button>` : ''}
      </div>
      <div class="toolbar">
        <button class="btn ghost small" onclick="App.goToday()">Today</button>
        <button class="btn ghost small" onclick="App.shiftWeek(-1)">‹</button>
        <strong>${fmtDate(data.dates[0])} – ${fmtDate(data.dates[6])}</strong>
        <button class="btn ghost small" onclick="App.shiftWeek(1)">›</button>
      </div>
      <div class="week-summary">
        <div class="stat"><div class="num">${data.totals.planned_hours}</div><div class="lbl">Planned Hours</div></div>
        <div class="stat"><div class="num">${data.totals.actual_hours}</div><div class="lbl">Actual Hours</div></div>
        ${canBudget ? `<div class="stat"><div class="num">${fmtMoney(data.totals.planned_cost)}</div><div class="lbl">Planned Cost</div></div>` : ''}
        ${canBudget ? `<div class="stat"><div class="num">${fmtMoney(data.totals.actual_cost)}</div><div class="lbl">Actual Cost</div></div>` : ''}
      </div>
      <div class="grid-wrap">
        <table class="simple">
          <thead><tr><th>Date</th><th>Employee</th><th>Position</th><th>Type</th><th>Scheduled</th><th>Actual start</th><th>Actual end</th><th>Hours</th>${canBudget ? '<th>Cost</th>' : ''}<th>Approved</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="10" class="help" style="padding:16px">No shifts published for this week yet.</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  App.updateTimesheet = async function (id, field, value) {
    try {
      await api(`/timesheets/${id}`, 'PUT', { [field]: value });
      renderTab();
    } catch (e) { toast(e.message, true); }
  };
  App.approveAllTimesheets = async function () {
    await api('/timesheets/approve-all', 'POST', { location_id: App.state.locationId, week: App.state.weekStart });
    toast('All entries approved.');
    renderTab();
  };

  // =======================================================================
  // AVAILABILITY (staff submit unavailable/leave dates; managers see it in
  // the shift modal's conflict warnings and in the Availability & Leave report)
  // =======================================================================
  async function renderAvailabilityPage(page) {
    const isManager = App.state.user.role !== 'employee';
    const employeeOptions = isManager
      ? `<label class="field">Employee
          <select class="input" id="avail-employee">${App.state.employees.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
        </label>` : '';
    const targetEmployeeId = isManager ? (App.state.employees[0] && App.state.employees[0].id) : App.state.user.id;
    page.innerHTML = `<div class="card">Loading…</div>`;
    let rows = [];
    try {
      const q = new URLSearchParams({ from: todayISO() });
      if (isManager) q.set('employee_id', targetEmployeeId);
      else q.set('employee_id', App.state.user.id);
      rows = (await api('/availability?' + q.toString())).availability;
    } catch (e) { /* ignore */ }

    page.innerHTML = `
      <div class="two-col">
        <div class="card">
          <div class="section-title" style="margin-top:0">${isManager ? 'Add availability / leave for a staff member' : 'Let your manager know when you can\'t work'}</div>
          ${employeeOptions}
          <label class="field">Date<input class="input" type="date" id="avail-date" value="${todayISO()}" /></label>
          <label class="field">Type
            <select class="input" id="avail-type">
              <option value="unavailable">Unavailable</option>
              <option value="leave">On leave</option>
              <option value="available">Available (overrides a default day off)</option>
            </select>
          </label>
          <div class="row2">
            <label class="field">From (leave blank = all day)<input class="input" type="time" id="avail-start" /></label>
            <label class="field">To<input class="input" type="time" id="avail-end" /></label>
          </div>
          <label class="field">Note<input class="input" id="avail-note" placeholder="Optional" /></label>
          <button class="btn primary" onclick="App.addAvailability(${targetEmployeeId})">Submit</button>
        </div>
        <div class="card">
          <div class="section-title" style="margin-top:0">Upcoming entries</div>
          ${rows.length ? `<table class="simple"><thead><tr><th>Date</th><th>Type</th><th>Time</th><th>Note</th><th></th></tr></thead>
            <tbody>${rows.map(r => `<tr><td>${fmtDate(r.date)}</td><td>${r.type}</td><td>${r.start_time ? r.start_time + '-' + r.end_time : 'All day'}</td><td>${esc(r.note || '')}</td><td><button class="btn ghost small" onclick="App.deleteAvailability(${r.id})">Remove</button></td></tr>`).join('')}</tbody></table>`
            : `<p class="help">No availability or leave entries submitted yet.</p>`}
        </div>
      </div>
    `;
  }

  App.addAvailability = async function (employeeId) {
    const empSelect = document.getElementById('avail-employee');
    const employee_id = empSelect ? Number(empSelect.value) : employeeId;
    const date = document.getElementById('avail-date').value;
    const type = document.getElementById('avail-type').value;
    const start_time = document.getElementById('avail-start').value || null;
    const end_time = document.getElementById('avail-end').value || null;
    const note = document.getElementById('avail-note').value || null;
    if (!date) { toast('Pick a date first.', true); return; }
    try {
      await api('/availability', 'POST', { employee_id, date, type, start_time, end_time, note });
      toast('Saved.');
      renderTab();
    } catch (e) { toast(e.message, true); }
  };

  App.deleteAvailability = async function (id) {
    await api(`/availability/${id}`, 'DELETE');
    renderTab();
  };

  // =======================================================================
  // REPORTS
  // =======================================================================
  App.state.reportKey = 'schedule-by-employee';

  async function renderReportsPage(page) {
    const reportList = [
      ['schedule-by-employee', 'Schedule By Employee'],
      ['schedule-by-position', 'Schedule By Position'],
      ['availability-leave', 'Availability & Leave Report'],
      ['shift-notifications', 'Shift Notification Report'],
      ['staff-listing', 'Staff Listing']
    ];
    page.innerHTML = `
      <div class="two-col">
        <div>
          <div class="section-title">Reports</div>
          <div class="card" style="padding:8px">
            ${reportList.map(([key, label]) => `<div class="tab ${App.state.reportKey === key ? 'active' : ''}" style="display:block;margin-bottom:6px" onclick="App.setReport('${key}')">${label}</div>`).join('')}
          </div>
          <div class="section-title">Options</div>
          <div class="card">
            <label class="field">Location ${locationSelectHtml()}</label>
            <label class="field">Week
              <input class="input" type="date" value="${App.state.weekStart}" onchange="App.setReportWeek(this.value)" />
            </label>
            <label class="check-row"><input type="checkbox" id="rep-published-only" /> Published shifts only</label>
            <button class="btn primary" style="width:100%" onclick="App.generateReport()">Generate report</button>
          </div>
        </div>
        <div id="report-output" class="card report-card">
          <p class="help">Choose a report and click Generate.</p>
        </div>
      </div>
    `;
  }

  App.setReport = function (key) { App.state.reportKey = key; renderTab(); };
  App.setReportWeek = function (v) { App.state.weekStart = weekStartOf(v); };

  App.generateReport = async function () {
    const key = App.state.reportKey;
    const out = document.getElementById('report-output');
    out.innerHTML = 'Generating…';
    const publishedOnly = document.getElementById('rep-published-only').checked;
    const q = `location_id=${App.state.locationId}&week=${App.state.weekStart}&published_only=${publishedOnly}`;
    try {
      if (key === 'schedule-by-employee' || key === 'schedule-by-position') {
        const data = await api(`/reports/${key}?${q}`);
        const groups = Object.keys(data.report);
        out.innerHTML = `<h3>${key === 'schedule-by-employee' ? 'Schedule By Employee' : 'Schedule By Position'}</h3>
          <p class="help">${fmtDate(data.dates[0])} – ${fmtDate(data.dates[6])}</p>
          ${groups.length ? groups.map(g => `<h4>${esc(g)}</h4><ul>${data.report[g].map(item => `<li>${item.date_human}: ${esc(item.label)} ${item.position ? '— ' + esc(item.position) : ''} ${item.employee ? '— ' + esc(item.employee) : ''} (${item.hours}h)</li>`).join('')}</ul>`).join('') : '<p class="help">No shifts found.</p>'}`;
      } else if (key === 'availability-leave') {
        const data = await api(`/reports/availability-leave?${q}`);
        const groups = Object.keys(data.report);
        out.innerHTML = `<h3>Availability &amp; Leave Report</h3>
          ${groups.length ? groups.map(g => `<h4>${esc(g)}</h4><ul>${data.report[g].map(item => `<li>${item.date_human}: ${item.type}${item.start_time ? ' ' + item.start_time + '-' + item.end_time : ' (all day)'} ${item.note ? '— ' + esc(item.note) : ''}</li>`).join('')}</ul>`).join('') : '<p class="help">No availability or leave entries submitted for this week.</p>'}`;
      } else if (key === 'shift-notifications') {
        const data = await api(`/reports/shift-notifications?${q}`);
        out.innerHTML = `<h3>Shift Notification Report</h3>
          <p class="help">Delivery status of every roster SMS/email sent this week.</p>
          <table class="simple"><thead><tr><th>When</th><th>Employee</th><th>Event</th><th>Channel</th><th>Recipient</th><th>Status</th></tr></thead>
          <tbody>${data.log.length ? data.log.map(l => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.employee_name || '')}</td><td>${esc(l.event_type)}</td><td>${l.channel.toUpperCase()}</td><td>${esc(l.recipient || '-')}</td><td><span class="pill ${l.status === 'sent' ? 'green' : l.status === 'failed' ? 'red' : 'gold'}">${l.status}</span></td></tr>`).join('') : `<tr><td colspan="6" class="help">No notifications sent yet this week.</td></tr>`}</tbody></table>`;
      } else if (key === 'staff-listing') {
        const data = await api(`/reports/staff-listing`);
        out.innerHTML = `<h3>Staff Listing</h3>
          <table class="simple"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Notify</th></tr></thead>
          <tbody>${data.staff.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.email)}</td><td>${esc(s.phone || '-')}</td><td>${s.role}</td><td>${s.notify_email ? 'Email ' : ''}${s.notify_sms ? 'SMS' : ''}</td></tr>`).join('')}</tbody></table>`;
      }
    } catch (e) { out.innerHTML = `<p class="login-error">${esc(e.message)}</p>`; }
  };

  // =======================================================================
  // ORGANIZATION
  // =======================================================================
  App.state.orgTab = 'employees';

  async function renderOrganizationPage(page) {
    let notifStatus = null;
    try { notifStatus = (await api('/notifications/status')).providers; } catch (e) {}

    page.innerHTML = `
      <div class="tabs">
        <button class="tab ${App.state.orgTab === 'employees' ? 'active' : ''}" onclick="App.setOrgTab('employees')">Employees</button>
        <button class="tab ${App.state.orgTab === 'positions' ? 'active' : ''}" onclick="App.setOrgTab('positions')">Positions</button>
        <button class="tab ${App.state.orgTab === 'locations' ? 'active' : ''}" onclick="App.setOrgTab('locations')">Locations</button>
        <button class="tab ${App.state.orgTab === 'notifications' ? 'active' : ''}" onclick="App.setOrgTab('notifications')">Notifications</button>
      </div>
      <div id="org-body"></div>
    `;
    const body = document.getElementById('org-body');
    if (App.state.orgTab === 'employees') renderEmployeesTab(body);
    else if (App.state.orgTab === 'positions') renderPositionsTab(body);
    else if (App.state.orgTab === 'locations') renderLocationsTab(body);
    else renderNotificationsTab(body, notifStatus);
  }
  App.setOrgTab = function (t) { App.state.orgTab = t; renderTab(); };

  function renderEmployeesTab(body) {
    const rows = App.state.employees.map(e => `
      <tr>
        <td>${esc(e.name)}</td><td>${esc(e.email)}</td><td>${esc(e.phone || '-')}</td>
        <td>${e.role}</td>
        <td>${e.positions.map(p => esc(p.name)).join(', ') || '-'}</td>
        <td>${e.notify_email ? 'Email ' : ''}${e.notify_sms ? 'SMS' : ''}</td>
        <td><button class="btn ghost small" onclick="App.openEmployeeModal(${e.id})">Edit</button></td>
      </tr>`).join('');
    body.innerHTML = `
      <div class="toolbar"><div class="grow"></div><button class="btn primary" onclick="App.openEmployeeModal(null)">+ Add employee</button></div>
      <div class="grid-wrap"><table class="simple">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Positions</th><th>Notify via</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  App.openEmployeeModal = function (id) {
    const emp = id ? App.state.employees.find(e => e.id === id) : {
      id: null, name: '', email: '', phone: '', role: 'employee', pay_rate: 0, can_view_wages: false,
      notify_email: true, notify_sms: true, positions: [], locations: []
    };
    App.state.modal = { type: 'employee', data: { ...emp, position_ids: (emp.positions || []).map(p => p.id) }, password: '' };
    renderModalIfAny();
  };

  App.updateEmployeeField = function (field, value) { App.state.modal.data[field] = value; };
  App.toggleEmployeePosition = function (posId, checked) {
    const d = App.state.modal.data;
    if (checked) d.position_ids = [...new Set([...d.position_ids, posId])];
    else d.position_ids = d.position_ids.filter(id => id !== posId);
  };

  App.saveEmployee = async function () {
    const m = App.state.modal;
    const d = m.data;
    const payload = {
      name: d.name, email: d.email, phone: d.phone || null, role: d.role,
      pay_rate: Number(d.pay_rate || 0), can_view_wages: !!d.can_view_wages,
      notify_email: !!d.notify_email, notify_sms: !!d.notify_sms,
      position_ids: d.position_ids, location_ids: [App.state.locationId]
    };
    if (m.password) payload.password = m.password;
    try {
      if (d.id) await api(`/employees/${d.id}`, 'PUT', payload);
      else {
        if (!m.password) { toast('Set a temporary password for the new employee.', true); return; }
        await api('/employees', 'POST', { ...payload, password: m.password });
      }
      toast('Employee saved.');
      await loadOrgData();
      App.state.modal = null;
      renderTab();
    } catch (e) { toast(e.message, true); }
  };

  App.deactivateEmployee = async function () {
    const d = App.state.modal.data;
    if (!confirm(`Remove ${d.name} from the active staff list? Their history is kept.`)) return;
    await api(`/employees/${d.id}`, 'DELETE');
    await loadOrgData();
    App.state.modal = null;
    renderTab();
  };

  function employeeModalHtml(m) {
    const d = m.data;
    return `
    <div class="modal-backdrop" onclick="if(event.target===this) App.closeModal()">
      <div class="modal">
        <h2>${d.id ? 'Edit Employee' : 'Add Employee'}</h2>
        <label class="field">Full name<input class="input" value="${esc(d.name)}" onchange="App.updateEmployeeField('name',this.value)" /></label>
        <div class="row2">
          <label class="field">Email<input class="input" type="email" value="${esc(d.email)}" onchange="App.updateEmployeeField('email',this.value)" /></label>
          <label class="field">Mobile (for SMS)<input class="input" placeholder="+61…" value="${esc(d.phone || '')}" onchange="App.updateEmployeeField('phone',this.value)" /></label>
        </div>
        <div class="row2">
          <label class="field">Role
            <select class="input" onchange="App.updateEmployeeField('role',this.value)">
              <option value="employee" ${d.role === 'employee' ? 'selected' : ''}>Employee</option>
              <option value="manager" ${d.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="admin" ${d.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </label>
          <label class="field">Pay rate ($/hr)<input class="input" type="number" step="0.5" value="${d.pay_rate}" onchange="App.updateEmployeeField('pay_rate',this.value)" /></label>
        </div>
        <label class="field">${d.id ? 'Reset password (leave blank to keep current)' : 'Temporary password'}
          <input class="input" type="text" oninput="App.state.modal.password=this.value" />
        </label>
        <div class="section-title">Qualified positions</div>
        ${App.state.positions.map(p => `<label class="check-row"><input type="checkbox" ${d.position_ids.includes(p.id) ? 'checked' : ''} onchange="App.toggleEmployeePosition(${p.id}, this.checked)" /> ${esc(p.name)}</label>`).join('')}
        <div class="section-title">Notifications</div>
        <label class="check-row"><input type="checkbox" ${d.notify_email ? 'checked' : ''} onchange="App.updateEmployeeField('notify_email', this.checked)" /> Notify by email on roster changes</label>
        <label class="check-row"><input type="checkbox" ${d.notify_sms ? 'checked' : ''} onchange="App.updateEmployeeField('notify_sms', this.checked)" /> Notify by SMS on roster changes</label>
        <label class="check-row"><input type="checkbox" ${d.can_view_wages ? 'checked' : ''} onchange="App.updateEmployeeField('can_view_wages', this.checked)" /> Can view wages/labour cost</label>
        <div class="modal-actions">
          <div class="left">${d.id ? `<button class="btn danger" onclick="App.deactivateEmployee()">Remove</button>` : ''}</div>
          <div class="left">
            <button class="btn ghost" onclick="App.closeModal()">Cancel</button>
            <button class="btn primary" onclick="App.saveEmployee()">Save</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderPositionsTab(body) {
    const rows = App.state.positions.map(p => `
      <tr>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${p.color};margin-right:6px"></span>${esc(p.name)}</td>
        <td>${p.active ? '<span class="pill green">Active</span>' : '<span class="pill gray">Inactive</span>'}</td>
        <td><button class="btn ghost small" onclick="App.renamePosition(${p.id})">Rename</button> <button class="btn ghost small" onclick="App.deletePosition(${p.id})">Delete</button></td>
      </tr>`).join('');
    body.innerHTML = `
      <div class="toolbar"><div class="grow"></div><button class="btn primary" onclick="App.addPosition()">+ Add position</button></div>
      <div class="grid-wrap"><table class="simple"><thead><tr><th>Position</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  App.addPosition = async function () {
    const name = prompt('New position name (e.g. Barista, Delivery Driver):');
    if (!name) return;
    await api('/positions', 'POST', { name, sort_order: App.state.positions.length });
    await loadOrgData(); renderTab();
  };
  App.renamePosition = async function (id) {
    const p = App.state.positions.find(x => x.id === id);
    const name = prompt('Rename position:', p.name);
    if (!name) return;
    await api(`/positions/${id}`, 'PUT', { name });
    await loadOrgData(); renderTab();
  };
  App.deletePosition = async function (id) {
    if (!confirm('Delete this position? Existing shifts referencing it will be affected.')) return;
    await api(`/positions/${id}`, 'DELETE');
    await loadOrgData(); renderTab();
  };

  function renderLocationsTab(body) {
    const rows = App.state.locations.map(l => `
      <tr><td>${esc(l.name)}</td><td>${esc(l.address || '-')}</td>
        <td><button class="btn ghost small" onclick="App.renameLocation(${l.id})">Edit</button></td></tr>`).join('');
    body.innerHTML = `
      <div class="toolbar"><div class="grow"></div><button class="btn primary" onclick="App.addLocation()">+ Add location</button></div>
      <div class="grid-wrap"><table class="simple"><thead><tr><th>Location</th><th>Address</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  App.addLocation = async function () {
    const name = prompt('New location name:');
    if (!name) return;
    const address = prompt('Address (optional):') || null;
    await api('/locations', 'POST', { name, address });
    await loadOrgData(); renderTab();
  };
  App.renameLocation = async function (id) {
    const l = App.state.locations.find(x => x.id === id);
    const name = prompt('Location name:', l.name);
    if (!name) return;
    const address = prompt('Address:', l.address || '') || null;
    await api(`/locations/${id}`, 'PUT', { name, address });
    await loadOrgData(); renderTab();
  };

  function renderNotificationsTab(body, status) {
    body.innerHTML = `
      <div class="card">
        <div class="section-title" style="margin-top:0">Delivery providers</div>
        <p class="help">By default, SMS and email are <b>simulated</b> — every roster change is logged (see Reports → Shift Notification Report) but nothing actually leaves the server, so you can test the whole workflow safely. Connect real providers by setting environment variables and restarting the server — see the README that shipped with this app.</p>
        <table class="simple">
          <tr><td style="width:120px"><b>Email</b></td><td>${status ? esc(status.email) : 'unknown'}</td></tr>
          <tr><td><b>SMS</b></td><td>${status ? esc(status.sms) : 'unknown'}</td></tr>
        </table>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="section-title" style="margin-top:0">How notifications work</div>
        <ul>
          <li><b>Publish &amp; Notify</b> on the Schedule page sends that week's roster to whoever you choose — only newly affected staff, everyone rostered that week, or your entire staff list — by email, SMS, or both.</li>
          <li>Editing or deleting a shift that's <b>already been published</b> notifies the affected employee(s) immediately, the same way ZenShifts does.</li>
          <li>Each employee can opt in/out of email or SMS individually — set this on their profile under Organization → Employees.</li>
          <li>Every attempt (sent, simulated, failed, or skipped) is recorded — see Reports → Shift Notification Report.</li>
        </ul>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  boot();
})();

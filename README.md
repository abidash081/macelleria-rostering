# Macelleria Rostering

A self-hosted staff rostering app built for Macelleria, covering the same
ground as ZenShifts: weekly scheduling by employee or position, availability
and double-booking warnings, budget/cost tracking, timesheets generated from
the schedule, printable/exportable reports, and — the feature you asked for
specifically — **SMS and email notifications whenever the roster changes**,
sent to just the affected staff or to everyone, on demand or automatically.

## What's included

**Schedule**
- Weekly roster grid, switchable between "by employee" and "by position" views
- Shifts can end at a set time, "until required", or "close" (no fixed finish)
- Add / edit / delete shifts, with live warnings for double-booking and
  employee availability conflicts
- Copy an entire week to another week, or save a week as a reusable template
- Draft-then-publish workflow: new shifts stay unpublished (and silent) until
  you click **Publish & Notify**
- Budget toggle showing hours and labour cost per position/employee/day,
  with a per-employee permission for who's allowed to see wages

**Notifications (SMS + Email)**
- **Publish & Notify**: choose who hears about it — only staff with new or
  changed shifts, everyone rostered that week, or your entire staff list —
  and by email, SMS, or both
- Editing or deleting a shift that's already been published notifies the
  affected employee(s) immediately
- Each employee can opt in/out of email or SMS individually
- Every attempt is logged — sent, simulated, failed, or skipped (opted out /
  no contact info) — visible in Reports → Shift Notification Report
- Ships in **simulated mode**: everything works end-to-end and logs what
  would be sent, until you plug in a real email/SMS provider (see below) —
  nothing goes out to real staff by accident while you're testing

**Timesheets**
- Auto-generated from published shifts; enter actual start/end times
- Planned vs. actual hours and cost
- Manager approval (single entry or approve-all)
- CSV export (a stand-in for a payroll system upload)

**Reports**
- Schedule By Employee / By Position
- Availability & Leave Report
- Shift Notification Report (delivery status of every SMS/email)
- Staff Listing

**Availability**
- Staff submit unavailable/leave dates (and managers can log them too)
- Feeds straight into the double-booking/availability warnings when building
  the schedule, and into the Availability & Leave Report

**Organization**
- Employees (contact info, role, pay rate, qualified positions, notification
  preferences, wage-visibility permission)
- Positions and Locations
- Notifications settings/status page

## Getting started

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run seed      # creates the database with a starter Macelleria organization
npm start
```

Then open **http://localhost:3000**.

The seed script prints the login it creates — by default:

- Owner/admin: the email address you set as `SEED_OWNER_EMAIL` (defaults to
  the address used to set this project up) / `ChangeMe123!`
- Two demo employees (`demo.employee1@example.com`, `demo.employee2@example.com`,
  password `Password123!`) so the roster isn't empty on first login

**Change the owner password immediately**, and replace the demo employees
with your real staff under **Organization → Employees** (delete the demo
ones once you've added your own team). To reset the database and reseed
from scratch, delete the `data/` folder's `.db` files and run `npm run seed`
again.

## Turning on real SMS and email

Copy `.env.example` to `.env` and fill in whichever provider(s) you have:

- **Email**: any SMTP login works — Gmail (with an
  [App Password](https://support.google.com/accounts/answer/185833)),
  Outlook, or the SMTP endpoint of a transactional email service
  (SendGrid, Postmark, Resend, Mailgun, etc).
- **SMS**: a [Twilio](https://www.twilio.com) account — sign up, buy or
  verify a phone number, and put the Account SID, Auth Token and number
  into `.env`.

Restart the server (`npm start`) after editing `.env`. You can turn on just
one channel — leaving the other blank keeps it in simulated/logging mode.
Check **Organization → Notifications** in the app to see which channels are
currently live vs. simulated.

## Deploying so your team can reach it from anywhere — for free

Right now this runs on one machine. To make it reachable outside your own
computer at **no cost**, see the separate **Deploying to Render** step-by-step
guide for exact, click-by-click instructions (no coding required, about
15-20 minutes, $0/month).

The free setup uses two free services together:

- **[Render](https://render.com) free web service** — runs the app itself.
  Free web services fall asleep after ~15 minutes with no traffic and take
  20-60 seconds to wake back up on the next visit — the trade-off for $0/month.
  They also wipe their local disk on every restart/sleep cycle, which is why:
- **[Turso](https://turso.tech) free database** — a hosted SQLite database
  (100 databases, 5GB storage, no credit card required) that keeps your
  roster, staff and timesheet data safe permanently, independent of Render's
  disk. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (see `.env.example`)
  and the app automatically uses it instead of a local file.

Running locally with no Turso account is unaffected — leave those two
variables blank and the app just uses a local `data/macelleria.db` file, as
before.

If you'd rather deploy elsewhere (a VPS, Railway, Fly.io) or pay for an
always-on instance with no cold start: copy the project, run
`npm install --production`, set the same `.env` values, and run `npm start`
(a process manager like `pm2`, or the platform's own restart-on-crash, keeps
it running). Put it behind HTTPS before using it with real staff data —
Render and similar platforms do this automatically.

## Notes on scope

This was built by reviewing ZenShifts' own marketing pages and the live
Macelleria account (Schedule, Timesheets, Reports, Organization) to match
its feature set and day-to-day workflow. It's an original codebase and
design — not ZenShifts' code or branding — so you own it outright and can
extend it freely. A few things ZenShifts also offers that aren't built out
yet, in case you want them next:

- Direct accounting/payroll integrations (Xero, MYOB, Elmo, KINGpay) — the
  CSV timesheet export is a manual stand-in for these today
- Multi-organization / multi-tenant hosting (this is set up for one
  business with one or more locations, matching how Macelleria uses it)

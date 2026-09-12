// Pluggable notification service: sends SMS + email, or simulates (logs) when
// no provider credentials are configured yet. Every attempt — real or
// simulated — is written to notification_log so the "Shift Notification"
// report has a full delivery record, same as ZenShifts.

const db = require('../db');

let nodemailer = null;
let twilioClient = null;

function getMailer() {
  if (nodemailer) return nodemailer;
  try {
    const nm = require('nodemailer');
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      nodemailer = nm.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
    }
  } catch (e) {
    nodemailer = null;
  }
  return nodemailer;
}

function getTwilio() {
  if (twilioClient) return twilioClient;
  try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require('twilio');
      twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
  } catch (e) {
    twilioClient = null;
  }
  return twilioClient;
}

async function logNotification({ org_id, event_type, shift_id, employee_id, channel, recipient, message, status, error }) {
  await db.prepare(`INSERT INTO notification_log
      (org_id, event_type, shift_id, employee_id, channel, recipient, message, status, error)
      VALUES (@org_id, @event_type, @shift_id, @employee_id, @channel, @recipient, @message, @status, @error)`)
    .run({
      org_id, event_type, shift_id: shift_id || null, employee_id: employee_id || null,
      channel, recipient: recipient || null, message: message || null, status,
      error: error || null
    });
}

async function sendEmail({ org_id, event_type, shift_id, employee_id, to, subject, html, text }) {
  if (!to) {
    await logNotification({ org_id, event_type, shift_id, employee_id, channel: 'email', recipient: null, message: subject, status: 'skipped_no_contact' });
    return { status: 'skipped_no_contact' };
  }
  const mailer = getMailer();
  if (!mailer) {
    // Simulation mode: no SMTP configured yet. Log it as simulated so the
    // notification report and UI clearly show what *would* have been sent.
    await logNotification({ org_id, event_type, shift_id, employee_id, channel: 'email', recipient: to, message: subject, status: 'simulated' });
    console.log(`[SIMULATED EMAIL] to=${to} subject="${subject}"\n${text || ''}`);
    return { status: 'simulated' };
  }
  try {
    await mailer.sendMail({
      from: process.env.MAIL_FROM || 'Macelleria Rostering <no-reply@macelleria-rostering.local>',
      to, subject, html, text
    });
    await logNotification({ org_id, event_type, shift_id, employee_id, channel: 'email', recipient: to, message: subject, status: 'sent' });
    return { status: 'sent' };
  } catch (err) {
    await logNotification({ org_id, event_type, shift_id, employee_id, channel: 'email', recipient: to, message: subject, status: 'failed', error: String(err.message || err) });
    return { status: 'failed', error: err };
  }
}

async function sendSms({ org_id, event_type, shift_id, employee_id, to, body }) {
  if (!to) {
    await logNotification({ org_id, event_type, shift_id, employee_id, channel: 'sms', recipient: null, message: body, status: 'skipped_no_contact' });
    return { status: 'skipped_no_contact' };
  }
  const client = getTwilio();
  if (!client || !process.env.TWILIO_FROM_NUMBER) {
    await logNotification({ org_id, event_type, shift_id, employee_id, channel: 'sms', recipient: to, message: body, status: 'simulated' });
    console.log(`[SIMULATED SMS] to=${to}\n${body}`);
    return { status: 'simulated' };
  }
  try {
    await client.messages.create({ from: process.env.TWILIO_FROM_NUMBER, to, body });
    await logNotification({ org_id, event_type, shift_id, employee_id, channel: 'sms', recipient: to, message: body, status: 'sent' });
    return { status: 'sent' };
  } catch (err) {
    await logNotification({ org_id, event_type, shift_id, employee_id, channel: 'sms', recipient: to, message: body, status: 'failed', error: String(err.message || err) });
    return { status: 'failed', error: err };
  }
}

// Notify one employee about a roster event via whichever channels they (or
// the caller) want, respecting their own opt-in preferences unless
// overridden (e.g. an admin forcing a broadcast).
async function notifyEmployee({ org_id, event_type, shift_id, employee, channels, subject, smsBody, emailHtml, emailText, respectPreferences = true }) {
  const results = {};
  const wantsEmail = channels.includes('email') && (!respectPreferences || employee.notify_email);
  const wantsSms = channels.includes('sms') && (!respectPreferences || employee.notify_sms);

  if (channels.includes('email') && !wantsEmail) {
    await logNotification({ org_id, event_type, shift_id, employee_id: employee.id, channel: 'email', recipient: employee.email, message: subject, status: 'skipped_opted_out' });
  }
  if (channels.includes('sms') && !wantsSms) {
    await logNotification({ org_id, event_type, shift_id, employee_id: employee.id, channel: 'sms', recipient: employee.phone, message: smsBody, status: 'skipped_opted_out' });
  }

  if (wantsEmail) {
    results.email = await sendEmail({ org_id, event_type, shift_id, employee_id: employee.id, to: employee.email, subject, html: emailHtml, text: emailText });
  }
  if (wantsSms) {
    results.sms = await sendSms({ org_id, event_type, shift_id, employee_id: employee.id, to: employee.phone, body: smsBody });
  }
  return results;
}

function providerStatus() {
  return {
    email: getMailer() ? 'configured' : 'simulated (no SMTP_HOST/SMTP_USER/SMTP_PASS set)',
    sms: (getTwilio() && process.env.TWILIO_FROM_NUMBER) ? 'configured' : 'simulated (no TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER set)'
  };
}

module.exports = { sendEmail, sendSms, notifyEmployee, providerStatus, logNotification };

// api/slack-notify.js — @mention people picker + notifications (Slack DM + email)
//
// GET  /api/slack-notify?action=users
//        → workspace people for the @mention dropdown: [{ name, email }]
// POST /api/slack-notify  { action:'notify', emails:[...], context, from, link }
//        → for each email: Slack DM (lookupByEmail → chat.postMessage) + email (Resend)
//
// Required Vercel env vars:
//   JWT_SECRET            — same secret used by /api/auth and /api/data (request auth)
//   SLACK_BOT_TOKEN       — xoxb-... Bot token. Scopes: users:read, users:read.email,
//                           chat:write, im:write
// Optional (email channel — skipped gracefully if unset):
//   RESEND_API_KEY        — Resend API key for sending the email copy
//   MENTION_EMAIL_FROM    — verified From address, e.g. "NPD Dashboard <npd@calo.app>"
//   MENTION_USER_FILTER   — comma-separated email domains to keep (default: calo.app)

const crypto = require('crypto');

const JWT_SECRET      = process.env.JWT_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const EMAIL_FROM      = process.env.MENTION_EMAIL_FROM || 'NPD Dashboard <a.mohamed@calo.app>';

function allowedDomains() {
  return (process.env.MENTION_USER_FILTER || 'calo.app')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ── JWT verify (matches api/data.js) ─────────────────────────────────────────
function jwtVerify(token) {
  if (!token || !JWT_SECRET) return null;
  try {
    const [h, b, s] = token.split('.');
    if (!h || !b || !s) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
    if (s !== expected) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function getToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

// ── Slack helpers ────────────────────────────────────────────────────────────
async function slackGet(method, params) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const r = await fetch(`https://slack.com/api/${method}${qs}`, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  });
  return r.json();
}
async function slackPost(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  return r.json();
}

// Pull the full workspace member list (paginated), keep active humans with an email.
// Returns { users, diag } so the caller can explain an empty result.
async function listWorkspaceUsers() {
  const diag = { token: !!SLACK_BOT_TOKEN, totalMembers: 0, withEmail: 0, slackError: null };
  if (!SLACK_BOT_TOKEN) { diag.slackError = 'SLACK_BOT_TOKEN env var is not set'; return { users: [], diag }; }
  const domains = allowedDomains();
  const out = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const params = { limit: '200' };
    if (cursor) params.cursor = cursor;
    const d = await slackGet('users.list', params);
    if (!d.ok) { diag.slackError = d.error || 'users.list failed'; break; }
    (d.members || []).forEach(m => {
      diag.totalMembers++;
      if (m.deleted || m.is_bot || m.id === 'USLACKBOT') return;
      const p = m.profile || {};
      const email = (p.email || '').toLowerCase();
      if (!email) return;
      diag.withEmail++;
      if (domains.length && !domains.some(dn => email.endsWith('@' + dn))) return;
      out.push({
        name: p.real_name || m.real_name || p.display_name || m.name || email,
        email
      });
    });
    cursor = (d.response_metadata && d.response_metadata.next_cursor) || '';
    if (!cursor) break;
  }
  // If members came back but none had an email, the email scope is almost certainly missing.
  if (!diag.slackError && diag.totalMembers > 0 && diag.withEmail === 0) {
    diag.slackError = 'members returned but no emails — add scope users:read.email and reinstall';
  }
  const seen = {};
  const users = out
    .filter(u => (seen[u.email] ? false : (seen[u.email] = true)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { users, diag };
}

async function slackDM(email, text) {
  if (!SLACK_BOT_TOKEN) return { ok: false, error: 'no_token' };
  const look = await slackGet('users.lookupByEmail', { email });
  if (!look.ok || !look.user) return { ok: false, error: look.error || 'user_not_found' };
  const open = await slackPost('conversations.open', { users: look.user.id });
  if (!open.ok) return { ok: false, error: open.error || 'open_failed' };
  const msg = await slackPost('chat.postMessage', {
    channel: open.channel.id,
    text,
    unfurl_links: false
  });
  return { ok: !!msg.ok, error: msg.ok ? null : msg.error };
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) return { ok: false, error: 'email_not_configured' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html })
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `resend ${r.status}: ${t.slice(0, 160)}` };
  }
  return { ok: true };
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!jwtVerify(getToken(req))) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    // ── People picker ──────────────────────────────────────────────
    const action = (req.method === 'GET' ? (req.query || {}).action : (req.body || {}).action) || '';
    if (req.method === 'GET' && action === 'users') {
      const { users, diag } = await listWorkspaceUsers();
      return res.status(200).json({ ok: true, data: users, diag });
    }

    // ── Send notifications ─────────────────────────────────────────
    if (req.method === 'POST' && action === 'notify') {
      const body    = req.body || {};
      const emails  = Array.from(new Set((body.emails || [])
        .map(e => String(e || '').trim().toLowerCase()).filter(Boolean)));
      const from    = String(body.from || 'Someone').slice(0, 120);
      const context = String(body.context || 'an item').slice(0, 240);
      const link    = String(body.link || '').slice(0, 600);

      if (!emails.length) return res.status(200).json({ ok: true, sent: 0, results: [] });

      const text = `:wave: *${from}* mentioned you on the NPD Dashboard.\n*${context}*` +
                   (link ? `\n<${link}|Open the dashboard>` : '');
      const html = `<p><strong>${escapeHtml(from)}</strong> mentioned you on the NPD Dashboard.</p>` +
                   `<p>${escapeHtml(context)}</p>` +
                   (link ? `<p><a href="${escapeHtml(link)}">Open the dashboard</a></p>` : '');

      const results = await Promise.all(emails.map(async email => {
        const slack = await slackDM(email, text).catch(e => ({ ok: false, error: e.message }));
        const mail  = await sendEmail(email, `${from} mentioned you on the NPD Dashboard`, html)
                        .catch(e => ({ ok: false, error: e.message }));
        return { email, slack: slack.ok, slackError: slack.error, email_sent: mail.ok, emailError: mail.error };
      }));

      const sent = results.filter(r => r.slack || r.email_sent).length;
      return res.status(200).json({ ok: true, sent, results });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error('[slack-notify]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// api/sendreport.js — Proxy pre-built Slack blocks from browser to Slack webhook
//
// POST /api/sendreport   body: { blocks: [...], webhookUrl: "https://hooks.slack.com/..." }
// Required env vars:
//   JWT_SECRET            — same as auth
//   SLACK_WEEKLY_WEBHOOK  — fallback webhook if client doesn't send one

const crypto = require('crypto');
const JWT_SECRET       = process.env.JWT_SECRET;
const FALLBACK_WEBHOOK = process.env.SLACK_WEEKLY_WEBHOOK;

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const jwt = jwtVerify(getToken(req));
  if (!jwt || !jwt.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const role = String(jwt.user.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'super admin') {
    return res.status(403).json({ ok: false, error: 'Admin only' });
  }

  const d = req.body || {};

  // Connectivity test
  if (d._test) return res.status(200).json({ ok: true, test: true });

  const webhook = (d.webhookUrl && /^https:\/\/hooks\.slack\.com\//.test(d.webhookUrl))
    ? d.webhookUrl
    : FALLBACK_WEBHOOK;

  if (!webhook) {
    return res.status(500).json({ ok: false, error: 'No Slack webhook URL. Set it in Settings or add SLACK_WEEKLY_WEBHOOK in Vercel env vars.' });
  }

  if (!d.blocks || !Array.isArray(d.blocks) || !d.blocks.length) {
    return res.status(400).json({ ok: false, error: 'No blocks in request body' });
  }

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    let r;
    try {
      r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: d.blocks }),
        signal: ctrl.signal
      });
    } finally { clearTimeout(tid); }

    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ ok: false, error: `Slack ${r.status}: ${t.slice(0, 200)}` });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[sendreport]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// api/send-report.js — Send overall NPD report to Slack (admin-only)
//
// POST /api/send-report   body: { mp, date, flash, monthly, meals, bh, fixes, ingredients, quality }
// Required env vars:
//   JWT_SECRET            — same as auth
//   SLACK_WEEKLY_WEBHOOK  — Slack Incoming Webhook URL

const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET;
const WEBHOOK    = process.env.SLACK_WEEKLY_WEBHOOK;

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
function val(v, suffix) { return v != null ? String(v) + (suffix || '') : '—'; }

function buildBlocks(d) {
  const blocks = [];

  // ── Header ──
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `NPD Overall Report  —  ${d.mp}  —  ${d.date}`, emoji: false }
  });
  blocks.push({ type: 'divider' });

  // ── Flash Report ──
  if (d.flash) {
    const f = d.flash;
    const weekTxt = f.weekLabel ? `Week: ${f.weekLabel}` : 'Current Week';
    const topTxt  = f.topPerformers && f.topPerformers.length
      ? f.topPerformers.map(n => `  • ${n}`).join('\n') : '  None';
    const lowTxt  = f.underperformers && f.underperformers.length
      ? f.underperformers.map(n => `  • ${n}`).join('\n') : '  None';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Flash Report  (${weekTxt})*\n` +
              `FHS: *${f.fhs || '—'}*   |   Top Performers: *${f.highCount || 0}*   |   Underperformers: *${f.lowCount || 0}*   |   New Meals: *${f.newMealsCount || 0}*\n` +
              `*Top performers:*\n${topTxt}\n` +
              `*Needs attention:*\n${lowTxt}`
      }
    });
    blocks.push({ type: 'divider' });
  }

  // ── Monthly Review ──
  if (d.monthly) {
    const m = d.monthly;
    const monthTxt = m.monthLabel || 'Current Month';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Monthly Review  (${monthTxt})*\n` +
              `Avg FHS: *${val(m.avgFhs, '%')}*   |   New Launches: *${val(m.launches)}*   |   Removals: *${val(m.removals)}*   |   Open Actions: *${val(m.openActions)}*`
      }
    });
    blocks.push({ type: 'divider' });
  }

  // ── Meals Pipeline ──
  if (d.meals) {
    const m = d.meals;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Meals Pipeline*\n` +
              `Total: *${val(m.total)}*   |   Launched: *${val(m.launched)}*   |   Avg FHS (launched): *${val(m.avgFhs, '%')}*   |   Idea: *${val(m.idea)}*   |   Rework: *${val(m.rework)}*`
      }
    });
  }

  // ── BH NPD ──
  if (d.bh) {
    const b = d.bh;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*BH NPD Tastings*\n` +
              `Total tastings: *${val(b.total)}*   |   Good: *${val(b.good)}*   |   Poor/Bad: *${val(b.poor)}*`
      }
    });
  }

  // ── Fixes ──
  if (d.fixes) {
    const f = d.fixes;
    const alert = f.highPri > 0 ? `   :rotating_light: ${f.highPri} high priority` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Fixes*\n` +
              `Total: *${val(f.total)}*   |   Pending: *${val(f.pending)}*${alert}`
      }
    });
  }

  // ── Ingredients ──
  if (d.ingredients) {
    const i = d.ingredients;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Ingredients*\n` +
              `Total: *${val(i.total)}*   |   Pending Approval: *${val(i.pending)}*`
      }
    });
  }

  // ── Quality ──
  if (d.quality) {
    const q = d.quality;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Quality Issues*\n` +
              `Pending: *${val(q.pending)}*   |   In Progress: *${val(q.inProgress)}*   |   Done: *${val(q.done)}*`
      }
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `NPD Training Dashboard  |  Sent by admin  |  ${d.date}` }]
  });

  return blocks;
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

  if (!WEBHOOK) {
    return res.status(500).json({ ok: false, error: 'SLACK_WEEKLY_WEBHOOK env var not set. Add it in Vercel → Settings → Environment Variables.' });
  }

  try {
    const d = req.body || {};
    const blocks = buildBlocks(d);

    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks })
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ ok: false, error: `Slack ${r.status}: ${t.slice(0, 200)}` });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[send-report]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

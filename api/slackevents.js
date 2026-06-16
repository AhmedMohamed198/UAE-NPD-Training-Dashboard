// api/slack-events.js — Slack Events API receiver
//
// Receives message events from monitored channels, filters by allowed users,
// and saves fixes directly to the GitHub JSON store.
//
// Required Vercel env vars:
//   SLACK_SIGNING_SECRET  — from api.slack.com → App → Basic Information
//   SLACK_BOT_TOKEN       — xoxb-... Bot User OAuth Token (needs users:read scope)
//   NPD_GH_TOKEN          — GitHub PAT
//   SLACK_ALLOWED_USERS   — comma-separated display names (default list built-in)
//   SLACK_CHANNEL_MAP     — JSON: {"CHANNEL_ID":"UAE","CHANNEL_ID2":"KSA-Jeddah"}
//
// In Slack App → Event Subscriptions:
//   Request URL: https://<your-vercel-domain>/api/slack-events
//   Subscribe to bot events: message.channels
//   OAuth Scopes: channels:history, users:read

const crypto = require('crypto');

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;
const GH_TOKEN             = process.env.NPD_GH_TOKEN;
const GH_REPO              = process.env.GITHUB_REPO   || 'ahmedmohamed198/uae-npd-training-dashboard';
const GH_BRANCH            = process.env.GITHUB_BRANCH || 'main';

const DEFAULT_ALLOWED = 'Sam,Jaspal Singh,Mukesh Singh,Lokesh Tmg,Som Dutt,Ahmed Mohamed,Hazem Khalil,Chandan kumar';
const ALLOWED_USERS = (process.env.SLACK_ALLOWED_USERS || DEFAULT_ALLOWED)
  .split(',').map(u => u.trim().toLowerCase()).filter(Boolean);

function getChannelMap() {
  try { return JSON.parse(process.env.SLACK_CHANNEL_MAP || '{}'); } catch(_) { return {}; }
}

// ── Signature verification ───────────────────────────────────────────────────
function verifySignature(rawBody, headers) {
  if (!SLACK_SIGNING_SECRET) return true; // skip in dev if not set
  const ts  = headers['x-slack-request-timestamp'];
  const sig = headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay protection
  const expected = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(`v0:${ts}:${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch(_) { return false; }
}

// ── Slack API helpers ────────────────────────────────────────────────────────
async function slackGetUser(userId) {
  if (!SLACK_BOT_TOKEN || !userId) return null;
  try {
    const r = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });
    const d = await r.json();
    return d.ok ? d.user : null;
  } catch(_) { return null; }
}

function isAllowedUser(user) {
  if (!user) return false;
  const candidates = [
    (user.real_name || '').toLowerCase(),
    (user.name || '').toLowerCase(),
    ((user.profile || {}).display_name || '').toLowerCase(),
    ((user.profile || {}).real_name || '').toLowerCase()
  ];
  return ALLOWED_USERS.some(allowed =>
    candidates.some(c => c && (c.includes(allowed) || allowed.includes(c)))
  );
}

// ── GitHub helpers ───────────────────────────────────────────────────────────
async function ghRead(path) {
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`,
    { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'npd-slack-events' } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read ${r.status}`);
  const file = await r.json();
  return { content: JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8')), sha: file.sha };
}

async function ghWrite(path, content, sha, message) {
  const body = { message, content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'), branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'npd-slack-events', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`GitHub write ${r.status}: ${t.slice(0, 200)}`); }
  return (await r.json()).content.sha;
}

function recomputeTotals(items) {
  const done    = items.filter(i => (i.status||'').toLowerCase() === 'done').length;
  const pending = items.filter(i => (i.status||'').toLowerCase() === 'pending').length;
  const inProg  = items.filter(i => /progress/i.test(i.status||'')).length;
  const byType = {}, byPriority = {}, byStatus = {};
  items.forEach(i => {
    byType[i.type||'Other']       = (byType[i.type||'Other']       || 0) + 1;
    byPriority[i.priority||'Low'] = (byPriority[i.priority||'Low'] || 0) + 1;
    byStatus[i.status||'Pending'] = (byStatus[i.status||'Pending'] || 0) + 1;
  });
  return { total: items.length, done, pending, inProgress: inProg,
           donePct: items.length ? Math.round(done / items.length * 100) : 0,
           byType, byPriority, byStatus };
}

function recomputeFilters(items) {
  const types = new Set(), statuses = new Set(), priorities = new Set(), assignees = new Set();
  items.forEach(i => {
    if (i.type)       types.add(i.type);
    if (i.status)     statuses.add(i.status);
    if (i.priority)   priorities.add(i.priority);
    if (i.assignedTo) assignees.add(i.assignedTo);
  });
  return { types:[...types].sort(), statuses:[...statuses].sort(), priorities:[...priorities].sort(), assignees:[...assignees].sort() };
}

function randId() { return 'FIX-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function firstLine(text) { return (text || '').split('\n')[0].trim().slice(0, 80) || 'Slack Fix'; }

// ── Vercel config: disable body parsing so we get raw body for sig verification
module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Collect raw body
  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });

  if (!verifySignature(rawBody, req.headers)) {
    return res.status(401).json({ error: 'Invalid Slack signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch(_) { return res.status(400).json({ error: 'Bad JSON' }); }

  // URL verification handshake
  if (payload.type === 'url_verification') {
    return res.status(200).json({ challenge: payload.challenge });
  }

  if (payload.type !== 'event_callback') return res.status(200).end();

  const event = payload.event || {};

  // Only handle plain new messages (skip edits, bot posts, joins, etc.)
  if (event.type !== 'message')                          return res.status(200).end();
  if (event.subtype && event.subtype !== 'file_share')   return res.status(200).end();
  if (event.bot_id || event.app_id)                      return res.status(200).end();
  if (!event.text && !(event.files && event.files.length)) return res.status(200).end();

  // Check channel is monitored
  const channelMap = getChannelMap();
  const mp = channelMap[event.channel];
  if (!mp) {
    console.log('[slack-events] Unmonitored channel:', event.channel);
    return res.status(200).end();
  }

  // Check poster is allowed
  const slackUser = await slackGetUser(event.user);
  if (!isAllowedUser(slackUser)) {
    console.log('[slack-events] Ignored non-allowed user:', event.user, slackUser && slackUser.real_name);
    return res.status(200).end();
  }

  const text       = event.text || '';
  const userName   = slackUser.real_name || slackUser.name || event.user;
  const msgTs      = (event.ts || '').replace('.', '');
  const msgLink    = `https://slack.com/archives/${event.channel}/p${msgTs}`;

  const fix = {
    id:           randId(),
    date:         todayStr(),
    type:         'Slack',
    name:         firstLine(text),
    issueDetails: text,
    status:       'Pending',
    assignedTo:   '',
    priority:     'Low',
    notes:        `Source: Slack | Link: ${msgLink}`,
    reportedBy:   userName,
    done:         false,
    updatedAt:    todayStr()
  };

  try {
    const path     = `data/${mp}/fixes.json`;
    const current  = await ghRead(path);
    const fileData = current ? current.content : { fixes: { items: [], totals: {}, filters: {} }, meta: {} };
    const sha      = current ? current.sha : null;

    const section = fileData.fixes || { items: [], totals: {}, filters: {} };
    const items   = section.items || [];

    items.unshift(fix);
    section.items   = items;
    section.totals  = recomputeTotals(items);
    section.filters = recomputeFilters(items);
    fileData.fixes  = section;

    await ghWrite(path, fileData, sha, `[slack-fix] ${mp}: ${fix.name} (${fix.id})`);
    console.log('[slack-events] Saved fix', fix.id, 'for', mp, 'from', userName);
    return res.status(200).json({ ok: true, id: fix.id });
  } catch(e) {
    console.error('[slack-events]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// api/slack-events.js — Slack Events API receiver
//
// Receives message events from monitored channels, filters by allowed users,
// and routes each fix to the correct MP dashboard based on who posted.
//
// Required Vercel env vars:
//   SLACK_SIGNING_SECRET  — from api.slack.com → App → Basic Information
//   SLACK_BOT_TOKEN       — xoxb-... Bot User OAuth Token (needs users:read scope)
//   NPD_GH_TOKEN          — GitHub PAT
//   SLACK_CHANNEL_MAP     — JSON: {"CHANNEL_ID":"monitored"} — marks which channels to watch
//   SLACK_USER_MP_MAP     — JSON: {"Ahmed Mohamed":"UAE","Chandan kumar":"Jeddah",...}
//
// Routing: the poster's display name determines which MP dashboard the fix goes to.
// In Slack App → Event Subscriptions:
//   Request URL: https://<your-vercel-domain>/api/slackevents
//   Subscribe to bot events: message.channels
//   OAuth Scopes: channels:history, users:read

const crypto = require('crypto');

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;
const GH_TOKEN             = process.env.NPD_GH_TOKEN;
const GH_REPO              = process.env.GITHUB_REPO   || 'ahmedmohamed198/uae-npd-training-dashboard';
const GH_BRANCH            = process.env.GITHUB_BRANCH || 'main';

// Default user → MP routing (overridden by SLACK_USER_MP_MAP env var)
const DEFAULT_USER_MP = {
  'lokesh tmg':    'UAE',
  'sam':           'UAE',
  'som dutt':      'UAE',
  'jaspal singh':  'UAE',
  'mukesh singh':  'UAE',
  'ahmed mohamed': 'UAE',
  'hazem khalil':  'Riyadh',
  'chandan kumar': 'Jeddah'
};

function getUserMpMap() {
  try {
    const raw = JSON.parse(process.env.SLACK_USER_MP_MAP || '{}');
    // Normalise keys to lowercase
    const out = {};
    Object.keys(raw).forEach(k => { out[k.toLowerCase()] = raw[k]; });
    return out;
  } catch(_) { return {}; }
}

// Monitored channel IDs (values ignored — just needs to be in the map)
function getChannelMap() {
  try { return JSON.parse(process.env.SLACK_CHANNEL_MAP || '{}'); } catch(_) { return {}; }
}

// Resolve MP for a Slack user object
function getMpForUser(user) {
  const overrides = getUserMpMap();
  const map = Object.keys(overrides).length ? overrides : DEFAULT_USER_MP;
  const candidates = [
    (user.real_name || '').toLowerCase(),
    ((user.profile || {}).real_name || '').toLowerCase(),
    ((user.profile || {}).display_name || '').toLowerCase(),
    (user.name || '').toLowerCase()
  ];
  for (const key of Object.keys(map)) {
    if (candidates.some(c => c && (c.includes(key) || key.includes(c)))) {
      return map[key];
    }
  }
  return null; // not in the allowed list
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

// MPs to search when marking a fix as done (extend via SLACK_KNOWN_MPS env var)
function getKnownMps() {
  try {
    const v = process.env.SLACK_KNOWN_MPS;
    if (v) return v.split(',').map(s => s.trim()).filter(Boolean);
  } catch(_) {}
  return ['UAE', 'KSA-Jeddah', 'Riyadh'];
}

// Search all known MPs for a fix by slackTs (thread match) or name, mark it Done
async function markFixDone(threadTs, fixName) {
  for (const mp of getKnownMps()) {
    const path    = `data/${mp}/fixes.json`;
    const current = await ghRead(path);
    if (!current) continue;
    const fileData = current.content;
    const section  = fileData.fixes || { items: [] };
    const items    = section.items || [];
    let idx = threadTs ? items.findIndex(i => i.slackTs === threadTs) : -1;
    if (idx === -1 && fixName) {
      idx = items.findIndex(i => i.name && i.name.toLowerCase() === fixName.toLowerCase());
    }
    if (idx !== -1) {
      items[idx] = { ...items[idx], status: 'Done', done: true, updatedAt: todayStr() };
      section.items   = items;
      section.totals  = recomputeTotals(items);
      section.filters = recomputeFilters(items);
      fileData.fixes  = section;
      await ghWrite(path, fileData, current.sha, `[slack-done] ${mp}: ${items[idx].name}`);
      return { mp, fix: items[idx] };
    }
  }
  return null;
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

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Collect raw body (works whether bodyParser is on or off)
  let rawBody, payload;
  if (req.body && typeof req.body === 'object') {
    // Body already parsed by Vercel — reconstruct raw string for sig check
    rawBody = JSON.stringify(req.body);
    payload = req.body;
  } else {
    rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
    try { payload = JSON.parse(rawBody); } catch(_) { return res.status(400).json({ error: 'Bad JSON' }); }
  }

  if (!verifySignature(rawBody, req.headers)) {
    return res.status(401).json({ error: 'Invalid Slack signature' });
  }

  // URL verification handshake
  if (payload.type === 'url_verification') {
    return res.status(200).json({ challenge: payload.challenge });
  }

  if (payload.type !== 'event_callback') return res.status(200).end();

  const event = payload.event || {};

  // Only handle new messages (skip edits, joins, etc. — but ALLOW workflow/bot posts)
  if (event.type !== 'message')                                                return res.status(200).end();
  if (event.subtype && !['bot_message','file_share'].includes(event.subtype))  return res.status(200).end();
  if (!event.text && !(event.files && event.files.length))                     return res.status(200).end();

  // Check channel is monitored
  const channelMap = getChannelMap();
  if (!channelMap[event.channel]) {
    console.log('[slack-events] Unmonitored channel:', event.channel);
    return res.status(200).end();
  }

  const text    = event.text || '';
  const msgTs   = (event.ts || '').replace('.', '');
  const msgLink = `https://slack.com/archives/${event.channel}/p${msgTs}`;

  // ── CASE 1: "Done fixing" reply — mark existing fix as Done ─────────────────
  // e.g. "Just to let you know that Butter Masala Sauce is now fixed on the dashboard 🚀"
  if (/is now fixed on the dashboard/i.test(text)) {
    const nameMatch = text.match(/that (.+?) is now fixed on the dashboard/i);
    const fixName   = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const threadTs  = event.thread_ts || null;
    try {
      const result = await markFixDone(threadTs, fixName);
      if (result) {
        console.log('[slack-events] Marked done:', result.fix.name, result.mp);
        return res.status(200).json({ ok: true, action: 'done', id: result.fix.id });
      }
      console.log('[slack-events] Done reply but no matching fix found for:', fixName);
    } catch(e) {
      console.error('[slack-events] markFixDone error:', e.message);
    }
    return res.status(200).end();
  }

  // ── CASE 2: Structured workflow message — create new Pending fix ─────────────
  // e.g. "Name Garlic Sauce\nApply changes to UAE\nDetails ...\nLink ..."
  const isWorkflow = /apply changes to/i.test(text);

  let mp, fixName, issueDetails, reportedBy, notesLink;

  if (isWorkflow) {
    const strip = s => s.replace(/<[^>]+>/g, m => {
      const pipe = m.indexOf('|'); return pipe > -1 ? m.slice(pipe + 1, -1) : m.slice(1, -1);
    }).trim();
    const field = (label, src) => {
      const m = src.match(new RegExp(label + '[:\\s]+([^\\n]+)', 'i'));
      return m ? strip(m[1]) : '';
    };

    fixName      = field('Name', text);
    issueDetails = field('Details', text);
    notesLink    = field('Link', text);

    const mpRaw = field('Apply changes to', text).toLowerCase();
    if (mpRaw.includes('jeddah'))       mp = 'KSA-Jeddah';
    else if (mpRaw.includes('riyadh'))  mp = 'Riyadh';
    else                                mp = 'UAE';

    const reqBy = text.match(/requested by\s+<@[^|>]+\|([^>]+)>|requested by\s+@?([\w\s]+)/i);
    reportedBy  = reqBy ? (reqBy[1] || reqBy[2] || '').trim() : strip(event.username || '');

    if (!fixName) {
      console.log('[slack-events] Workflow message missing Name field — skipping');
      return res.status(200).end();
    }
  } else {
    // ── CASE 3: Regular user message — route by poster identity ─────────────
    const slackUser = await slackGetUser(event.user);
    mp = getMpForUser(slackUser || {});
    if (!mp) {
      console.log('[slack-events] Ignored non-allowed user:', event.user, slackUser && slackUser.real_name);
      return res.status(200).end();
    }
    fixName      = firstLine(text);
    issueDetails = text;
    notesLink    = msgLink;
    reportedBy   = (slackUser && (slackUser.real_name || slackUser.name)) || event.user;
  }

  const fix = {
    id:           randId(),
    date:         todayStr(),
    type:         'Slack',
    name:         fixName,
    issueDetails: issueDetails,
    status:       'Pending',
    assignedTo:   '',
    priority:     'Low',
    notes:        notesLink ? `Link: ${notesLink}` : `Source: Slack | ${msgLink}`,
    reportedBy:   reportedBy,
    done:         false,
    slackTs:      event.ts || null,   // stored so the "done" reply can find this fix by thread
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
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;

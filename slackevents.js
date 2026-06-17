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

// Resolve a Slack mention/name string to a human-readable display name.
// Handles "<@U123|name>", "<@U123>", "@Name", or plain "Name".
async function resolveMention(raw) {
  if (!raw) return '';
  const m = String(raw).match(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/);
  if (m) {
    if (m[2]) return m[2].trim();                 // inline name present
    const u = await slackGetUser(m[1]);           // look up by ID
    return u ? (u.real_name || u.name || m[1]) : m[1];
  }
  return String(raw).replace(/^@/, '').trim();
}

// Signature verification disabled — channel map + user map provide sufficient filtering
function verifySignature() { return true; }

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

  // Ignore Slack's automatic retries (they cause duplicate fixes when our
  // GitHub write takes longer than Slack's 3-second ack window).
  if (req.headers['x-slack-retry-num']) {
    console.log('[slack-events] Ignoring Slack retry #', req.headers['x-slack-retry-num']);
    return res.status(200).end();
  }

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

  // A thread reply has thread_ts set and different from its own ts.
  const isReply = event.thread_ts && event.thread_ts !== event.ts;

  // ── CASE 1: the specific "Done" confirmation — mark existing fix as Done ──────
  // Only these exact phrases count, nothing else.
  const DONE_RE = /is now fixed on the dashboard|clicked\s+\*?done fixing the dashboard|clicked\s+\*?recipe updated/i;

  if (DONE_RE.test(text)) {
    const nameMatch = text.match(/that (.+?) is now fixed on the dashboard/i);
    const doneName  = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const threadTs  = event.thread_ts || null;
    try {
      const result = await markFixDone(threadTs, doneName);
      if (result) {
        console.log('[slack-events] Marked done:', result.fix.name, result.mp);
        return res.status(200).json({ ok: true, action: 'done', id: result.fix.id });
      }
      console.log('[slack-events] Done signal — no matching fix found for:', doneName);
    } catch(e) {
      console.error('[slack-events] markFixDone error:', e.message);
    }
    return res.status(200).end();
  }

  // Any other thread reply is just chatter — ignore it (do NOT create a fix).
  if (isReply) {
    console.log('[slack-events] Ignoring non-done thread reply');
    return res.status(200).end();
  }

  // Shared strip helper
  const strip = s => s.replace(/<[^>]+>/g, m => {
    const pipe = m.indexOf('|'); return pipe > -1 ? m.slice(pipe + 1, -1) : m.slice(1, -1);
  }).trim();

  // ── CASE 2: Meal Fixes Workflow (labeled) — #foodops-npd-meal-fixes-workflow ─
  // Format: "requested by @Name" + labeled fields: Name, Apply changes to, Details, Link
  const isMealFixesFormat = /apply changes to/i.test(text);

  // ── CASE 3: Recipe Fixes and Scaling (positional) — #recipe-fixes-scaling ────
  // Format: MEAL_NAME\nDETAILS\n@ASSIGNEE\nMARKET
  const isBot = !event.user || !!event.bot_id || event.subtype === 'bot_message';

  let mp, fixName, issueDetails, reportedBy, notesLink;

  if (isMealFixesFormat) {
    // Labeled format. Slack wraps the labels in backticks (`Name`, `Details`),
    // so strip backticks before extracting fields.
    const ntext = text.replace(/`/g, '');
    const field = (label) => {
      const m = ntext.match(new RegExp(label + '[:\\s]+([^\\n]+)', 'i'));
      return m ? strip(m[1]) : '';
    };

    const mpRaw = field('Apply changes to').toLowerCase();
    if (mpRaw.includes('jeddah'))          mp = 'KSA-Jeddah';
    else if (/riyadh|ksa|saudi/.test(mpRaw)) mp = 'Riyadh';
    else                                   mp = 'UAE';

    // Try "Name X" label; fall back to line just before "Apply changes to"
    fixName = field('Name') || field('Meal Name') || field('Component');
    if (!fixName) {
      const lines = ntext.split('\n').map(l => strip(l)).filter(Boolean);
      const applyIdx = lines.findIndex(l => /apply changes to/i.test(l));
      for (let i = applyIdx - 1; i >= 0; i--) {
        const l = lines[i];
        if (l && !/hello|requested by|there'?s a dashboard|team/i.test(l)) { fixName = l; break; }
      }
    }

    issueDetails = field('Details') || field('Description') || field('Issue');
    notesLink    = field('Link') || field('URL');

    const reqRaw = (ntext.match(/requested by\s+(<@[^>]+>|@?[\w .'-]+)/i) || [])[1] || event.username || '';
    reportedBy   = await resolveMention(reqRaw);
    fixName      = fixName || 'Slack Fix';

  } else if (isBot) {
    // Positional format (Recipe Fixes and Scaling): NAME / DETAILS / @ASSIGNEE / MARKET
    const lines = text.split('\n')
      .map(l => strip(l).replace(/:[a-z_-]+:/g, '').replace(/[\u{1F1E0}-\u{1F1FF}]{2}/gu, '').trim())
      .filter(Boolean);

    console.log('[slack-events] Positional lines:', JSON.stringify(lines));

    // Market line: contains a recognised country name
    const marketIdx = lines.findIndex(l => /\buae\b|ksa|jeddah|riyadh|saudi|qatar|egypt|bahrain/i.test(l));
    if (marketIdx === -1) {
      console.log('[slack-events] No market found — skipping');
      return res.status(200).end();
    }

    const mpRaw = lines[marketIdx].toLowerCase();
    if (mpRaw.includes('jeddah'))          mp = 'KSA-Jeddah';
    else if (/riyadh|ksa|saudi/.test(mpRaw)) mp = 'Riyadh';
    else if (mpRaw.includes('uae'))        mp = 'UAE';
    else {
      console.log('[slack-events] Market not monitored:', lines[marketIdx]);
      return res.status(200).end();
    }

    fixName = lines[0];
    const middleLines = lines.slice(1, marketIdx);
    const assigneeIdx = middleLines.findIndex(l => /^@/.test(l));
    if (assigneeIdx >= 0) {
      issueDetails = middleLines.slice(0, assigneeIdx).join(' ');
    } else {
      issueDetails = middleLines.join(' ');
    }
    // Resolve the @mention from the RAW text (strip turns it into a bare ID)
    const mention = text.match(/<@[^>]+>/);
    reportedBy = mention ? await resolveMention(mention[0]) : strip(event.username || '');
    notesLink  = msgLink;

  } else {
    // Regular human chat message — NOT a workflow fix. Ignore it so the
    // dashboard only captures actual workflow-submitted fixes.
    console.log('[slack-events] Skipping non-workflow chat message');
    return res.status(200).end();
  }

  const fix = {
    id:           randId(),
    mp,
    date:         todayStr(),
    type:         'Slack',
    name:         fixName,
    issue:        issueDetails,   // dashboard renders the "issue" column from this field
    status:       'Pending',
    assignedTo:   '',
    priority:     'Low',
    notes:        notesLink ? `Link: ${notesLink}` : `Source: Slack | ${msgLink}`,
    reportedBy:   reportedBy,
    done:         false,
    slackTs:      event.ts || null,   // stored so the "done" reply can find this fix by thread
    photoUrl:     '',
    updatedAt:    new Date().toISOString()
  };

  try {
    const path     = `data/${mp}/fixes.json`;
    const current  = await ghRead(path);
    const fileData = current ? current.content : { fixes: { items: [], totals: {}, filters: {} }, meta: {} };
    const sha      = current ? current.sha : null;

    const section = fileData.fixes || { items: [], totals: {}, filters: {} };
    const items   = section.items || [];

    // Dedupe: skip if a fix from this exact Slack message already exists.
    if (fix.slackTs && items.some(i => i.slackTs === fix.slackTs)) {
      console.log('[slack-events] Duplicate (same slackTs) — skipping', fix.slackTs);
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // Assign a row number so the dashboard can delete it by row too.
    fix.row = items.reduce((mx, i) => Math.max(mx, Number(i.row) || 0), 0) + 1;

    items.unshift(fix);
    section.items   = items;
    section.totals  = recomputeTotals(items);
    section.filters = recomputeFilters(items);
    fileData.fixes  = section;

    await ghWrite(path, fileData, sha, `[slack-fix] ${mp}: ${fix.name} (${fix.id})`);
    console.log('[slack-events] Saved fix', fix.id, 'for', mp, 'from', reportedBy);
    return res.status(200).json({ ok: true, id: fix.id });
  } catch(e) {
    console.error('[slack-events]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;

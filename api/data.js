// api/data.js — section data CRUD via GitHub file store
// GET  /api/data?mp=UAE&section=meals          → read section JSON
// GET  /api/data?section=users                 → user list for @mentions
// POST /api/data  { mp, section, data, sha? }  → write section JSON

const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const GH_TOKEN   = process.env.GITHUB_TOKEN;
const GH_REPO    = process.env.GITHUB_REPO   || 'ahmedmohamed198/uae-npd-training-dashboard';
const GH_BRANCH  = process.env.GITHUB_BRANCH || 'main';

const VALID_SECTIONS = ['meals', 'bh', 'quality', 'ingredients', 'fixes', 'audits', 'comments'];

// ── JWT verify ───────────────────────────────────────────────────
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

// ── GitHub helpers ───────────────────────────────────────────────
async function ghRead(path) {
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`,
    { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'npd-dashboard' } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read ${r.status}`);
  const file = await r.json();
  return { content: JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8')), sha: file.sha };
}

async function ghWrite(path, content, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
    branch: GH_BRANCH
  };
  if (sha) body.sha = sha;   // required for updates; omit for creates
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'npd-dashboard',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub write ${r.status}: ${txt.slice(0, 200)}`);
  }
  const result = await r.json();
  return result.content.sha;
}

// ── Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth
  const jwt = jwtVerify(getToken(req));
  if (!jwt) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const params   = req.method === 'GET' ? (req.query || {}) : (req.body || {});
  const mp       = (params.mp      || 'UAE').replace(/[^a-zA-Z0-9_\-]/g, '');
  const section  = (params.section || '').replace(/[^a-zA-Z0-9_\-]/g, '');

  try {
    // ── Special: users list for @mention ──────────────────────────
    if (section === 'users') {
      const result = await ghRead('data/users.json');
      const users  = (result && result.content) || [];
      return res.status(200).json({
        ok: true,
        data: users.map(u => ({ name: u.name || u.email, email: u.email }))
      });
    }

    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ ok: false, error: 'Invalid section: ' + section });
    }

    const path = `data/${mp}/${section}.json`;

    // ── GET ───────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const result = await ghRead(path);
      if (!result) return res.status(200).json({ ok: true, data: null, sha: null });
      return res.status(200).json({ ok: true, data: result.content, sha: result.sha });
    }

    // ── POST (write) ──────────────────────────────────────────────
    if (req.method === 'POST') {
      let sha = params.sha || null;
      // If no sha provided, fetch it first (handles first-time creates gracefully)
      if (!sha) {
        const existing = await ghRead(path);
        sha = existing ? existing.sha : null;
      }
      const author  = jwt.user ? jwt.user.name || jwt.user.email : 'dashboard';
      const message = `[dashboard] ${author}: update ${mp}/${section}`;
      const newSha  = await ghWrite(path, params.data, sha, message);
      return res.status(200).json({ ok: true, sha: newSha });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('[data]', req.method, section, e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

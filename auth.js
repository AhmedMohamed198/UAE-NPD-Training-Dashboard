// api/auth.js — JWT auth backed by data/users.json in GitHub
// POST /api/auth  body: { action:'login', email, password }
// GET  /api/auth  query: { action:'me' }   header: Authorization: Bearer <token>

const crypto = require('crypto');

const JWT_SECRET  = process.env.JWT_SECRET;
const GH_TOKEN    = process.env.NPD_GH_TOKEN;
const GH_REPO     = process.env.GITHUB_REPO    || 'ahmedmohamed198/uae-npd-training-dashboard';
const GH_BRANCH   = process.env.GITHUB_BRANCH  || 'main';

// ── GitHub helper ────────────────────────────────────────────────
async function ghRead(path) {
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`,
    { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'npd-dashboard' } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const file = await r.json();
  return { content: JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8')), sha: file.sha };
}

// ── Users write helper (admin user management) ───────────────────
async function ghWriteUsers(users, sha, message) {
  const body = {
    message: message || '[dashboard] users update',
    content: Buffer.from(JSON.stringify(users, null, 2)).toString('base64'),
    branch: GH_BRANCH
  };
  if (sha) body.sha = sha;
  const wr = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/data/users.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'npd-dashboard', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!wr.ok) { const t = await wr.text(); throw new Error('Write failed ' + wr.status + ': ' + t.slice(0, 150)); }
}

// ── JWT helpers ──────────────────────────────────────────────────
function b64u(str) { return Buffer.from(str).toString('base64url'); }

// Returns the JWT payload if the caller is an Admin or Super Admin, else null.
function adminFromReq(req) {
  const jwt = jwtVerify(getToken(req));
  if (!jwt || !jwt.user) return null;
  const role = String(jwt.user.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'super admin') return null;
  return jwt;
}

function jwtSign(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET env var not set');
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const b = b64u(JSON.stringify(payload));
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}

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

function hashPw(pw) {
  return crypto.createHash('sha256').update(pw + ':npd-salt').digest('hex');
}

function getToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

// ── Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const action = params.action || 'me';

  try {
    // ── me: validate existing token ──────────────────────────────
    if (action === 'me') {
      const payload = jwtVerify(getToken(req));
      if (!payload) return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
      return res.status(200).json({ ok: true, user: payload.user });
    }

    // ── login ────────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = params;
      if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password required' });

      const result = await ghRead('data/users.json');
      if (!result) {
        console.error('[auth] login: users.json not found. TOKEN_SET:', !!GH_TOKEN, 'REPO:', GH_REPO);
        return res.status(500).json({ ok: false, error: 'User database not found. Contact admin.' });
      }
      const users = result.content;

      const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user || user.password !== hashPw(password)) {
        return res.status(401).json({ ok: false, error: 'Incorrect email or password' });
      }

      const payload = {
        user: { email: user.email, name: user.name || user.email, role: user.role || 'Viewer', mp_access: user.mp_access || '' },
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000
      };
      const token = jwtSign(payload);
      return res.status(200).json({ ok: true, token, user: payload.user });
    }

    // ── changePassword ───────────────────────────────────────────
    if (action === 'changePassword') {
      const jwt = jwtVerify(getToken(req));
      if (!jwt) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      const { email, oldPassword, newPassword } = params;
      if (!oldPassword || !newPassword) return res.status(400).json({ ok: false, error: 'Old and new password required' });
      const result = await ghRead('data/users.json');
      if (!result) return res.status(500).json({ ok: false, error: 'User database not found' });
      const users = result.content;
      const idx = users.findIndex(u => u.email.toLowerCase() === (email || '').toLowerCase());
      if (idx < 0 || users[idx].password !== hashPw(oldPassword)) {
        return res.status(401).json({ ok: false, error: 'Current password is incorrect' });
      }
      users[idx].password = hashPw(newPassword);
      const body = {
        message: '[dashboard] password update',
        content: Buffer.from(JSON.stringify(users, null, 2)).toString('base64'),
        sha: result.sha, branch: GH_BRANCH
      };
      const wr = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/data/users.json`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'npd-dashboard', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!wr.ok) throw new Error('Write failed: ' + wr.status);
      return res.status(200).json({ ok: true });
    }

    // ── listUsers (admin) ────────────────────────────────────────
    if (action === 'listUsers') {
      if (!adminFromReq(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const result = await ghRead('data/users.json');
      if (!result) return res.status(500).json({ ok: false, error: 'User database not found' });
      const safe = result.content.map(u => ({ email: u.email, name: u.name, role: u.role, mp_access: u.mp_access || '' }));
      return res.status(200).json({ ok: true, users: safe });
    }

    // ── adminAddUser (admin) ─────────────────────────────────────
    if (action === 'adminAddUser') {
      if (!adminFromReq(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { email: newEmail, name, role, password: newPw, mp_access } = params;
      if (!newEmail || !newPw) return res.status(400).json({ ok: false, error: 'Email and password required' });
      const result = await ghRead('data/users.json');
      if (!result) return res.status(500).json({ ok: false, error: 'User database not found' });
      const users = result.content;
      if (users.find(u => u.email.toLowerCase() === newEmail.toLowerCase())) {
        return res.status(409).json({ ok: false, error: 'User already exists' });
      }
      users.push({ email: newEmail.toLowerCase(), name: name || newEmail.split('@')[0], role: role || 'Viewer', password: hashPw(newPw), mp_access: mp_access || '' });
      await ghWriteUsers(users, result.sha, '[dashboard] add user ' + newEmail);
      return res.status(200).json({ ok: true });
    }

    // ── adminSetPassword (admin) ──────────────────────────────────
    if (action === 'adminSetPassword') {
      if (!adminFromReq(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { email: targetEmail, password: newPw } = params;
      if (!targetEmail || !newPw) return res.status(400).json({ ok: false, error: 'Email and password required' });
      const result = await ghRead('data/users.json');
      if (!result) return res.status(500).json({ ok: false, error: 'User database not found' });
      const users = result.content;
      const idx = users.findIndex(u => u.email.toLowerCase() === targetEmail.toLowerCase());
      if (idx < 0) return res.status(404).json({ ok: false, error: 'User not found' });
      users[idx].password = hashPw(newPw);
      await ghWriteUsers(users, result.sha, '[dashboard] reset password for ' + targetEmail);
      return res.status(200).json({ ok: true });
    }

    // ── adminUpdateUser (admin) ───────────────────────────────────
    if (action === 'adminUpdateUser') {
      if (!adminFromReq(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { email: targetEmail, name, role, mp_access } = params;
      if (!targetEmail) return res.status(400).json({ ok: false, error: 'Email required' });
      const result = await ghRead('data/users.json');
      if (!result) return res.status(500).json({ ok: false, error: 'User database not found' });
      const users = result.content;
      const idx = users.findIndex(u => u.email.toLowerCase() === targetEmail.toLowerCase());
      if (idx < 0) return res.status(404).json({ ok: false, error: 'User not found' });
      if (name !== undefined) users[idx].name = name;
      if (role !== undefined) users[idx].role = role;
      if (mp_access !== undefined) users[idx].mp_access = mp_access;
      await ghWriteUsers(users, result.sha, '[dashboard] update user ' + targetEmail);
      return res.status(200).json({ ok: true });
    }

    // ── adminDeleteUser (admin) ───────────────────────────────────
    if (action === 'adminDeleteUser') {
      if (!adminFromReq(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { email: targetEmail } = params;
      if (!targetEmail) return res.status(400).json({ ok: false, error: 'Email required' });
      const result = await ghRead('data/users.json');
      if (!result) return res.status(500).json({ ok: false, error: 'User database not found' });
      const users = result.content;
      const idx = users.findIndex(u => u.email.toLowerCase() === targetEmail.toLowerCase());
      if (idx < 0) return res.status(404).json({ ok: false, error: 'User not found' });
      users.splice(idx, 1);
      await ghWriteUsers(users, result.sha, '[dashboard] delete user ' + targetEmail);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('[auth]', action, e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

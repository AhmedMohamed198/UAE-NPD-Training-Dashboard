// api/weeklyreport.js — Automated weekly NPD report posted to Slack every Monday 8am UTC
//
// Triggered by Vercel cron (vercel.json) OR manually via POST with CRON_SECRET.
//
// Required env vars:
//   SLACK_WEEKLY_WEBHOOK  — Incoming Webhook URL
//   NPD_GH_TOKEN          — GitHub token to read data files
//   CRON_SECRET           — Random secret to prevent public abuse
//   GITHUB_REPO           — e.g. ahmedmohamed198/uae-npd-training-dashboard
//   GITHUB_BRANCH         — default: main

const GH_TOKEN  = process.env.NPD_GH_TOKEN;
const GH_REPO   = process.env.GITHUB_REPO   || 'ahmedmohamed198/uae-npd-training-dashboard';
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';
const WEBHOOK   = process.env.SLACK_WEEKLY_WEBHOOK;
const CRON_SEC  = process.env.CRON_SECRET;

const MARKETS = ['UAE', 'KSA-Jeddah', 'KSA-Riyadh', 'Qatar', 'Bahrain', 'Kuwait'];

async function ghRead(path) {
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`,
    { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'npd-dashboard' } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} for ${path}`);
  const f = await r.json();
  return JSON.parse(Buffer.from(f.content, 'base64').toString('utf-8'));
}

function sv(v, suf) { return (v != null && v !== '') ? String(v) + (suf || '') : '—'; }
function fhsEmoji(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '';
  return n >= 70 ? ':large_green_circle:' : n >= 60 ? ':large_yellow_circle:' : ':red_circle:';
}

function mealsSummary(meals) {
  if (!meals || !meals.length) return null;
  const launched = meals.filter(m => m.status === 'Launched');
  const fhsNums  = launched.filter(m => m.fhs != null).map(m => m.fhs * 100);
  const avgFhs   = fhsNums.length ? (fhsNums.reduce((a,b) => a+b, 0) / fhsNums.length).toFixed(1) : null;
  return {
    total:       meals.length,
    launched:    launched.length,
    notLaunched: meals.filter(m => m.status === 'Not Launched').length,
    idea:        meals.filter(m => m.status === 'Idea').length,
    rework:      meals.filter(m => m.status === 'Rework').length,
    notQual:     meals.filter(m => m.status === 'Not Qualified').length,
    avgFhs
  };
}

function bhSummary(meals) {
  if (!meals || !meals.length) return null;
  return {
    total:   meals.length,
    good:    meals.filter(m => /good/i.test(m.rating || '')).length,
    poor:    meals.filter(m => /poor|bad/i.test(m.rating || '')).length,
    pending: meals.filter(m => !m.rating || /pending|tbd/i.test(m.rating || '')).length
  };
}

function fixesSummary(fixes) {
  if (!fixes || !fixes.length) return null;
  const pend  = fixes.filter(f => f.status && !/done/i.test(f.status));
  return {
    total:   fixes.length,
    pending: pend.length,
    done:    fixes.length - pend.length,
    hiPri:   pend.filter(f => /high|critical/i.test(f.priority || '')).length
  };
}

function ingsSummary(ings) {
  if (!ings || !ings.length) return null;
  return {
    total:    ings.length,
    pending:  ings.filter(i => /pending/i.test(i.status || '')).length,
    approved: ings.filter(i => /approv/i.test(i.status || '')).length,
    rejected: ings.filter(i => /reject/i.test(i.status || '')).length
  };
}

function qualSummary(totals) {
  if (!totals) return null;
  return { pending: totals.pending || 0, inProgress: totals.inProgress || 0, done: totals.done || 0 };
}

async function fetchMarket(mp) {
  const folder = `data/${mp}`;
  const [mealsData, bhData, fixesData, ingData, qualData] = await Promise.all([
    ghRead(`${folder}/meals.json`).catch(() => null),
    ghRead(`${folder}/bh.json`).catch(() => null),
    ghRead(`${folder}/fixes.json`).catch(() => null),
    ghRead(`${folder}/ingredients.json`).catch(() => null),
    ghRead(`${folder}/quality.json`).catch(() => null)
  ]);

  const meals = (mealsData && mealsData.dashboard && mealsData.dashboard.meals) || [];
  const bhMeals = bhData
    ? (bhData.meals || (bhData.bh && bhData.bh.meals) || [])
    : [];
  const fixes = (fixesData && fixesData.fixes) || [];
  const ings  = ingData
    ? (Array.isArray(ingData.ingredients) ? ingData.ingredients
       : (ingData.ingredients && ingData.ingredients.items) || [])
    : [];
  const qualTotals = qualData
    ? (qualData.totals || (qualData.quality && qualData.quality.totals) || null)
    : null;

  return { mp, meals, bhMeals, fixes, ings, qualTotals };
}

function buildBlocks(markets, dateStr) {
  const blocks = [];

  blocks.push({ type: 'header', text: { type: 'plain_text', text: 'NPD Weekly Report  |  ' + dateStr, emoji: false } });

  for (const m of markets) {
    if (!m.meals.length && !m.bhMeals.length && !m.fixes.length && !m.ings.length && !m.qualTotals) continue;

    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ':globe_with_meridians: *' + m.mp + '*' } });

    // Meals
    const ms = mealsSummary(m.meals);
    if (ms) blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: ':fork_and_knife: *Meals*   Total: *' + ms.total + '*   |   Launched: *' + ms.launched + '*   |   ' + fhsEmoji(ms.avgFhs) + ' Avg FHS: *' + sv(ms.avgFhs, '%') + '*   |   Rework: *' + ms.rework + '*   |   Idea: *' + ms.idea + '*   |   Not Launched: *' + ms.notLaunched + '*' } });

    // BH Tastings
    const bh = bhSummary(m.bhMeals);
    if (bh) blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: ':test_tube: *BH Tastings*   Total: *' + bh.total + '*   |   :thumbsup: Good: *' + bh.good + '*   |   :thumbsdown: Poor/Bad: *' + bh.poor + '*   |   :hourglass: Pending: *' + bh.pending + '*' } });

    // Fixes
    const fx = fixesSummary(m.fixes);
    if (fx) {
      const hiA = fx.hiPri > 0 ? '   :rotating_light: *' + fx.hiPri + ' high priority*' : '';
      blocks.push({ type: 'section', text: { type: 'mrkdwn',
        text: ':wrench: *Fixes*   Total: *' + fx.total + '*   |   Pending: *' + fx.pending + '*   |   Done: *' + fx.done + '*' + hiA } });
    }

    // Ingredients
    const ig = ingsSummary(m.ings);
    if (ig) blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: ':herb: *Ingredients*   Total: *' + ig.total + '*   |   Pending: *' + ig.pending + '*   |   Approved: *' + ig.approved + '*   |   Rejected: *' + ig.rejected + '*' } });

    // Quality
    const ql = qualSummary(m.qualTotals);
    if (ql) blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: ':mag: *Quality*   :red_circle: Pending: *' + ql.pending + '*   |   :large_yellow_circle: In Progress: *' + ql.inProgress + '*   |   :large_green_circle: Done: *' + ql.done + '*' } });
  }

  blocks.push({ type: 'divider' });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'NPD Training Dashboard  |  Auto-generated every Monday at 8:00 AM UTC  |  ' + dateStr }] });

  return blocks;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const isCron     = req.headers['x-vercel-cron'] === '1';
  const hasSecret  = CRON_SEC && authHeader === `Bearer ${CRON_SEC}`;

  if (!isCron && !hasSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized. Provide Authorization: Bearer <CRON_SECRET>' });
  }

  if (!WEBHOOK) {
    return res.status(500).json({ ok: false, error: 'SLACK_WEEKLY_WEBHOOK env var not set' });
  }

  try {
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    // Fetch all markets in parallel
    const markets = await Promise.all(MARKETS.map(mp => fetchMarket(mp)));

    const blocks  = buildBlocks(markets, dateStr);

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    let r;
    try {
      r = await fetch(WEBHOOK, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ blocks }),
        signal:  ctrl.signal
      });
    } finally { clearTimeout(tid); }

    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ ok: false, error: `Slack ${r.status}: ${t.slice(0, 200)}` });
    }

    return res.status(200).json({ ok: true, markets: markets.length, date: dateStr });
  } catch (e) {
    console.error('[weeklyreport]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

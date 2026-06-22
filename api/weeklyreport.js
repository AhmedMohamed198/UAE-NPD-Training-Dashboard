// api/weekly-report.js — Automated weekly NPD summary posted to Slack
//
// Triggered every Monday via Vercel cron (vercel.json) OR manually via POST.
//
// Required env vars:
//   SLACK_WEEKLY_WEBHOOK  — Incoming Webhook URL from your Slack app
//   NPD_GH_TOKEN          — GitHub token to read data files
//   CRON_SECRET           — A random secret string; set in Vercel → prevents public abuse
//   GITHUB_REPO           — e.g. ahmedmohamed198/uae-npd-training-dashboard
//   GITHUB_BRANCH         — default: main

const GH_TOKEN   = process.env.NPD_GH_TOKEN;
const GH_REPO    = process.env.GITHUB_REPO   || 'ahmedmohamed198/uae-npd-training-dashboard';
const GH_BRANCH  = process.env.GITHUB_BRANCH || 'main';
const WEBHOOK    = process.env.SLACK_WEEKLY_WEBHOOK;
const CRON_SEC   = process.env.CRON_SECRET;

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

function avg(arr) {
  const nums = arr.filter(n => n !== null && !isNaN(n));
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function pct(v) { return v != null ? (v * 100).toFixed(1) + '%' : '—'; }

async function buildReport() {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const sections = [];

  for (const mp of MARKETS) {
    const folder = `data/${mp}`;
    const [mealsData, fixesData] = await Promise.all([
      ghRead(`${folder}/meals.json`).catch(() => null),
      ghRead(`${folder}/fixes.json`).catch(() => null)
    ]);

    const meals  = (mealsData  && mealsData.dashboard  && mealsData.dashboard.meals)   || [];
    const fixes  = (fixesData  && fixesData.fixes)  || [];

    if (!meals.length && !fixes.length) continue;

    // Meals summary
    const launched    = meals.filter(m => m.status === 'Launched');
    const fhsVals     = launched.map(m => m.fhs).filter(v => v !== null && v !== undefined && !isNaN(v));
    const avgFhs      = avg(fhsVals);
    const belowTarget = fhsVals.filter(v => v * 100 < 65).length;
    const newMeals    = meals.filter(m => {
      if (!m.updatedAt) return false;
      return new Date(m.updatedAt) >= weekAgo;
    });

    // Fixes summary
    const pendingFixes   = fixes.filter(f => f.status && !/done/i.test(f.status));
    const highPriFixes   = pendingFixes.filter(f => /high|critical/i.test(f.priority || ''));

    sections.push({ mp, launched: launched.length, avgFhs, belowTarget, newMeals: newMeals.length, pendingFixes: pendingFixes.length, highPriFixes: highPriFixes.length });
  }

  return sections;
}

function slackColor(avgFhs) {
  if (avgFhs === null) return '#888888';
  const v = avgFhs * 100;
  if (v >= 70) return '#38b675';
  if (v >= 60) return '#f59e0b';
  return '#ea4335';
}

function buildSlackPayload(sections, date) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'NPD Weekly Summary — ' + date, emoji: false }
    },
    { type: 'divider' }
  ];

  if (!sections.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'No market data available this week.' } });
  } else {
    sections.forEach(s => {
      const avgLabel = s.avgFhs !== null ? (s.avgFhs * 100).toFixed(1) + '%' : 'N/A';
      const verdict  = s.avgFhs !== null
        ? (s.avgFhs * 100 >= 70 ? 'Strong' : s.avgFhs * 100 >= 60 ? 'Acceptable' : 'At Risk')
        : 'No Data';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${s.mp}*  —  ${verdict}\n` +
                `Launched meals: *${s.launched}*   |   Avg FHS: *${avgLabel}*   |   Below 65%: *${s.belowTarget}*\n` +
                `Pending fixes: *${s.pendingFixes}*` + (s.highPriFixes ? `  (${s.highPriFixes} high priority)` : '') +
                (s.newMeals ? `   |   Updated this week: *${s.newMeals}*` : '')
        }
      });
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'NPD Training Dashboard  |  Auto-generated every Monday' }]
  });

  return { blocks };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow Vercel cron (no auth header) OR manual POST with CRON_SECRET
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
    const sections = await buildReport();
    const dateStr  = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const payload  = buildSlackPayload(sections, dateStr);

    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ ok: false, error: `Slack responded ${r.status}: ${t.slice(0, 200)}` });
    }

    return res.status(200).json({ ok: true, markets: sections.length, date: dateStr });
  } catch (e) {
    console.error('[weekly-report]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

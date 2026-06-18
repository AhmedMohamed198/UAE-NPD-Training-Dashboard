// api/notion.js — Vercel serverless proxy for Notion API (CORS-safe)
// Required Vercel env vars:
//   NOTION_TOKEN              — Integration secret (ntn_...)
//   NOTION_FLASH_PAGE_UAE     — Notion page ID for UAE Flash Reports
//   NOTION_MONTHLY_PAGE_UAE   — Notion page ID for UAE Monthly Review
//   NOTION_FLASH_PAGE_KSA-Riyadh  (optional)
//   NOTION_MONTHLY_PAGE_KSA-Riyadh (optional)
//   etc.

const BASE = 'https://api.notion.com/v1';
const VER  = '2022-06-28';

// ── Notion helpers ──────────────────────────────────────────────

async function nFetch(token, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': VER,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  const data = await r.json();
  if (data.object === 'error') throw new Error('Notion: ' + (data.message || data.code));
  return data;
}

async function nChildren(token, blockId) {
  let results = [], cursor = null;
  do {
    let path = '/blocks/' + blockId + '/children?page_size=100';
    if (cursor) path += '&start_cursor=' + encodeURIComponent(cursor);
    const data = await nFetch(token, path);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

function nText(richText) {
  if (!richText) return '';
  if (!Array.isArray(richText)) return String(richText.plain_text || richText.text || richText || '');
  return richText.map(t => t.plain_text || '').join('');
}

function nBlockText(block) {
  const c = block[block.type];
  if (!c) return '';
  if (block.type === 'child_page') return c.title || '';
  if (block.type === 'callout') {
    const icon = (c.icon && c.icon.emoji) ? c.icon.emoji + ' ' : '';
    return icon + (c.rich_text ? nText(c.rich_text) : '');
  }
  if (c.rich_text) return nText(c.rich_text);
  if (c.title)     return nText(c.title);
  return '';
}

// ── Table parser ────────────────────────────────────────────────

async function parseTable(token, tableBlockId) {
  const result = { headers: [], rows: [] };
  let first = true;
  const rows = await nChildren(token, tableBlockId);
  for (const row of rows) {
    if (row.type !== 'table_row') continue;
    const cells = (row.table_row.cells || []).map(cell => nText(cell));
    if (first) { result.headers = cells; first = false; }
    else        result.rows.push(cells);
  }
  return result;
}

// ── Flash Report ────────────────────────────────────────────────

async function getFlashReports(token, pageId) {
  if (!pageId) return { configured: false, weeks: [] };
  const weeks = [];
  const seenIds = {};

  const bt = b => b.type === 'child_page'
    ? ((b.child_page && b.child_page.title) || '').trim()
    : nBlockText(b).trim();

  const isC = b => b.has_children &&
    ['toggle','child_page','heading_1','heading_2','heading_3'].includes(b.type);

  const isMonth = t => /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(t);
  const isSection = t => /rated|meals|snapshot|overview|report|step|owner|perform|underperform|analysis|newly/i.test(t);

  async function addWeeksFromMonth(mb) {
    const children = (await nChildren(token, mb.id)).filter(isC);
    for (const wb of children) {
      const title = bt(wb);
      if (title && !isSection(title) && !seenIds[wb.id]) {
        seenIds[wb.id] = true;
        weeks.push({ id: wb.id, title });
      }
    }
  }

  async function addWeeksFromYear(yb) {
    const yearChildren = (await nChildren(token, yb.id)).filter(isC);
    if (!yearChildren.length) return;
    const first = bt(yearChildren[0]);
    if (isMonth(first)) {
      for (const mb of yearChildren) await addWeeksFromMonth(mb);
    } else {
      for (const wb of yearChildren) {
        const title = bt(wb);
        if (title && !isSection(title) && !seenIds[wb.id]) {
          seenIds[wb.id] = true;
          weeks.push({ id: wb.id, title });
        }
      }
    }
  }

  const topBlocks = await nChildren(token, pageId);
  const topC = topBlocks.filter(isC);
  if (!topC.length) return { configured: true, weeks: [] };

  const firstText = bt(topC[0]);
  if (/^\d{4}$/.test(firstText)) {
    for (const yb of topC) await addWeeksFromYear(yb);
  } else if (isMonth(firstText)) {
    for (const mb of topC) await addWeeksFromMonth(mb);
  } else if (!isSection(firstText)) {
    for (const wb of topC) {
      const title = bt(wb);
      if (!title) continue;
      if (/^\d{4}$/.test(title)) {
        // year container mixed in with direct week entries — drill into it
        await addWeeksFromYear(wb);
      } else if (!isSection(title) && !seenIds[wb.id]) {
        seenIds[wb.id] = true;
        weeks.push({ id: wb.id, title });
      }
    }
  }

  return { configured: true, weeks };
}

async function getFlashReportContent(token, blockId) {
  const blocks = await nChildren(token, blockId);
  const content = await parseFlashBlocks(token, blocks);
  return { ok: true, content };
}

async function parseFlashBlocks(token, blocks) {
  const out = {
    snapshotBullets: [], snapshotCallout: '',
    snapshot: null, highRated: null, lowRated: null, newMeals: null, nextSteps: null
  };
  let currentSection = null;
  let tableCount = 0;

  const detectSection = lower => {
    if (/high.?rat|top.?perform|best.?meal|top.?meal/i.test(lower))                          return 'highRated';
    if (/low.?rat|underperform|worst|poor.?meal|bottom/i.test(lower))                        return 'lowRated';
    if (/new.?meal|newly|new.?add|new.?item|new.?product|addition/i.test(lower))             return 'newMeals';
    if (/next.?step|action|owner|follow.?up|to.?do/i.test(lower))                            return 'nextSteps';
    if (/snapshot|overview|summary|highlight|metric|performance|kpi|week/i.test(lower))      return 'snapshot';
    return null;
  };

  // Detect section type from table headers when heading-based detection fails
  const detectSectionFromHeaders = headers => {
    const h = headers.map(x => x.toLowerCase()).join(' ');
    if (/rating|score|fhs|rank/.test(h) && /meal|item|name/.test(h)) {
      // Will be assigned sequentially — highRated first, then lowRated
      return null;
    }
    if (/date|added|launch|new/.test(h)) return 'newMeals';
    if (/metric|kpi|deliveri|vote/.test(h)) return 'snapshot';
    return null;
  };

  async function processBlock(block) {
    const type = block.type;
    const text = nBlockText(block);
    const lower = text.toLowerCase();

    if (['heading_1','heading_2','heading_3','toggle'].includes(type)) {
      const sec = detectSection(lower);
      if (block.has_children) {
        const saved = currentSection;
        if (sec !== null) currentSection = sec;
        try {
          const ch = await nChildren(token, block.id);
          for (const c of ch) await processBlock(c);
        } catch(e) {}
        currentSection = saved;
      } else {
        if (sec !== null) currentSection = sec;
      }
      return;
    }

    if (type === 'callout' && text) {
      out.snapshotCallout = (out.snapshotCallout ? out.snapshotCallout + '\n' : '') + text;
      return;
    }

    if (['bulleted_list_item','numbered_list_item','paragraph'].includes(type) && text) {
      if (currentSection === 'snapshot' || currentSection === null) out.snapshotBullets.push(text);
      return;
    }

    if (type === 'table') {
      const tableData = await parseTable(token, block.id);
      let sec = currentSection;

      // If no section set, try to detect from headers
      if (!sec && tableData.headers && tableData.headers.length) {
        sec = detectSectionFromHeaders(tableData.headers);
      }

      // Fallback: assign sequentially by tableCount
      if (!sec) sec = ['snapshot','highRated','lowRated','newMeals'][Math.min(tableCount, 3)];

      tableCount++;

      // If slot already filled, cascade to next available slot
      if      (sec === 'snapshot'  && !out.snapshot)  { out.snapshot  = tableData; }
      else if (sec === 'highRated' && !out.highRated)  { out.highRated = tableData; }
      else if (sec === 'lowRated'  && !out.lowRated)   { out.lowRated  = tableData; }
      else if (sec === 'newMeals'  && !out.newMeals)   { out.newMeals  = tableData; }
      else if (sec === 'nextSteps' && !out.nextSteps)  { out.nextSteps = tableData; }
      // Slot already taken — try remaining slots in order
      else if (!out.snapshot)  { out.snapshot  = tableData; }
      else if (!out.highRated) { out.highRated = tableData; }
      else if (!out.lowRated)  { out.lowRated  = tableData; }
      else if (!out.newMeals)  { out.newMeals  = tableData; }
    }
  }

  for (const b of blocks) await processBlock(b);
  return out;
}

// ── Monthly Review ──────────────────────────────────────────────

async function getMonthlyReviewMonths(token, pageId) {
  if (!pageId) return { configured: false, months: [] };

  const blockTitle = b => {
    const text = nBlockText(b);
    if (!text && b.type === 'child_page') return (b.child_page && b.child_page.title) || '';
    return text;
  };
  const isYearContainer = title => /^\s*\d{4}\s*$/.test(title);
  const isMonthContainer = b => b.has_children &&
    ['toggle','child_page','heading_1','heading_2','heading_3'].includes(b.type);

  const top = await nChildren(token, pageId);
  const months = [];
  const seen = {};

  for (const b of top) {
    const title = blockTitle(b);
    if (!title || !isMonthContainer(b)) continue;

    if (isYearContainer(title)) {
      try {
        const yearChildren = await nChildren(token, b.id);
        for (const child of yearChildren) {
          const childTitle = blockTitle(child);
          if (childTitle && isMonthContainer(child) && !seen[child.id]) {
            seen[child.id] = true;
            months.push({ id: child.id, title: childTitle + ' (' + title.trim() + ')' });
          }
        }
      } catch(e) {}
    } else {
      if (!seen[b.id]) {
        seen[b.id] = true;
        months.push({ id: b.id, title });
      }
    }
  }

  return { configured: true, months };
}

async function getMonthlyReviewContent(token, blockId) {
  const blocks = await nChildren(token, blockId);
  const data = await parseMonthlyBlocks(token, blocks);
  return { ok: true, data };
}

async function parseMonthlyBlocks(token, blocks) {
  const out = {
    summary: [], launches: [], removals: [], actions: [], tables: [], rawSections: []
  };
  let currentSection = null;
  let currentTitle   = '';

  const pushRaw = (type, text) => {
    if (!currentSection) { currentSection = { title: '', items: [] }; out.rawSections.push(currentSection); }
    currentSection.items.push({ type, text });
  };

  const sectionKey = title => {
    const t = title.toLowerCase();
    if (/launch|new meal|added|addition|new item|new product/.test(t)) return 'launches';
    if (/remov|discontinu|delist|exit|off.?menu|kill|drop/.test(t))    return 'removals';
    if (/action|task|follow.?up|owner|next step|to.?do|focus/.test(t)) return 'actions';
    if (/summary|overview|highlight|insight|executive|win|issue/.test(t)) return 'summary';
    if (/perform|rating|score|fhs|review|result|meal list|top|bottom/.test(t)) return 'tables';
    return 'other';
  };

  async function processBlock(block) {
    const type = block.type || '';
    const text = nBlockText(block) || '';

    if (['heading_1','heading_2','heading_3'].includes(type)) {
      currentTitle = text;
      currentSection = { title: text, key: sectionKey(text), items: [] };
      out.rawSections.push(currentSection);
      if (block.has_children) {
        try { const ch = await nChildren(token, block.id); for (const c of ch) await processBlock(c); } catch(e) {}
      }
      return;
    }

    if (type === 'child_page') {
      const pageTitle = (block.child_page && block.child_page.title) || text || '';
      if (pageTitle) {
        currentTitle = pageTitle;
        currentSection = { title: pageTitle, key: sectionKey(pageTitle), items: [] };
        out.rawSections.push(currentSection);
      }
      try { const ch = await nChildren(token, block.id); for (const c of ch) await processBlock(c); } catch(e) {}
      return;
    }

    if (type === 'table') {
      const tbl = await parseTable(token, block.id);
      tbl.sectionTitle = currentTitle;
      out.tables.push(tbl);
      pushRaw('table', '[table: ' + (tbl.headers.join(', ') || 'data') + ']');
      return;
    }

    if (type === 'to_do') {
      const checked = block.to_do && block.to_do.checked;
      out.actions.push({ text, done: !!checked, source: 'todo' });
      pushRaw('todo', (checked ? '✅ ' : '☐ ') + text);
      return;
    }

    if (type === 'callout') {
      const icon = (block.callout && block.callout.icon && (block.callout.icon.emoji || '💡')) || '💡';
      const isAction = /action|task|follow|owner|assign|must|urgent|critical/i.test(text);
      if (isAction) out.actions.push({ text, done: false, source: 'callout', icon });
      else          out.summary.push(icon + ' ' + text);
      pushRaw('callout', icon + ' ' + text);
      return;
    }

    if (['bulleted_list_item','numbered_list_item'].includes(type)) {
      const sKey = currentSection ? currentSection.key : 'other';
      if      (sKey === 'launches') out.launches.push(text);
      else if (sKey === 'removals') out.removals.push(text);
      else if (sKey === 'actions')  out.actions.push({ text, done: false, source: 'list' });
      else if (sKey === 'summary')  out.summary.push(text);
      pushRaw(type, text);
      if (block.has_children) {
        try { const ch = await nChildren(token, block.id); for (const c of ch) await processBlock(c); } catch(e) {}
      }
      return;
    }

    if (type === 'paragraph' && text) {
      const sKey2 = currentSection ? currentSection.key : 'summary';
      if (sKey2 === 'summary' || sKey2 === 'other' || !currentSection) out.summary.push(text);
      pushRaw('paragraph', text);
      return;
    }

    if (block.has_children && ['toggle','quote'].includes(type)) {
      if (text) {
        currentTitle = text;
        currentSection = { title: text, key: sectionKey(text), items: [] };
        out.rawSections.push(currentSection);
      }
      try { const ch = await nChildren(token, block.id); for (const c of ch) await processBlock(c); } catch(e) {}
    }
  }

  for (const b of blocks) await processBlock(b);

  out.stats = {
    launchCount:  out.launches.length,
    removalCount: out.removals.length,
    actionCount:  out.actions.filter(a => !a.done).length,
    tableCount:   out.tables.length,
    avgRating:    null,
    ratingRows:   []
  };

  for (const tbl of out.tables) {
    const hi = tbl.headers.map(h => h.toLowerCase());
    const ratingIdx = ['rating','score','fhs'].reduce((acc, k) => acc !== -1 ? acc : hi.indexOf(k), -1);
    const nameIdx   = ['meal','item','name'].reduce((acc, k)   => acc !== -1 ? acc : hi.indexOf(k), 0);
    if (ratingIdx < 0) continue;
    let total = 0, count = 0;
    tbl.rows.forEach(row => {
      const n = parseFloat(row[ratingIdx]);
      if (!isNaN(n)) { total += n; count++; }
      out.stats.ratingRows.push({ name: row[nameIdx] || '—', rating: row[ratingIdx] || '—' });
    });
    if (count > 0 && out.stats.avgRating === null) {
      out.stats.avgRating = Math.round((total / count) * 10) / 10;
    }
  }

  return out;
}

// ── Search ──────────────────────────────────────────────────────

async function searchPages(token, query) {
  const data = await nFetch(token, '/search', 'POST', {
    query,
    filter: { value: 'page', property: 'object' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' }
  });
  return (data.results || []).map(p => ({
    id: p.id,
    title: p.properties && p.properties.title
      ? nText(p.properties.title.title)
      : (p.child_page && p.child_page.title) || '(untitled)',
    url: p.url || null,
    lastEdited: p.last_edited_time || null
  }));
}

// ── Handler ─────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN = process.env.NOTION_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN env var not set' });

  const params = req.method === 'GET' ? req.query : (req.body || {});
  const action = params.action || '';
  const mp     = (params.mp || 'UAE').replace(/[^a-zA-Z0-9_\-]/g, '');
  // Normalize for Vercel env var names (no hyphens allowed): KSA-Riyadh → KSA_RIYADH
  const mpKey  = mp.replace(/[-\s]/g, '_').toUpperCase();
  const blockId = params.blockId || params.block_id || '';

  try {
    switch (action) {

      case 'search': {
        const query = params.query || 'NPD Dashboard';
        const pages = await searchPages(TOKEN, query);
        return res.status(200).json({ ok: true, pages });
      }

      case 'getFlashReports': {
        const key = 'NOTION_FLASH_PAGE_' + mpKey;
        const pageId = process.env[key];
        if (!pageId) return res.status(200).json({ configured: false, weeks: [], envKey: key });
        const result = await getFlashReports(TOKEN, pageId);
        return res.status(200).json(result);
      }

      case 'getFlashReportContent': {
        if (!blockId) return res.status(400).json({ ok: false, error: 'blockId required' });
        const result = await getFlashReportContent(TOKEN, blockId);
        return res.status(200).json(result);
      }

      case 'getMonthlyReviewMonths': {
        const key = 'NOTION_MONTHLY_PAGE_' + mpKey;
        const pageId = process.env[key];
        if (!pageId) return res.status(200).json({ configured: false, months: [], envKey: key });
        const result = await getMonthlyReviewMonths(TOKEN, pageId);
        return res.status(200).json(result);
      }

      case 'getMonthlyReviewContent': {
        if (!blockId) return res.status(400).json({ ok: false, error: 'blockId required' });
        const result = await getMonthlyReviewContent(TOKEN, blockId);
        return res.status(200).json(result);
      }

      case 'debug': {
        const key = 'NOTION_FLASH_PAGE_' + mpKey;
        const pageId = process.env[key];
        if (!pageId) return res.status(200).json({ ok: false, error: key + ' env var not set', mp });
        const top = await nChildren(TOKEN, pageId);
        const topBlocks = top.slice(0, 20).map(b => ({
          id: b.id, type: b.type, text: nBlockText(b), has_children: b.has_children
        }));
        // Also fetch children of first toggle/heading that has children (the week block)
        let weekChildren = [];
        const weekBlock = top.find(b => b.has_children && ['toggle','child_page','heading_1','heading_2'].includes(b.type));
        if (weekBlock) {
          const wc = await nChildren(TOKEN, weekBlock.id);
          weekChildren = wc.slice(0, 30).map(b => ({
            id: b.id, type: b.type, text: nBlockText(b), has_children: b.has_children
          }));
        }
        return res.status(200).json({ ok: true, pageId, mp: mpKey, topBlocks, weekChildren });
      }

      case 'getChildren': {
        if (!blockId) return res.status(400).json({ ok: false, error: 'blockId required' });
        const children = await nChildren(TOKEN, blockId);
        return res.status(200).json({ ok: true, results: children });
      }

      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
  } catch (e) {
    console.error('[notion]', action, e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

UAE Dashboard/*****************************************************************
 * UAE MP DASHBOARD — Apps Script Backend
 * Spreadsheet: UAE NPD Report&Training 2026
 *
 * Sheets used:
 *   - "UAE NPD Progress Tracker"  (meals master)
 *   - "Quality Points/<Month>"    (one sheet per month, e.g. Quality Points/April)
 *   - "Ingredients Report"        (ingredient approval tracker)
 *
 * Columns expected in UAE NPD Progress Tracker (header row = row 1):
 *   A: Analysis #     B: Meal Name      C: Cost %         D: Overall FHS
 *   E: More than 3x   F: Chef           G: Dietary Plans  H: Meal Type
 *   I: Ideation       J: Creation       K: Dashboarding   L: MP Tasting
 *   M: NPD Tasting    N: Approving      O: Status         P: Note
 *
 * Columns expected in Quality Points/<Month> (header row = row 1):
 *   A: Name           B: Photo 1        C: Photo 2        D: Comment
 *   E: Corrective Action               F: Done/Pending/In Progress/Not Done
 *   G: Notes          H: Assessment Date     I: Final Product Photo
 *
 * Columns expected in Ingredients Report (header row = row 1):
 *   A: Ingredient     B: Brand          C: Photo          D: Status
 *   E: Reason         F: Done           G: Note           H: Dead Line
 *   I: Priority       J: SC Notes
 *****************************************************************/

const TRACKER_SHEET     = 'UAE NPD Progress Tracker';
const QUALITY_PREFIX    = 'Quality Points/';
const INGREDIENTS_SHEET = 'Ingredients Report';
const WORKFLOW_COLS     = ['Ideation','Creation','Dashboarding','MP Tasting','NPD Tasting','Approving'];
const STATUS_OPTIONS    = ['Launched','Not Launched','Not Qualified','Rework','Idea'];
const QUALITY_STATUS    = ['Done','Pending','In Progress','Not Done'];
const INGREDIENT_STATUS   = ['Approved','Non Approved','Under Review','Exception'];
const INGREDIENT_PRIORITY = ['High Priority','Low Priority','Low Hanging Fruits'];
const INGREDIENT_DONE     = ['Done','Pending','In Progress','Not Done'];

/* -------------------- AUDIT CONFIG -------------------- */
const AUDIT_SUMMARY_SHEET = 'Audit Summary';
const AUDIT_DETAILS_SHEET = 'Audit Details';
const AUDIT_FOLDER_NAME   = 'UAE MP Dashboard Audits';

/* -------------------- CACHE / ACTIVITY LOG / UNDO CONFIG -------------------- */
const ACTIVITY_LOG_SHEET = 'Activity Log';
const CACHE_TTL_SECONDS  = 600;   // 10 minutes
const UNDO_TTL_SECONDS   = 60;    // 60 seconds (long enough to undo, short enough to not pollute)
const CACHE_KEYS = {
  DASHBOARD:   'cache_dashboard_v1',
  QUALITY:     'cache_quality_v1_',     // suffixed with month sheet name
  INGREDIENTS: 'cache_ingredients_v1',
  AUDITS:      'cache_audits_v1',
  META:        'cache_meta_v1'
};

/* -------------------- ACCESS CONTROL CONFIG -------------------- */
const ACCESS_SHEET   = 'Access Control';
const ALLOWED_DOMAIN = 'calo.app';      // only @calo.app emails get past the gate
const VALID_ROLES    = ['Admin','Editor','Viewer'];
// Hard-coded fallback admins — these accounts are always Admin even if the
// Access Control sheet is empty or missing. Add yourself here BEFORE deploying
// so you can never get locked out.
const SUPER_ADMINS   = ['a.mohamed@calo.app']; // ← replace with your actual @calo.app email(s)


/* -------------------- MENU & ENTRY POINTS -------------------- */

function onOpen() {
  // Make sure the Access Control sheet exists on first open. Safe to call
  // every time — it's a no-op if the sheet already exists.
  try { ensureAccessSheet_(); } catch (e) { /* ignore on first install */ }

  SpreadsheetApp.getUi()
    .createMenu('🍽️ UAE MP Dashboard')
    .addItem('📊 Open Dashboard',              'showDashboard')
    .addSeparator()
    .addItem('➕ Add Meal (sidebar)',           'showAddMealSidebar')
    .addItem('⚠️ Add Quality Issue (sidebar)',  'showAddQualitySidebar')
    .addSeparator()
    .addItem('🧹 Cleanup Stranded Meals',       'cleanupStrandedMealsFromMenu')
    .addToUi();
}

function showDashboard() {
  const user = getUserRole_();
  if (!user.allowed) {
    SpreadsheetApp.getUi().alert(
      'Access Denied',
      'Signed in as: ' + (user.email || '(unknown)') + '\n\n' + user.reason,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }
  const html = HtmlService.createTemplateFromFile('Dashboard')
    .evaluate()
    .setWidth(1500)
    .setHeight(900)
    .setTitle('UAE MP Dashboard');
  SpreadsheetApp.getUi().showModalDialog(html, 'UAE MP Dashboard');
}

function showAddMealSidebar() {
  const html = HtmlService.createTemplateFromFile('AddMealSidebar')
    .evaluate()
    .setTitle('➕ Add Meal');
  SpreadsheetApp.getUi().showSidebar(html);
}

function showAddQualitySidebar() {
  const html = HtmlService.createTemplateFromFile('AddQualitySidebar')
    .evaluate()
    .setTitle('⚠️ Add Quality Issue');
  SpreadsheetApp.getUi().showSidebar(html);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ============================================================
 * CACHE + ACTIVITY LOG + UNDO HELPERS
 * Drop-in helpers that other functions use to:
 *   - cache slow read operations (10-min TTL)
 *   - log every write to the Activity Log sheet
 *   - support 60-second undo of deletes
 * ============================================================ */

/* -------- CACHE -------- */

function _cacheGet(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    Logger.log('Cache get failed: ' + e);
    return null;
  }
}

function _cachePut(key, value) {
  try {
    // Apps Script CacheService has a 100KB per-key limit. Use chunking for big payloads.
    const json = JSON.stringify(value);
    if (json.length > 95000) {
      _cachePutChunked(key, json);
    } else {
      CacheService.getScriptCache().put(key, json, CACHE_TTL_SECONDS);
    }
  } catch (e) {
    Logger.log('Cache put failed (' + key + '): ' + e);
  }
}

function _cachePutChunked(key, json) {
  const cache = CacheService.getScriptCache();
  const CHUNK = 90000;
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK));
  const meta = { _chunks: chunks.length };
  cache.put(key, JSON.stringify(meta), CACHE_TTL_SECONDS);
  chunks.forEach((c, i) => cache.put(key + '_chunk_' + i, c, CACHE_TTL_SECONDS));
}

function _cacheGetChunked(key) {
  const cache = CacheService.getScriptCache();
  const metaRaw = cache.get(key);
  if (!metaRaw) return null;
  let meta;
  try { meta = JSON.parse(metaRaw); } catch (e) { return null; }
  if (!meta._chunks) {
    // Not chunked, return as-is
    return meta;
  }
  let json = '';
  for (let i = 0; i < meta._chunks; i++) {
    const c = cache.get(key + '_chunk_' + i);
    if (!c) return null; // missing chunk → cache miss
    json += c;
  }
  try { return JSON.parse(json); } catch (e) { return null; }
}

/**
 * Invalidates a cache key (and any chunked variants).
 */
function _cacheInvalidate(key) {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(key);
    // Best-effort cleanup of chunk keys (we don't know the count, so try up to 50)
    const removeKeys = [];
    for (let i = 0; i < 50; i++) removeKeys.push(key + '_chunk_' + i);
    cache.removeAll(removeKeys);
  } catch (e) {
    Logger.log('Cache invalidate failed: ' + e);
  }
}

/**
 * Invalidates all caches at once. Called on any write.
 */
function _cacheInvalidateAll() {
  _cacheInvalidate(CACHE_KEYS.DASHBOARD);
  _cacheInvalidate(CACHE_KEYS.INGREDIENTS);
  _cacheInvalidate(CACHE_KEYS.AUDITS);
  _cacheInvalidate(CACHE_KEYS.META);
  // Quality has per-month keys — invalidate them all
  getAllQualitySheetNames().forEach(name => {
    _cacheInvalidate(CACHE_KEYS.QUALITY + name);
  });
  _cacheInvalidate(CACHE_KEYS.QUALITY + 'ALL');
}

/**
 * Wraps an expensive read with cache. The reader is only called on cache miss.
 * Returns the value (and adds a `_cached` marker so the client knows).
 */
function _withCache(key, reader) {
  // Try chunked first (it falls through to non-chunked transparently)
  const cached = _cacheGetChunked(key);
  if (cached !== null) {
    cached._cached = true;
    return cached;
  }
  const fresh = reader();
  fresh._cached = false;
  _cachePut(key, fresh);
  return fresh;
}

/* -------- ACTIVITY LOG -------- */

function ensureActivityLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ACTIVITY_LOG_SHEET);
  if (sh) return sh;

  sh = ss.insertSheet(ACTIVITY_LOG_SHEET);
  const headers = ['Timestamp','User','Action','Entity','Item ID/Name','Details','Sheet','Row','Reverted'];
  sh.getRange(1,1,1,headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1f6e3f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 220);
  sh.setColumnWidth(3, 100);
  sh.setColumnWidth(4, 120);
  sh.setColumnWidth(5, 220);
  sh.setColumnWidth(6, 380);
  try { sh.hideSheet(); } catch (e) {}
  return sh;
}

/**
 * Logs an action to the Activity Log sheet.
 * @param {string} action  — 'add' | 'edit' | 'delete' | 'cleanup' | 'upload' | 'restore'
 * @param {string} entity  — 'meal' | 'quality' | 'ingredient' | 'audit'
 * @param {Object} data    — { name, sheet, row, details }
 */
function _logActivity(action, entity, data) {
  try {
    const sh = ensureActivityLogSheet_();
    const user = getCurrentUserEmail_() || '(unknown)';
    sh.appendRow([
      new Date(),
      user,
      action,
      entity,
      data.name || data.id || '',
      data.details || '',
      data.sheet || '',
      data.row || '',
      ''  // reverted column blank by default
    ]);
    // Keep the log to last 5000 entries to prevent runaway growth
    const lastRow = sh.getLastRow();
    if (lastRow > 5001) {
      sh.deleteRows(2, lastRow - 5001);
    }
  } catch (e) {
    Logger.log('Activity log failed: ' + e);
  }
}

/* -------- UNDO -------- */

/**
 * Stashes data needed to restore deleted items, keyed by undoToken.
 * Returns the token to send back to the client.
 */
function _stashUndo(data) {
  const token = 'undo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  try {
    CacheService.getScriptCache().put(token, JSON.stringify(data), UNDO_TTL_SECONDS);
  } catch (e) {
    Logger.log('Undo stash failed: ' + e);
    return null;
  }
  return token;
}

function _retrieveUndo(token) {
  if (!token) return null;
  try {
    const raw = CacheService.getScriptCache().get(token);
    if (!raw) return null;
    CacheService.getScriptCache().remove(token);
    return JSON.parse(raw);
  } catch (e) {
    Logger.log('Undo retrieve failed: ' + e);
    return null;
  }
}

/**
 * Public — restores a deletion using the undo token returned by a delete call.
 * Works for meals, ingredients, quality issues.
 */
function undoDelete(token) {
  requireRole_(['Admin']);
  const stash = _retrieveUndo(token);
  if (!stash) {
    return { ok:false, message:'Undo window expired (60 seconds) or invalid token.' };
  }
  try {
    if (stash.entity === 'meal') {
      const sh = getTrackerSheet_();
      stash.rows.forEach(r => {
        sh.getRange(r.row, 2, 1, 15).setValues([r.data]); // restore B..P
      });
      _logActivity('restore', 'meal', { name: stash.rows.map(r=>r.name).join(', '), details: 'Undid delete' });
    } else if (stash.entity === 'ingredient') {
      const sh = getIngredientsSheet_();
      stash.rows.forEach(r => {
        sh.getRange(r.row, 1, 1, 10).setValues([r.data]);
      });
      _logActivity('restore', 'ingredient', { name: stash.rows.map(r=>r.name).join(', '), details: 'Undid delete' });
    } else if (stash.entity === 'audit') {
      const summarySh = ensureAuditSummarySheet_();
      const detailsSh = ensureAuditDetailsSheet_();
      summarySh.appendRow(stash.summaryRow);
      stash.detailsRows.forEach(r => detailsSh.appendRow(r));
      _logActivity('restore', 'audit', { name: stash.auditId, details: 'Undid delete' });
    }
    _cacheInvalidateAll();
    return { ok:true, restored: stash.rows ? stash.rows.length : 1, entity: stash.entity };
  } catch (e) {
    return { ok:false, message:'Restore failed: ' + e.message };
  }
}



/* -------------------- ACCESS CONTROL -------------------- */

/**
 * PUBLIC SETUP FUNCTION — Run this once from the Apps Script editor to create
 * the Access Control sheet. Just select "setupAccessControl" from the function
 * dropdown at the top of the editor, then click ▶ Run.
 *
 * Safe to run multiple times — it's a no-op if the sheet already exists.
 */
function setupAccessControl() {
  const sh = ensureAccessSheet_();
  const user = getCurrentUserEmail_();
  Logger.log('Access Control sheet ready. You are signed in as: ' + user);
  // Try to show a UI confirmation if we're running from a context that has UI.
  try {
    SpreadsheetApp.getUi().alert(
      '✅ Access Control Ready',
      'The "Access Control" sheet has been created (it is hidden by default).\n\n' +
      'You are signed in as: ' + user + '\n\n' +
      'To manage users:\n' +
      'View → Hidden sheets → Access Control',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // No UI context (e.g. run from script editor only) — Logger output is enough.
  }
  return { ok:true, sheet:ACCESS_SHEET, currentUser:user };
}

/** Ensures the Access Control sheet exists with proper headers and seed admin row. */
function ensureAccessSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ACCESS_SHEET);
  if (sh) return sh;

  sh = ss.insertSheet(ACCESS_SHEET);
  sh.getRange(1,1,1,3).setValues([['Email','Role','Notes']])
    .setFontWeight('bold').setBackground('#1f6e3f').setFontColor('#ffffff');
  sh.setFrozenRows(1);

  // Seed with SUPER_ADMINS
  const seed = SUPER_ADMINS.map(e => [e, 'Admin', 'Auto-seeded super admin']);
  if (seed.length) sh.getRange(2,1,seed.length,3).setValues(seed);

  // Data validation for Role column
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(VALID_ROLES, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2,2,1000,1).setDataValidation(rule);

  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 100);
  sh.setColumnWidth(3, 320);

  // Hide the sheet from casual viewers
  try { sh.hideSheet(); } catch (e) { /* might fail if it's the only sheet */ }

  return sh;
}

/** Returns the active user's email, lowercased. */
function getCurrentUserEmail_() {
  // Session.getActiveUser() works for users in the same Workspace domain.
  // For consumer Gmail accounts in some contexts, getEffectiveUser is the fallback.
  const email = (Session.getActiveUser().getEmail() ||
                 Session.getEffectiveUser().getEmail() ||
                 '').toLowerCase().trim();
  return email;
}

/**
 * Computes the role for the current user.
 * Returns: { email, role, allowed, reason }
 *   - role:   'Admin' | 'Editor' | 'Viewer' | null
 *   - allowed: true if role is set
 *   - reason:  human-readable denial reason if not allowed
 */
function getUserRole_() {
  const email = getCurrentUserEmail_();
  if (!email) {
    return { email:'', role:null, allowed:false,
             reason:'Could not detect your Google account. Make sure you are signed in.' };
  }

  // Domain gate
  const domain = email.split('@')[1] || '';
  if (domain !== ALLOWED_DOMAIN) {
    return { email, role:null, allowed:false,
             reason:'Only @' + ALLOWED_DOMAIN + ' accounts can access this dashboard. ' +
                    'You are signed in as: ' + email };
  }

  // Super admin shortcut
  if (SUPER_ADMINS.map(s => s.toLowerCase()).indexOf(email) !== -1) {
    return { email, role:'Admin', allowed:true, reason:'' };
  }

  // Lookup in Access Control sheet
  const sh = ensureAccessSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const data = sh.getRange(2,1,lastRow - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      const rowEmail = String(data[i][0] || '').toLowerCase().trim();
      const rowRole  = String(data[i][1] || '').trim();
      if (rowEmail === email && VALID_ROLES.indexOf(rowRole) !== -1) {
        return { email, role:rowRole, allowed:true, reason:'' };
      }
    }
  }

  return { email, role:null, allowed:false,
           reason:'Your account is not authorized. Please contact an administrator to be added.' };
}

/** Public — used by the client to know who they are and what they can do. */
function getCurrentUser() {
  return getUserRole_();
}

/**
 * Permission check — call at the top of any write function.
 * @param {string[]} allowedRoles - e.g. ['Admin'] or ['Admin','Editor']
 */
function requireRole_(allowedRoles) {
  const u = getUserRole_();
  if (!u.allowed) {
    throw new Error('Access denied: ' + (u.reason || 'You are not authorized.'));
  }
  if (allowedRoles.indexOf(u.role) === -1) {
    throw new Error('Permission denied: this action requires one of [' +
                    allowedRoles.join(', ') + ']. Your role: ' + u.role);
  }
  return u;
}

/* -------------------- WEB APP ENTRY POINT -------------------- */
/**
 * Required so the dashboard works when accessed as a deployed Web App URL.
 * Gates the response on access control — returns the dashboard for authorized
 * users and an "Access Denied" page for everyone else.
 */
function doGet(e) {
  // Handle print requests: ?print=meals|quality|ingredients|audits
  var printSection = e && e.parameter && e.parameter.print;
  if (printSection) {
    return servePrintPage_(printSection);
  }

  const user = getUserRole_();
  if (!user.allowed) {
    const t = HtmlService.createTemplateFromFile('AccessDenied');
    t.email  = user.email || '(unknown)';
    t.reason = user.reason || 'Not authorized.';
    return t.evaluate()
      .setTitle('Access Denied — UAE MP Dashboard')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createTemplateFromFile('Dashboard')
    .evaluate()
    .setTitle('UAE MP Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Serves a print page. Two modes:
 *   ?print=cached  — reads HTML from cache (client-generated, filtered)
 */
function servePrintPage_(section) {
  var html = '';

  if (section === 'cached') {
    // Read client-generated print HTML from cache
    var cached = CacheService.getScriptCache().get('printHtml_' + Session.getActiveUser().getEmail());
    if (cached) {
      html = cached;
    } else {
      html = '<!DOCTYPE html><html><body><h2>Print expired</h2><p>The print data has expired. Please try again from the dashboard.</p></body></html>';
    }
  } else {
    html = '<!DOCTYPE html><html><body><h2>Unknown print section</h2></body></html>';
  }

  return HtmlService.createHtmlOutput(html)
    .setTitle('CALO — Print')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Stores client-generated print HTML in cache for 5 minutes.
 * Called from the frontend before opening the print URL.
 */
function savePrintHtml(html) {
  requireRole_(VALID_ROLES);
  var key = 'printHtml_' + Session.getActiveUser().getEmail();
  // Cache has 100KB limit per key — chunk if needed
  if (html.length > 95000) {
    // Truncate for safety — 95KB is a lot of table rows
    html = html.substring(0, 95000) + '</tbody></table><p style="color:red">Table truncated for print. Export to Excel for full data.</p></body></html>';
  }
  CacheService.getScriptCache().put(key, html, 300); // 5 min TTL
  return { ok: true };
}

/* -------------------- HELPERS -------------------- */

function getTrackerSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TRACKER_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + TRACKER_SHEET);
  return sh;
}

function getAllQualitySheetNames() {
  return SpreadsheetApp.getActive().getSheets()
    .map(s => s.getName())
    .filter(n => n.indexOf(QUALITY_PREFIX) === 0)
    .sort();
}

function ensureQualitySheet_(sheetName) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(sheetName);
  if (sh) return sh;

  // Clone structure from any existing quality sheet (preferred) or create fresh
  const existing = getAllQualitySheetNames();
  if (existing.length) {
    const template = ss.getSheetByName(existing[0]);
    sh = template.copyTo(ss).setName(sheetName);
    // Clear data rows but keep header
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    }
  } else {
    sh = ss.insertSheet(sheetName);
    sh.getRange(1,1,1,9).setValues([[
      'Name','Photo 1','Photo 2','Comment','Corrective Action',
      'Done/Pending/In progress','Notes','Assessment Date','Final Product Photo'
    ]]).setFontWeight('bold').setBackground('#1f6e3f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* -------------------- MEALS: READ + COMPUTE -------------------- */

function getDashboardData() {
  requireRole_(VALID_ROLES);
  return _withCache(CACHE_KEYS.DASHBOARD, function() {
    return _readDashboardData_();
  });
}

function _readDashboardData_() {
  const sh = getTrackerSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { meals:[], totals:emptyTotals_(), filters:filterOptions_([]) };
  }

  const range = sh.getRange(2, 1, lastRow - 1, 16);
  const values = range.getValues();

  // Read rich text links from column B (links stored via "Insert link", not =HYPERLINK)
  const richTexts = sh.getRange(2, 2, lastRow - 1, 1).getRichTextValues();

  const meals = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    if (!r[1]) continue; // skip rows with empty Meal Name

    const ideation     = !!r[8];
    const creation     = !!r[9];
    const dashboarding = !!r[10];
    const mpTasting    = !!r[11];
    const npdTasting   = !!r[12];
    const approving    = !!r[13];
    const completed = [ideation,creation,dashboarding,mpTasting,npdTasting,approving]
                        .filter(Boolean).length;

    // Extract URL from rich text link
    let link = '';
    try {
      const rt = richTexts[i][0];
      if (rt) {
        link = rt.getLinkUrl() || '';
        // If no top-level link, check individual runs
        if (!link) {
          const runs = rt.getRuns();
          for (let j = 0; j < runs.length; j++) {
            const u = runs[j].getLinkUrl();
            if (u) { link = u; break; }
          }
        }
      }
    } catch (e) { /* ignore — no link */ }

    meals.push({
      row: i + 2,
      analysis:    r[0],
      name:        String(r[1] || '').trim(),
      link:        link,
      costPct:     numOrNull_(r[2]),
      fhs:         numOrNull_(r[3]),
      moreThan3x:  String(r[4] || ''),
      chef:        String(r[5] || '').trim(),
      diet:        String(r[6] || '').trim(),
      type:        String(r[7] || '').trim(),
      ideation, creation, dashboarding, mpTasting, npdTasting, approving,
      workflowPct: Math.round((completed / WORKFLOW_COLS.length) * 100),
      status:      String(r[14] || '').trim(),
      note:        String(r[15] || '').trim()
    });
  }

  return {
    meals,
    totals:  computeTotals_(meals),
    filters: filterOptions_(meals)
  };
}

function emptyTotals_() {
  return {
    total:0, launched:0, notLaunched:0, notQualified:0, rework:0, idea:0,
    byChef:{}, byDiet:{}, byType:{}, byStatus:{},
    avgCost:0, avgFhs:0, avgWorkflow:0
  };
}

function computeTotals_(meals) {
  const t = emptyTotals_();
  t.total = meals.length;
  let costSum = 0, costN = 0, fhsSum = 0, fhsN = 0, wfSum = 0;

  meals.forEach(m => {
    // Status buckets (case-insensitive match)
    const s = (m.status || '').toLowerCase();
    if (s === 'launched')        t.launched++;
    else if (s.indexOf('not lauched') === 0 || s.indexOf('not launched') === 0) t.notLaunched++;
    else if (s.indexOf('not qualified') === 0) t.notQualified++;
    else if (s === 'rework')     t.rework++;
    else if (s === 'idea')       t.idea++;

    if (m.chef) t.byChef[m.chef]   = (t.byChef[m.chef]   || 0) + 1;
    if (m.diet) t.byDiet[m.diet]   = (t.byDiet[m.diet]   || 0) + 1;
    if (m.type) t.byType[m.type]   = (t.byType[m.type]   || 0) + 1;
    if (m.status) t.byStatus[m.status] = (t.byStatus[m.status] || 0) + 1;

    if (m.costPct !== null) { costSum += m.costPct; costN++; }
    if (m.fhs     !== null) { fhsSum  += m.fhs;     fhsN++;  }
    wfSum += m.workflowPct;
  });

  t.avgCost     = costN ? +(costSum / costN).toFixed(2) : 0;
  t.avgFhs      = fhsN  ? +(fhsSum  / fhsN ).toFixed(2) : 0;
  t.avgWorkflow = meals.length ? Math.round(wfSum / meals.length) : 0;
  return t;
}

function filterOptions_(meals) {
  const uniq = key => Array.from(new Set(meals.map(m => m[key]).filter(Boolean))).sort();
  return {
    chefs:    uniq('chef'),
    diets:    uniq('diet'),
    types:    uniq('type'),
    statuses: uniq('status')
  };
}

function numOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace('%',''));
  return isNaN(n) ? null : n;
}

/* -------------------- MEALS: ADD -------------------- */

function addMeal(payload) {
  requireRole_(['Admin','Editor']);
  const sh = getTrackerSheet_();
  const lastRow = sh.getLastRow();

  // Find the LAST row that actually has a Meal Name in column B.
  // Pre-formatted empty rows (with dropdowns / pre-numbered Analysis #s) below
  // it should NOT be considered "used" — we want to write into the first one.
  let lastMealRow   = 1;     // header row
  let lastAnalysis  = 0;
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, 2).getValues(); // cols A + B
    for (let i = data.length - 1; i >= 0; i--) {
      const name = String(data[i][1] || '').trim();
      if (name) {
        lastMealRow  = i + 2;                    // sheet row of last real meal
        lastAnalysis = Number(data[i][0]) || 0;  // its Analysis #
        break;
      }
    }
  }

  // Target row = first row after the last real meal
  const targetRow = lastMealRow + 1;

  // If the target row already has a pre-filled Analysis # in column A, keep it.
  // Otherwise auto-increment from the last real meal's number.
  const existingA = sh.getRange(targetRow, 1).getValue();
  const nextNum = (typeof existingA === 'number' && existingA > 0)
                    ? existingA
                    : lastAnalysis + 1;

  const wf = payload.workflow || {};
  const mealName = payload.name || '';
  const mealLink = String(payload.link || '').trim();

  const row = [
    nextNum,
    mealName,  // plain text — overridden below with =HYPERLINK if link provided
    payload.costPct === '' || payload.costPct === undefined ? '' : Number(payload.costPct) / 100,
    payload.fhs     === '' || payload.fhs     === undefined ? '' : Number(payload.fhs)     / 100,
    payload.moreThan3x  || '',
    payload.chef        || '',
    payload.diet        || '',
    payload.type        || '',
    !!wf.ideation,
    !!wf.creation,
    !!wf.dashboarding,
    !!wf.mpTasting,
    !!wf.npdTasting,
    !!wf.approving,
    payload.status      || '',
    payload.note        || ''
  ];

  // Write the row (with plain meal name in B for now)
  sh.getRange(targetRow, 1, 1, row.length).setValues([row]);
  sh.getRange(targetRow, 3, 1, 2).setNumberFormat('0.00%');

  // If a link was provided, replace cell B's value with a HYPERLINK formula
  // so the meal name renders as a clickable link (matches existing rows).
  if (mealLink && mealName) {
    const safeUrl   = mealLink.replace(/"/g, '""');
    const safeLabel = mealName.replace(/"/g, '""');
    sh.getRange(targetRow, 2).setFormula('=HYPERLINK("' + safeUrl + '","' + safeLabel + '")');
  }

  _logActivity('add', 'meal', {
    name: mealName, sheet: TRACKER_SHEET, row: targetRow,
    details: 'Analysis #' + nextNum + ' · ' + (payload.chef || '') + ' · ' + (payload.status || '')
  });
  _cacheInvalidate(CACHE_KEYS.DASHBOARD);
  _cacheInvalidate(CACHE_KEYS.META);

  return { ok:true, row:targetRow, analysis:nextNum };
}

/* -------------------- QUALITY: READ + COMPUTE -------------------- */

function getQualityData(monthSheetName) {
  requireRole_(VALID_ROLES);
  const cacheKey = CACHE_KEYS.QUALITY + (monthSheetName || 'ALL');
  return _withCache(cacheKey, function() {
    return _readQualityData_(monthSheetName);
  });
}

function _readQualityData_(monthSheetName) {
  const ss = SpreadsheetApp.getActive();
  const allSheets = getAllQualitySheetNames();
  const targets = monthSheetName && monthSheetName !== 'ALL'
    ? [monthSheetName]
    : allSheets;

  const issues = [];
  const monthlyCounts = {}; // sheetName => count

  targets.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const lastRow = sh.getLastRow();
    monthlyCounts[name] = 0;
    if (lastRow < 2) return;

    const data = sh.getRange(2, 1, lastRow - 1, 9).getValues();
    data.forEach((r, i) => {
      if (!r[0] && !r[3]) return; // skip empty rows
      const status = String(r[5] || '').trim();
      issues.push({
        sheet: name,
        row: i + 2,
        name:            String(r[0] || '').trim(),
        photo1:          String(r[1] || ''),
        photo2:          String(r[2] || ''),
        comment:         String(r[3] || '').trim(),
        correctiveAction:String(r[4] || '').trim(),
        status:          status,
        notes:           String(r[6] || '').trim(),
        assessmentDate:  r[7] ? formatDate_(r[7]) : '',
        finalPhoto:      String(r[8] || '')
      });
      monthlyCounts[name]++;
    });
  });

  // Counts
  const counts = { Done:0, Pending:0, 'In Progress':0, 'Not Done':0, Other:0 };
  issues.forEach(it => {
    const s = it.status.toLowerCase();
    if      (s === 'done')                                counts.Done++;
    else if (s === 'pending')                             counts.Pending++;
    else if (s === 'in progress' || s === 'in-progress')  counts['In Progress']++;
    else if (s === 'not done')                            counts['Not Done']++;
    else if (s)                                           counts.Other++;
  });

  // Most repeated comment & most affected meal
  const commentFreq = {};
  const mealFreq    = {};
  issues.forEach(it => {
    if (it.comment) commentFreq[it.comment] = (commentFreq[it.comment] || 0) + 1;
    if (it.name)    mealFreq[it.name]       = (mealFreq[it.name]       || 0) + 1;
  });

  const topKey = obj => {
    let bestK = '', bestV = 0;
    Object.keys(obj).forEach(k => { if (obj[k] > bestV) { bestV = obj[k]; bestK = k; } });
    return { key:bestK, count:bestV };
  };

  // Most issues by month
  let topMonth = { key:'', count:0 };
  Object.keys(monthlyCounts).forEach(k => {
    if (monthlyCounts[k] > topMonth.count) topMonth = { key:k, count:monthlyCounts[k] };
  });

  return {
    issues,
    counts,
    monthlyCounts,
    sheets: allSheets,
    mostRepeatedIssue: topKey(commentFreq),
    mostAffectedMeal:  topKey(mealFreq),
    mostIssuesMonth:   topMonth,
    total: issues.length
  };
}

function formatDate_(d) {
  if (Object.prototype.toString.call(d) === '[object Date]') {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(d);
}

/* -------------------- QUALITY: ADD -------------------- */

/* -------------------- PHOTO UPLOAD HELPERS -------------------- */

const PHOTO_FOLDER_NAME = 'UAE MP Dashboard Photos';

/**
 * Ensures a Drive folder exists for storing dashboard photos.
 * Returns the folder ID. The folder is set so anyone with the link can view,
 * which is required for Sheets =IMAGE() formulas to render the image.
 */
function ensurePhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('PHOTO_FOLDER_ID');

  // Verify existing folder still exists
  if (folderId) {
    try {
      const f = DriveApp.getFolderById(folderId);
      if (f && !f.isTrashed()) return folderId;
    } catch (e) {
      // Folder was deleted or is inaccessible — fall through and create a new one
    }
  }

  // Try to find an existing folder by name first
  const iter = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  let folder;
  if (iter.hasNext()) {
    folder = iter.next();
  } else {
    folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  }
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  folderId = folder.getId();
  props.setProperty('PHOTO_FOLDER_ID', folderId);
  return folderId;
}

/**
 * Uploads a base64-encoded image to the photo folder and returns a URL
 * suitable for use in an =IMAGE() formula.
 *
 * @param {Object} fileObj { name, type, data }
 *   - name: original filename (e.g. "photo.jpg")
 *   - type: MIME type (e.g. "image/jpeg")
 *   - data: base64-encoded file content (no data: prefix)
 * @return {string} a public URL the cell can render via =IMAGE()
 */
function uploadPhotoToDrive_(fileObj) {
  if (!fileObj || !fileObj.data) return '';
  const folderId = ensurePhotoFolder_();
  const folder = DriveApp.getFolderById(folderId);

  const decoded = Utilities.base64Decode(fileObj.data);
  const blob = Utilities.newBlob(decoded, fileObj.type || 'image/jpeg',
                                 fileObj.name || ('photo_' + Date.now() + '.jpg'));
  const file = folder.createFile(blob);
  // Anyone with the link can view (required for IMAGE() to fetch)
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // The googleusercontent thumbnail URL is what =IMAGE() can reliably render
  return 'https://drive.google.com/uc?export=view&id=' + file.getId();
}

/**
 * Resolves a photo input into a URL suitable for the cell. Accepts either:
 *   - { url: "https://..." }              → just returns the URL
 *   - { upload: { name, type, data } }    → uploads, returns Drive URL
 *   - falsy                                → returns ''
 */
function resolvePhoto_(photoInput) {
  if (!photoInput) return '';
  if (typeof photoInput === 'string') return photoInput;
  if (photoInput.url) return photoInput.url;
  if (photoInput.upload && photoInput.upload.data) {
    return uploadPhotoToDrive_(photoInput.upload);
  }
  return '';
}

/**
 * Builds an =IMAGE(url) formula that fits the image inside the cell while
 * preserving aspect ratio. mode 1 = resize to fit cell (matches "in cell" UX).
 */
function imageFormula_(url) {
  if (!url) return '';
  // Escape any double quotes in the URL
  const safe = String(url).replace(/"/g, '""');
  return '=IMAGE("' + safe + '", 1)';
}

/* -------------------- QUALITY: ADD -------------------- */

function addQualityIssue(payload) {
  requireRole_(['Admin','Editor']);
  const sheetName = payload.sheet && payload.sheet.indexOf(QUALITY_PREFIX) === 0
    ? payload.sheet
    : QUALITY_PREFIX + (payload.sheet || 'New');
  const sh = ensureQualitySheet_(sheetName);

  const dateVal = payload.assessmentDate
    ? new Date(payload.assessmentDate)
    : new Date();

  // Resolve the three photo inputs (URL or upload) into URLs
  const photo1Url    = resolvePhoto_(payload.photo1);
  const photo2Url    = resolvePhoto_(payload.photo2);
  const finalPhotoUrl = resolvePhoto_(payload.finalPhoto);

  // Find first row in the data block where Name (col A) is empty so we land in
  // a pre-formatted slot (matches the addMeal/addIngredient pattern).
  const lastRow = sh.getLastRow();
  let lastFilledRow = 1;
  if (lastRow >= 2) {
    const colA = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = colA.length - 1; i >= 0; i--) {
      if (String(colA[i][0] || '').trim()) { lastFilledRow = i + 2; break; }
    }
  }
  const targetRow = lastFilledRow + 1;

  const NUM_COLS = 9;
  // Write everything in one batch using setValues; image cells get formulas via setFormula after.
  const row = [
    payload.name             || '',
    '',  // photo1 — formula set below
    '',  // photo2 — formula set below
    payload.comment          || '',
    payload.correctiveAction || '',
    payload.status           || '',
    payload.notes            || '',
    dateVal,
    ''   // finalPhoto — formula set below
  ];
  sh.getRange(targetRow, 1, 1, NUM_COLS).setValues([row]);

  // Now drop in IMAGE() formulas for the photo cells (only if a URL was provided)
  if (photo1Url)     sh.getRange(targetRow, 2).setFormula(imageFormula_(photo1Url));
  if (photo2Url)     sh.getRange(targetRow, 3).setFormula(imageFormula_(photo2Url));
  if (finalPhotoUrl) sh.getRange(targetRow, 9).setFormula(imageFormula_(finalPhotoUrl));

  sh.getRange(targetRow, 8).setNumberFormat('M/d/yyyy');

  // Make sure the row is tall enough to actually show the photos
  try { sh.setRowHeight(targetRow, 200); } catch (e) { /* ignore */ }

  _logActivity('add', 'quality', {
    name: payload.name, sheet: sheetName, row: targetRow,
    details: (payload.status || '') + ' · ' + (payload.comment || '').slice(0, 60)
  });
  _cacheInvalidate(CACHE_KEYS.QUALITY + sheetName);
  _cacheInvalidate(CACHE_KEYS.QUALITY + 'ALL');
  _cacheInvalidate(CACHE_KEYS.META);

  return { ok:true, sheet:sheetName, row:targetRow };
}

function createNewMonthSheet(monthLabel) {
  requireRole_(['Admin','Editor']);
  const name = monthLabel.indexOf(QUALITY_PREFIX) === 0
    ? monthLabel
    : QUALITY_PREFIX + monthLabel;
  ensureQualitySheet_(name);
  return { ok:true, sheet:name, sheets:getAllQualitySheetNames() };
}

/* -------------------- META FOR SIDEBAR DROPDOWNS -------------------- */

function getFormMetadata() {
  requireRole_(VALID_ROLES);
  const data = getDashboardData();
  return {
    chefs:    data.filters.chefs.length    ? data.filters.chefs    : ['Lokesh','Mukesh','Ahmed Mohamed','Som Dutt','Jaspal','Pankaj'],
    diets:    data.filters.diets.length    ? data.filters.diets    : ["Chef's Pick",'Balanced','High Protein','Low Carb'],
    types:    data.filters.types.length    ? data.filters.types    : ['Lunch/Dinner','Breakfast','Snacks'],
    statuses: STATUS_OPTIONS,
    qualityStatuses: QUALITY_STATUS,
    qualitySheets:   getAllQualitySheetNames()
  };
}

/* -------------------- CLEANUP: STRANDED MEALS -------------------- */
/**
 * Finds meals that were accidentally added far below the data block (because
 * sh.appendRow jumped past pre-formatted empty rows) and moves them up to fill
 * the first available empty rows. Preserves the pre-filled Analysis # in column
 * A of the destination row when present.
 *
 * Returns: { ok, moved, message, details: [{ name, from, to, analysis }, ...] }
 */
function cleanupStrandedMeals() {
  requireRole_(['Admin']);
  const sh = getTrackerSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok:true, moved:0, message:'Sheet is empty.', details:[] };

  const NUM_COLS = 16; // A..P
  const data = sh.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();

  // Find the first row in the data block where Meal Name (col B) is empty.
  let firstEmptyRow = -1;
  for (let i = 0; i < data.length; i++) {
    if (!String(data[i][1] || '').trim()) {
      firstEmptyRow = i + 2;  // sheet row number
      break;
    }
  }
  if (firstEmptyRow === -1) {
    return { ok:true, moved:0, message:'No empty rows found — nothing to compact.', details:[] };
  }

  // Collect every "stranded" meal: filled Meal Name rows that sit at or below firstEmptyRow.
  const stranded = [];
  for (let i = firstEmptyRow - 2; i < data.length; i++) {
    if (String(data[i][1] || '').trim()) {
      stranded.push({ fromRow: i + 2, rowData: data[i].slice() });
    }
  }
  if (!stranded.length) {
    return { ok:true, moved:0, message:'No stranded meals found.', details:[] };
  }

  const moved = [];
  let writeRow = firstEmptyRow;

  stranded.forEach(meal => {
    // Skip ahead past any rows that already have a Meal Name (in case multiple stranded rows are interleaved).
    while (writeRow < meal.fromRow &&
           String(sh.getRange(writeRow, 2).getValue() || '').trim() !== '') {
      writeRow++;
    }
    if (writeRow >= meal.fromRow) return; // already in place or below — skip

    // Preserve a pre-filled Analysis # at the destination if present.
    const existingA = sh.getRange(writeRow, 1).getValue();
    const newRow = meal.rowData.slice();
    if (typeof existingA === 'number' && existingA > 0) {
      newRow[0] = existingA;
    }

    sh.getRange(writeRow, 1, 1, NUM_COLS).setValues([newRow]);
    sh.getRange(writeRow, 3, 1, 2).setNumberFormat('0.00%');
    sh.getRange(meal.fromRow, 1, 1, NUM_COLS).clearContent();

    moved.push({
      name:     newRow[1],
      from:     meal.fromRow,
      to:       writeRow,
      analysis: newRow[0]
    });
    writeRow++;
  });

  if (moved.length) {
    _logActivity('cleanup', 'meal', {
      name: moved.map(m => m.name).join(', '),
      sheet: TRACKER_SHEET,
      details: 'Moved ' + moved.length + ' stranded meal(s) up'
    });
    _cacheInvalidate(CACHE_KEYS.DASHBOARD);
    _cacheInvalidate(CACHE_KEYS.META);
  }

  return {
    ok: true,
    moved: moved.length,
    message: 'Moved ' + moved.length + ' meal(s) up.',
    details: moved
  };
}

/** Menu wrapper with confirmation + result alert. */
function cleanupStrandedMealsFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert(
    '🧹 Cleanup Stranded Meals',
    'This will find any meals that were added far below your data ' +
    '(because of empty pre-formatted rows in between) and move them ' +
    'up into the first available empty rows.\n\n' +
    'Pre-filled Analysis numbers in the destination rows will be preserved.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );
  if (ok !== ui.Button.YES) return;

  const result = cleanupStrandedMeals();
  let msg = result.message;
  if (result.details && result.details.length) {
    msg += '\n\n' + result.details
      .map(d => '• "' + d.name + '"  row ' + d.from + ' → row ' + d.to + '  (Analysis #' + d.analysis + ')')
      .join('\n');
  }
  ui.alert('Cleanup Complete', msg, ui.ButtonSet.OK);
}

/* -------------------- DELETE MEALS -------------------- */
/**
 * Clears meal data (columns B..P) for the given sheet row numbers.
 * The pre-formatted Analysis # in column A and the row's data validation /
 * formatting are preserved so the empty slot stays usable for future meals.
 *
 * @param {number[]} rowNumbers - 1-indexed sheet row numbers (e.g. [12, 47, 88])
 * Returns: { ok, deleted, rows: [...] }
 */
function deleteMeals(rowNumbers) {
  requireRole_(['Admin']);
  if (!rowNumbers || !rowNumbers.length) {
    return { ok:false, deleted:0, message:'No rows specified.' };
  }
  const sh = getTrackerSheet_();
  const lastRow = sh.getLastRow();
  const valid = rowNumbers
    .map(r => Number(r))
    .filter(r => Number.isInteger(r) && r >= 2 && r <= lastRow);

  if (!valid.length) {
    return { ok:false, deleted:0, message:'No valid rows to delete.' };
  }

  // Snapshot existing data BEFORE clearing, so we can restore via undo
  const snapshot = valid.map(r => ({
    row: r,
    name: String(sh.getRange(r, 2).getValue() || ''),
    data: sh.getRange(r, 2, 1, 15).getValues()[0]
  }));

  // Clear columns B..P (Meal Name through Note). Column A (Analysis #) stays.
  valid.forEach(r => {
    sh.getRange(r, 2, 1, 15).clearContent();
  });

  const undoToken = _stashUndo({ entity:'meal', rows:snapshot });
  _logActivity('delete', 'meal', {
    name: snapshot.map(s => s.name).join(', '),
    sheet: TRACKER_SHEET,
    row: valid.join(','),
    details: 'Deleted ' + valid.length + ' meal(s)'
  });
  _cacheInvalidate(CACHE_KEYS.DASHBOARD);
  _cacheInvalidate(CACHE_KEYS.META);

  return { ok:true, deleted:valid.length, rows:valid, undoToken: undoToken };
}

/* -------------------- DUPLICATE DETECTION & CLEANUP -------------------- */

/**
 * Scans the tracker sheet and finds rows with duplicate Meal Names.
 * Returns: { ok, totalDuplicates, groups: [{ name, rows:[{row, analysis, status, chef}], keepRow, deleteRows }] }
 *
 * The "keepRow" is the FIRST occurrence (by row number); all later rows are flagged as duplicates.
 * This way the original entry stays put and only the re-added copies get cleared.
 */
function findDuplicateMeals() {
  requireRole_(['Admin']);
  const sh = getTrackerSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok:true, totalDuplicates:0, groups:[] };

  const data = sh.getRange(2, 1, lastRow - 1, 16).getValues();
  const seen = {};  // normalized name -> [{ row, analysis, status, chef, original }]

  data.forEach((r, i) => {
    const rawName = String(r[1] || '').trim();
    if (!rawName) return;
    const key = rawName.toLowerCase();
    if (!seen[key]) seen[key] = [];
    seen[key].push({
      row:      i + 2,
      analysis: r[0],
      original: rawName,
      chef:     String(r[5] || ''),
      status:   String(r[14] || '')
    });
  });

  const groups = [];
  let totalDup = 0;
  Object.keys(seen).forEach(k => {
    const occ = seen[k];
    if (occ.length > 1) {
      occ.sort((a,b) => a.row - b.row);
      const keepRow = occ[0].row;
      const deleteRows = occ.slice(1).map(o => o.row);
      totalDup += deleteRows.length;
      groups.push({
        name:        occ[0].original,
        rows:        occ,
        keepRow:     keepRow,
        deleteRows:  deleteRows
      });
    }
  });

  return { ok:true, totalDuplicates:totalDup, groups:groups };
}

/**
 * Removes duplicate meals by clearing the later occurrences (keeping the first).
 * Same clear-content behavior as deleteMeals — preserves Analysis # in column A
 * and the row's dropdowns / formatting.
 */
function removeDuplicateMeals() {
  requireRole_(['Admin']);
  const result = findDuplicateMeals();
  if (!result.totalDuplicates) {
    return { ok:true, deleted:0, message:'No duplicate meals found.' };
  }

  const sh = getTrackerSheet_();
  const allRowsToClear = [];
  result.groups.forEach(g => g.deleteRows.forEach(r => allRowsToClear.push(r)));

  allRowsToClear.forEach(r => {
    sh.getRange(r, 2, 1, 15).clearContent();
  });

  _logActivity('cleanup', 'meal', {
    name: result.groups.map(g => g.name).join(', '),
    sheet: TRACKER_SHEET,
    details: 'Removed ' + allRowsToClear.length + ' duplicate(s)'
  });
  _cacheInvalidate(CACHE_KEYS.DASHBOARD);
  _cacheInvalidate(CACHE_KEYS.META);

  return {
    ok: true,
    deleted: allRowsToClear.length,
    message: 'Removed ' + allRowsToClear.length + ' duplicate row(s) across ' +
             result.groups.length + ' meal name(s). The first occurrence of each was kept.',
    details: result.groups.map(g => ({
      name:    g.name,
      kept:    g.keepRow,
      removed: g.deleteRows
    }))
  };
}

/* -------------------- INGREDIENTS: HELPERS -------------------- */

function getIngredientsSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(INGREDIENTS_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + INGREDIENTS_SHEET);
  return sh;
}

/* -------------------- INGREDIENTS: READ + COMPUTE -------------------- */

function getIngredientsData() {
  requireRole_(VALID_ROLES);
  return _withCache(CACHE_KEYS.INGREDIENTS, function() {
    return _readIngredientsData_();
  });
}

function _readIngredientsData_() {
  const sh = getIngredientsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { items:[], totals:emptyIngTotals_(), filters:emptyIngFilters_() };

  const NUM_COLS = 10;
  const values = sh.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
  const items = values
    .map((r, i) => {
      const name = String(r[0] || '').trim();
      if (!name) return null;
      return {
        row:       i + 2,
        name:      name,
        brand:     String(r[1] || '').trim(),
        photo:     String(r[2] || '').trim(),
        status:    String(r[3] || '').trim(),
        reason:    String(r[4] || '').trim(),
        done:      String(r[5] || '').trim(),
        note:      String(r[6] || '').trim(),
        deadline:  r[7] ? formatDate_(r[7]) : '',
        priority:  String(r[8] || '').trim(),
        scNotes:   String(r[9] || '').trim()
      };
    })
    .filter(Boolean);

  return {
    items,
    totals:  computeIngTotals_(items),
    filters: ingFilters_(items)
  };
}

function emptyIngTotals_() {
  return {
    total:0,
    approved:0, nonApproved:0, underReview:0, exception:0,
    notApprovedTotal:0, // Non Approved + Under Review + Exception
    done:0, pending:0, inProgress:0, notDone:0,
    high:0, low:0, lowHanging:0,
    byStatus:{}, byPriority:{}, byDone:{}, byBrand:{}
  };
}

function emptyIngFilters_() {
  return { brands:[], statuses:INGREDIENT_STATUS.slice(),
           priorities:INGREDIENT_PRIORITY.slice(), dones:INGREDIENT_DONE.slice() };
}

function computeIngTotals_(items) {
  const t = emptyIngTotals_();
  t.total = items.length;

  // Sample first 5 raw status/done/priority values to logs (helps diagnose mismatches)
  const sample = items.slice(0, 5).map(it => ({
    name: it.name, status: JSON.stringify(it.status),
    done: JSON.stringify(it.done), priority: JSON.stringify(it.priority)
  }));
  Logger.log('Ingredient sample (first 5): ' + JSON.stringify(sample));

  items.forEach(it => {
    // Normalize: lowercase + collapse internal whitespace + trim
    const s = String(it.status   || '').toLowerCase().replace(/\s+/g,' ').trim();
    const p = String(it.priority || '').toLowerCase().replace(/\s+/g,' ').trim();
    const d = String(it.done     || '').toLowerCase().replace(/\s+/g,' ').trim();

    // Status buckets
    if      (s === 'approved')      t.approved++;
    else if (s === 'non approved' || s === 'not approved') t.nonApproved++;
    else if (s === 'under review')  t.underReview++;
    else if (s === 'exception')     t.exception++;

    // Done buckets — accept several variants
    if      (d === 'done' || d === 'completed' || d === 'complete') t.done++;
    else if (d === 'pending')                                       t.pending++;
    else if (d === 'in progress' || d === 'in-progress' || d === 'inprogress') t.inProgress++;
    else if (d === 'not done' || d === 'notdone')                   t.notDone++;

    // Priority buckets
    if      (p === 'high priority' || p === 'high')         t.high++;
    else if (p === 'low priority'  || p === 'low')          t.low++;
    else if (p === 'low hanging fruits' || p === 'low hanging fruit') t.lowHanging++;

    if (it.status)   t.byStatus[it.status]     = (t.byStatus[it.status]     || 0) + 1;
    if (it.priority) t.byPriority[it.priority] = (t.byPriority[it.priority] || 0) + 1;
    if (it.done)     t.byDone[it.done]         = (t.byDone[it.done]         || 0) + 1;
    if (it.brand)    t.byBrand[it.brand]       = (t.byBrand[it.brand]       || 0) + 1;
  });

  // "Non-Approved" KPI card now counts ONLY ingredients with status = "Non Approved"
  // (not Under Review, not Exception). Those have their own dedicated cards.
  t.notApprovedTotal = t.nonApproved;
  return t;
}

function ingFilters_(items) {
  const uniq = key => Array.from(new Set(items.map(it => it[key]).filter(Boolean))).sort();
  return {
    brands:     uniq('brand'),
    statuses:   INGREDIENT_STATUS.slice(),
    priorities: INGREDIENT_PRIORITY.slice(),
    dones:      INGREDIENT_DONE.slice()
  };
}

/* -------------------- INGREDIENTS: ADD -------------------- */

function addIngredient(payload) {
  requireRole_(['Admin','Editor']);
  const sh = getIngredientsSheet_();
  const lastRow = sh.getLastRow();
  const NUM_COLS = 10;

  // Find first row where Ingredient (col A) is empty, after the last filled
  // ingredient. Same approach as addMeal — skips pre-formatted empty rows.
  let lastFilledRow = 1; // header
  if (lastRow >= 2) {
    const colA = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = colA.length - 1; i >= 0; i--) {
      if (String(colA[i][0] || '').trim()) { lastFilledRow = i + 2; break; }
    }
  }
  const targetRow = lastFilledRow + 1;

  const dl = payload.deadline ? new Date(payload.deadline) : '';
  const photoUrl = resolvePhoto_(payload.photo);

  const row = [
    payload.name      || '',
    payload.brand     || '',
    '',  // photo — formula set below
    payload.status    || '',
    payload.reason    || '',
    payload.done      || '',
    payload.note      || '',
    dl,
    payload.priority  || '',
    payload.scNotes   || ''
  ];

  sh.getRange(targetRow, 1, 1, NUM_COLS).setValues([row]);
  if (photoUrl) sh.getRange(targetRow, 3).setFormula(imageFormula_(photoUrl));
  if (dl) sh.getRange(targetRow, 8).setNumberFormat('M/d/yyyy');

  // Make the row tall enough to display the photo
  try { sh.setRowHeight(targetRow, 200); } catch (e) { /* ignore */ }

  _logActivity('add', 'ingredient', {
    name: payload.name, sheet: INGREDIENTS_SHEET, row: targetRow,
    details: (payload.status || '') + ' · ' + (payload.priority || '') + ' · ' + (payload.brand || '')
  });
  _cacheInvalidate(CACHE_KEYS.INGREDIENTS);

  return { ok:true, row:targetRow };
}

/* -------------------- INGREDIENTS: DELETE -------------------- */

function deleteIngredients(rowNumbers) {
  requireRole_(['Admin']);
  if (!rowNumbers || !rowNumbers.length) {
    return { ok:false, deleted:0, message:'No rows specified.' };
  }
  const sh = getIngredientsSheet_();
  const lastRow = sh.getLastRow();
  const NUM_COLS = 10;
  const valid = rowNumbers
    .map(r => Number(r))
    .filter(r => Number.isInteger(r) && r >= 2 && r <= lastRow);

  if (!valid.length) {
    return { ok:false, deleted:0, message:'No valid rows to delete.' };
  }

  // Snapshot before clearing for undo
  const snapshot = valid.map(r => ({
    row: r,
    name: String(sh.getRange(r, 1).getValue() || ''),
    data: sh.getRange(r, 1, 1, NUM_COLS).getValues()[0]
  }));

  // Same behavior as deleteMeals — clear contents but preserve formatting/dropdowns.
  valid.forEach(r => {
    sh.getRange(r, 1, 1, NUM_COLS).clearContent();
  });

  const undoToken = _stashUndo({ entity:'ingredient', rows:snapshot });
  _logActivity('delete', 'ingredient', {
    name: snapshot.map(s => s.name).join(', '),
    sheet: INGREDIENTS_SHEET,
    row: valid.join(','),
    details: 'Deleted ' + valid.length + ' ingredient(s)'
  });
  _cacheInvalidate(CACHE_KEYS.INGREDIENTS);

  return { ok:true, deleted:valid.length, rows:valid, undoToken: undoToken };
}

/* -------------------- INGREDIENTS: METADATA FOR SIDEBAR -------------------- */

function getIngredientFormMetadata() {
  requireRole_(VALID_ROLES);
  const data = getIngredientsData();
  return {
    brands:     data.filters.brands,
    statuses:   INGREDIENT_STATUS,
    priorities: INGREDIENT_PRIORITY,
    dones:      INGREDIENT_DONE
  };
}



/* ============================================================
 * AUDIT MODULE
 * ============================================================
 * Sheets used:
 *   Audit Summary  — one row per audit (header info + score)
 *   Audit Details  — one row per question/item across all audits
 * Drive folder:
 *   UAE MP Dashboard Audits — stores the original uploaded PDF
 * ============================================================ */

/* -------------------- AUDIT: SHEET HELPERS -------------------- */

function ensureAuditSummarySheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(AUDIT_SUMMARY_SHEET);
  if (sh) return sh;

  sh = ss.insertSheet(AUDIT_SUMMARY_SHEET);
  const headers = [
    'Audit ID','Date','Auditor','Site','Conducted On',
    'Score Numerator','Score Denominator','Score %','Flagged Count',
    'Total Sections','Location','PDF Link','Uploaded By','Uploaded At','Status'
  ];
  sh.getRange(1,1,1,headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1f6e3f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 130);  // Audit ID
  sh.setColumnWidth(2, 100);  // Date
  sh.setColumnWidth(3, 130);  // Auditor
  sh.setColumnWidth(11, 320); // Location
  sh.setColumnWidth(12, 160); // PDF Link
  return sh;
}

function ensureAuditDetailsSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(AUDIT_DETAILS_SHEET);
  if (sh) return sh;

  sh = ss.insertSheet(AUDIT_DETAILS_SHEET);
  const headers = [
    'Audit ID','Date','Auditor','Section','Question','Question ID',
    'Result','Comment','Photo Refs','Photo Count','PDF Link'
  ];
  sh.getRange(1,1,1,headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1f6e3f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(5, 380);  // Question
  sh.setColumnWidth(8, 380);  // Comment
  sh.setColumnWidth(11, 160); // PDF Link
  return sh;
}

function ensureAuditFolder_() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('AUDIT_FOLDER_ID');
  if (folderId) {
    try {
      const f = DriveApp.getFolderById(folderId);
      if (f && !f.isTrashed()) return folderId;
    } catch (e) { /* fall through */ }
  }
  const iter = DriveApp.getFoldersByName(AUDIT_FOLDER_NAME);
  let folder;
  if (iter.hasNext()) {
    folder = iter.next();
  } else {
    folder = DriveApp.createFolder(AUDIT_FOLDER_NAME);
  }
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  folderId = folder.getId();
  props.setProperty('AUDIT_FOLDER_ID', folderId);
  return folderId;
}

/* -------------------- AUDIT: PDF TEXT EXTRACTION -------------------- */

/**
 * Extracts plain text from a PDF Blob by converting it through Google Docs.
 * Slow (~3-5 sec) but reliable for text-based PDFs like audit reports.
 */
function extractPdfText_(pdfBlob) {
  // Use Drive Advanced Service to convert PDF to Google Doc, which gives us text.
  // Requires "Drive API v3" advanced service to be enabled in the Apps Script editor.
  const tempFile = DriveApp.createFile(pdfBlob);
  let docId = null;
  try {
    // Use Drive.Files.copy with mimeType conversion (requires Drive advanced service)
    const copy = Drive.Files.copy(
      { name: 'TEMP_AUDIT_PARSE_' + Date.now(), mimeType: MimeType.GOOGLE_DOCS },
      tempFile.getId()
    );
    docId = copy.id;
    const doc = DocumentApp.openById(docId);
    const text = doc.getBody().getText();
    return text;
  } finally {
    // Clean up temp files
    try { tempFile.setTrashed(true); } catch (e) {}
    if (docId) {
      try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
    }
  }
}

/* -------------------- AUDIT: PDF PARSER -------------------- */

/**
 * Parses extracted audit text into structured data.
 * Returns: {
 *   header: { title, date, auditor, score, scoreNumerator, scoreDenominator,
 *             scorePct, flaggedCount, site, conductedOn, location, preparedBy },
 *   sections: [{ name, flaggedCount, scoreNumerator, scoreDenominator, scorePct,
 *                items: [{ question, result, comment, photoRefs:[1,2,3] }] }]
 * }
 */
function parseAuditText_(text) {
  const result = {
    header: {},
    sections: [],
    parseWarnings: []
  };

  const lines = text.split(/\r?\n/).map(l => l.trim());

  // ---- Header parsing (page 1) ----
  // Look for: "23 Apr 2026 / Ahmed Mohamed"
  // Score line: "Score 23 / 37 (62.16%)"  or split across lines
  // Flagged: "Flagged items 14"
  // Site conducted, Conducted on, Prepared by, Location

  for (let i = 0; i < lines.length && i < 60; i++) {
    const line = lines[i];

    // Date / Auditor pattern: "23 Apr 2026 / Ahmed Mohamed"
    const dateMatch = line.match(/^(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})\s*\/\s*(.+)$/);
    if (dateMatch && !result.header.date) {
      result.header.date    = dateMatch[1];
      result.header.auditor = dateMatch[2].trim();
    }

    // Score: "23 / 37 (62.16%)" — may span this line + next, or be inline
    const scoreInline = line.match(/(\d+)\s*\/\s*(\d+)\s*\(([\d.]+)\s*%\)/);
    if (scoreInline && !result.header.scoreNumerator && line.toLowerCase().indexOf('score') !== -1) {
      result.header.scoreNumerator   = Number(scoreInline[1]);
      result.header.scoreDenominator = Number(scoreInline[2]);
      result.header.scorePct         = Number(scoreInline[3]);
    } else if (scoreInline && !result.header.scoreNumerator) {
      // Score on a separate line (no "Score" word on same line)
      result.header.scoreNumerator   = Number(scoreInline[1]);
      result.header.scoreDenominator = Number(scoreInline[2]);
      result.header.scorePct         = Number(scoreInline[3]);
    }

    // Flagged items: "Flagged items 14" or "Flagged items" then "14"
    if (line.toLowerCase() === 'flagged items' && lines[i+1] && /^\d+$/.test(lines[i+1])) {
      result.header.flaggedCount = Number(lines[i+1]);
    } else {
      const flagMatch = line.match(/^Flagged items\s+(\d+)$/i);
      if (flagMatch) result.header.flaggedCount = Number(flagMatch[1]);
    }

    // Field labels followed by value on next non-empty line
    const labelMap = {
      'site conducted':  'site',
      'conducted on':    'conductedOn',
      'prepared by':     'preparedBy',
      'location':        'location'
    };
    const lower = line.toLowerCase();
    if (labelMap[lower]) {
      // Collect following non-empty lines until we hit another known label or run dry
      const valLines = [];
      for (let j = i + 1; j < lines.length && j < i + 8; j++) {
        const next = lines[j];
        if (!next) continue;
        const nl = next.toLowerCase();
        if (labelMap[nl] || nl === 'flagged items' || /^score\b/i.test(next)) break;
        valLines.push(next);
        // Single-line fields stop at first match
        if (labelMap[lower] !== 'location') break;
      }
      result.header[labelMap[lower]] = valLines.join(' ').trim();
    }
  }

  // ---- Section parsing ----
  // Each section appears in two places:
  //   (a) "Flagged items" summary near the top (skip — it duplicates per-section data)
  //   (b) Per-section pages: "SECTION NAME  N flagged, X / Y (Z%)" header,
  //       then questions (bold), Yes/No result, optional comment, optional Photo refs.
  //
  // We rely on (b) because it contains ALL questions (Yes and No), not just flagged.

  // Section header pattern: e.g. "COMMISSORY 1 flagged, 2 / 3 (66.67%)"
  // Some sections have no flagged items, e.g. "OPERATIONAL EXCELLENCE 2 / 2 (100%)"
  const sectionHeaderRe = /^([A-Z][A-Z &]+(?:[A-Z]))\s+(?:(\d+)\s+flagged,\s+)?(\d+)\s*\/\s*(\d+)\s*\(([\d.]+)\s*%\)$/;

  let currentSection = null;
  let sectionStartIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(sectionHeaderRe);
    if (m) {
      // Push previous section
      if (currentSection) result.sections.push(currentSection);
      currentSection = {
        name:             m[1].trim(),
        flaggedCount:     m[2] ? Number(m[2]) : 0,
        scoreNumerator:   Number(m[3]),
        scoreDenominator: Number(m[4]),
        scorePct:         Number(m[5]),
        items:            []
      };
      sectionStartIdx = i;
    }
  }
  if (currentSection) result.sections.push(currentSection);

  // De-duplicate sections by name (the audit may show the same section twice in
  // the text — once in the flagged summary and once in the full page). Keep
  // the LAST occurrence which has full Yes/No questions.
  const dedupedSections = {};
  result.sections.forEach(s => { dedupedSections[s.name] = s; });
  result.sections = Object.keys(dedupedSections).map(k => dedupedSections[k]);

  // Now walk the lines again, grouped by section, to extract items
  // For each section, find its header line, then parse items until the next section header.
  result.sections.forEach(section => {
    const headerIdx = lines.findIndex(l => {
      const m = l.match(sectionHeaderRe);
      return m && m[1].trim() === section.name;
    });
    if (headerIdx === -1) return;

    // Find the end of this section (next section header or end of text)
    let endIdx = lines.length;
    for (let j = headerIdx + 1; j < lines.length; j++) {
      if (sectionHeaderRe.test(lines[j])) { endIdx = j; break; }
      if (/^Media summary$/i.test(lines[j])) { endIdx = j; break; }
    }

    // Walk from headerIdx+1 to endIdx, accumulating items.
    // An item is: question text (1+ lines, ends when followed by 'Yes' or 'No'),
    // optionally followed by a comment, optionally followed by Photo refs.
    let i = headerIdx + 1;
    while (i < endIdx) {
      const line = lines[i];
      if (!line) { i++; continue; }

      // Skip pagination footer
      if (/^Private & confidential/i.test(line)) { i++; continue; }
      if (/^\d+\/\d+$/.test(line)) { i++; continue; }

      // Look ahead to find the next Yes/No — that marks the end of the question text
      let resultIdx = -1;
      for (let k = i; k < Math.min(i + 6, endIdx); k++) {
        if (lines[k] === 'Yes' || lines[k] === 'No') { resultIdx = k; break; }
      }
      if (resultIdx === -1) { i++; continue; }

      // Question = lines[i..resultIdx-1] joined
      const question = lines.slice(i, resultIdx).join(' ').replace(/\s+/g, ' ').trim();
      const itemResult = lines[resultIdx];

      // Comment + photo refs: everything between resultIdx+1 and the next question or section end.
      // The next question starts where we hit text that's followed by Yes/No within a few lines.
      let blockEnd = endIdx;
      for (let k = resultIdx + 1; k < endIdx; k++) {
        // Look for the start of the next question by checking if any line in the next 6 lines is Yes/No
        for (let kk = k; kk < Math.min(k + 6, endIdx); kk++) {
          if (lines[kk] === 'Yes' || lines[kk] === 'No') {
            blockEnd = k;
            break;
          }
        }
        if (blockEnd !== endIdx) break;
      }

      let comment = '';
      const photoRefs = [];
      for (let k = resultIdx + 1; k < blockEnd; k++) {
        const ln = lines[k];
        if (!ln) continue;
        if (/^Private & confidential/i.test(ln)) continue;
        if (/^\d+\/\d+$/.test(ln)) continue;
        // Photo references: "Photo 1", "Photo 12", etc.
        const pm = ln.match(/^Photo\s+(\d+)$/i);
        if (pm) {
          photoRefs.push(Number(pm[1]));
        } else {
          // Append to comment
          comment += (comment ? ' ' : '') + ln;
        }
      }

      section.items.push({
        question:  question,
        result:    itemResult,
        comment:   comment.trim(),
        photoRefs: photoRefs
      });

      i = blockEnd > resultIdx ? blockEnd : resultIdx + 1;
    }
  });

  // Add parseWarnings if anything looks off
  if (!result.header.date) result.parseWarnings.push('Date not detected');
  if (!result.header.auditor) result.parseWarnings.push('Auditor not detected');
  if (!result.header.scoreNumerator) result.parseWarnings.push('Score not detected');
  if (!result.sections.length) result.parseWarnings.push('No sections detected');

  return result;
}

/**
 * Generates a stable ID for a question so we can match the same question
 * across multiple audits. Based on section name + first 80 chars of question.
 */
function questionId_(sectionName, question) {
  const norm = (sectionName + '|' + question)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  // Simple hash to keep IDs short
  let h = 0;
  for (let i = 0; i < norm.length; i++) {
    h = ((h << 5) - h + norm.charCodeAt(i)) | 0;
  }
  return 'Q' + Math.abs(h).toString(36).toUpperCase();
}

/* -------------------- AUDIT: UPLOAD ENDPOINT -------------------- */

/**
 * Public — called from the dashboard with a base64-encoded PDF.
 * Parses, saves to Drive, writes Summary + Details rows.
 */
function uploadAuditPdf(payload) {
  const user = requireRole_(['Admin','Editor']);

  if (!payload || !payload.data) throw new Error('No PDF data received.');

  // Decode + save the original PDF
  const decoded = Utilities.base64Decode(payload.data);
  const blob = Utilities.newBlob(decoded, 'application/pdf',
                                  payload.name || ('audit_' + Date.now() + '.pdf'));
  const folderId = ensureAuditFolder_();
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const pdfLink = file.getUrl();

  // Extract text + parse
  let parsed, parseError = null;
  try {
    const text = extractPdfText_(blob);
    parsed = parseAuditText_(text);
  } catch (e) {
    parseError = String(e);
    parsed = { header: {}, sections: [], parseWarnings: ['Parse failed: ' + parseError] };
  }

  // Build IDs and timestamps
  const auditId    = 'A' + Date.now().toString(36).toUpperCase();
  const uploadedAt = new Date();
  const status     = parsed.parseWarnings.length ? 'Partial — review' : 'OK';

  // Coerce date string into a Date object
  let dateObj = null;
  if (parsed.header.date) {
    const d = new Date(parsed.header.date);
    if (!isNaN(d.getTime())) dateObj = d;
  }

  // ---- Write Summary row ----
  const summarySh = ensureAuditSummarySheet_();
  const totalSections = parsed.sections.length;
  const summaryRow = [
    auditId,
    dateObj || parsed.header.date || '',
    parsed.header.auditor || '',
    parsed.header.site || '',
    parsed.header.conductedOn || '',
    parsed.header.scoreNumerator || '',
    parsed.header.scoreDenominator || '',
    parsed.header.scorePct ? parsed.header.scorePct / 100 : '',
    parsed.header.flaggedCount || 0,
    totalSections,
    parsed.header.location || '',
    pdfLink,
    user.email,
    uploadedAt,
    status
  ];
  summarySh.appendRow(summaryRow);
  const summaryRowNum = summarySh.getLastRow();
  // Format date + percent + uploadedAt
  if (dateObj) summarySh.getRange(summaryRowNum, 2).setNumberFormat('M/d/yyyy');
  summarySh.getRange(summaryRowNum, 8).setNumberFormat('0.00%');
  summarySh.getRange(summaryRowNum, 14).setNumberFormat('M/d/yyyy h:mm');

  // ---- Write Details rows ----
  const detailsSh = ensureAuditDetailsSheet_();
  const detailRows = [];
  parsed.sections.forEach(section => {
    section.items.forEach(item => {
      detailRows.push([
        auditId,
        dateObj || parsed.header.date || '',
        parsed.header.auditor || '',
        section.name,
        item.question,
        questionId_(section.name, item.question),
        item.result,
        item.comment || '',
        item.photoRefs.join(', '),
        item.photoRefs.length,
        pdfLink
      ]);
    });
  });
  if (detailRows.length) {
    const startRow = detailsSh.getLastRow() + 1;
    detailsSh.getRange(startRow, 1, detailRows.length, detailRows[0].length).setValues(detailRows);
    if (dateObj) {
      detailsSh.getRange(startRow, 2, detailRows.length, 1).setNumberFormat('M/d/yyyy');
    }
  }

  _logActivity('upload', 'audit', {
    name: auditId, sheet: AUDIT_SUMMARY_SHEET, row: summaryRowNum,
    details: (parsed.header.date || '') + ' · ' + (parsed.header.auditor || '') +
             ' · ' + (parsed.header.scoreNumerator || 0) + '/' + (parsed.header.scoreDenominator || 0) +
             ' · ' + detailRows.length + ' items'
  });
  _cacheInvalidate(CACHE_KEYS.AUDITS);

  return {
    ok: true,
    auditId,
    summaryRow: summaryRowNum,
    detailsRows: detailRows.length,
    pdfLink,
    parseWarnings: parsed.parseWarnings,
    status,
    parsed: {
      date: parsed.header.date || '',
      auditor: parsed.header.auditor || '',
      score: parsed.header.scoreNumerator + '/' + parsed.header.scoreDenominator,
      scorePct: parsed.header.scorePct,
      flaggedCount: parsed.header.flaggedCount,
      sectionCount: parsed.sections.length
    }
  };
}

/* -------------------- AUDIT: READ + COMPUTE -------------------- */

function getAuditData() {
  requireRole_(VALID_ROLES);
  return _withCache(CACHE_KEYS.AUDITS, function() {
    return _readAuditData_();
  });
}

function _readAuditData_() {
  const summarySh = ensureAuditSummarySheet_();
  const detailsSh = ensureAuditDetailsSheet_();

  // Read summary
  const audits = [];
  if (summarySh.getLastRow() >= 2) {
    const data = summarySh.getRange(2, 1, summarySh.getLastRow() - 1, 15).getValues();
    data.forEach(r => {
      if (!r[0]) return;
      audits.push({
        auditId:     String(r[0]),
        date:        r[1] ? formatDate_(r[1]) : '',
        rawDate:     r[1] instanceof Date ? r[1].getTime() : null,
        auditor:     String(r[2] || ''),
        site:        String(r[3] || ''),
        conductedOn: String(r[4] || ''),
        scoreNum:    Number(r[5]) || 0,
        scoreDen:    Number(r[6]) || 0,
        scorePct:    typeof r[7] === 'number' ? Math.round(r[7] * 10000) / 100 : null,
        flagged:     Number(r[8]) || 0,
        sections:    Number(r[9]) || 0,
        location:    String(r[10] || ''),
        pdfLink:     String(r[11] || ''),
        uploadedBy:  String(r[12] || ''),
        uploadedAt:  r[13] ? formatDate_(r[13]) : '',
        status:      String(r[14] || '')
      });
    });
  }

  // Read details
  const items = [];
  if (detailsSh.getLastRow() >= 2) {
    const data = detailsSh.getRange(2, 1, detailsSh.getLastRow() - 1, 11).getValues();
    data.forEach(r => {
      if (!r[0]) return;
      items.push({
        auditId:    String(r[0]),
        date:       r[1] ? formatDate_(r[1]) : '',
        auditor:    String(r[2] || ''),
        section:    String(r[3] || ''),
        question:   String(r[4] || ''),
        questionId: String(r[5] || ''),
        result:     String(r[6] || ''),
        comment:    String(r[7] || ''),
        photoRefs:  String(r[8] || ''),
        photoCount: Number(r[9]) || 0,
        pdfLink:    String(r[10] || '')
      });
    });
  }

  // Compute KPIs
  const totalAudits = audits.length;
  audits.sort((a,b) => (b.rawDate || 0) - (a.rawDate || 0));
  const latest = audits[0] || null;

  let avgScore = 0;
  const scored = audits.filter(a => a.scorePct !== null);
  if (scored.length) {
    avgScore = scored.reduce((s,a) => s + a.scorePct, 0) / scored.length;
    avgScore = Math.round(avgScore * 100) / 100;
  }

  const totalFlagged = audits.reduce((s,a) => s + a.flagged, 0);

  // This month vs last month
  const now = new Date();
  const thisMonthKey = now.getFullYear() + '-' + (now.getMonth() + 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = lastMonth.getFullYear() + '-' + (lastMonth.getMonth() + 1);
  const monthKey = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1);
  };
  const thisMonthAudits = audits.filter(a => monthKey(a.rawDate) === thisMonthKey);
  const lastMonthAudits = audits.filter(a => monthKey(a.rawDate) === lastMonthKey);

  // Section trend — flagged count by section across all audits
  const sectionFlagged = {};
  items.filter(it => (it.result || '').toLowerCase() === 'no').forEach(it => {
    if (!it.section) return;
    sectionFlagged[it.section] = (sectionFlagged[it.section] || 0) + 1;
  });

  // Score trend over time (audits sorted oldest -> newest)
  const trendData = audits.slice().reverse().map(a => ({
    date: a.date, scorePct: a.scorePct, flagged: a.flagged, auditId: a.auditId
  }));

  // Question repeat counter — same question failing across multiple audits
  const questionFailCounts = {};
  items.filter(it => (it.result || '').toLowerCase() === 'no').forEach(it => {
    const k = it.questionId;
    if (!k) return;
    if (!questionFailCounts[k]) {
      questionFailCounts[k] = { count:0, question:it.question, section:it.section, audits:[] };
    }
    questionFailCounts[k].count++;
    if (questionFailCounts[k].audits.indexOf(it.auditId) === -1) {
      questionFailCounts[k].audits.push(it.auditId);
    }
  });
  const repeatOffenders = Object.values(questionFailCounts)
    .filter(q => q.count >= 2)
    .sort((a,b) => b.count - a.count)
    .slice(0, 10);

  // Filters
  const auditors = Array.from(new Set(audits.map(a => a.auditor).filter(Boolean))).sort();
  const sites    = Array.from(new Set(audits.map(a => a.site).filter(Boolean))).sort();
  const sections = Array.from(new Set(items.map(it => it.section).filter(Boolean))).sort();

  return {
    audits,
    items,
    totals: {
      totalAudits,
      latestScore:    latest ? latest.scorePct : null,
      latestFlagged:  latest ? latest.flagged : 0,
      latestDate:     latest ? latest.date : '',
      avgScore,
      totalFlagged,
      thisMonthCount: thisMonthAudits.length,
      lastMonthCount: lastMonthAudits.length,
      thisMonthAvg:   thisMonthAudits.length ?
                       Math.round(thisMonthAudits.reduce((s,a)=>s+(a.scorePct||0),0) / thisMonthAudits.length * 100) / 100 : 0,
      lastMonthAvg:   lastMonthAudits.length ?
                       Math.round(lastMonthAudits.reduce((s,a)=>s+(a.scorePct||0),0) / lastMonthAudits.length * 100) / 100 : 0
    },
    sectionFlagged,
    trendData,
    repeatOffenders,
    filters: { auditors, sites, sections }
  };
}

/* -------------------- AUDIT: DELETE -------------------- */

function deleteAudit(auditId) {
  requireRole_(['Admin']);
  if (!auditId) return { ok:false, message:'No audit ID' };

  const summarySh = ensureAuditSummarySheet_();
  const detailsSh = ensureAuditDetailsSheet_();

  // Delete summary row
  let summaryDeleted = 0;
  if (summarySh.getLastRow() >= 2) {
    const data = summarySh.getRange(2, 1, summarySh.getLastRow() - 1, 1).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]) === auditId) {
        summarySh.deleteRow(i + 2);
        summaryDeleted++;
      }
    }
  }

  // Delete details rows
  let detailsDeleted = 0;
  if (detailsSh.getLastRow() >= 2) {
    const data = detailsSh.getRange(2, 1, detailsSh.getLastRow() - 1, 1).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]) === auditId) {
        detailsSh.deleteRow(i + 2);
        detailsDeleted++;
      }
    }
  }

  _logActivity('delete', 'audit', {
    name: auditId, sheet: AUDIT_SUMMARY_SHEET,
    details: 'Removed audit + ' + detailsDeleted + ' detail rows'
  });
  _cacheInvalidate(CACHE_KEYS.AUDITS);

  return { ok:true, summaryDeleted, detailsDeleted };
}

/* -------------------- ACTIVITY LOG: PUBLIC API -------------------- */

/**
 * Returns the most recent activity log entries (newest first).
 * @param {number} limit — max entries to return, default 50
 */
function getActivityLog(limit) {
  requireRole_(VALID_ROLES);
  const sh = ensureActivityLogSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { entries: [] };

  const max = Math.min(Number(limit) || 50, 500);
  const startRow = Math.max(2, lastRow - max + 1);
  const numRows  = lastRow - startRow + 1;
  const data = sh.getRange(startRow, 1, numRows, 9).getValues();

  // Reverse to put newest first
  const entries = data.reverse().map(r => ({
    timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ''),
    user:      String(r[1] || ''),
    action:    String(r[2] || ''),
    entity:    String(r[3] || ''),
    name:      String(r[4] || ''),
    details:   String(r[5] || ''),
    sheet:     String(r[6] || ''),
    row:       String(r[7] || ''),
    reverted:  String(r[8] || '')
  }));
  return { entries };
}

/**
 * Admin-only: clears all caches manually. Useful for debugging.
 */
function adminClearCache() {
  requireRole_(['Admin']);
  _cacheInvalidateAll();
  return { ok:true, message:'All caches cleared.' };
}

/**
 * Returns the deployed web app URL so the client can build shareable links.
 */
function getDeploymentUrl() {
  try {
    return { url: ScriptApp.getService().getUrl() };
  } catch (e) {
    return { url: '' };
  }
}

/* ============================================================
 * SERVER-SIDE PRINT (#23 final fix)
 * Generates an HTML file in Drive, returns the URL.
 * User opens it in a new tab → Ctrl+P to print.
 * ============================================================ */

function generatePrintView(section) {
  requireRole_(VALID_ROLES);

  let title = 'UAE MP Dashboard';
  let tableHtml = '';
  let summary = '';

  if (section === 'meals') {
    title = 'Meals Report';
    const data = getDashboardData();
    const t = data.totals || {};
    summary = 'Total: ' + t.total + ' | Launched: ' + t.launched +
              ' | Rework: ' + t.rework + ' | Ideas: ' + t.idea +
              ' | Avg Cost: ' + t.avgCost + '% | Avg Workflow: ' + t.avgWorkflow + '%';
    tableHtml = '<table><thead><tr><th>#</th><th>Meal</th><th>Chef</th><th>Plan</th><th>Type</th>' +
      '<th>Cost %</th><th>FHS</th><th>Workflow</th><th>Status</th><th>Note</th></tr></thead><tbody>';
    data.meals.forEach(function(m, i) {
      var cost = m.costPct !== null ? (Math.abs(m.costPct) <= 1 ? (m.costPct*100).toFixed(2) : m.costPct.toFixed(2)) + '%' : '—';
      var fhs  = m.fhs !== null ? (Math.abs(m.fhs) <= 1 ? (m.fhs*100).toFixed(2) : m.fhs.toFixed(2)) + '%' : '—';
      tableHtml += '<tr><td>' + (i+1) + '</td><td>' + (m.name||'') + '</td><td>' + (m.chef||'') +
        '</td><td>' + (m.diet||'') + '</td><td>' + (m.type||'') + '</td><td>' + cost +
        '</td><td>' + fhs + '</td><td>' + (m.workflowPct||0) + '%</td><td>' + (m.status||'') +
        '</td><td>' + (m.note||'') + '</td></tr>';
    });
    tableHtml += '</tbody></table>';

  } else if (section === 'ingredients') {
    title = 'Ingredients Report';
    const data = getIngredientsData();
    const t = data.totals || {};
    summary = 'Total: ' + t.total + ' | Approved: ' + t.approved +
              ' | Non Approved: ' + t.nonApproved + ' | Done: ' + t.done;
    tableHtml = '<table><thead><tr><th>#</th><th>Ingredient</th><th>Brand</th><th>Status</th>' +
      '<th>Done</th><th>Priority</th><th>Deadline</th><th>Reason</th><th>Note</th></tr></thead><tbody>';
    data.items.forEach(function(it, i) {
      tableHtml += '<tr><td>' + (i+1) + '</td><td>' + (it.name||'') + '</td><td>' + (it.brand||'') +
        '</td><td>' + (it.status||'') + '</td><td>' + (it.done||'') + '</td><td>' + (it.priority||'') +
        '</td><td>' + (it.deadline||'') + '</td><td>' + (it.reason||'') + '</td><td>' + (it.note||'') + '</td></tr>';
    });
    tableHtml += '</tbody></table>';

  } else if (section === 'quality') {
    title = 'Quality Issues Report';
    const data = getQualityData('ALL');
    summary = 'Total: ' + data.total + ' | Done: ' + data.counts.Done +
              ' | Pending: ' + data.counts.Pending + ' | In Progress: ' + data.counts['In Progress'];
    tableHtml = '<table><thead><tr><th>Sheet</th><th>Name</th><th>Comment</th><th>Corrective Action</th>' +
      '<th>Status</th><th>Date</th><th>Notes</th></tr></thead><tbody>';
    data.issues.forEach(function(it) {
      tableHtml += '<tr><td>' + (it.sheet||'').replace('Quality Points/','') + '</td><td>' + (it.name||'') +
        '</td><td>' + (it.comment||'') + '</td><td>' + (it.correctiveAction||'') +
        '</td><td>' + (it.status||'') + '</td><td>' + (it.assessmentDate||'') +
        '</td><td>' + (it.notes||'') + '</td></tr>';
    });
    tableHtml += '</tbody></table>';

  } else if (section === 'audits') {
    title = 'Audit Report';
    const data = getAuditData();
    summary = 'Total Audits: ' + data.totals.totalAudits + ' | Avg Score: ' + data.totals.avgScore + '%';
    tableHtml = '<table><thead><tr><th>Date</th><th>Auditor</th><th>Site</th><th>Score</th>' +
      '<th>%</th><th>Flagged</th><th>Status</th></tr></thead><tbody>';
    data.audits.forEach(function(a) {
      tableHtml += '<tr><td>' + (a.date||'') + '</td><td>' + (a.auditor||'') +
        '</td><td>' + (a.site||'') + '</td><td>' + a.scoreNum + '/' + a.scoreDen +
        '</td><td>' + (a.scorePct !== null ? a.scorePct + '%' : '—') +
        '</td><td>' + a.flagged + '</td><td>' + (a.status||'') + '</td></tr>';
    });
    tableHtml += '</tbody></table>';
  }

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>CALO — ' + title + '</title>' +
    '<style>' +
    'body{font-family:"Segoe UI",sans-serif;font-size:12px;color:#1f2937;margin:30px}' +
    'h2{margin:0 0 4px;font-size:18px;color:#1f6e3f}' +
    '.meta{color:#6b7280;font-size:11px;margin-bottom:6px}' +
    '.summary{background:#f0fdf4;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:12px;color:#166534}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#1f6e3f;color:#fff;padding:8px 10px;text-align:left;font-size:11px}' +
    'td{padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:11px}' +
    'tr:nth-child(even){background:#f9fafb}' +
    '.print-hint{margin-top:20px;color:#9ca3af;font-size:11px;text-align:center}' +
    '</style></head><body>' +
    '<h2>CALO — ' + title + '</h2>' +
    '<div class="meta">Generated ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') +
    ' by ' + getCurrentUserEmail_() + '</div>' +
    '<div class="summary">' + summary + '</div>' +
    tableHtml +
    '<div class="print-hint">Press Ctrl+P (or Cmd+P) to print this page.</div>' +
    '</body></html>';

  // Save to Drive as a temporary HTML file
  var folderId = ensurePhotoFolder_(); // reuse the photos folder for temp files
  var folder = DriveApp.getFolderById(folderId);
  var fileName = 'CALO_' + title.replace(/\s+/g, '_') + '_' +
                 Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '.html';
  var file = folder.createFile(fileName, html, MimeType.HTML);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Auto-delete after 1 hour via a trigger (best-effort cleanup)
  try {
    ScriptApp.newTrigger('_cleanupTempFile')
      .timeBased()
      .after(60 * 60 * 1000)
      .create();
    PropertiesService.getScriptProperties().setProperty('_tempFileId_' + file.getId(), '1');
  } catch (e) { /* ignore trigger errors */ }

  return { ok: true, url: file.getUrl(), name: fileName };
}

/** Cleanup trigger — deletes temp print files older than 1 hour */
function _cleanupTempFile() {
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    Object.keys(props).forEach(function(key) {
      if (key.indexOf('_tempFileId_') !== 0) return;
      var fileId = key.replace('_tempFileId_', '');
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (e) {}
      PropertiesService.getScriptProperties().deleteProperty(key);
    });
    // Also clean up the trigger itself
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === '_cleanupTempFile') {
        try { ScriptApp.deleteTrigger(t); } catch (e) {}
      }
    });
  } catch (e) {}
}

/* ============================================================
 * BATCH 4 BACKEND
 * - Top/bottom performers  (#13)
 * - Weekly email summary   (#14)
 * ============================================================ */

/**
 * Computes top/bottom performer stats across meals, quality, ingredients.
 */
function getPerformanceStats() {
  requireRole_(VALID_ROLES);
  var dashData = getDashboardData();
  var meals = dashData.meals || [];
  var t = dashData.totals || {};

  // Best chef by launches
  var chefLaunches = {};
  meals.forEach(function(m) {
    if ((m.status || '').toLowerCase() === 'launched' && m.chef) {
      chefLaunches[m.chef] = (chefLaunches[m.chef] || 0) + 1;
    }
  });
  var bestChef = { name:'—', count:0 };
  Object.keys(chefLaunches).forEach(function(k) {
    if (chefLaunches[k] > bestChef.count) bestChef = { name:k, count:chefLaunches[k] };
  });

  // Chef with most meals overall
  var mostMeals = { name:'—', count:0 };
  Object.keys(t.byChef || {}).forEach(function(k) {
    if (t.byChef[k] > mostMeals.count) mostMeals = { name:k, count:t.byChef[k] };
  });

  // Highest and lowest cost meals
  var withCost = meals.filter(function(m) { return m.costPct !== null; });
  withCost.sort(function(a, b) { return b.costPct - a.costPct; });
  var highestCost = withCost.length ? { name:withCost[0].name, value:withCost[0].costPct } : null;
  var lowestCost  = withCost.length ? { name:withCost[withCost.length-1].name, value:withCost[withCost.length-1].costPct } : null;

  // Best FHS
  var withFhs = meals.filter(function(m) { return m.fhs !== null && m.fhs > 0; });
  withFhs.sort(function(a, b) { return b.fhs - a.fhs; });
  var bestFhs  = withFhs.length ? { name:withFhs[0].name, value:withFhs[0].fhs } : null;
  var worstFhs = withFhs.length ? { name:withFhs[withFhs.length-1].name, value:withFhs[withFhs.length-1].fhs } : null;

  // Most reworked
  var reworkCount = {};
  meals.forEach(function(m) {
    if ((m.status||'').toLowerCase() === 'rework' && m.name) {
      reworkCount[m.chef || 'Unknown'] = (reworkCount[m.chef || 'Unknown'] || 0) + 1;
    }
  });
  var mostReworks = { name:'—', count:0 };
  Object.keys(reworkCount).forEach(function(k) {
    if (reworkCount[k] > mostReworks.count) mostReworks = { name:k, count:reworkCount[k] };
  });

  return {
    bestChef:    bestChef,
    mostMeals:   mostMeals,
    highestCost: highestCost,
    lowestCost:  lowestCost,
    bestFhs:     bestFhs,
    worstFhs:    worstFhs,
    mostReworks: mostReworks,
    totalLaunched:  t.launched || 0,
    totalRework:    t.rework || 0,
    totalMeals:     t.total || 0
  };
}

/**
 * Sends a weekly summary email to all Admin users.
 * Call this manually or set up a weekly time trigger.
 */
function sendWeeklySummary() {
  var dashData, qualData, ingData, auditData;
  try { dashData  = getDashboardData(); }  catch(e) { dashData  = { totals:{} }; }
  try { qualData  = getQualityData('ALL'); } catch(e) { qualData  = { total:0, counts:{} }; }
  try { ingData   = getIngredientsData(); }  catch(e) { ingData   = { totals:{} }; }
  try { auditData = getAuditData(); }        catch(e) { auditData = { totals:{} }; }

  var dt = dashData.totals || {};
  var it = ingData.totals || {};
  var at = auditData.totals || {};
  var qc = qualData.counts || {};

  var body = '<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto">' +
    '<div style="background:#16a974;color:#fff;padding:20px;border-radius:12px 12px 0 0">' +
    '<h2 style="margin:0">🍽️ CALO — Weekly Summary</h2>' +
    '<p style="margin:4px 0 0;opacity:.85">' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy') + '</p>' +
    '</div>' +
    '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">' +

    '<h3 style="color:#16a974;margin:0 0 10px">📊 Meals</h3>' +
    '<p>Total: <b>' + (dt.total||0) + '</b> · Launched: <b>' + (dt.launched||0) +
    '</b> · Rework: <b>' + (dt.rework||0) + '</b> · Ideas: <b>' + (dt.idea||0) +
    '</b><br>Avg Cost: ' + (dt.avgCost||0) + '% · Avg FHS: ' + (dt.avgFhs||0) +
    '% · Avg Workflow: ' + (dt.avgWorkflow||0) + '%</p>' +

    '<h3 style="color:#16a974;margin:16px 0 10px">⚠️ Quality</h3>' +
    '<p>Total Issues: <b>' + (qualData.total||0) + '</b> · Done: <b>' + (qc.Done||0) +
    '</b> · Pending: <b>' + (qc.Pending||0) + '</b> · In Progress: <b>' + (qc['In Progress']||0) +
    '</b> · Not Done: <b>' + (qc['Not Done']||0) + '</b></p>' +

    '<h3 style="color:#16a974;margin:16px 0 10px">🧪 Ingredients</h3>' +
    '<p>Total: <b>' + (it.total||0) + '</b> · Approved: <b>' + (it.approved||0) +
    '</b> · Non Approved: <b>' + (it.nonApproved||0) +
    '</b> · Done: <b>' + (it.done||0) + '</b></p>' +

    '<h3 style="color:#16a974;margin:16px 0 10px">📋 Audits</h3>' +
    '<p>Total: <b>' + (at.totalAudits||0) + '</b> · Latest Score: <b>' + (at.latestScore!==null ? at.latestScore+'%' : '—') +
    '</b> · Average: <b>' + (at.avgScore||0) + '%</b> · This Month: <b>' + (at.thisMonthCount||0) + '</b></p>' +

    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">' +
    '<p style="color:#6b7280;font-size:12px">Generated by UAE MP Dashboard</p>' +
    '</div></div>';

  // Send to all Admins
  var accessSh = ensureAccessSheet_();
  var lastRow = accessSh.getLastRow();
  var sent = 0;
  if (lastRow >= 2) {
    var users = accessSh.getRange(2, 1, lastRow - 1, 2).getValues();
    users.forEach(function(row) {
      var email = String(row[0] || '').trim().toLowerCase();
      var role  = String(row[1] || '').trim();
      if (email && role === 'Admin' && email.indexOf('@') > 0) {
        try {
          MailApp.sendEmail({
            to: email,
            subject: '🍽️ CALO Weekly Summary — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy'),
            htmlBody: body
          });
          sent++;
        } catch (e) {
          Logger.log('Email failed for ' + email + ': ' + e);
        }
      }
    });
  }
  return { ok:true, sent:sent };
}

/**
 * Sets up a weekly trigger for the email summary (Monday 8am).
 * Run once from the editor.
 */
function setupWeeklyEmailTrigger() {
  // Remove existing triggers for this function
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendWeeklySummary') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('sendWeeklySummary')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();
  return { ok:true, message:'Weekly email trigger set for Monday 8am.' };
}

/* ============================================================
 * BATCH 3 BACKEND
 * - Inline edit  (#7)  — updateMealRow, updateIngredientRow
 * - Bulk actions (#8)  — bulkUpdateMeals
 * - Bookmarks    (#21) — toggleBookmark, getBookmarks
 * ============================================================ */

/* -------------------- INLINE EDIT -------------------- */

/**
 * Column index map for UAE NPD Progress Tracker (1-based)
 * A=1 Analysis#, B=2 Name, C=3 Cost%, D=4 FHS, E=5 More3x,
 * F=6 Chef, G=7 Diet, H=8 Type, I-N=9-14 Workflow checkboxes,
 * O=15 Status, P=16 Note
 */
const MEAL_COL_MAP = {
  name:        2,
  costPct:     3,
  fhs:         4,
  moreThan3x:  5,
  chef:        6,
  diet:        7,
  type:        8,
  ideation:    9,
  creation:    10,
  dashboarding:11,
  mpTasting:   12,
  npdTasting:  13,
  approving:   14,
  status:      15,
  note:        16,
  link:        2   // handled specially — writes HYPERLINK formula
};

/**
 * Updates one or more fields of a meal row in the sheet.
 * @param {number} rowNum  sheet row number (1-indexed)
 * @param {Object} updates { fieldName: newValue, ... }
 */
function updateMealRow(rowNum, updates) {
  requireRole_(['Admin','Editor']);
  if (!rowNum || !updates) throw new Error('rowNum and updates are required.');

  const sh = getTrackerSheet_();
  const lastRow = sh.getLastRow();
  if (rowNum < 2 || rowNum > lastRow) throw new Error('Row ' + rowNum + ' is out of range.');

  const changed = [];
  Object.keys(updates).forEach(field => {
    const col = MEAL_COL_MAP[field];
    if (!col) return; // unknown field — skip
    const cell = sh.getRange(rowNum, col);
    let val = updates[field];

    // Special handling
    if (field === 'costPct' || field === 'fhs') {
      const n = parseFloat(String(val).replace('%',''));
      val = isNaN(n) ? '' : (Math.abs(n) > 1 ? n / 100 : n);
      cell.setValue(val);
      cell.setNumberFormat('0.00%');
    } else if (field === 'link') {
      const mealName = String(sh.getRange(rowNum, 2).getDisplayValue() || '');
      if (val) {
        cell.setFormula('=HYPERLINK("' + String(val).replace(/"/g,'""') + '","' + mealName.replace(/"/g,'""') + '")');
      }
    } else if (field === 'ideation' || field === 'creation' || field === 'dashboarding' ||
               field === 'mpTasting' || field === 'npdTasting' || field === 'approving') {
      cell.setValue(val === true || val === 'true' || val === 'TRUE');
    } else {
      cell.setValue(val);
    }
    changed.push(field);
  });

  _logActivity('edit', 'meal', {
    sheet: TRACKER_SHEET, row: rowNum,
    details: 'Updated: ' + changed.join(', ')
  });
  _cacheInvalidate(CACHE_KEYS.DASHBOARD);
  _cacheInvalidate(CACHE_KEYS.META);

  return { ok:true, row:rowNum, updated:changed };
}

/**
 * Updates one or more fields of an ingredient row.
 * Columns: A=1 Name, B=2 Brand, C=3 Photo, D=4 Status,
 *          E=5 Reason, F=6 Done, G=7 Note, H=8 Deadline,
 *          I=9 Priority, J=10 SC Notes
 */
const ING_COL_MAP = {
  name:     1,
  brand:    2,
  photo:    3,  // formula cell — skip direct edit for now
  status:   4,
  reason:   5,
  done:     6,
  note:     7,
  deadline: 8,
  priority: 9,
  scNotes:  10
};

function updateIngredientRow(rowNum, updates) {
  requireRole_(['Admin','Editor']);
  if (!rowNum || !updates) throw new Error('rowNum and updates are required.');

  const sh = getIngredientsSheet_();
  const lastRow = sh.getLastRow();
  if (rowNum < 2 || rowNum > lastRow) throw new Error('Row ' + rowNum + ' is out of range.');

  const changed = [];
  Object.keys(updates).forEach(field => {
    const col = ING_COL_MAP[field];
    if (!col || field === 'photo') return;
    const cell = sh.getRange(rowNum, col);
    let val = updates[field];
    if (field === 'deadline') {
      val = val ? new Date(val) : '';
      cell.setValue(val);
      if (val) cell.setNumberFormat('M/d/yyyy');
    } else {
      cell.setValue(val);
    }
    changed.push(field);
  });

  _logActivity('edit', 'ingredient', {
    sheet: INGREDIENTS_SHEET, row: rowNum,
    details: 'Updated: ' + changed.join(', ')
  });
  _cacheInvalidate(CACHE_KEYS.INGREDIENTS);

  return { ok:true, row:rowNum, updated:changed };
}

/* -------------------- BULK ACTIONS -------------------- */

/**
 * Applies a bulk action to multiple meal rows.
 * @param {number[]} rowNumbers
 * @param {string}   action  'setStatus' | 'completeWorkflow' | 'clearWorkflow'
 * @param {*}        value   for 'setStatus', the new status string
 */
function bulkUpdateMeals(rowNumbers, action, value) {
  requireRole_(['Admin','Editor']);
  if (!rowNumbers || !rowNumbers.length) return { ok:false, message:'No rows.' };

  const sh = getTrackerSheet_();
  const lastRow = sh.getLastRow();
  const valid = rowNumbers.map(Number).filter(r => r >= 2 && r <= lastRow);
  if (!valid.length) return { ok:false, message:'No valid rows.' };

  let changed = 0;
  valid.forEach(row => {
    if (action === 'setStatus') {
      sh.getRange(row, 15).setValue(value || '');
      changed++;
    } else if (action === 'completeWorkflow') {
      sh.getRange(row, 9, 1, 6).setValues([[true,true,true,true,true,true]]);
      changed++;
    } else if (action === 'clearWorkflow') {
      sh.getRange(row, 9, 1, 6).setValues([[false,false,false,false,false,false]]);
      changed++;
    }
  });

  _logActivity('edit', 'meal', {
    sheet: TRACKER_SHEET, row: valid.join(','),
    details: 'Bulk ' + action + (value ? '=' + value : '') + ' on ' + changed + ' row(s)'
  });
  _cacheInvalidate(CACHE_KEYS.DASHBOARD);
  _cacheInvalidate(CACHE_KEYS.META);

  return { ok:true, updated:changed, action, value };
}

/* -------------------- BOOKMARKS -------------------- */

const BOOKMARK_PROP_PREFIX = 'bookmarks_';

function _bookmarkKey() {
  const email = getCurrentUserEmail_() || 'anon';
  return BOOKMARK_PROP_PREFIX + email.replace(/[^a-z0-9]/gi, '_');
}

function getBookmarks() {
  requireRole_(VALID_ROLES);
  try {
    const raw = PropertiesService.getUserProperties().getProperty(_bookmarkKey());
    return { bookmarks: raw ? JSON.parse(raw) : [] };
  } catch (e) {
    return { bookmarks: [] };
  }
}

/**
 * Adds or removes a bookmark.
 * @param {string} type  'meal' | 'ingredient' | 'audit'
 * @param {string} key   unique identifier (meal name, ingredient name, auditId)
 * @param {string} label display label
 * Returns: { bookmarks: [...], added: bool }
 */
function toggleBookmark(type, key, label) {
  requireRole_(VALID_ROLES);
  const propKey = _bookmarkKey();
  let bookmarks = [];
  try {
    const raw = PropertiesService.getUserProperties().getProperty(propKey);
    if (raw) bookmarks = JSON.parse(raw);
  } catch (e) {}

  const existing = bookmarks.findIndex(b => b.type === type && b.key === key);
  let added;
  if (existing >= 0) {
    bookmarks.splice(existing, 1);
    added = false;
  } else {
    bookmarks.unshift({ type, key, label: label || key, ts: Date.now() });
    if (bookmarks.length > 100) bookmarks = bookmarks.slice(0, 100);
    added = true;
  }
  PropertiesService.getUserProperties().setProperty(propKey, JSON.stringify(bookmarks));
  return { bookmarks, added };
}

/* ============================================================
 * BATCH 5 BACKEND — COLLABORATION
 * - Comments + @mentions (#16)
 * - Email notifications   (#17)
 * - My Tasks view         (#18)
 * - Approve/reject        (#19)
 * ============================================================ */

const COMMENTS_SHEET = 'Comments';

/* -------------------- COMMENTS SHEET -------------------- */

function ensureCommentsSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(COMMENTS_SHEET);
  if (sh) return sh;

  sh = ss.insertSheet(COMMENTS_SHEET);
  var headers = ['Comment ID','Entity Type','Entity Key','Author','Text','Mentions','Timestamp','Resolved'];
  sh.getRange(1,1,1,headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1f6e3f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(3, 220);
  sh.setColumnWidth(5, 400);
  sh.setColumnWidth(6, 260);
  try { sh.hideSheet(); } catch (e) {}
  return sh;
}

/* -------------------- ADD COMMENT -------------------- */

/**
 * Adds a comment to any entity.
 * @param {string} entityType  'meal' | 'ingredient' | 'quality' | 'audit'
 * @param {string} entityKey   unique identifier (meal name, ingredient name, auditId)
 * @param {string} text        comment text, may contain @email mentions
 */
function addComment(entityType, entityKey, text) {
  requireRole_(['Admin','Editor']);
  if (!text || !text.trim()) throw new Error('Comment text is required.');
  if (!entityKey) throw new Error('Entity key is required.');

  var sh = ensureCommentsSheet_();
  var author = getCurrentUserEmail_();
  var commentId = 'C' + Date.now().toString(36).toUpperCase();
  var timestamp = new Date();

  // Extract @mentions from text
  var mentionPattern = /@([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi;
  var mentions = [];
  var match;
  while ((match = mentionPattern.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  // Also support @firstname format — resolve against Access Control sheet
  var shortMentionPattern = /@(\w+)/g;
  while ((match = shortMentionPattern.exec(text)) !== null) {
    var name = match[1].toLowerCase();
    // Skip if it's already a full email we caught above
    if (name.indexOf('@') >= 0) continue;
    // Try to find in Access Control
    var resolved = resolveShortMention_(name);
    if (resolved && mentions.indexOf(resolved) === -1) {
      mentions.push(resolved);
    }
  }

  var row = [
    commentId,
    entityType,
    entityKey,
    author,
    text.trim(),
    mentions.join(', '),
    timestamp,
    ''
  ];
  sh.appendRow(row);

  _logActivity('add', 'comment', {
    name: entityKey,
    details: 'Comment by ' + author + ': ' + text.trim().substring(0, 80)
  });

  // Send email notifications to mentioned users (#17)
  if (mentions.length) {
    sendMentionNotifications_(author, entityType, entityKey, text.trim(), mentions);
  }

  return { ok:true, commentId:commentId, mentions:mentions };
}

/**
 * Resolves a short @name to a full email by searching the Access Control sheet.
 */
function resolveShortMention_(name) {
  var sh = ensureAccessSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  var data = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    var email = String(data[i][0] || '').toLowerCase().trim();
    // Match on the part before @ or the full email
    var localPart = email.split('@')[0] || '';
    if (localPart === name || email === name) {
      return email;
    }
  }
  return null;
}

/* -------------------- READ COMMENTS -------------------- */

/**
 * Gets all comments for a specific entity, or all comments if no entity specified.
 */
function getComments(entityType, entityKey) {
  requireRole_(VALID_ROLES);
  var sh = ensureCommentsSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { comments: [] };

  var data = sh.getRange(2, 1, lastRow - 1, 8).getValues();
  var comments = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (entityType && String(r[1]) !== entityType) continue;
    if (entityKey && String(r[2]) !== entityKey) continue;
    comments.push({
      commentId:  String(r[0]),
      entityType: String(r[1]),
      entityKey:  String(r[2]),
      author:     String(r[3] || ''),
      text:       String(r[4] || ''),
      mentions:   String(r[5] || ''),
      timestamp:  r[6] instanceof Date ? r[6].toISOString() : String(r[6] || ''),
      resolved:   String(r[7] || '')
    });
  }
  // Sort newest first
  comments.reverse();
  return { comments: comments };
}

/**
 * Resolves/unresolves a comment.
 */
function toggleResolveComment(commentId) {
  requireRole_(['Admin','Editor']);
  var sh = ensureCommentsSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok:false };
  var data = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === commentId) {
      var cell = sh.getRange(i + 2, 8);
      var current = String(cell.getValue() || '');
      cell.setValue(current ? '' : 'resolved');
      return { ok:true, resolved: !current };
    }
  }
  return { ok:false };
}

/* -------------------- EMAIL NOTIFICATIONS (#17) -------------------- */

function sendMentionNotifications_(author, entityType, entityKey, text, mentions) {
  var entityLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);
  var subject = '💬 ' + author.split('@')[0] + ' mentioned you in ' + entityLabel + ': ' + entityKey;

  var body = '<div style="font-family:Segoe UI,sans-serif;max-width:500px">' +
    '<div style="background:#16a974;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0">' +
    '<h3 style="margin:0">💬 New Mention</h3></div>' +
    '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">' +
    '<p style="color:#6b7280;font-size:12px;margin:0 0 8px">' +
    entityLabel + ': <b>' + entityKey + '</b></p>' +
    '<p style="margin:0 0 12px">' + text.replace(/\n/g, '<br>') + '</p>' +
    '<p style="color:#6b7280;font-size:12px">— ' + author + '</p>' +
    '</div></div>';

  mentions.forEach(function(email) {
    if (email === author) return; // don't email yourself
    try {
      MailApp.sendEmail({
        to: email,
        subject: subject,
        htmlBody: body
      });
    } catch (e) {
      Logger.log('Mention email failed for ' + email + ': ' + e);
    }
  });
}

/* -------------------- MY TASKS (#18) -------------------- */

/**
 * Returns items relevant to the current user:
 * - Comments they're mentioned in
 * - Meals/ingredients they've commented on
 * - Items pending their approval
 */
function getMyTasks() {
  requireRole_(VALID_ROLES);
  var email = getCurrentUserEmail_();
  var sh = ensureCommentsSheet_();
  var lastRow = sh.getLastRow();

  var mentionedIn = [];
  var myComments  = [];

  if (lastRow >= 2) {
    var data = sh.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r[0]) continue;
      var comment = {
        commentId:  String(r[0]),
        entityType: String(r[1]),
        entityKey:  String(r[2]),
        author:     String(r[3] || ''),
        text:       String(r[4] || ''),
        mentions:   String(r[5] || ''),
        timestamp:  r[6] instanceof Date ? r[6].toISOString() : String(r[6] || ''),
        resolved:   String(r[7] || '')
      };

      // Am I mentioned?
      if (comment.mentions.toLowerCase().indexOf(email) >= 0 && !comment.resolved) {
        mentionedIn.push(comment);
      }
      // Did I write this?
      if (comment.author.toLowerCase() === email) {
        myComments.push(comment);
      }
    }
  }

  // Items pending approval (meals with status "Pending Approval")
  var pendingApproval = [];
  try {
    var dashData = getDashboardData();
    (dashData.meals || []).forEach(function(m) {
      if ((m.status || '').toLowerCase() === 'pending approval') {
        pendingApproval.push({
          entityType: 'meal',
          entityKey:  m.name,
          row:        m.row,
          chef:       m.chef,
          status:     m.status
        });
      }
    });
  } catch (e) {}

  // Pending ingredient approvals
  try {
    var ingData = getIngredientsData();
    (ingData.items || []).forEach(function(it) {
      if ((it.done || '').toLowerCase() === 'pending') {
        pendingApproval.push({
          entityType: 'ingredient',
          entityKey:  it.name,
          row:        it.row,
          brand:      it.brand,
          status:     it.done
        });
      }
    });
  } catch (e) {}

  return {
    email: email,
    mentionedIn:     mentionedIn.slice(0, 50),
    myComments:      myComments.slice(0, 50),
    pendingApproval: pendingApproval.slice(0, 50),
    totalMentions:   mentionedIn.length,
    totalPending:    pendingApproval.length
  };
}

/* -------------------- APPROVE / REJECT (#19) -------------------- */

/**
 * Approves or rejects a meal (changes status from "Pending Approval" to target).
 */
function approveMeal(rowNum, decision, comment) {
  requireRole_(['Admin']);
  var sh = getTrackerSheet_();
  var current = String(sh.getRange(rowNum, 15).getValue() || '');

  var newStatus;
  if (decision === 'approve') {
    newStatus = 'Launched';
  } else if (decision === 'reject') {
    newStatus = 'Not Qualified';
  } else {
    throw new Error('Decision must be "approve" or "reject".');
  }

  sh.getRange(rowNum, 15).setValue(newStatus);

  // Add a comment if provided
  var mealName = String(sh.getRange(rowNum, 2).getDisplayValue() || '');
  if (comment) {
    addComment('meal', mealName, '[' + decision.toUpperCase() + '] ' + comment);
  }

  _logActivity('edit', 'meal', {
    name: mealName, sheet: TRACKER_SHEET, row: rowNum,
    details: decision.toUpperCase() + ': ' + current + ' → ' + newStatus + (comment ? ' — ' + comment : '')
  });
  _cacheInvalidate(CACHE_KEYS.DASHBOARD);
  _cacheInvalidate(CACHE_KEYS.META);

  return { ok:true, row:rowNum, oldStatus:current, newStatus:newStatus };
}

/**
 * Submits a meal for approval (sets status to "Pending Approval").
 */
function submitForApproval(rowNum) {
  requireRole_(['Admin','Editor']);
  var sh = getTrackerSheet_();
  sh.getRange(rowNum, 15).setValue('Pending Approval');

  var mealName = String(sh.getRange(rowNum, 2).getDisplayValue() || '');
  _logActivity('edit', 'meal', {
    name: mealName, sheet: TRACKER_SHEET, row: rowNum,
    details: 'Submitted for approval'
  });
  _cacheInvalidate(CACHE_KEYS.DASHBOARD);
  return { ok:true, row:rowNum, name:mealName };
}
// Replaced below by the unified getGalleryPhotos() at end of file





function convertDriveLink(url) {

  if (!url) return '';

  url = url.toString();

  const match = url.match(/[-\w]{25,}/);

  if (match) {

    return `https://drive.google.com/uc?export=view&id=${match[0]}`;

  }

  return url;

}
/* ================= GALLERY ================= */

/**
 * Extracts a photo URL from a cell.
 * Cells store photos as =IMAGE("url", 1) formulas.
 * getValues() returns an empty string for these cells, so we use
 * getFormulas() and parse the URL out of the IMAGE formula.
 * Falls back to checking the raw value if it already contains a URL.
 */
function extractImageUrl_(value, formula) {
  if (formula) {
    const m = formula.match(/=IMAGE\("([^"]+)"/i);
    if (m) return m[1].replace(/""/g, '"');
  }
  const s = String(value || '');
  return s.includes('http') ? s : '';
}

function getGalleryPhotos() {
  const ss = SpreadsheetApp.getActive();
  const photos = [];

  /* ================= QUALITY PHOTOS ================= */
  ss.getSheets().forEach(sheet => {
    if (!sheet.getName().includes('Quality Points')) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const numRows = lastRow - 1;
    const range = sheet.getRange(2, 1, numRows, 9);
    const values   = range.getValues();
    const formulas = range.getFormulas();

    for (let i = 0; i < values.length; i++) {
      const itemName  = values[i][0];
      const photo1    = extractImageUrl_(values[i][1], formulas[i][1]);
      const photo2    = extractImageUrl_(values[i][2], formulas[i][2]);
      const finalPhoto = extractImageUrl_(values[i][8], formulas[i][8]);
      if (photo1)     photos.push({ name: itemName, photo: photo1,     type: 'Quality Photo' });
      if (photo2)     photos.push({ name: itemName, photo: photo2,     type: 'Quality Photo' });
      if (finalPhoto) photos.push({ name: itemName, photo: finalPhoto, type: 'Final Product' });
    }
  });

  /* ================= INGREDIENT PHOTOS ================= */
  const ingSheet = ss.getSheetByName('Ingredients Report');
  if (ingSheet) {
    const lastRow = ingSheet.getLastRow();
    if (lastRow >= 2) {
      const numRows = lastRow - 1;
      const range = ingSheet.getRange(2, 1, numRows, 3);
      const values   = range.getValues();
      const formulas = range.getFormulas();
      for (let i = 0; i < values.length; i++) {
        const ingredient = values[i][0];
        const photo = extractImageUrl_(values[i][2], formulas[i][2]);
        if (photo) photos.push({ name: ingredient, photo: photo, type: 'Ingredient' });
      }
    }
  }

  return photos.reverse();
}

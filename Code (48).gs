/******************************************************************
 * UAE NPD TRAINING DASHBOARD — Phase 1 + 2 + 3 + 4 + 4b
 * Complete consolidated Code.gs (includes PDF auto-parse)
 *
 * REQUIRES: Drive API enabled in Services (for OCR conversion)
 ******************************************************************/

// ============================================================
// CONFIG
// ============================================================
const SPREADSHEET_ID    = '13SBdYebA63355uyAPLf1HYPZxNyWtpYx7zcrbaM9Mf0';
const MASTER_SPREADSHEET_ID = SPREADSHEET_ID;  // UAE master - holds Access Control + MP Registry
const MASTER_MP_KEY     = 'UAE';
const MP_REGISTRY_SHEET = 'MP Registry';
const ALL_MARKETS_FOLDER_NAME = 'NPD Training - All Markets';

// All supported MPs. UAE is the master, the rest are clones.
const MP_DEFAULTS = [
  { key: 'UAE',         display: 'UAE' },
  { key: 'KSA-Riyadh',  display: 'KSA - Riyadh' },
  { key: 'KSA-Jeddah',  display: 'KSA - Jeddah' },
  { key: 'Qatar',       display: 'Qatar' },
  { key: 'Bahrain',     display: 'Bahrain' },
  { key: 'Oman',        display: 'Oman' },
  { key: 'Kuwait',      display: 'Kuwait' }
];

const MEALS_SHEET       = 'UAE NPD Progress Tracker';
const BH_SHEET          = 'BH NPD Meals';
const INGREDIENTS_SHEET = 'Ingredients Report';
const FIXES_SHEET       = 'Meal & Component Fixes';
const AUDITS_SHEET      = 'Audit Details';
const ACCESS_SHEET      = 'Access Control';
const ACTIVITY_SHEET    = 'Activity Log';
const FLASH_STEPS_SHEET = 'Flash Next Steps';

const QUALITY_PREFIX = 'Quality Points/';
const QUALITY_TEMPLATE_SHEET = 'Quality Points/April';
const COMMENTS_SHEET = 'Comments';

const PHOTO_FOLDER_NAME = 'UAE NPD Dashboard - Photos';  // Legacy fallback - real folders are per-MP
const PDF_FOLDER_NAME   = 'UAE NPD Dashboard - Audit PDFs';

const VALID_ROLES = ['Admin', 'Editor', 'Viewer'];
const ADMIN_ROLES = ['Admin'];
const WRITE_ROLES = ['Admin', 'Editor'];

const COL = {
  ANALYSIS:    1, NAME: 2, COST_PCT: 3, FHS: 4, MORE_THAN_3X: 5,
  CHEF:        6, DIET: 7, TYPE: 8,
  IDEATION:    9, CREATION: 10, DASHBOARDING: 11,
  MP_TASTING: 12, NPD_TASTING: 13, APPROVING: 14,
  STATUS:     15, NOTE: 16, PHOTO: 17
};

const BH_COL = {
  SR_NO: 1, NAME: 2, PHOTO: 3, SIZE: 4, FOOD_COST: 5,
  TEXTURE: 6, FLAVOUR: 7, RATING: 8,
  COMMENTS: 9, CATEGORY: 10, DATE: 11
};

const BH_SUBSECTIONS = ['Calo Core', 'Calo Black', 'Premium Meals', 'Custom Macros', 'Calo Cafe', 'Calo Marketplace'];

const QUALITY_COL = {
  NAME: 1, PHOTO1: 2, PHOTO2: 3, COMMENT: 4,
  CORRECTIVE: 5, STATUS: 6, NOTES: 7, ASSESSMENT_DATE: 8,
  FINAL_PRODUCT_PHOTO: 9
};

const ING_COL = {
  INGREDIENT: 1, BRAND: 2, PHOTO: 3, STATUS: 4, REASON: 5,
  DONE: 6, NOTE: 7, DEADLINE: 8, PRIORITY: 9, SC_NOTES: 10
};

const FIX_COL = {
  ID: 1, DATE: 2, TYPE: 3, NAME: 4, ISSUE: 5, PHOTO: 6,
  STATUS: 7, ASSIGNED_TO: 8, PRIORITY: 9, NOTES: 10,
  REPORTED_BY: 11, UPDATED_AT: 12
};

const AUDIT_COL = {
  AUDIT_ID: 1, DATE: 2, AUDITOR: 3, SECTION: 4, QUESTION: 5,
  QUESTION_ID: 6, RESULT: 7, COMMENT: 8, PHOTO_REFS: 9,
  PHOTO_COUNT: 10, PDF_LINK: 11, PHOTO_URLS: 12, EXTRA: 13
};

// Known audit sections (used to validate parser output)
const KNOWN_SECTIONS = [
  'BUTCHERY', 'COMMISSORY', 'HOT SECTION', 'ROASTING SECTION',
  'PORTIONING', 'CLEANING AND SANITATION', 'BAKERY & PASTRY',
  'SAUCE SECTION', 'GARDE MANGER', 'OPERATIONAL'
];

// ============================================================
// MENU + ENTRY POINTS
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 UAE NPD Dashboard')
    .addItem('🚀 Open Dashboard', 'showDashboard')
    .addSeparator()
    .addItem('🔧 Setup / Verify Sheets', 'setupSheets')
    .addItem('📋 View Activity Log', 'openActivityLog')
    .addSeparator()
    .addItem('📧 Setup Weekly Email Trigger', 'setupWeeklyTrigger')
    .addItem('📩 Send Weekly Report Now (Admin)', 'sendWeeklyReport')
    .addToUi();
}

function doGet(e) {
  return HtmlService.createTemplateFromFile('Dashboard')
    .evaluate()
    .setTitle('UAE NPD Training Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// SLACK WEBHOOK — doPost handler for Slack Events API
// ============================================================
// Deploy this script as a Web App (Execute as: Me, Who has access: Anyone)
// and use the /exec URL as the Slack Events API Request URL.
//
// Required Script Property (set in Project Settings → Script Properties):
//   SLACK_SIGNING_SECRET  — from api.slack.com/apps → Your App → Basic Information → Signing Secret

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var payload = JSON.parse(body);

    // Slack URL verification handshake
    if (payload.type === 'url_verification') {
      return ContentService.createTextOutput(JSON.stringify({ challenge: payload.challenge }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Verify request signature
    if (!_verifySlackSignature_(e)) {
      Logger.log('Slack: invalid signature');
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid_signature' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Process message events
    if (payload.type === 'event_callback') {
      // Deduplicate: Slack retries if we don't respond within 3s.
      // Cache the event_id so retries are ignored without re-processing.
      var eventId = payload.event_id || '';
      if (eventId) {
        var cache = CacheService.getScriptCache();
        if (cache.get('slk_' + eventId)) {
          return ContentService.createTextOutput(JSON.stringify({ ok: true }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        cache.put('slk_' + eventId, '1', 3600);
      }

      var ev = payload.event;

      // Write debug row to master sheet so we can inspect the raw payload
      _writeSlackDebug_(ev, body);

      if (ev && ev.type === 'message') {
        // Check done-reply patterns FIRST (both workflow types come from bot usernames
        // that would also match the new-fix detectors, so order matters).
        if (_isWorkflowDoneMessage_(ev)) {
          var doneName = _parseWorkflowDoneName_(ev);
          Logger.log('Slack Done reply (meal-fixes): name=' + doneName + ' thread_ts=' + (ev.thread_ts || 'none'));
          _markFixDoneByName_(doneName, ev.thread_ts);
        } else if (_isRecipeUpdatedDoneMessage_(ev)) {
          // "Recipe Updated 🚀" button clicked — recipe name comes from the thread map
          Logger.log('Slack Done reply (recipe-scaling): thread_ts=' + (ev.thread_ts || 'none'));
          _markFixDoneByName_(null, ev.thread_ts);
        // New-fix detectors: recipe-scaling BEFORE meal-fixes (its username contains "fixes")
        } else if (_isRecipeScalingMessage_(ev)) {
          var rsParsed = _parseRecipeScalingMessage_(ev);
          Logger.log('Recipe Scaling fix: name=' + rsParsed.name + ' mp=' + rsParsed.mpKey);
          _addSlackFix_(rsParsed.mpKey, ev, payload.event_id || '', ev.username || 'Workflow', rsParsed);
        // Original Meal Fixes Workflow
        } else if (_isWorkflowMessage_(ev)) {
          var parsed = _parseWorkflowMessage_(ev);
          if (parsed && parsed.mpKey) {
            _addSlackFix_(parsed.mpKey, ev, payload.event_id || '', parsed.requester, parsed);
          } else {
            Logger.log('Slack workflow: could not identify MP — check "Apply changes to" field. parsed=' + JSON.stringify(parsed));
          }
        } else if (!ev.subtype && !ev.bot_id) {
          // Regular user message (no subtype, no bot)
          var hasBotToken = !!PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
          var posterName = hasBotToken ? _getSlackUserName_(ev.user) : (ev.user || 'Unknown');
          var posterAllowed = hasBotToken ? _isAllowedPoster_(posterName) : true;
          if (!posterAllowed) {
            Logger.log('Slack: ignored message from ' + posterName + ' (not in allowed list)');
          } else {
            var mpKey = _identifyMpFromText_(ev.text || '');
            if (mpKey) {
              _addSlackFix_(mpKey, ev, payload.event_id || '', posterName, null);
            } else {
              Logger.log('Slack: no market keyword found in message from ' + posterName);
            }
          }
        } else {
          Logger.log('Slack: message skipped — subtype=' + ev.subtype + ' bot_id=' + ev.bot_id +
            ' username=' + ev.username + ' — not matched as workflow or user message');
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Write one debug row to a "Slack Debug" sheet in the master spreadsheet.
// This is always visible even when Logger.log is delayed.
function _writeSlackDebug_(ev, rawBody) {
  try {
    var ss = SpreadsheetApp.openById(MASTER_SPREADSHEET_ID);
    var sh = ss.getSheetByName('Slack Debug');
    if (!sh) {
      sh = ss.insertSheet('Slack Debug');
      sh.getRange(1, 1, 1, 6).setValues([['Timestamp', 'event.type', 'subtype', 'bot_id', 'username', 'text (first 300)']]);
      sh.getRange(1, 1, 1, 6).setFontWeight('bold');
    }
    sh.appendRow([
      new Date(),
      ev ? ev.type : '(no event)',
      ev ? (ev.subtype || '') : '',
      ev ? (ev.bot_id || '') : '',
      ev ? (ev.username || '') : '',
      ev ? ((ev.text || '').substring(0, 300)) : rawBody.substring(0, 300)
    ]);
  } catch (err) {
    Logger.log('_writeSlackDebug_ error: ' + err);
  }
}

function _verifySlackSignature_(e) {
  // Google Apps Script Web Apps do not expose HTTP request headers — e.headers is always
  // undefined. HMAC-SHA256 signature verification is therefore not possible in this runtime.
  // Security relies on the webhook URL remaining secret (it is a long unguessable GAS URL).
  // We log a notice and allow the request through.
  if (!e || !e.headers || typeof e.headers !== 'object') {
    Logger.log('Slack: headers unavailable (GAS limitation) — skipping signature check');
    return true;
  }
  var secret = PropertiesService.getScriptProperties().getProperty('SLACK_SIGNING_SECRET');
  if (!secret) return true;
  try {
    var timestamp = e.headers['X-Slack-Request-Timestamp'];
    var slackSig  = e.headers['X-Slack-Signature'];
    if (!timestamp || !slackSig) return true; // headers present but fields missing — allow
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;
    var sigBase  = 'v0:' + timestamp + ':' + (e.postData ? e.postData.contents : '');
    var computed = 'v0=' + Utilities.computeHmacSha256Signature(sigBase, secret)
      .map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    return computed === slackSig;
  } catch (err) {
    Logger.log('Slack signature error: ' + err);
    return true; // don't block on unexpected errors
  }
}

// Returns true if the bot message looks like a "Meal Fixes Workflow" structured post.
function _isWorkflowMessage_(ev) {
  var username = (ev.username || '').toLowerCase();
  var text = ev.text || '';
  return username.indexOf('workflow') !== -1 ||
    username.indexOf('fixes') !== -1 ||
    /apply changes to/i.test(text);
}

// Parse a structured Slack Workflow message into named fields.
// Handles backtick labels (`Label` value), bold (*Label* value), colon (Label: value).
function _parseWorkflowMessage_(ev) {
  var rawText = ev.text || '';

  // Extract requester — message contains "requested by <@USERID>" or plain name
  var requester = 'Unknown';
  var requesterIdMatch = rawText.match(/requested by\s+<@([A-Z0-9]+)>/i);
  if (requesterIdMatch) {
    var userId = requesterIdMatch[1];
    var looked = _getSlackUserName_(userId);
    // Use real name if lookup succeeded, otherwise show user ID (better than "Workflow")
    requester = (looked && looked !== userId) ? looked : userId;
  } else {
    // Plain name format: "requested by Ahmed Mohamed"
    var reqMatch = rawText.match(/requested by\s+([^\n<@,]+)/i);
    if (reqMatch) requester = reqMatch[1].replace(/[<>:]/g, '').trim();
  }

  // Clean text (strips @mentions, converts <URL> → URL, normalises whitespace)
  var combined = _cleanSlackText_(rawText);

  var mpRaw   = _extractField_(combined, 'Apply changes to');
  var mpKey   = mpRaw ? _identifyMpFromText_(mpRaw) : null;
  var name    = _extractField_(combined, 'Name');
  var details = _extractField_(combined, 'Details');
  var link    = _extractField_(combined, 'Link');

  Logger.log('Workflow parsed — MP: ' + mpKey + ' | Name: ' + name +
    ' | Requester: ' + requester + ' | Link: ' + link);
  return { mpKey: mpKey, name: name, details: details, link: link, requester: requester };
}

// Detect the workflow "Done" reply: "X is now fixed on the dashboard"
function _isWorkflowDoneMessage_(ev) {
  var text = ev.text || '';
  return /is now fixed on the dashboard/i.test(text);
}

// Extract the fix name from the done reply.
// Message format: "Just to let you know that {NAME} is now fixed on the dashboard 🚀"
function _parseWorkflowDoneName_(ev) {
  var text = _cleanSlackText_(ev.text || '');
  var m = text.match(/that\s+(.+?)\s+is now fixed on the dashboard/i);
  return m ? m[1].trim() : null;
}

// Detect the #recipe-fixes-scaling "Recipe Updated 🚀" done reply.
// When clicked, the workflow sends a reply in the thread — we detect it by
// "recipe updated" text plus a thread_ts linking back to the original post.
function _isRecipeUpdatedDoneMessage_(ev) {
  var text = (ev.text || '').toLowerCase();
  return !!ev.thread_ts && /recipe updated/i.test(ev.text || '');
}

// Detect a #recipe-fixes-scaling workflow post.
// These come from a bot named "Recipe Fixes and Scaling" and DON'T have "Apply changes to".
function _isRecipeScalingMessage_(ev) {
  var username = (ev.username || '').toLowerCase();
  return (username.indexOf('recipe') >= 0 && username.indexOf('scaling') >= 0) ||
    /recipe.fixes.scaling/i.test(username);
}

// Parse a #recipe-fixes-scaling / Recipe Fix & Adjustments workflow post.
// Slack posts the form fields as labeled lines. Recipe name = first non-label line.
function _parseRecipeScalingMessage_(ev) {
  var text = _cleanSlackText_(ev.text || '');

  // Try explicit field labels first (Slack Workflow Builder posts them as "Label: value")
  var mpRaw    = _extractField_(text, 'MP Name') || _extractField_(text, 'MP') || '';
  var details  = _extractField_(text, 'Details of the issue') || _extractField_(text, 'Details') || '';
  var rootCause = _extractField_(text, 'What is the root cause of the Issue') ||
                  _extractField_(text, 'Root cause') || _extractField_(text, 'Root Cause') || '';
  var requester = _extractField_(text, 'Requester Name') || _extractField_(text, 'Requester') || '';

  // Recipe name: first non-empty line that doesn't look like a label
  var lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  var name = '';
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    // Skip lines that look like field labels or values matching known fields
    if (/^(MP|Details|Root|Requester|Apply)/i.test(l)) continue;
    if (l === mpRaw || l === details || l === rootCause || l === requester) continue;
    name = l;
    break;
  }
  if (!name) name = lines[0] || 'Unknown Recipe';

  // MP: try explicit field first, fall back to keyword scan of full text
  var mpKey = (mpRaw ? _identifyMpFromText_(mpRaw) : null) ||
              _identifyMpFromText_(text) || MASTER_MP_KEY;

  Logger.log('RecipeScaling parsed — name: ' + name + ' | mp: ' + mpKey +
    ' | rootCause: ' + rootCause + ' | requester: ' + requester);
  return {
    name: name, mpKey: mpKey, type: 'Recipe',
    details: [rootCause, details].filter(Boolean).join(' — ') || null,
    requester: requester || null
  };
}

// Look up fix name from the thread→fix map (stored when fix was created).
function _getThreadFixInfo_(threadTs) {
  if (!threadTs) return null;
  try {
    var map = JSON.parse(
      PropertiesService.getScriptProperties().getProperty('SLACK_THREAD_MP_MAP') || '{}'
    );
    var entry = map[threadTs];
    if (!entry) return null;
    // Support both old string format (just mpKey) and new JSON format {mp, name}
    try { return JSON.parse(entry); } catch(e) { return { mp: entry, name: null }; }
  } catch(e) { return null; }
}

// Search MP spreadsheets for a fix with the given name and mark it Done.
// threadTs: Slack thread_ts of the original fix post — used to resolve the exact MP.
function _markFixDoneByName_(fixName, threadTs) {
  var registry = _getMpRegistry_();

  // Resolve MP from stored thread→fix map (avoids cross-MP name collisions)
  var mpKeyHint = null;
  if (threadTs) {
    var info = _getThreadFixInfo_(threadTs);
    if (info) {
      mpKeyHint = info.mp || null;
      // If no name was passed (recipe-scaling done reply), use the stored name
      if (!fixName && info.name) fixName = info.name;
      Logger.log('Slack Done: thread_ts=' + threadTs + ' → MP=' + mpKeyHint + ' name=' + fixName);
    } else {
      Logger.log('Slack Done: thread_ts=' + threadTs + ' not found in thread map');
    }
  }
  if (!fixName) { Logger.log('Slack Done: no fix name to search for'); return; }
  var fixNameLower = fixName.toLowerCase();

  // If we know the MP, restrict search to it; otherwise fall back to all MPs
  var targets = mpKeyHint
    ? registry.filter(function(mp) { return mp.key === mpKeyHint; })
    : registry;
  if (mpKeyHint && targets.length === 0) {
    Logger.log('Slack Done: MP "' + mpKeyHint + '" not in registry, searching all MPs');
    targets = registry;
  }

  var updatedCount = 0;
  targets.forEach(function(mp) {
    try {
      var ss = SpreadsheetApp.openById(mp.spreadsheetId);
      var sh = ss.getSheetByName(FIXES_SHEET);
      if (!sh || sh.getLastRow() < 2) return;
      var lastRow = sh.getLastRow();
      // Read NAME (col 4) and STATUS (col 7) together
      var data = sh.getRange(2, FIX_COL.NAME, lastRow - 1, FIX_COL.STATUS - FIX_COL.NAME + 1).getValues();
      for (var i = 0; i < data.length; i++) {
        var rowName   = String(data[i][0] || '').trim().toLowerCase();
        var statusIdx = FIX_COL.STATUS - FIX_COL.NAME; // offset within the range
        var rowStatus = String(data[i][statusIdx] || '').trim().toLowerCase();
        if (rowName === fixNameLower && rowStatus !== 'done') {
          var sheetRow = i + 2;
          sh.getRange(sheetRow, FIX_COL.STATUS).setValue('Done');
          sh.getRange(sheetRow, FIX_COL.UPDATED_AT).setValue(new Date().toISOString());
          SpreadsheetApp.flush();
          PropertiesService.getScriptProperties()
            .setProperty('MOD_' + mp.spreadsheetId + '_fixes', String(Date.now()));
          _bustSectionCache_('fixes');
          updatedCount++;
          Logger.log('Slack Done: marked "' + fixName + '" as Done in MP ' + mp.key + ' row ' + sheetRow);
        }
      }
    } catch(err) {
      Logger.log('_markFixDoneByName_ error MP ' + mp.key + ': ' + err);
    }
  });
  if (updatedCount === 0) {
    Logger.log('Slack Done: no open fix found matching "' + fixName + '"');
  }
}

// Extract a labeled field value from text.
// Handles: `Label` value  |  *Label* value  |  Label: value  |  Label  value
function _extractField_(text, label) {
  if (!text || !label) return null;
  var escaped = label.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  // Match label wrapped in backticks, asterisks, or bare — followed by colon or whitespace
  var re = new RegExp('[`*]?' + escaped + '[`*]?[:\\s]+([^\\n`]+)', 'i');
  var m = text.match(re);
  return m ? m[1].trim() : null;
}

// Detect which MP a Slack message belongs to by scanning for market keywords.
function _identifyMpFromText_(text) {
  var t = text.toUpperCase();
  if (t.indexOf('UAE') !== -1)     return 'UAE';
  if (t.indexOf('RIYADH') !== -1)  return 'KSA-Riyadh';
  if (t.indexOf('JEDDAH') !== -1)  return 'KSA-Jeddah';
  if (t.indexOf('QATAR') !== -1)   return 'Qatar';
  if (t.indexOf('BAHRAIN') !== -1) return 'Bahrain';
  if (t.indexOf('OMAN') !== -1)    return 'Oman';
  if (t.indexOf('KUWAIT') !== -1)  return 'Kuwait';
  return null;
}

// Check if a poster name is in the allowed list.
// The list is stored in Script Property SLACK_ALLOWED_POSTERS as comma-separated names.
// If the property is not set, falls back to the hardcoded default list.
var _ALLOWED_POSTERS_DEFAULT_ = ['Ahmed Mohamed', 'Chandan Kumar', 'Hazem Khalil'];

function _isAllowedPoster_(name) {
  if (!name) return false;
  var nameLower = name.toLowerCase().trim();
  var listStr = PropertiesService.getScriptProperties().getProperty('SLACK_ALLOWED_POSTERS');
  var list = listStr
    ? listStr.split(',').map(function(s){ return s.trim().toLowerCase(); })
    : _ALLOWED_POSTERS_DEFAULT_.map(function(s){ return s.toLowerCase(); });
  return list.some(function(allowed){ return nameLower.indexOf(allowed) !== -1 || allowed.indexOf(nameLower) !== -1; });
}

function _detectPriorityFromText_(text) {
  var t = text.toUpperCase();
  if (/URGENT|CRITICAL|ASAP|!!/.test(t)) return 'Critical';
  if (/\bMED(IUM)?\b|\bSOON\b/.test(t))  return 'Medium';
  return 'Low';
}

// Return the first line of already-cleaned text, capped at 80 chars.
function _extractNameFromSlack_(text) {
  var first = (text || '').split('\n')[0].trim();
  return first.length > 80 ? first.substring(0, 77) + '...' : (first || 'Slack Issue');
}

// Fetch the Slack user's display name.
// Checks SLACK_USER_MAP Script Property first (format: "U123=Ahmed Mohamed,U456=Chandan Kumar").
// Falls back to Slack users.info API if SLACK_BOT_TOKEN is set.
function _getSlackUserName_(userId) {
  if (!userId) return 'Unknown';

  // Check local map first — works without bot token
  var mapStr = PropertiesService.getScriptProperties().getProperty('SLACK_USER_MAP');
  if (mapStr) {
    var entries = mapStr.split(',');
    for (var i = 0; i < entries.length; i++) {
      var parts = entries[i].split('=');
      if (parts.length >= 2 && parts[0].trim() === userId) {
        return parts.slice(1).join('=').trim();
      }
    }
  }

  // Fall back to Slack API
  var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) return userId;
  try {
    var resp = UrlFetchApp.fetch('https://slack.com/api/users.info?user=' + encodeURIComponent(userId), {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var data = JSON.parse(resp.getContentText());
    if (data.ok && data.user) {
      return data.user.real_name || data.user.display_name || data.user.name || userId;
    }
  } catch (err) { Logger.log('Slack user lookup error: ' + err); }
  return userId;
}

// Get the permanent Slack link to a message (requires SLACK_BOT_TOKEN).
function _getSlackPermalink_(channelId, ts) {
  var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token || !channelId || !ts) return null;
  try {
    var resp = UrlFetchApp.fetch(
      'https://slack.com/api/chat.getPermalink?channel=' + encodeURIComponent(channelId) +
      '&message_ts=' + encodeURIComponent(ts),
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    var data = JSON.parse(resp.getContentText());
    return data.ok ? data.permalink : null;
  } catch(e) { Logger.log('getPermalink error: ' + e); return null; }
}

// Send a Slack DM to each mentioned email (requires SLACK_BOT_TOKEN).
function _sendMentionSlackDMs_(mentionedEmails, sectionLabel, itemName, itemText, reporterName) {
  var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token || !mentionedEmails || mentionedEmails.length === 0) return;
  mentionedEmails.forEach(function(email) {
    try {
      var lookupResp = UrlFetchApp.fetch(
        'https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email),
        { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
      );
      var userData = JSON.parse(lookupResp.getContentText());
      if (!userData.ok || !userData.user) {
        Logger.log('Slack DM: user not found for ' + email);
        return;
      }
      UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
        method: 'post',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
        payload: JSON.stringify({
          channel: userData.user.id,
          text: ':wave: You were mentioned in *' + sectionLabel + '*: *' + itemName + '*\n\n' +
                (reporterName ? '_By ' + reporterName + '_\n\n' : '') +
                '"' + itemText + '"\n\nCheck the NPD Training Dashboard for details.'
        }),
        muteHttpExceptions: true
      });
    } catch(e) { Logger.log('Slack DM failed to ' + email + ': ' + e); }
  });
}

// Write a new fix row into the correct MP spreadsheet.
// parsed: object from _parseWorkflowMessage_ (name/details/link/requester), or null for free-text messages.
function _addSlackFix_(mpKey, event, eventId, posterName, parsed) {
  var mp = _findMpByKey_(mpKey);
  if (!mp) {
    // MP not in registry — do NOT fall back to UAE. Log and stop.
    Logger.log('_addSlackFix_: MP key "' + mpKey + '" not found in registry. ' +
      'Run checkSlackSetup() to diagnose. Message discarded to prevent cross-MP data leak.');
    return;
  }

  var ss = SpreadsheetApp.openById(mp.spreadsheetId);
  var sh = ss.getSheetByName(FIXES_SHEET);
  if (!sh) { Logger.log('_addSlackFix_: "Meal & Component Fixes" sheet not found in ' + mpKey); return; }

  var lastRow = sh.getLastRow();
  var newRow  = Math.max(lastRow + 1, 2);

  // Collect existing IDs to avoid collision
  var existingIds = {};
  if (lastRow >= 2) {
    sh.getRange(2, FIX_COL.ID, lastRow - 1, 1).getValues().forEach(function(r) {
      if (r[0]) existingIds[String(r[0]).trim()] = true;
    });
  }
  var fixId;
  do { fixId = _generateFixId_(); } while (existingIds[fixId]);

  var rawText  = event.text || '';
  var dateVal  = event.ts ? new Date(parseFloat(event.ts) * 1000) : new Date();
  posterName   = posterName || _getSlackUserName_(event.user);

  var fixName, issue, notes;
  if (parsed && parsed.name) {
    // Structured workflow message — use parsed fields directly
    fixName = parsed.name;
    issue   = parsed.details || _cleanSlackText_(rawText);
    notes   = '[Via Slack Workflow | MP: ' + mp.display + ']' +
              (parsed.link ? '\nLink: ' + parsed.link : '');
    // Use requester from form if available (recipe-scaling workflow)
    if (parsed.requester) posterName = parsed.requester;
  } else {
    // Free-text user message — derive name from first line
    var text = _cleanSlackText_(rawText);
    fixName  = _extractNameFromSlack_(text);
    issue    = text;
    notes    = '[Via Slack | MP: ' + mp.display + ']';
  }

  var reportedBy = posterName + ' (Slack)';

  // Get Slack permalink and append to notes
  var permalink = _getSlackPermalink_(event.channel, event.ts);
  if (permalink) notes = notes + '\nSlack: ' + permalink;

  sh.getRange(newRow, FIX_COL.ID).setValue(fixId);
  sh.getRange(newRow, FIX_COL.DATE).setValue(dateVal);
  sh.getRange(newRow, FIX_COL.TYPE).setValue(parsed && parsed.type ? parsed.type : 'Slack');
  sh.getRange(newRow, FIX_COL.NAME).setValue(fixName);
  sh.getRange(newRow, FIX_COL.ISSUE).setValue(issue);
  sh.getRange(newRow, FIX_COL.STATUS).setValue('Pending');
  sh.getRange(newRow, FIX_COL.ASSIGNED_TO).setValue('');
  sh.getRange(newRow, FIX_COL.PRIORITY).setValue(_detectPriorityFromText_(rawText));
  sh.getRange(newRow, FIX_COL.NOTES).setValue(notes);
  sh.getRange(newRow, FIX_COL.REPORTED_BY).setValue(reportedBy);
  sh.getRange(newRow, FIX_COL.UPDATED_AT).setValue(new Date());
  SpreadsheetApp.flush();

  // Store thread_ts → {mp, name} so done-reply handler finds the right fix
  try {
    var ts = event.ts || '';
    if (ts) {
      var props = PropertiesService.getScriptProperties();
      var mapStr = props.getProperty('SLACK_THREAD_MP_MAP') || '{}';
      var threadMap = JSON.parse(mapStr);
      var mapKeys = Object.keys(threadMap);
      if (mapKeys.length >= 400) {
        mapKeys.sort().slice(0, 100).forEach(function(k) { delete threadMap[k]; });
      }
      threadMap[ts] = JSON.stringify({ mp: mpKey, name: fixName });
      props.setProperty('SLACK_THREAD_MP_MAP', JSON.stringify(threadMap));
    }
  } catch(tErr) { Logger.log('Thread→MP store error: ' + tErr); }

  // Signal the dashboard that fixes data changed for this MP
  PropertiesService.getScriptProperties()
    .setProperty('MOD_' + mp.spreadsheetId + '_fixes', String(Date.now()));
  Logger.log('Slack fix added: ' + fixId + ' | MP: ' + mpKey + ' | by: ' + posterName);
}

// Diagnostic: run from Apps Script editor to verify Slack + MP Registry setup.
// Shows which MPs are registered, which Script Properties are set, and warns about gaps.
function checkSlackSetup() {
  var props = PropertiesService.getScriptProperties();
  var hasSigningSecret = !!props.getProperty('SLACK_SIGNING_SECRET');
  var hasBotToken      = !!props.getProperty('SLACK_BOT_TOKEN');
  var allowedPosters   = props.getProperty('SLACK_ALLOWED_POSTERS') || '(using defaults: Ahmed Mohamed, Chandan Kumar, Hazem Khalil)';

  var registry = _getMpRegistry_();
  var lines = [
    '=== Slack + MP Registry Diagnostic ===',
    '',
    '-- Script Properties --',
    'SLACK_SIGNING_SECRET : ' + (hasSigningSecret ? '✅ set' : '❌ MISSING — signature verification will be skipped'),
    'SLACK_BOT_TOKEN      : ' + (hasBotToken ? '✅ set' : '⚠️  not set — poster name filter disabled, raw user IDs will be stored'),
    'SLACK_ALLOWED_POSTERS: ' + allowedPosters,
    '',
    '-- MP Registry (' + registry.length + ' entries) --'
  ];

  registry.forEach(function(mp) {
    var isUAE = mp.key === MASTER_MP_KEY;
    var label = isUAE ? ' (master — always included)' : '';
    try {
      var ss = SpreadsheetApp.openById(mp.spreadsheetId);
      var fixSheet = ss.getSheetByName(FIXES_SHEET);
      var fixStatus = fixSheet
        ? '✅ "Meal & Component Fixes" exists (' + Math.max(fixSheet.getLastRow() - 1, 0) + ' rows)'
        : '❌ "Meal & Component Fixes" sheet MISSING';
      lines.push('  [' + mp.key + '] ' + mp.display + label);
      lines.push('    Spreadsheet: ' + mp.spreadsheetId);
      lines.push('    ' + fixStatus);
    } catch (err) {
      lines.push('  [' + mp.key + '] ' + mp.display + label);
      lines.push('    Spreadsheet: ' + mp.spreadsheetId);
      lines.push('    ❌ Cannot open spreadsheet: ' + err);
    }
  });

  var unregistered = ['KSA-Riyadh', 'KSA-Jeddah', 'Qatar', 'Bahrain', 'Oman', 'Kuwait']
    .filter(function(k) { return !registry.some(function(r){ return r.key === k; }); });

  if (unregistered.length) {
    lines.push('');
    lines.push('-- Unregistered MPs (Slack messages for these will be DISCARDED) --');
    unregistered.forEach(function(k) { lines.push('  ⚠️  ' + k + ' — add to "MP Registry" sheet with its own spreadsheet ID'); });
  }

  var msg = lines.join('\n');
  Logger.log(msg);
  SpreadsheetApp.getUi().alert('Slack Setup Check', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

// Strip Slack user/channel mention tags and clean up whitespace.
function _cleanSlackText_(text) {
  return (text || '')
    .replace(/<@[A-Z0-9]+>/g, '')     // remove @user mentions
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')  // #channel → #channel-name
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')      // links with label
    .replace(/<([^>]+)>/g, '$1')                 // bare URLs
    .replace(/\s+/g, ' ').trim();
}

function showDashboard() {
  var html = HtmlService.createTemplateFromFile('Dashboard')
    .evaluate().setWidth(1400).setHeight(900)
    .setTitle('UAE NPD Training Dashboard');
  SpreadsheetApp.getUi().showModalDialog(html, 'UAE NPD Training Dashboard');
}

function openActivityLog() {
  var sh = _ss().getSheetByName(ACTIVITY_SHEET);
  if (!sh) { setupSheets(); sh = _ss().getSheetByName(ACTIVITY_SHEET); }
  if (sh) { _ss().setActiveSheet(sh); sh.showSheet(); }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
// SHEET ACCESS — with per-execution caching for speed
// ============================================================

// Per-execution caches. Reset between script invocations, fast within one call.
var _SS_CACHE = {};          // ssId → SpreadsheetApp handle
var _REGISTRY_CACHE = null;  // _getMpRegistry_ result
var _MP_KEY_CACHE = null;    // current MP key
var _DASHBOARD_CACHE = null; // getDashboardData result

function _openSs_(ssId) {
  if (_SS_CACHE[ssId]) return _SS_CACHE[ssId];
  _SS_CACHE[ssId] = SpreadsheetApp.openById(ssId);
  return _SS_CACHE[ssId];
}

function _ss() { return _openSs_(_currentSpreadsheetId_()); }

// ============================================================
// MULTI-MARKET (MP) SUPPORT
// ============================================================

// Open the master spreadsheet (UAE) — holds Access Control + MP Registry
function _master_() { return _openSs_(MASTER_SPREADSHEET_ID); }

// ============================================================
// BIDIRECTIONAL SYNC — Sheet ↔ Dashboard
// ============================================================

// Maps sheet name → section key used by the frontend cache
function _sheetNameToSection_(name) {
  if (!name) return null;
  if (MEALS_SHEET_ALIASES.indexOf(name) !== -1) return 'meals';
  if (name === BH_SHEET)          return 'bh';
  if (name === INGREDIENTS_SHEET) return 'ingredients';
  if (name === FIXES_SHEET)       return 'fixes';
  if (name === AUDITS_SHEET)      return 'audits';
  if (name.indexOf(QUALITY_PREFIX) === 0) return 'quality';
  return null;
}

// Write a "last modified" timestamp for a section so the dashboard can detect stale cache
function _touchSync_(section) {
  try {
    var ssId = _currentSpreadsheetId_();
    PropertiesService.getScriptProperties()
      .setProperty('MOD_' + ssId + '_' + section, String(Date.now()));
  } catch(e) { Logger.log('_touchSync_ error: ' + e); }
}

// ─── Section cache helpers (5-minute script cache per MP) ────────────────────
function _scKey_(section) { return 'sc2_' + _currentMpKey_() + '_' + section; }
function _getSectionCache_(section) {
  try { var v = CacheService.getScriptCache().get(_scKey_(section)); return v ? JSON.parse(v) : null; } catch(e) { return null; }
}
function _setSectionCache_(section, data) {
  try {
    var s = JSON.stringify(data);
    if (s.length < 95000) CacheService.getScriptCache().put(_scKey_(section), s, 300);
  } catch(e) {}
}
function _bustSectionCache_(section) {
  try { CacheService.getScriptCache().remove(_scKey_(section)); } catch(e) {}
}
function bustAllSectionCaches() {
  ['meals','bh','quality','ingredients','fixes','audits'].forEach(function(s){ _bustSectionCache_(s); });
  return 'All section caches cleared.';
}
// ─────────────────────────────────────────────────────────────────────────────

// Called by the frontend every 30 s to check for external sheet edits
function getLastModifiedTimestamp() {
  requireRole_(VALID_ROLES);
  var ssId = _currentSpreadsheetId_();
  var props = PropertiesService.getScriptProperties();
  var sections = ['meals', 'bh', 'quality', 'ingredients', 'fixes', 'audits'];
  var result = {};
  sections.forEach(function(s) {
    var val = props.getProperty('MOD_' + ssId + '_' + s);
    result[s] = val ? parseInt(val) : 0;
  });
  return result;
}

// Simple trigger: fires when anyone edits the spreadsheet directly
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheetName = e.range.getSheet().getName();
    var section = _sheetNameToSection_(sheetName);
    if (!section) return;
    var ssId = e.source.getId();
    PropertiesService.getScriptProperties()
      .setProperty('MOD_' + ssId + '_' + section, String(Date.now()));
  } catch(ex) { Logger.log('onEdit error: ' + ex); }
}

// Get current user's selected MP (per-user, persists across sessions)
function _currentMpKey_() {
  if (_MP_KEY_CACHE !== null) return _MP_KEY_CACHE;
  var key = '';
  try { key = PropertiesService.getUserProperties().getProperty('CURRENT_MP_KEY') || ''; } catch(e) {}
  _MP_KEY_CACHE = key || MASTER_MP_KEY;
  return _MP_KEY_CACHE;
}

function _setCurrentMpKey_(key) {
  try { PropertiesService.getUserProperties().setProperty('CURRENT_MP_KEY', key); } catch(e) {}
  // Invalidate caches that depend on the MP
  _MP_KEY_CACHE = key;
  _SS_CACHE = {};
  _DASHBOARD_CACHE = null;
}

// Read MP Registry from master. Returns [{key, display, spreadsheetId}].
// Always includes UAE as the master, regardless of registry contents.
function _getMpRegistry_() {
  if (_REGISTRY_CACHE) return _REGISTRY_CACHE;
  var result = [{ key: MASTER_MP_KEY, display: 'UAE', spreadsheetId: MASTER_SPREADSHEET_ID }];
  try {
    var reg = _master_().getSheetByName(MP_REGISTRY_SHEET);
    if (reg && reg.getLastRow() >= 2) {
      var data = reg.getRange(2, 1, reg.getLastRow() - 1, 3).getValues();
      for (var i = 0; i < data.length; i++) {
        var key = String(data[i][0] || '').trim();
        var display = String(data[i][1] || '').trim();
        var ssId = String(data[i][2] || '').trim();
        if (key && ssId && key !== MASTER_MP_KEY) {
          result.push({ key: key, display: display || key, spreadsheetId: ssId });
        }
      }
    }
  } catch(e) {}
  _REGISTRY_CACHE = result;
  return result;
}

function _findMpByKey_(key) {
  var reg = _getMpRegistry_();
  for (var i = 0; i < reg.length; i++) if (reg[i].key === key) return reg[i];
  return null;
}

function _currentSpreadsheetId_() {
  var key = _currentMpKey_();
  var mp = _findMpByKey_(key);
  return mp ? mp.spreadsheetId : MASTER_SPREADSHEET_ID;
}

function _currentMpDisplay_() {
  var key = _currentMpKey_();
  var mp = _findMpByKey_(key);
  return mp ? mp.display : 'UAE';
}

// Alternative sheet names some MP spreadsheets use (cloned sheets may differ from UAE)
const MEALS_SHEET_ALIASES = ['UAE NPD Progress Tracker', 'NPD Progress Tracker'];

function _meals() {
  var ss = _ss();
  for (var i = 0; i < MEALS_SHEET_ALIASES.length; i++) {
    var sh = ss.getSheetByName(MEALS_SHEET_ALIASES[i]);
    if (sh) return sh;
  }
  throw new Error('Meals sheet not found. Expected one of: ' + MEALS_SHEET_ALIASES.join(', '));
}

// ============================================================
// SETUP
// ============================================================

function setupSheets() {
  var ss = _ss();
  
  var access = ss.getSheetByName(ACCESS_SHEET);
  if (!access) {
    access = ss.insertSheet(ACCESS_SHEET);
    access.getRange(1, 1, 1, 3).setValues([['Email', 'Role', 'Notes']]);
    access.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#0f9d58').setFontColor('#ffffff');
    access.getRange(2, 1, 1, 3).setValues([['a.mohamed@calo.app', 'Admin', 'Auto-seeded super admin']]);
    access.setColumnWidth(1, 220); access.setColumnWidth(2, 100); access.setColumnWidth(3, 280);
    access.hideSheet();
  }
  
  var log = ss.getSheetByName(ACTIVITY_SHEET);
  if (!log) {
    log = ss.insertSheet(ACTIVITY_SHEET);
    log.getRange(1, 1, 1, 6).setValues([['Timestamp', 'User', 'Role', 'Action', 'Entity', 'Details']]);
    log.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#0f9d58').setFontColor('#ffffff');
    log.setFrozenRows(1);
  }
  
  ensurePhotoFolder_();
  ensurePdfFolder_();
  
  SpreadsheetApp.getUi().alert('✅ Setup Complete',
    'All sheets ready. Photo + PDF folders ready in Drive.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================
// AUTH / ROLES
// ============================================================

function getUserRole_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch(e) {}
  if (!email) return { email: '', role: 'Denied', allowed: false, reason: 'Cannot detect email' };
  email = email.toLowerCase().trim();
  
  var registry = _getMpRegistry_();
  var allMpKeys = registry.map(function(m){ return m.key; });
  
  // Read Access Control from MASTER (UAE) — single source of truth
  var access = _master_().getSheetByName(ACCESS_SHEET);
  if (!access || access.getLastRow() < 2) {
    return { email: email, role: 'Admin', allowed: true,
             currentMp: _currentMpKey_(), accessibleMps: allMpKeys, mpRegistry: registry };
  }
  
  // Read up to 4 columns: Email | Role | Notes | Allowed MPs
  var lastCol = Math.max(3, access.getLastColumn());
  var readCols = Math.min(4, lastCol);
  var data = access.getRange(2, 1, access.getLastRow() - 1, readCols).getValues();
  
  for (var i = 0; i < data.length; i++) {
    var rowEmail = String(data[i][0] || '').toLowerCase().trim();
    var rowRole  = String(data[i][1] || '').trim();
    var allowedMpsStr = readCols >= 4 ? String(data[i][3] || '').trim() : '';
    
    if (rowEmail === email && VALID_ROLES.indexOf(rowRole) >= 0) {
      var accessibleMps;
      if (rowRole === 'Admin') {
        accessibleMps = allMpKeys.slice();  // Admins access all MPs
      } else if (allowedMpsStr === '' || allowedMpsStr === '*') {
        accessibleMps = [MASTER_MP_KEY];    // Default for non-admins = UAE only
      } else {
        accessibleMps = allowedMpsStr.split(',')
          .map(function(s){ return s.trim(); })
          .filter(function(s){ return allMpKeys.indexOf(s) >= 0; });
        if (accessibleMps.length === 0) accessibleMps = [MASTER_MP_KEY];
      }
      
      // Validate currentMp is accessible; if not, snap to first accessible
      var currentMp = _currentMpKey_();
      if (accessibleMps.indexOf(currentMp) === -1) {
        currentMp = accessibleMps[0] || MASTER_MP_KEY;
        _setCurrentMpKey_(currentMp);
      }
      
      return {
        email: email, role: rowRole, allowed: true,
        currentMp: currentMp,
        currentMpDisplay: _findMpByKey_(currentMp) ? _findMpByKey_(currentMp).display : currentMp,
        accessibleMps: accessibleMps,
        mpRegistry: registry
      };
    }
  }
  return { email: email, role: 'Denied', allowed: false, reason: 'Email not in Access Control' };
}

function requireRole_(allowedRoles) {
  var u = getUserRole_();
  if (!u.allowed) throw new Error('Access denied: ' + (u.reason || 'unauthorized'));
  if (allowedRoles && allowedRoles.indexOf(u.role) === -1) {
    throw new Error('Access denied: requires ' + allowedRoles.join(' or ') + ' role');
  }
  return u;
}

function getCurrentUser() { return getUserRole_(); }

function getSessionEmail() {
  try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || ''; }
  catch(e) { return ''; }
}

function verifyLogin(email, password) {
  if (!email) return { ok: false, error: 'Email is required' };
  email = email.toLowerCase().trim();
  if (!password) return { ok: false, error: 'Password is required' };

  var access = _master_().getSheetByName(ACCESS_SHEET);
  if (!access || access.getLastRow() < 2) return { ok: true };

  var lastCol = Math.max(4, access.getLastColumn());
  var readCols = Math.min(5, lastCol);
  var data = access.getRange(2, 1, access.getLastRow() - 1, readCols).getValues();

  for (var i = 0; i < data.length; i++) {
    var rowEmail = String(data[i][0] || '').toLowerCase().trim();
    var rowRole  = String(data[i][1] || '').trim();
    var rowPwd   = readCols >= 5 ? String(data[i][4] || '').trim() : '';
    if (rowEmail === email && VALID_ROLES.indexOf(rowRole) >= 0) {
      if (!rowPwd) return { ok: true, firstTime: true };   // no password set yet
      if (rowPwd === password) return { ok: true };
      return { ok: false, error: 'Incorrect password' };
    }
  }
  return { ok: false, error: 'Email not authorized. Please contact your Admin.' };
}

function setPassword(email, newPassword) {
  if (!email || !newPassword) return { ok: false, error: 'Email and password are required' };
  if (newPassword.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
  email = email.toLowerCase().trim();

  var access = _master_().getSheetByName(ACCESS_SHEET);
  if (!access || access.getLastRow() < 2) return { ok: false, error: 'Access Control sheet not found' };

  var lastCol = Math.max(4, access.getLastColumn());
  var readCols = Math.min(5, lastCol);
  var data = access.getRange(2, 1, access.getLastRow() - 1, readCols).getValues();

  for (var i = 0; i < data.length; i++) {
    var rowEmail = String(data[i][0] || '').toLowerCase().trim();
    var rowRole  = String(data[i][1] || '').trim();
    var rowPwd   = readCols >= 5 ? String(data[i][4] || '').trim() : '';
    if (rowEmail === email && VALID_ROLES.indexOf(rowRole) >= 0) {
      if (rowPwd) return { ok: false, error: 'Password already set. Use Change Password instead.' };
      access.getRange(i + 2, 5).setValue(newPassword);
      SpreadsheetApp.flush();
      return { ok: true };
    }
  }
  return { ok: false, error: 'Email not found in Access Control' };
}

function requestPasswordReset(email) {
  if (!email) return { ok: false, error: 'Email is required' };
  email = email.toLowerCase().trim();

  var access = _master_().getSheetByName(ACCESS_SHEET);
  if (!access || access.getLastRow() < 2) return { ok: false, error: 'Email not found' };

  var data = access.getRange(2, 1, access.getLastRow() - 1, 2).getValues();
  var found = false;
  for (var i = 0; i < data.length; i++) {
    var rowEmail = String(data[i][0] || '').toLowerCase().trim();
    var rowRole  = String(data[i][1] || '').trim();
    if (rowEmail === email && VALID_ROLES.indexOf(rowRole) >= 0) { found = true; break; }
  }
  if (!found) return { ok: false, error: 'No account found for this email address' };

  // Generate 6-digit OTP and store with 15-min expiry
  var code = String(Math.floor(100000 + Math.random() * 900000));
  var expiry = Date.now() + 15 * 60 * 1000;
  var props = PropertiesService.getScriptProperties();
  props.setProperty('PWD_RESET_' + email, JSON.stringify({ code: code, expiry: expiry }));

  try {
    MailApp.sendEmail({
      to: email,
      subject: 'CALO NPD Dashboard – Password Reset Code',
      body: [
        'Hello,',
        '',
        'You requested a password reset for the CALO NPD Training Dashboard.',
        '',
        'Your reset code is: ' + code,
        '',
        'This code expires in 15 minutes. If you did not request a reset, ignore this email.',
        '',
        '— CALO NPD Dashboard'
      ].join('\n')
    });
  } catch(e) {
    return { ok: false, error: 'Failed to send email: ' + e.message };
  }
  return { ok: true };
}

function confirmPasswordReset(email, code, newPassword) {
  if (!email || !code || !newPassword) return { ok: false, error: 'All fields are required' };
  if (newPassword.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
  email = email.toLowerCase().trim();
  code  = String(code).trim();

  var props = PropertiesService.getScriptProperties();
  var raw   = props.getProperty('PWD_RESET_' + email);
  if (!raw) return { ok: false, error: 'No reset code found. Please request a new one.' };

  var data;
  try { data = JSON.parse(raw); } catch(e) { return { ok: false, error: 'Invalid reset state. Please request a new code.' }; }

  if (Date.now() > data.expiry) {
    props.deleteProperty('PWD_RESET_' + email);
    return { ok: false, error: 'Reset code has expired. Please request a new one.' };
  }
  if (data.code !== code) return { ok: false, error: 'Incorrect reset code.' };

  // Code is valid — update the password
  var access = _master_().getSheetByName(ACCESS_SHEET);
  if (!access || access.getLastRow() < 2) return { ok: false, error: 'Access Control sheet not found' };

  var lastCol  = Math.max(4, access.getLastColumn());
  var readCols = Math.min(5, lastCol);
  var rows = access.getRange(2, 1, access.getLastRow() - 1, readCols).getValues();
  for (var i = 0; i < rows.length; i++) {
    var rowEmail = String(rows[i][0] || '').toLowerCase().trim();
    var rowRole  = String(rows[i][1] || '').trim();
    if (rowEmail === email && VALID_ROLES.indexOf(rowRole) >= 0) {
      access.getRange(i + 2, 5).setValue(newPassword);
      SpreadsheetApp.flush();
      props.deleteProperty('PWD_RESET_' + email);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Email not found in Access Control' };
}

function changePassword(email, currentPassword, newPassword) {
  if (!email || !currentPassword || !newPassword) return { ok: false, error: 'All fields are required' };
  if (newPassword.length < 6) return { ok: false, error: 'New password must be at least 6 characters' };
  email = email.toLowerCase().trim();

  var access = _master_().getSheetByName(ACCESS_SHEET);
  if (!access || access.getLastRow() < 2) return { ok: false, error: 'Access Control sheet not found' };

  var lastCol = Math.max(4, access.getLastColumn());
  var readCols = Math.min(5, lastCol);
  var data = access.getRange(2, 1, access.getLastRow() - 1, readCols).getValues();

  for (var i = 0; i < data.length; i++) {
    var rowEmail = String(data[i][0] || '').toLowerCase().trim();
    var rowRole  = String(data[i][1] || '').trim();
    var rowPwd   = readCols >= 5 ? String(data[i][4] || '').trim() : '';
    if (rowEmail === email && VALID_ROLES.indexOf(rowRole) >= 0) {
      if (rowPwd && rowPwd !== currentPassword) return { ok: false, error: 'Current password is incorrect' };
      access.getRange(i + 2, 5).setValue(newPassword);
      SpreadsheetApp.flush();
      return { ok: true };
    }
  }
  return { ok: false, error: 'Email not found in Access Control' };
}

// User-callable: switch active MP
function setActiveMp(mpKey) {
  var user = getUserRole_();
  if (!user.allowed) throw new Error('Access denied');
  if (!mpKey) throw new Error('MP key required');
  if (user.accessibleMps.indexOf(mpKey) === -1) {
    throw new Error('You are not authorized to access ' + mpKey);
  }
  _setCurrentMpKey_(mpKey);
  return { ok: true, currentMp: mpKey };
}

// ============================================================
// INITIAL DATA — ONE CALL FOR EVERYTHING
// ============================================================

function getInitialData() {
  var user = getUserRole_();
  if (!user.allowed) return { user: user };
  
  // Phase 5b: Lightweight initial load — only Meals + metadata + MP context.
  // Other sections are fetched lazily by the frontend when the tab is opened.
  var dashboard = null, meta = null, performers = null;
  try { dashboard  = getDashboardData(); }            catch(e) { dashboard  = { meals:[], totals:{}, filters:{} }; }
  try { meta       = getFormMetadata(); }             catch(e) { meta       = { chefs:[], diets:[], types:[], statuses:[] }; }
  try { performers = getPerformanceStats(dashboard); } catch(e) { performers = null; }
  
  return {
    user: user, dashboard: dashboard, meta: meta, performers: performers,
    knownSections: KNOWN_SECTIONS,
    spreadsheetUrl: _ss().getUrl(),
    currentMp: user.currentMp || MASTER_MP_KEY,
    currentMpDisplay: user.currentMpDisplay || 'UAE',
    accessibleMps: user.accessibleMps || [MASTER_MP_KEY],
    mpRegistry: user.mpRegistry || _getMpRegistry_()
  };
}

// ============================================================
// LAZY SECTION ENDPOINTS — called on-demand from frontend
// ============================================================

function getMealsSection() {
  requireRole_(VALID_ROLES);
  var _c = _getSectionCache_('meals'); if (_c) return _c;
  var dashboard = null, performers = null, meta = null;
  try { dashboard  = getDashboardData(); }            catch(e) { dashboard  = { meals:[], totals:{}, filters:{} }; }
  try { performers = getPerformanceStats(dashboard); } catch(e) { performers = null; }
  try { meta       = getFormMetadata(); }             catch(e) { meta = null; }
  var _r = { dashboard: dashboard, performers: performers, meta: meta };
  _setSectionCache_('meals', _r);
  return _r;
}

function getBhSection() {
  requireRole_(VALID_ROLES);
  var _c = _getSectionCache_('bh'); if (_c) return _c;
  try {
    var bh = getBhData();
    var sh = _ss().getSheetByName(BH_SHEET);
    var meta = null;
    if (sh) {
      meta = {
        textures:   _getColDropdownOptions_(sh, BH_COL.TEXTURE),
        flavours:   _getColDropdownOptions_(sh, BH_COL.FLAVOUR),
        ratings:    _getColDropdownOptions_(sh, BH_COL.RATING),
        categories: BH_SUBSECTIONS
      };
      meta.textures = _mergeUnique_(meta.textures, (bh.filters || {}).textures || []);
      meta.flavours = _mergeUnique_(meta.flavours, (bh.filters || {}).flavours || []);
      meta.ratings  = _mergeUnique_(meta.ratings,  (bh.filters || {}).ratings  || []);
    }
    var _r = { bh: bh, meta: meta };
    _setSectionCache_('bh', _r);
    return _r;
  }
  catch(e) { return { bh: { meals:[], totals:{}, filters:{}, subsections:{} }, meta: null }; }
}

function getQualitySection() {
  requireRole_(VALID_ROLES);
  var _c = _getSectionCache_('quality'); if (_c) return _c;
  try {
    var quality = getQualityData();
    var qualSh = null;
    var sheets = _ss().getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().indexOf(QUALITY_PREFIX) === 0) { qualSh = sheets[i]; break; }
    }
    var meta = null;
    if (qualSh) {
      meta = { statuses: _getColDropdownOptions_(qualSh, QUALITY_COL.STATUS) };
      meta.statuses = _mergeUnique_(meta.statuses, (quality.filters || {}).statuses || []);
    }
    var _r = { quality: quality, meta: meta };
    _setSectionCache_('quality', _r);
    return _r;
  }
  catch(e) { return { quality: { entries:[], totals:{}, filters:{}, months:[] }, meta: null }; }
}

function getIngredientsSection() {
  requireRole_(VALID_ROLES);
  var _c = _getSectionCache_('ingredients'); if (_c) return _c;
  try {
    var ingredients = getIngredientsData();
    var sh = _ss().getSheetByName(INGREDIENTS_SHEET);
    var meta = null;
    if (sh) {
      meta = {
        statuses:   _getColDropdownOptions_(sh, ING_COL.STATUS),
        dones:      _getColDropdownOptions_(sh, ING_COL.DONE),
        priorities: _getColDropdownOptions_(sh, ING_COL.PRIORITY)
      };
      meta.statuses   = _mergeUnique_(meta.statuses,   (ingredients.filters || {}).statuses   || []);
      meta.dones      = _mergeUnique_(meta.dones,      (ingredients.filters || {}).dones      || []);
      meta.priorities = _mergeUnique_(meta.priorities, (ingredients.filters || {}).priorities || []);
    }
    var _r = { ingredients: ingredients, meta: meta };
    _setSectionCache_('ingredients', _r);
    return _r;
  }
  catch(e) { return { ingredients: { items:[], totals:{}, filters:{} }, meta: null }; }
}

function getFixesSection() {
  requireRole_(VALID_ROLES);
  var _c = _getSectionCache_('fixes'); if (_c) return _c;
  try {
    var fixes = getFixesData();
    var sh = _ss().getSheetByName(FIXES_SHEET);
    var meta = null;
    if (sh) {
      meta = {
        types:       _getColDropdownOptions_(sh, FIX_COL.TYPE),
        statuses:    _getColDropdownOptions_(sh, FIX_COL.STATUS),
        priorities:  _getColDropdownOptions_(sh, FIX_COL.PRIORITY),
        assignedUsers: _getColDropdownOptions_(sh, FIX_COL.ASSIGNED_TO)
      };
      meta.types      = _mergeUnique_(meta.types,      (fixes.filters || {}).types      || []);
      meta.statuses   = _mergeUnique_(meta.statuses,   (fixes.filters || {}).statuses   || []);
      meta.priorities = _mergeUnique_(meta.priorities, (fixes.filters || {}).priorities || []);
      // Always include the full known option sets regardless of what's in the data
      meta.types      = _mergeUnique_(['Recipe', 'Meal', 'Ingredient'], meta.types);
      meta.statuses   = _mergeUnique_(meta.statuses,   ['Done', 'In Progress', 'Not Done', 'Pending']);
      meta.priorities = _mergeUnique_(meta.priorities, ['Critical', 'High', 'Low', 'Medium']);
      // Table-format sheets block DataValidation API and may be empty — fall back to Script Properties
      if (!meta.assignedUsers || meta.assignedUsers.length === 0) {
        var _mpKey = _currentMpKey_();
        var _props = PropertiesService.getScriptProperties();
        var _perMp = _props.getProperty('ASSIGNED_USERS_' + _mpKey);
        var _global = _props.getProperty('ASSIGNED_USERS');
        var _fallback = _perMp || _global || '';
        if (_fallback) {
          meta.assignedUsers = _fallback.split(',')
            .map(function(s){ return s.trim(); })
            .filter(Boolean)
            .sort();
        }
      }
    }
    var _r = { fixes: fixes, meta: meta };
    _setSectionCache_('fixes', _r);
    return _r;
  }
  catch(e) { return { fixes: { items:[], totals:{}, filters:{} }, meta: null }; }
}

function getAuditsSection() {
  requireRole_(VALID_ROLES);
  var _c = _getSectionCache_('audits'); if (_c) return _c;
  try {
    var _r = { audits: getAuditsData() };
    _setSectionCache_('audits', _r);
    return _r;
  }
  catch(e) { return { audits: { rows:[], sessions:[], totals:{}, filters:{} } }; }
}

// ============================================================
// WEEKLY FLASH REPORT — Notion API Integration
// Reads a plain Notion page structured as: Year toggle > Month toggle > Week toggle > content
// Script Properties needed:
//   NOTION_TOKEN              — Notion integration token (secret_...)
//   NOTION_FLASH_PAGE_{mpKey} — Page ID for each MP (e.g. NOTION_FLASH_PAGE_UAE)
// ============================================================

var NOTION_BASE_ = 'https://api.notion.com/v1';
var NOTION_VER_  = '2022-06-28';

function _notionFetch_(path) {
  var token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN not set in Script Properties');
  var resp = UrlFetchApp.fetch(NOTION_BASE_ + path, {
    headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': NOTION_VER_ },
    muteHttpExceptions: true
  });
  var data = JSON.parse(resp.getContentText());
  if (data.object === 'error') throw new Error('Notion: ' + data.message);
  return data;
}

function _notionChildren_(blockId) {
  var results = [], cursor = null;
  do {
    var path = '/blocks/' + blockId + '/children?page_size=100';
    if (cursor) path += '&start_cursor=' + encodeURIComponent(cursor);
    var data = _notionFetch_(path);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

function _notionText_(richText) {
  if (!richText || !richText.length) return '';
  return richText.map(function(t){ return t.plain_text || ''; }).join('');
}

function _notionBlockText_(block) {
  var c = block[block.type];
  if (!c) return '';
  // Callout must be handled first — it has rich_text AND an icon
  if (block.type === 'callout') {
    var icon = (c.icon && c.icon.emoji) ? c.icon.emoji + ' ' : '';
    return icon + (c.rich_text ? _notionText_(c.rich_text) : '');
  }
  if (c.rich_text) return _notionText_(c.rich_text);
  if (c.title)     return _notionText_(c.title);
  return '';
}

// Debug: returns raw top-level block types/texts from the Notion page so we can diagnose structure issues.
function debugNotionPage() {
  requireRole_(VALID_ROLES);
  var mpKey  = _currentMpKey_();
  var pageId = PropertiesService.getScriptProperties().getProperty('NOTION_FLASH_PAGE_' + mpKey);
  if (!pageId) return { ok: false, error: 'NOTION_FLASH_PAGE_' + mpKey + ' not set in Script Properties' };

  var result = { ok: true, mpKey: mpKey, pageId: pageId, pageMeta: null, blocks: [], diagnosis: '' };

  // 1. Fetch the page object itself to confirm access and get its title
  try {
    var pageMeta = _notionFetch_('/pages/' + pageId);
    var titleProp = pageMeta.properties && (pageMeta.properties.title || pageMeta.properties.Name);
    var titleText = '';
    if (titleProp && titleProp.title) titleText = _notionText_(titleProp.title);
    result.pageMeta = { type: pageMeta.object, title: titleText, archived: pageMeta.archived };
  } catch(e) {
    result.pageMeta = { error: e.message };
    result.diagnosis = 'Cannot fetch page — check the page ID and that the integration has access to this page.';
    return result;
  }

  // 2. Fetch children
  try {
    var top = _notionChildren_(pageId);
    if (top.length === 0) {
      result.diagnosis = 'Page is accessible but has ZERO children. Either: (a) the page is empty, (b) the integration was not shared with this specific page — open the page in Notion, click Share, and add your integration, or (c) the page ID is for a parent page and the actual content is in a sub-page.';
      return result;
    }
    result.blocks = top.map(function(b) {
      var text = _notionBlockText_(b);
      if (b.type === 'child_page') text = (b.child_page && b.child_page.title) || '';
      var children = [];
      if (b.has_children) {
        try {
          var ch = _notionChildren_(b.id);
          children = ch.map(function(c) {
            var ct = _notionBlockText_(c);
            if (c.type === 'child_page') ct = (c.child_page && c.child_page.title) || '';
            var grandchildren = [];
            if (c.has_children) {
              try {
                var gc = _notionChildren_(c.id);
                grandchildren = gc.map(function(g){
                  var gt = _notionBlockText_(g);
                  if (g.type === 'child_page') gt = (g.child_page && g.child_page.title) || '';
                  return { type: g.type, text: gt, id: g.id };
                });
              } catch(e2) { grandchildren = [{ error: e2.message }]; }
            }
            return { type: c.type, text: ct, has_children: c.has_children, id: c.id, children: grandchildren };
          });
        } catch(e2) { children = [{ error: e2.message }]; }
      }
      return { type: b.type, text: text, has_children: b.has_children, id: b.id, children: children };
    });
    result.diagnosis = 'Found ' + top.length + ' top-level block(s). See structure above.';
  } catch(e) {
    result.diagnosis = 'Error fetching children: ' + e.message;
  }
  return result;
}

// Returns list of available weeks for the current MP's Notion flash report page.
function getFlashReports() {
  requireRole_(VALID_ROLES);
  var mpKey  = _currentMpKey_();
  var pageId = PropertiesService.getScriptProperties().getProperty('NOTION_FLASH_PAGE_' + mpKey);
  if (!pageId) return { configured: false, weeks: [] };

  try {
    var weeks = [];
    var seenIds = {};

    function _bt_(b) {
      if (b.type === 'child_page') return (b.child_page && b.child_page.title) ? b.child_page.title.trim() : '';
      return _notionBlockText_(b).trim();
    }
    function _isC_(b) {
      return b.has_children &&
             (b.type === 'toggle' || b.type === 'child_page' ||
              b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3');
    }
    // Heuristic: is a block title a month name (Jan-Dec)?
    function _isMonth_(t) {
      return /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(t);
    }
    // Heuristic: is a block title a section heading (not a week)?
    function _isSection_(t) {
      return /rated|meals|snapshot|overview|report|step|owner|perform|underperform|analysis|newly/i.test(t);
    }
    // Heuristic: is a block title a week entry (contains date arrow or market prefix)?
    function _isWeek_(t) {
      return /→|->|\d{1,2}(st|nd|rd|th)|UAE|KSA|Qatar|Bahrain|Kuwait|Oman/i.test(t) || (!_isMonth_(t) && !_isSection_(t) && !/^\d{4}$/.test(t));
    }

    function _addWeeksFromContainer_(containerId) {
      var children = _notionChildren_(containerId);
      // Filter to container blocks
      var containers = children.filter(_isC_);
      if (containers.length === 0) return;

      var first = _bt_(containers[0]);

      if (/^\d{4}$/.test(first)) {
        // Year level — recurse into each year
        containers.forEach(function(yb) { _addWeeksFromYear_(yb); });
      } else if (_isMonth_(first)) {
        // Month level — children are weeks
        containers.forEach(function(mb) { _addWeeksFromMonth_(mb); });
      } else if (_isSection_(first)) {
        // We've gone too deep — skip
      } else {
        // These are week entries directly
        containers.forEach(function(wb) {
          var title = _bt_(wb);
          if (title && !seenIds[wb.id]) { seenIds[wb.id] = true; weeks.push({ id: wb.id, title: title }); }
        });
      }
    }

    function _addWeeksFromYear_(yb) {
      var yearChildren = _notionChildren_(yb.id).filter(_isC_);
      if (yearChildren.length === 0) return;
      var first = _bt_(yearChildren[0]);
      if (_isMonth_(first)) {
        // year → month → week
        yearChildren.forEach(function(mb) { _addWeeksFromMonth_(mb); });
      } else {
        // year → week directly (no month level)
        yearChildren.forEach(function(wb) {
          var title = _bt_(wb);
          if (title && !_isSection_(title) && !seenIds[wb.id]) {
            seenIds[wb.id] = true; weeks.push({ id: wb.id, title: title });
          }
        });
      }
    }

    function _addWeeksFromMonth_(mb) {
      _notionChildren_(mb.id).filter(_isC_).forEach(function(wb) {
        var title = _bt_(wb);
        if (title && !_isSection_(title) && !seenIds[wb.id]) {
          seenIds[wb.id] = true; weeks.push({ id: wb.id, title: title });
        }
      });
    }

    var topBlocks = _notionChildren_(pageId);
    var topContainers = topBlocks.filter(_isC_);
    if (topContainers.length === 0) return { configured: true, weeks: [] };

    var firstText = _bt_(topContainers[0]);
    if (/^\d{4}$/.test(firstText)) {
      // Top level = year blocks
      topContainers.forEach(function(yb) { _addWeeksFromYear_(yb); });
    } else if (_isMonth_(firstText)) {
      // Top level = month blocks
      topContainers.forEach(function(mb) { _addWeeksFromMonth_(mb); });
    } else if (!_isSection_(firstText)) {
      // Top level = week blocks directly
      topContainers.forEach(function(wb) {
        var title = _bt_(wb);
        if (title && !seenIds[wb.id]) { seenIds[wb.id] = true; weeks.push({ id: wb.id, title: title }); }
      });
    }

    return { configured: true, weeks: weeks };
  } catch(e) {
    Logger.log('getFlashReports error: ' + e);
    return { configured: true, error: e.message, weeks: [] };
  }
}

// Returns parsed content blocks for a specific week toggle block ID.
function getFlashReportContent(blockId) {
  requireRole_(VALID_ROLES);
  try {
    var blocks  = _notionChildren_(blockId);
    var content = _parseFlashBlocks_(blocks);
    return { ok: true, content: content };
  } catch(e) {
    Logger.log('getFlashReportContent error: ' + e);
    return { ok: false, error: e.message };
  }
}

function _parseFlashBlocks_(blocks) {
  var out = {
    snapshotBullets: [], snapshotCallout: '',
    snapshot: null,   // Snapshot Overview metrics table
    highRated: null,  // High Rated Meals table
    lowRated: null,   // Low Rated Meals table
    newMeals: null,   // New Meals table
    nextSteps: null   // Next Steps & Owners table/list
  };
  var currentSection = null;
  var tableCount = 0;

  function _detectSection_(lower) {
    if (/snapshot|overview/.test(lower) && !/high.?rated|low.?rated|new.?meal|top.?perform|underperform/.test(lower))
      return 'snapshot';
    if (/high.?rated|top.?perform/.test(lower))                          return 'highRated';
    if (/low.?rated|underperform/.test(lower))                           return 'lowRated';
    if (/new.?meal|newly.?added|new.?addition|newly\s*add/.test(lower))  return 'newMeals';
    if (/next.?step|owner/.test(lower))                                  return 'nextSteps';
    if (/analysis|week.?summary/.test(lower))                            return 'snapshot';
    return null;
  }

  function _processBlock_(block) {
    var type = block.type;
    var text = _notionBlockText_(block);
    if (type === 'child_page' && block.child_page) text = block.child_page.title || '';
    var lower = text.toLowerCase();

    // Heading / toggle blocks — either set section context or recurse if they have children
    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3' || type === 'toggle') {
      var sec = _detectSection_(lower);
      if (block.has_children) {
        var savedSection = currentSection;
        if (sec !== null) currentSection = sec;
        try { _notionChildren_(block.id).forEach(_processBlock_); } catch(e) {}
        currentSection = savedSection;
      } else {
        if (sec !== null) currentSection = sec;
      }
      return;
    }

    // Callout — always goes to snapshot analysis
    if (type === 'callout' && text) {
      out.snapshotCallout = (out.snapshotCallout ? out.snapshotCallout + '\n' : '') + text;
      return;
    }

    // Bullets / paragraphs
    if ((type === 'bulleted_list_item' || type === 'numbered_list_item' || type === 'paragraph') && text) {
      if (currentSection === 'snapshot' || currentSection === null) out.snapshotBullets.push(text);
      return;
    }

    // Tables
    if (type === 'table') {
      var tableData = _parseNotionTable_(block.id);
      var sec = currentSection;
      if (!sec) {
        // Auto-assign by order: snapshot → highRated → lowRated → newMeals
        sec = ['snapshot', 'highRated', 'lowRated', 'newMeals'][Math.min(tableCount, 3)];
      }
      tableCount++;
      if (sec === 'snapshot'   && !out.snapshot)   out.snapshot   = tableData;
      else if (sec === 'highRated' && !out.highRated) out.highRated = tableData;
      else if (sec === 'lowRated'  && !out.lowRated)  out.lowRated  = tableData;
      else if (sec === 'newMeals'  && !out.newMeals)  out.newMeals  = tableData;
      else if (sec === 'nextSteps' && !out.nextSteps)  out.nextSteps = tableData;
    }
  }

  blocks.forEach(_processBlock_);
  return out;
}

function _parseNotionTable_(tableBlockId) {
  var result = { headers: [], rows: [] };
  var first  = true;
  _notionChildren_(tableBlockId).forEach(function(row) {
    if (row.type !== 'table_row') return;
    var cells = (row.table_row.cells || []).map(function(cell) { return _notionText_(cell); });
    if (first) { result.headers = cells; first = false; }
    else        result.rows.push(cells);
  });
  return result;
}

// ============================================================
// FLASH REPORT — Next Steps (stored in Google Sheet, editable)
// ============================================================

function _flashStepsSheet_() {
  var ss = _master_();
  var sh = ss.getSheetByName(FLASH_STEPS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(FLASH_STEPS_SHEET);
    sh.getRange(1, 1, 1, 7).setValues([['Week ID', 'Week Label', 'Action', 'Owner', 'Status', 'ETA', 'Created At']]);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#00c07f').setFontColor('#ffffff');
  }
  return sh;
}

function getFlashNextSteps(weekId) {
  requireRole_(VALID_ROLES);
  var sh = _flashStepsSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [] };
  var data = sh.getRange(2, 1, last - 1, 7).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0] || '').trim() !== weekId) continue;
    rows.push({
      rowNum:    i + 2,
      action:    String(data[i][2] || ''),
      owner:     String(data[i][3] || ''),
      status:    String(data[i][4] || 'Pending'),
      eta:       String(data[i][5] || '')
    });
  }
  return { ok: true, rows: rows };
}

function addFlashNextStep(weekId, weekLabel, action, owner, status, eta) {
  requireRole_(WRITE_ROLES);
  if (!weekId) return { ok: false, error: 'Week ID required' };
  var sh = _flashStepsSheet_();
  sh.appendRow([weekId, weekLabel || '', action || '', owner || '', status || 'Pending', eta || '', new Date()]);
  SpreadsheetApp.flush();
  var newRow = sh.getLastRow();
  return { ok: true, rowNum: newRow };
}

function updateFlashNextStep(rowNum, action, owner, status, eta) {
  requireRole_(WRITE_ROLES);
  if (!rowNum || rowNum < 2) return { ok: false, error: 'Invalid row' };
  var sh = _flashStepsSheet_();
  sh.getRange(rowNum, 3, 1, 4).setValues([[action || '', owner || '', status || 'Pending', eta || '']]);
  SpreadsheetApp.flush();
  return { ok: true };
}

function deleteFlashNextStep(rowNum) {
  requireRole_(WRITE_ROLES);
  if (!rowNum || rowNum < 2) return { ok: false, error: 'Invalid row' };
  var sh = _flashStepsSheet_();
  sh.deleteRow(rowNum);
  SpreadsheetApp.flush();
  return { ok: true };
}

// ============================================================
// MEALS
// ============================================================

function getDashboardData() {
  if (_DASHBOARD_CACHE) return _DASHBOARD_CACHE;
  requireRole_(VALID_ROLES);
  var sh = _meals();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) { _DASHBOARD_CACHE = { meals: [], totals: emptyTotals_(), filters: emptyFilters_(), sheetGid: sh.getSheetId() }; return _DASHBOARD_CACHE; }
  
  var values   = sh.getRange(2, 1, lastRow - 1, 17).getValues();
  var richText = sh.getRange(2, 2, lastRow - 1, 1).getRichTextValues();
  var photoFormulas = sh.getRange(2, COL.PHOTO, lastRow - 1, 1).getFormulas();
  
  var meals = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (!r[1]) continue;
    var link = '';
    try { var rt = richText[i][0]; if (rt) link = rt.getLinkUrl() || ''; } catch(e) {}
    var photo = _extractPhoto_(photoFormulas[i], r[COL.PHOTO - 1]);
    meals.push({
      row: i + 2, analysis: parseInt(r[0]) || (i + 1),
      name: String(r[1] || '').trim(), link: link,
      costPct: parseNumeric_(r[2]), fhs: parseNumeric_(r[3]),
      moreThan3x: String(r[4] || '').trim(),
      chef: String(r[5] || '').trim(), diet: String(r[6] || '').trim(), type: String(r[7] || '').trim(),
      ideation: isTruthy_(r[8]), creation: isTruthy_(r[9]), dashboarding: isTruthy_(r[10]),
      mpTasting: isTruthy_(r[11]), npdTasting: isTruthy_(r[12]), approving: isTruthy_(r[13]),
      workflowPct: calcWorkflowPct_(r),
      status: String(r[14] || '').trim(), note: String(r[15] || '').trim(),
      photoUrl: photo.url, photoEmbedded: photo.embedded
    });
  }
  _DASHBOARD_CACHE = { meals: meals, totals: computeTotals_(meals), filters: extractFilters_(meals), sheetGid: sh.getSheetId() };
  return _DASHBOARD_CACHE;
}

function emptyTotals_() {
  return { total:0, launched:0, notLaunched:0, notQualified:0, rework:0, idea:0,
           byChef:{}, byDiet:{}, byType:{}, byStatus:{}, avgCost:0, avgFhs:0, avgWorkflow:0 };
}

function emptyFilters_() { return { chefs:[], diets:[], types:[], statuses:[] }; }

function parseNumeric_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = parseFloat(v); return isNaN(n) ? null : n;
}

function isTruthy_(v) {
  if (v === true || v === 'TRUE' || v === 'true') return true;
  if (typeof v === 'string' && v.toLowerCase() === 'yes') return true;
  return false;
}

function calcWorkflowPct_(r) {
  var steps = [r[8], r[9], r[10], r[11], r[12], r[13]];
  return Math.round((steps.filter(isTruthy_).length / 6) * 100);
}

function computeTotals_(meals) {
  var t = { total: meals.length, launched:0, notLaunched:0, notQualified:0, rework:0, idea:0,
            byChef:{}, byDiet:{}, byType:{}, byStatus:{}, avgCost:0, avgFhs:0, avgWorkflow:0 };
  var costSum = 0, costCount = 0, fhsSum = 0, fhsCount = 0, wfSum = 0;
  meals.forEach(function(m) {
    var s = (m.status || '').toLowerCase();
    if (s.indexOf('launched') === 0 && s.indexOf('not') === -1) t.launched++;
    else if (s.indexOf('not launched') === 0 || s.indexOf('not lauched') === 0) t.notLaunched++;
    else if (s.indexOf('not qual') === 0) t.notQualified++;
    else if (s.indexOf('rework') === 0) t.rework++;
    else if (s.indexOf('idea') === 0) t.idea++;
    if (m.chef)   t.byChef[m.chef]     = (t.byChef[m.chef] || 0) + 1;
    if (m.diet)   t.byDiet[m.diet]     = (t.byDiet[m.diet] || 0) + 1;
    if (m.type)   t.byType[m.type]     = (t.byType[m.type] || 0) + 1;
    if (m.status) t.byStatus[m.status] = (t.byStatus[m.status] || 0) + 1;
    if (m.costPct !== null) { costSum += m.costPct; costCount++; }
    if (m.fhs !== null)     { fhsSum  += m.fhs;     fhsCount++; }
    wfSum += m.workflowPct;
  });
  if (costCount > 0) t.avgCost = costSum / costCount;
  if (fhsCount > 0)  t.avgFhs  = fhsSum / fhsCount;
  if (meals.length > 0) t.avgWorkflow = wfSum / meals.length;
  return t;
}

function extractFilters_(meals) {
  var chefs = {}, diets = {}, types = {}, statuses = {};
  meals.forEach(function(m) {
    if (m.chef) chefs[m.chef] = true;
    if (m.diet) diets[m.diet] = true;
    if (m.type) types[m.type] = true;
    if (m.status) statuses[m.status] = true;
  });
  return {
    chefs:    Object.keys(chefs).sort(), diets: Object.keys(diets).sort(),
    types:    Object.keys(types).sort(), statuses: Object.keys(statuses).sort()
  };
}

/**
 * Read dropdown options from a sheet column.
 * Tries three methods in order:
 *   1. DataValidation rules (VALUE_IN_LIST or VALUE_IN_RANGE) on rows 2-6
 *   2. Scan all non-empty existing column values
 * Deduplicates case-insensitively and returns sorted.
 */
function _getColDropdownOptions_(sh, col) {
  var seen = {}, result = [];
  function add(v) {
    var k = String(v || '').trim();
    if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = true; result.push(k); }
  }

  // Method 1: DataValidation API — try rows 2-6 (some cells may have no rule)
  try {
    var lastRow = sh.getLastRow();
    var checkRow = lastRow >= 2 ? 2 : 2; // always check row 2 even if sheet is empty
    for (var r = 2; r <= Math.min(Math.max(lastRow, 2), 6); r++) {
      var rule = sh.getRange(r, col).getDataValidation();
      if (!rule) continue;
      var args = rule.getCriteriaValues();
      if (!args) continue;
      // Shape A: [[val1, val2, ...], showDropdown]  ← standard VALUE_IN_LIST
      if (Array.isArray(args[0])) {
        args[0].forEach(function(v) { add(v); });
        if (result.length > 0) break;
      }
      // Shape B: [val1, val2, ...]  ← sometimes returned flat
      else if (typeof args[0] === 'string') {
        args.forEach(function(v) { add(v); });
        if (result.length > 0) break;
      }
      // Shape C: [Range, ...]  ← VALUE_IN_RANGE
      else if (args[0] && typeof args[0].getValues === 'function') {
        args[0].getValues().forEach(function(row) { add(row[0]); });
        if (result.length > 0) break;
      }
    }
  } catch(e) {
    Logger.log('_getColDropdownOptions_ validation col=' + col + ': ' + e.message);
  }

  // Method 2: Scan existing non-empty column values (works even if validation unreadable)
  try {
    var lr = sh.getLastRow();
    if (lr >= 2) {
      sh.getRange(2, col, lr - 1, 1).getValues().forEach(function(row) { add(row[0]); });
    }
  } catch(e2) {
    Logger.log('_getColDropdownOptions_ scan col=' + col + ': ' + e2.message);
  }

  return result.sort();
}

// Merge two string arrays, dedup case-insensitively, return sorted
function _mergeUnique_(a, b) {
  var seen = {}, result = [];
  [].concat(a || [], b || []).forEach(function(v) {
    var k = String(v || '').trim().toLowerCase();
    if (k && !seen[k]) { seen[k] = true; result.push(String(v).trim()); }
  });
  return result.sort();
}

function getFormMetadata() {
  requireRole_(VALID_ROLES);
  var dash = getDashboardData();
  var sh;
  try { sh = _meals(); } catch(e) { sh = null; }
  // Read validation rules + existing values from the meals sheet columns
  var chefOpts = sh ? _getColDropdownOptions_(sh, COL.CHEF) : [];
  var dietOpts = sh ? _getColDropdownOptions_(sh, COL.DIET) : [];
  var typeOpts = sh ? _getColDropdownOptions_(sh, COL.TYPE) : [];
  return {
    chefs:    _mergeUnique_(chefOpts, dash.filters.chefs    || []),
    diets:    _mergeUnique_(dietOpts, dash.filters.diets    || []),
    types:    _mergeUnique_(typeOpts, dash.filters.types    || []),
    statuses: _mergeUnique_([],       dash.filters.statuses || [])
  };
}

function getPerformanceStats(dashOpt) {
  requireRole_(VALID_ROLES);
  var dash = dashOpt || getDashboardData();
  var meals = dash.meals || [];
  
  var chefLaunches = {};
  meals.forEach(function(m) {
    var s = String(m.status||'').toLowerCase();
    if (s.indexOf('launched') === 0 && s.indexOf('not') === -1 && m.chef) chefLaunches[m.chef] = (chefLaunches[m.chef] || 0) + 1;
  });
  var bestChef = { name: '—', count: 0 };
  Object.keys(chefLaunches).forEach(function(k) {
    if (chefLaunches[k] > bestChef.count) bestChef = { name: k, count: chefLaunches[k] };
  });
  
  var withCost = meals.filter(function(m) { return m.costPct !== null; });
  withCost.sort(function(a, b) { return b.costPct - a.costPct; });
  var highestCost = withCost.length > 0 ? { name: withCost[0].name, value: withCost[0].costPct } : null;
  
  var withFhs = meals.filter(function(m) { return m.fhs !== null && m.fhs > 0; });
  withFhs.sort(function(a, b) { return b.fhs - a.fhs; });
  var bestFhs = withFhs.length > 0 ? { name: withFhs[0].name, value: withFhs[0].fhs } : null;
  
  var reworkCount = {};
  meals.forEach(function(m) {
    var s = String(m.status||'').toLowerCase();
    if (s.indexOf('rework') === 0 && m.chef) reworkCount[m.chef] = (reworkCount[m.chef] || 0) + 1;
  });
  var mostReworks = { name: '—', count: 0 };
  Object.keys(reworkCount).forEach(function(k) {
    if (reworkCount[k] > mostReworks.count) mostReworks = { name: k, count: reworkCount[k] };
  });
  
  return { bestChef: bestChef, highestCost: highestCost, bestFhs: bestFhs, mostReworks: mostReworks };
}

function addMeal(payload, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!payload || !payload.name) throw new Error('Meal name is required');
  
  var sh = _meals();
  var lastDataRow = 1;
  var nameColumn = sh.getRange(2, COL.NAME, sh.getMaxRows() - 1, 1).getValues();
  for (var i = 0; i < nameColumn.length; i++) {
    if (nameColumn[i][0] && String(nameColumn[i][0]).trim() !== '') lastDataRow = i + 2;
  }
  var newRow = lastDataRow + 1;
  
  var nextAnalysis = 1;
  if (lastDataRow > 1) {
    var existingNumbers = sh.getRange(2, 1, lastDataRow - 1, 1).getValues();
    var maxN = 0;
    existingNumbers.forEach(function(r) { var n = parseInt(r[0]); if (!isNaN(n) && n > maxN) maxN = n; });
    nextAnalysis = maxN + 1;
  }
  
  var rowData = [
    nextAnalysis, String(payload.name).trim(),
    payload.costPct !== null && payload.costPct !== '' ? Number(payload.costPct) / 100 : '',
    payload.fhs !== null && payload.fhs !== '' ? Number(payload.fhs) / 100 : '',
    payload.moreThan3x || '',
    payload.chef || '', payload.diet || '', payload.type || '',
    !!payload.ideation, !!payload.creation, !!payload.dashboarding,
    !!payload.mpTasting, !!payload.npdTasting, !!payload.approving,
    payload.status || 'Idea', payload.note || ''
  ];
  sh.getRange(newRow, 1, 1, 16).setValues([rowData]);
  SpreadsheetApp.flush();
  
  if (payload.link) {
    var safeLink = String(payload.link).trim();
    if (safeLink.indexOf('http') === 0) {
      var rt = SpreadsheetApp.newRichTextValue().setText(String(payload.name).trim()).setLinkUrl(safeLink).build();
      sh.getRange(newRow, COL.NAME).setRichTextValue(rt);
    }
  }
  
  var photoUrl = '';
  if (photoData && photoData.bytes) {
    try {
      photoUrl = uploadPhotoToDrive_(photoData, payload.name + ' - meal photo');
      if (photoUrl) {
        _writePhotoCell_(sh, newRow, COL.PHOTO, photoUrl, payload.name);
        SpreadsheetApp.flush();
      }
    } catch(e) { Logger.log('addMeal photo error: ' + e); }
  }
  
  _logActivity_(user, 'add', 'meal', 'Row ' + newRow + ': "' + payload.name + '" (Analysis #' + nextAnalysis + ')');
  _touchSync_('meals'); _bustSectionCache_('meals');
  return { ok: true, row: newRow, analysis: nextAnalysis, photoUrl: photoUrl };
}

// ============================================================
// BH NPD MEALS
// ============================================================

function getBhData() {
  requireRole_(VALID_ROLES);
  var sh = _ss().getSheetByName(BH_SHEET);
  if (!sh) return { meals: [], totals: emptyBhTotals_(), filters: emptyBhFilters_(), subsections: {}, sheetGid: null };

  var lastRow = sh.getLastRow();
  if (lastRow < 3) return { meals: [], totals: emptyBhTotals_(), filters: emptyBhFilters_(), subsections: {}, sheetGid: sh.getSheetId() };

  var values = sh.getRange(3, 1, lastRow - 2, 11).getValues();
  var photoFormulas = sh.getRange(3, BH_COL.PHOTO, lastRow - 2, 1).getFormulas();

  var meals = [];
  var currentCategory = '';
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var srNo = r[BH_COL.SR_NO - 1];
    var name = String(r[BH_COL.NAME - 1] || '').trim();
    if (!name) continue;

    var isHeader = (!srNo || srNo === '') && !r[BH_COL.TEXTURE - 1] && !r[BH_COL.FLAVOUR - 1] && !r[BH_COL.RATING - 1];
    if (isHeader) {
      currentCategory = name.replace(/\s*meals?\s*$/i, '').trim() || name;
      continue;
    }

    var rowCategory = String(r[BH_COL.CATEGORY - 1] || '').trim() || currentCategory;
    var photo = _extractPhoto_(photoFormulas[i], r[BH_COL.PHOTO - 1]);
    var dateStr = _parseBhDate_(r[BH_COL.DATE - 1]);

    meals.push({
      row: i + 3, srNo: srNo || '', name: name, category: rowCategory,
      photoUrl: photo.url, hasPhoto: photo.url || photo.embedded, photoEmbedded: photo.embedded,
      size: String(r[BH_COL.SIZE - 1] || '').trim(),
      foodCost: r[BH_COL.FOOD_COST - 1] || '',
      texture: String(r[BH_COL.TEXTURE - 1] || '').trim(),
      flavour: String(r[BH_COL.FLAVOUR - 1] || '').trim(),
      rating: String(r[BH_COL.RATING - 1] || '').trim(),
      comments: String(r[BH_COL.COMMENTS - 1] || '').trim(),
      date: dateStr
    });
  }
  var subs = computeBhSubsections_(meals);
  return { meals: meals, totals: computeBhTotals_(meals), filters: extractBhFilters_(meals), subsections: subs, sheetGid: sh.getSheetId() };
}

function _parseBhDate_(rawDate) {
  if (!rawDate) return '';
  if (rawDate instanceof Date) {
    if (isNaN(rawDate.getTime())) return '';
    var m = rawDate.getMonth() + 1;
    var y = rawDate.getFullYear();
    return y + '-' + (m < 10 ? '0' + m : m);
  }
  var s = String(rawDate).trim();
  if (!s || s === '0') return '';
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    var m2 = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m2 < 10 ? '0' + m2 : m2);
  }
  return s;
}

function emptyBhTotals_() {
  return { total: 0, good: 0, average: 0, poor: 0, unrated: 0, goodPct: 0,
           byCategory: {}, byTexture: {}, byFlavour: {}, byRating: {} };
}
function emptyBhFilters_() { return { categories: [], ratings: [], textures: [], flavours: [], months: [] }; }

function computeBhSubsections_(meals) {
  var result = {};
  BH_SUBSECTIONS.forEach(function(s) {
    result[s] = { name: s, total: 0, good: 0, average: 0, poor: 0, unrated: 0, goodPct: 0 };
  });
  meals.forEach(function(m) {
    var key = m.category;
    if (!key) return;
    if (!result[key]) result[key] = { name: key, total: 0, good: 0, average: 0, poor: 0, unrated: 0, goodPct: 0 };
    result[key].total++;
    var r = (m.rating || '').toLowerCase();
    if (r === 'good') result[key].good++;
    else if (r.indexOf('needs') >= 0 || r === 'average') result[key].average++;
    else if (r === 'poor') result[key].poor++;
    else result[key].unrated++;
  });
  Object.keys(result).forEach(function(k) {
    var s = result[k];
    if (s.total > 0) s.goodPct = Math.round((s.good / s.total) * 100);
  });
  return result;
}

function computeBhTotals_(meals) {
  var t = { total: meals.length, good: 0, average: 0, poor: 0, unrated: 0, goodPct: 0,
            byCategory: {}, byTexture: {}, byFlavour: {}, byRating: {} };
  meals.forEach(function(m) {
    var rating = (m.rating || '').toLowerCase();
    if (rating === 'good') t.good++;
    else if (rating.indexOf('needs') >= 0 || rating === 'average') t.average++;
    else if (rating === 'poor') t.poor++;
    else t.unrated++;
    if (m.category) t.byCategory[m.category] = (t.byCategory[m.category] || 0) + 1;
    if (m.texture)  t.byTexture[m.texture]   = (t.byTexture[m.texture] || 0) + 1;
    if (m.flavour)  t.byFlavour[m.flavour]   = (t.byFlavour[m.flavour] || 0) + 1;
    if (m.rating)   t.byRating[m.rating]     = (t.byRating[m.rating] || 0) + 1;
  });
  if (meals.length > 0) t.goodPct = Math.round((t.good / meals.length) * 100);
  return t;
}

function extractBhFilters_(meals) {
  var c={}, r={}, t={}, f={}, mo={};
  meals.forEach(function(m) {
    if (m.category) c[m.category] = true;
    if (m.rating)   r[m.rating]   = true;
    if (m.texture)  t[m.texture]  = true;
    if (m.flavour)  f[m.flavour]  = true;
    if (m.date)     mo[m.date]    = true;
  });
  return { categories: Object.keys(c).sort(), ratings: Object.keys(r).sort(),
           textures: Object.keys(t).sort(), flavours: Object.keys(f).sort(),
           months: Object.keys(mo).sort().reverse() };
}

function addBhMeal(payload, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!payload || !payload.name) throw new Error('Meal name is required');
  
  var sh = _ss().getSheetByName(BH_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + BH_SHEET);
  
  var lastDataRow = 2;
  var nameColumn = sh.getRange(3, BH_COL.NAME, sh.getMaxRows() - 2, 1).getValues();
  for (var i = 0; i < nameColumn.length; i++) {
    if (nameColumn[i][0] && String(nameColumn[i][0]).trim() !== '') lastDataRow = i + 3;
  }
  var newRow = lastDataRow + 1;
  
  var nextSrNo = 1;
  if (lastDataRow > 2) {
    var existingNumbers = sh.getRange(3, BH_COL.SR_NO, lastDataRow - 2, 1).getValues();
    var maxN = 0;
    existingNumbers.forEach(function(r) { var n = parseInt(r[0]); if (!isNaN(n) && n > maxN) maxN = n; });
    nextSrNo = maxN + 1;
  }
  
  Logger.log('addBhMeal: writing to row ' + newRow + ' with payload: ' + JSON.stringify(payload));
  
  // Write each field to its EXACT column individually. No array indexing risk.
  sh.getRange(newRow, BH_COL.SR_NO).setValue(nextSrNo);
  sh.getRange(newRow, BH_COL.NAME).setValue(String(payload.name).trim());
  sh.getRange(newRow, BH_COL.SIZE).setValue(payload.size || '');
  sh.getRange(newRow, BH_COL.FOOD_COST).setValue(payload.foodCost || '');
  sh.getRange(newRow, BH_COL.TEXTURE).setValue(payload.texture || '');
  sh.getRange(newRow, BH_COL.FLAVOUR).setValue(payload.flavour || '');
  sh.getRange(newRow, BH_COL.RATING).setValue(payload.rating || '');
  sh.getRange(newRow, BH_COL.COMMENTS).setValue(payload.comments || '');
  if (payload.category) sh.getRange(newRow, BH_COL.CATEGORY).setValue(payload.category);
  if (payload.date)     sh.getRange(newRow, BH_COL.DATE).setValue(payload.date);
  SpreadsheetApp.flush();
  
  // Upload photo and write photo cell LAST, after data is committed
  var photoUrl = '';
  if (photoData && photoData.bytes) {
    try {
      photoUrl = uploadPhotoToDrive_(photoData, 'BH - ' + payload.name);
      if (photoUrl) {
        _writePhotoCell_(sh, newRow, BH_COL.PHOTO, photoUrl, payload.name);
        SpreadsheetApp.flush();
        // Verify the photo cell was written
        var verifyFormula = sh.getRange(newRow, BH_COL.PHOTO).getFormula();
        var verifyBackup = sh.getRange(newRow, BH_COL.DATE).getValue();
        Logger.log('addBhMeal photo verify: formula="' + verifyFormula + '" backup="' + verifyBackup + '"');
      }
    } catch(e) { Logger.log('Photo upload failed: ' + e); }
  }
  
  _logActivity_(user, 'add', 'bh-meal', 'Row ' + newRow + ': "' + payload.name + '" (Sr.No ' + nextSrNo + ')');
  _touchSync_('bh'); _bustSectionCache_('bh');
  return { ok: true, row: newRow, srNo: nextSrNo, photoUrl: photoUrl };
}

// ============================================================
// ROW UPDATE FUNCTIONS
// ============================================================

function updateMeal(row, payload) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || !payload) throw new Error('row and payload required');
  var sh = _meals();
  if (payload.name       !== undefined) sh.getRange(row, COL.NAME).setValue(payload.name);
  if (payload.chef       !== undefined) sh.getRange(row, COL.CHEF).setValue(payload.chef);
  if (payload.diet       !== undefined) sh.getRange(row, COL.DIET).setValue(payload.diet);
  if (payload.type       !== undefined) sh.getRange(row, COL.TYPE).setValue(payload.type);
  if (payload.costPct    !== undefined) sh.getRange(row, COL.COST_PCT).setValue(payload.costPct);
  if (payload.fhs        !== undefined) sh.getRange(row, COL.FHS).setValue(payload.fhs);
  if (payload.moreThan3x !== undefined) sh.getRange(row, COL.MORE_THAN_3X).setValue(payload.moreThan3x);
  if (payload.status     !== undefined) sh.getRange(row, COL.STATUS).setValue(payload.status);
  if (payload.note       !== undefined) sh.getRange(row, COL.NOTE).setValue(payload.note);
  SpreadsheetApp.flush();
  _logActivity_(user, 'edit', 'meal', 'Row ' + row + ': "' + (payload.name || '') + '"');
  _touchSync_('meals'); _bustSectionCache_('meals');
  return { ok: true, row: row };
}

function updateBhMeal(row, payload) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || !payload) throw new Error('row and payload required');
  var sh = _ss().getSheetByName(BH_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + BH_SHEET);
  if (payload.name     !== undefined) sh.getRange(row, BH_COL.NAME).setValue(payload.name);
  if (payload.size     !== undefined) sh.getRange(row, BH_COL.SIZE).setValue(payload.size);
  if (payload.foodCost !== undefined) sh.getRange(row, BH_COL.FOOD_COST).setValue(payload.foodCost);
  if (payload.texture  !== undefined) sh.getRange(row, BH_COL.TEXTURE).setValue(payload.texture);
  if (payload.flavour  !== undefined) sh.getRange(row, BH_COL.FLAVOUR).setValue(payload.flavour);
  if (payload.rating   !== undefined) sh.getRange(row, BH_COL.RATING).setValue(payload.rating);
  if (payload.comments !== undefined) sh.getRange(row, BH_COL.COMMENTS).setValue(payload.comments);
  if (payload.category !== undefined) sh.getRange(row, BH_COL.CATEGORY).setValue(payload.category);
  if (payload.date     !== undefined) sh.getRange(row, BH_COL.DATE).setValue(payload.date);
  SpreadsheetApp.flush();
  _logActivity_(user, 'edit', 'bh-meal', 'Row ' + row + ': "' + (payload.name || '') + '"');
  _touchSync_('bh'); _bustSectionCache_('bh');
  return { ok: true, row: row };
}

function updateQualityEntry(sheetName, row, payload) {
  var user = requireRole_(WRITE_ROLES);
  if (!sheetName || !row || !payload) throw new Error('sheetName, row and payload required');
  var sh = _ss().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet not found: ' + sheetName);
  if (payload.name             !== undefined) sh.getRange(row, QUALITY_COL.NAME).setValue(payload.name);
  if (payload.comment          !== undefined) sh.getRange(row, QUALITY_COL.COMMENT).setValue(payload.comment);
  if (payload.correctiveAction !== undefined) sh.getRange(row, QUALITY_COL.CORRECTIVE).setValue(payload.correctiveAction);
  if (payload.status           !== undefined) sh.getRange(row, QUALITY_COL.STATUS).setValue(payload.status);
  if (payload.notes            !== undefined) sh.getRange(row, QUALITY_COL.NOTES).setValue(payload.notes);
  if (payload.assessmentDate   !== undefined) sh.getRange(row, QUALITY_COL.ASSESSMENT_DATE).setValue(payload.assessmentDate);
  SpreadsheetApp.flush();
  _logActivity_(user, 'edit', 'quality', sheetName + ' Row ' + row + ': "' + (payload.name || '') + '"');
  _touchSync_('quality'); _bustSectionCache_('quality');
  return { ok: true, row: row, sheetName: sheetName };
}

function updateIngredient(row, payload) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || !payload) throw new Error('row and payload required');
  var sh = _ss().getSheetByName(INGREDIENTS_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + INGREDIENTS_SHEET);
  if (payload.ingredient !== undefined) sh.getRange(row, ING_COL.INGREDIENT).setValue(payload.ingredient);
  if (payload.brand      !== undefined) sh.getRange(row, ING_COL.BRAND).setValue(payload.brand);
  if (payload.status     !== undefined) sh.getRange(row, ING_COL.STATUS).setValue(payload.status);
  if (payload.reason     !== undefined) sh.getRange(row, ING_COL.REASON).setValue(payload.reason);
  if (payload.done       !== undefined) sh.getRange(row, ING_COL.DONE).setValue(payload.done);
  if (payload.note       !== undefined) sh.getRange(row, ING_COL.NOTE).setValue(payload.note);
  if (payload.deadline   !== undefined) sh.getRange(row, ING_COL.DEADLINE).setValue(payload.deadline);
  if (payload.priority   !== undefined) sh.getRange(row, ING_COL.PRIORITY).setValue(payload.priority);
  if (payload.scNotes    !== undefined) sh.getRange(row, ING_COL.SC_NOTES).setValue(payload.scNotes);
  SpreadsheetApp.flush();
  _logActivity_(user, 'edit', 'ingredient', 'Row ' + row + ': "' + (payload.ingredient || '') + '"');
  _touchSync_('ingredients'); _bustSectionCache_('ingredients');
  return { ok: true, row: row };
}

function updateFix(row, payload) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || !payload) throw new Error('row and payload required');
  var sh = _ss().getSheetByName(FIXES_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + FIXES_SHEET);
  if (payload.type       !== undefined) sh.getRange(row, FIX_COL.TYPE).setValue(payload.type);
  if (payload.name       !== undefined) sh.getRange(row, FIX_COL.NAME).setValue(payload.name);
  if (payload.issue      !== undefined) sh.getRange(row, FIX_COL.ISSUE).setValue(payload.issue);
  if (payload.status     !== undefined) sh.getRange(row, FIX_COL.STATUS).setValue(payload.status);
  if (payload.assignedTo !== undefined) sh.getRange(row, FIX_COL.ASSIGNED_TO).setValue(payload.assignedTo);
  if (payload.priority   !== undefined) sh.getRange(row, FIX_COL.PRIORITY).setValue(payload.priority);
  if (payload.notes      !== undefined) sh.getRange(row, FIX_COL.NOTES).setValue(payload.notes);
  sh.getRange(row, FIX_COL.UPDATED_AT).setValue(new Date().toISOString());
  SpreadsheetApp.flush();
  _logActivity_(user, 'edit', 'fix', 'Row ' + row + ': "' + (payload.name || '') + '"');
  _touchSync_('fixes'); _bustSectionCache_('fixes');
  return { ok: true, row: row };
}

// ============================================================
// QUALITY POINTS
// ============================================================

function _findQualitySheets_() {
  var sheets = _ss().getSheets();
  var monthOrder = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var found = [];
  sheets.forEach(function(s) {
    var name = s.getName();
    if (name.indexOf(QUALITY_PREFIX) === 0) {
      var month = name.substring(QUALITY_PREFIX.length).trim();
      found.push({ name: name, month: month, gid: s.getSheetId(),
                   order: monthOrder.indexOf(month) >= 0 ? monthOrder.indexOf(month) : 99 });
    }
  });
  found.sort(function(a, b) { return a.order - b.order; });
  return found;
}

function getQualityData() {
  requireRole_(VALID_ROLES);
  var months = _findQualitySheets_();
  if (months.length === 0) return { entries: [], totals: emptyQualityTotals_(), filters: emptyQualityFilters_(), months: [] };
  
  var allEntries = [];
  months.forEach(function(m) {
    var sh = _ss().getSheetByName(m.name);
    if (!sh) return;
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;
    var values = sh.getRange(2, 1, lastRow - 1, 9).getValues();
    var p1Formulas = sh.getRange(2, QUALITY_COL.PHOTO1, lastRow - 1, 1).getFormulas();
    var p2Formulas = sh.getRange(2, QUALITY_COL.PHOTO2, lastRow - 1, 1).getFormulas();
    var pFinalFormulas = sh.getRange(2, QUALITY_COL.FINAL_PRODUCT_PHOTO, lastRow - 1, 1).getFormulas();
    
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var name = String(r[QUALITY_COL.NAME - 1] || '').trim();
      if (!name) continue;
      var photo1 = _extractPhoto_(p1Formulas[i], r[QUALITY_COL.PHOTO1 - 1]);
      var photo2 = _extractPhoto_(p2Formulas[i], r[QUALITY_COL.PHOTO2 - 1]);
      var photoFinal = _extractPhoto_(pFinalFormulas[i], r[QUALITY_COL.FINAL_PRODUCT_PHOTO - 1]);
      var dt = r[QUALITY_COL.ASSESSMENT_DATE - 1];
      var dateStr = '';
      if (dt instanceof Date) dateStr = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      else if (dt) dateStr = String(dt);
      
      allEntries.push({
        row: i + 2, sheetName: m.name, month: m.month, sheetGid: m.gid, name: name,
        photo1Url: photo1.url, photo1Embedded: photo1.embedded,
        photo2Url: photo2.url, photo2Embedded: photo2.embedded,
        finalPhotoUrl: photoFinal.url, finalPhotoEmbedded: photoFinal.embedded,
        comment: String(r[QUALITY_COL.COMMENT - 1] || '').trim(),
        correctiveAction: String(r[QUALITY_COL.CORRECTIVE - 1] || '').trim(),
        status: String(r[QUALITY_COL.STATUS - 1] || '').trim(),
        notes: String(r[QUALITY_COL.NOTES - 1] || '').trim(),
        assessmentDate: dateStr
      });
    }
  });
  return {
    entries: allEntries, totals: computeQualityTotals_(allEntries),
    filters: extractQualityFilters_(allEntries),
    months: months.map(function(m) { return { name: m.name, month: m.month, gid: m.gid }; })
  };
}

function _normalizeDrivePhotoUrl_(url) {
  if (!url || typeof url !== 'string') return url;
  url = url.trim();
  var id = null;
  // Format: /file/d/FILE_ID/
  var m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) id = m[1];
  // Format: id=FILE_ID
  if (!id) { m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/); if (m) id = m[1]; }
  // Format: /d/FILE_ID (lh3 already)
  if (!id && url.indexOf('lh3.googleusercontent.com/d/') >= 0) {
    m = url.match(/\/d\/([a-zA-Z0-9_-]+)/); if (m) id = m[1];
  }
  if (id) return 'https://lh3.googleusercontent.com/d/' + id;
  return url;  // not a Drive URL — return as-is
}

function _extractPhoto_(formula, value, backupUrl) {
  // Priority 1: plain text URL in cell value
  if (value && typeof value === 'string' && value.indexOf('http') === 0) {
    return { url: _normalizeDrivePhotoUrl_(value.trim()), embedded: false };
  }
  // Priority 2: =IMAGE("url") formula
  var f = (formula && formula[0]) || '';
  if (f && f.indexOf('IMAGE(') >= 0) {
    var m = f.match(/IMAGE\s*\(\s*"([^"]+)"/);
    if (m && m[1]) return { url: _normalizeDrivePhotoUrl_(m[1].replace(/""/g, '"')), embedded: false };
  }
  // Priority 3: CellImage object
  if (value && typeof value === 'object') {
    try {
      if (typeof value.getUrl === 'function') {
        var url = value.getUrl();
        if (url) return { url: _normalizeDrivePhotoUrl_(String(url)), embedded: false };
      }
    } catch(e) {}
    return { url: '', embedded: true };
  }
  return { url: '', embedded: false };
}

// Write photo URL to the cell as plain text. Predictable read/write, no Sheets auto-conversion.
function _writePhotoCell_(sheet, row, col, photoUrl, altText) {
  if (!photoUrl) return;
  try {
    sheet.getRange(row, col).setValue(photoUrl);
  } catch(e) {
    Logger.log('Photo cell write failed: ' + e);
  }
}

function emptyQualityTotals_() {
  return { total: 0, done: 0, pending: 0, inProgress: 0, other: 0, donePct: 0, byMonth: {}, byStatus: {} };
}
function emptyQualityFilters_() { return { months: [], statuses: [] }; }

function computeQualityTotals_(entries) {
  var t = { total: entries.length, done: 0, pending: 0, inProgress: 0, other: 0, donePct: 0, byMonth: {}, byStatus: {} };
  entries.forEach(function(e) {
    var s = (e.status || '').toLowerCase();
    if (s === 'done' || s.indexOf('done') >= 0) t.done++;
    else if (s === 'pending' || s.indexOf('pending') >= 0) t.pending++;
    else if (s.indexOf('progress') >= 0) t.inProgress++;
    else t.other++;
    if (e.month)  t.byMonth[e.month]   = (t.byMonth[e.month] || 0) + 1;
    if (e.status) t.byStatus[e.status] = (t.byStatus[e.status] || 0) + 1;
  });
  if (entries.length > 0) t.donePct = Math.round((t.done / entries.length) * 100);
  return t;
}

function extractQualityFilters_(entries) {
  var m = {}, s = {};
  entries.forEach(function(e) {
    if (e.month) m[e.month] = true;
    if (e.status) s[e.status] = true;
  });
  return { months: Object.keys(m).sort(), statuses: Object.keys(s).sort() };
}

function addQualityEntry(payload, photo1Data, photo2Data) {
  var user = requireRole_(WRITE_ROLES);
  if (!payload || !payload.name) throw new Error('Issue name is required');
  if (!payload.month) throw new Error('Month is required');
  
  var sheetName = QUALITY_PREFIX + payload.month;
  var sh = _ss().getSheetByName(sheetName);
  if (!sh) throw new Error('Quality sheet not found: ' + sheetName);
  
  var lastDataRow = 1;
  var nameColumn = sh.getRange(2, QUALITY_COL.NAME, sh.getMaxRows() - 1, 1).getValues();
  for (var i = 0; i < nameColumn.length; i++) {
    if (nameColumn[i][0] && String(nameColumn[i][0]).trim() !== '') lastDataRow = i + 2;
  }
  var newRow = lastDataRow + 1;
  
  var dateVal = new Date();
  if (payload.assessmentDate) {
    var parsed = new Date(payload.assessmentDate);
    if (!isNaN(parsed.getTime())) dateVal = parsed;
  }
  
  // Write each field to its exact column individually
  sh.getRange(newRow, QUALITY_COL.NAME).setValue(String(payload.name).trim());
  sh.getRange(newRow, QUALITY_COL.COMMENT).setValue(payload.comment || '');
  sh.getRange(newRow, QUALITY_COL.CORRECTIVE).setValue(payload.correctiveAction || '');
  sh.getRange(newRow, QUALITY_COL.STATUS).setValue(payload.status || 'Pending');
  sh.getRange(newRow, QUALITY_COL.NOTES).setValue(payload.notes || '');
  sh.getRange(newRow, QUALITY_COL.ASSESSMENT_DATE).setValue(dateVal);
  SpreadsheetApp.flush();
  
  var photo1Url = '', photo2Url = '';
  if (photo1Data && photo1Data.bytes) {
    try { photo1Url = uploadPhotoToDrive_(photo1Data, 'Quality - ' + payload.name + ' - p1'); } catch(e) {}
  }
  if (photo2Data && photo2Data.bytes) {
    try { photo2Url = uploadPhotoToDrive_(photo2Data, 'Quality - ' + payload.name + ' - p2'); } catch(e) {}
  }
  if (photo1Url) _writePhotoCell_(sh, newRow, QUALITY_COL.PHOTO1, photo1Url, payload.name + ' - p1');
  if (photo2Url) _writePhotoCell_(sh, newRow, QUALITY_COL.PHOTO2, photo2Url, payload.name + ' - p2');
  if (photo1Url || photo2Url) SpreadsheetApp.flush();
  
  _logActivity_(user, 'add', 'quality-issue', sheetName + ' Row ' + newRow + ': "' + payload.name + '"');
  _touchSync_('quality'); _bustSectionCache_('quality'); _bustSectionCache_('quality');
  if (payload.mentionedEmails && payload.mentionedEmails.length > 0) {
    _sendMentionEmails_(payload.mentionedEmails, 'Quality Issue', payload.name, payload.correctiveAction || '', user.email);
    _sendMentionSlackDMs_(payload.mentionedEmails, 'Quality Issue', payload.name, payload.correctiveAction || '', user.name || user.email);
  }
  return { ok: true, row: newRow, sheet: sheetName, photo1Url: photo1Url, photo2Url: photo2Url };
}

function createQualityMonthTab(payload) {
  var user = requireRole_(ADMIN_ROLES);
  if (!payload || !payload.month) throw new Error('Month name is required');
  
  var month = String(payload.month).trim();
  month = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
  var newName = QUALITY_PREFIX + month;
  var ss = _ss();
  if (ss.getSheetByName(newName)) throw new Error('Sheet already exists: ' + newName);
  
  var template = ss.getSheetByName(QUALITY_TEMPLATE_SHEET);
  var newSheet;
  if (template) {
    newSheet = template.copyTo(ss);
    newSheet.setName(newName);
    var lastRow = newSheet.getLastRow();
    if (lastRow > 1) newSheet.getRange(2, 1, lastRow - 1, newSheet.getLastColumn()).clearContent();
  } else {
    newSheet = ss.insertSheet(newName);
    newSheet.getRange(1, 1, 1, 8).setValues([['Name', 'Photo 1', 'Photo 2', 'Comment', 'Corrective Action', 'Status', 'Notes', 'Assessment Date']]);
    newSheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#0f9d58').setFontColor('#ffffff');
    newSheet.setFrozenRows(1);
  }
  
  _logActivity_(user, 'create', 'quality-month-tab', 'Created: ' + newName);
  return { ok: true, sheetName: newName, gid: newSheet.getSheetId() };
}

// ============================================================
// INGREDIENTS
// ============================================================

function getIngredientsData() {
  requireRole_(VALID_ROLES);
  var sh = _ss().getSheetByName(INGREDIENTS_SHEET);
  if (!sh) return { items: [], totals: emptyIngTotals_(), filters: emptyIngFilters_(), sheetGid: null };
  
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { items: [], totals: emptyIngTotals_(), filters: emptyIngFilters_(), sheetGid: sh.getSheetId() };
  
  var values = sh.getRange(2, 1, lastRow - 1, 10).getValues();
  var photoFormulas = sh.getRange(2, ING_COL.PHOTO, lastRow - 1, 1).getFormulas();
  
  var items = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var ingredient = String(r[ING_COL.INGREDIENT - 1] || '').trim();
    if (!ingredient) continue;
    var photo = _extractPhoto_(photoFormulas[i], r[ING_COL.PHOTO - 1]);
    var deadline = r[ING_COL.DEADLINE - 1];
    var deadlineStr = '';
    if (deadline instanceof Date) deadlineStr = Utilities.formatDate(deadline, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    else if (deadline) deadlineStr = String(deadline);
    
    items.push({
      row: i + 2, ingredient: ingredient,
      brand: String(r[ING_COL.BRAND - 1] || '').trim(),
      photoUrl: photo.url, photoEmbedded: photo.embedded,
      status: String(r[ING_COL.STATUS - 1] || '').trim(),
      reason: String(r[ING_COL.REASON - 1] || '').trim(),
      done: String(r[ING_COL.DONE - 1] || '').trim(),
      note: String(r[ING_COL.NOTE - 1] || '').trim(),
      deadline: deadlineStr,
      priority: String(r[ING_COL.PRIORITY - 1] || '').trim(),
      scNotes: String(r[ING_COL.SC_NOTES - 1] || '').trim()
    });
  }
  return { items: items, totals: computeIngTotals_(items), filters: extractIngFilters_(items), sheetGid: sh.getSheetId() };
}

function emptyIngTotals_() { return { total: 0, done: 0, pending: 0, inProgress: 0, donePct: 0, byStatus: {}, byPriority: {}, byBrand: {} }; }
function emptyIngFilters_() { return { statuses: [], priorities: [], brands: [], dones: [] }; }

function computeIngTotals_(items) {
  var t = { total: items.length, done: 0, pending: 0, inProgress: 0, donePct: 0, byStatus: {}, byPriority: {}, byBrand: {} };
  items.forEach(function(it) {
    var d = (it.done || '').toLowerCase();
    if (d === 'done') t.done++;
    else if (d.indexOf('progress') >= 0) t.inProgress++;
    else if (d.indexOf('pending') >= 0 || d === '') t.pending++;
    if (it.status)   t.byStatus[it.status]     = (t.byStatus[it.status] || 0) + 1;
    if (it.priority) t.byPriority[it.priority] = (t.byPriority[it.priority] || 0) + 1;
    if (it.brand)    t.byBrand[it.brand]       = (t.byBrand[it.brand] || 0) + 1;
  });
  if (items.length > 0) t.donePct = Math.round((t.done / items.length) * 100);
  return t;
}

function extractIngFilters_(items) {
  var s = {}, p = {}, b = {}, d = {};
  items.forEach(function(it) {
    if (it.status) s[it.status] = true;
    if (it.priority) p[it.priority] = true;
    if (it.brand) b[it.brand] = true;
    if (it.done) d[it.done] = true;
  });
  return { statuses: Object.keys(s).sort(), priorities: Object.keys(p).sort(),
           brands: Object.keys(b).sort(), dones: Object.keys(d).sort() };
}

function addIngredient(payload, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!payload || !payload.ingredient) throw new Error('Ingredient name is required');
  
  var sh = _ss().getSheetByName(INGREDIENTS_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + INGREDIENTS_SHEET);
  
  var lastDataRow = 1;
  var col = sh.getRange(2, ING_COL.INGREDIENT, sh.getMaxRows() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] && String(col[i][0]).trim() !== '') lastDataRow = i + 2;
  }
  var newRow = lastDataRow + 1;
  
  var deadlineVal = '';
  if (payload.deadline) {
    var parsed = new Date(payload.deadline);
    if (!isNaN(parsed.getTime())) deadlineVal = parsed;
  }
  
  // Write each field to its exact column individually
  sh.getRange(newRow, ING_COL.INGREDIENT).setValue(String(payload.ingredient).trim());
  sh.getRange(newRow, ING_COL.BRAND).setValue(payload.brand || '');
  sh.getRange(newRow, ING_COL.STATUS).setValue(payload.status || '');
  sh.getRange(newRow, ING_COL.REASON).setValue(payload.reason || '');
  sh.getRange(newRow, ING_COL.DONE).setValue(payload.done || 'Pending');
  sh.getRange(newRow, ING_COL.NOTE).setValue(payload.note || '');
  sh.getRange(newRow, ING_COL.DEADLINE).setValue(deadlineVal);
  sh.getRange(newRow, ING_COL.PRIORITY).setValue(payload.priority || '');
  sh.getRange(newRow, ING_COL.SC_NOTES).setValue(payload.scNotes || '');
  SpreadsheetApp.flush();
  
  var photoUrl = '';
  if (photoData && photoData.bytes) {
    try {
      photoUrl = uploadPhotoToDrive_(photoData, 'Ingredient - ' + payload.ingredient);
      if (photoUrl) {
        _writePhotoCell_(sh, newRow, ING_COL.PHOTO, photoUrl, payload.ingredient);
        SpreadsheetApp.flush();
      }
    } catch(e) { Logger.log('Photo upload failed: ' + e); }
  }
  _logActivity_(user, 'add', 'ingredient', 'Row ' + newRow + ': "' + payload.ingredient + '"');
  _touchSync_('ingredients'); _bustSectionCache_('ingredients');
  return { ok: true, row: newRow, photoUrl: photoUrl };
}

// ============================================================
// FIXES
// ============================================================

function getFixesData() {
  requireRole_(VALID_ROLES);
  var sh = _ss().getSheetByName(FIXES_SHEET);
  if (!sh) return { items: [], totals: emptyFixTotals_(), filters: emptyFixFilters_(), sheetGid: null };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { items: [], totals: emptyFixTotals_(), filters: emptyFixFilters_(), sheetGid: sh.getSheetId() };
  
  var values = sh.getRange(2, 1, lastRow - 1, 12).getValues();
  var photoFormulas = sh.getRange(2, FIX_COL.PHOTO, lastRow - 1, 1).getFormulas();
  
  var items = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var id = String(r[FIX_COL.ID - 1] || '').trim();
    var name = String(r[FIX_COL.NAME - 1] || '').trim();
    if (!id && !name) continue;
    var photo = _extractPhoto_(photoFormulas[i], r[FIX_COL.PHOTO - 1]);
    var dt = r[FIX_COL.DATE - 1];
    var dateStr = '';
    if (dt instanceof Date) dateStr = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    else if (dt) dateStr = String(dt);
    var ua = r[FIX_COL.UPDATED_AT - 1];
    var updatedStr = '';
    if (ua instanceof Date) updatedStr = Utilities.formatDate(ua, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    else if (ua) updatedStr = String(ua);
    
    var notesRaw = String(r[FIX_COL.NOTES - 1] || '').trim();
    var slackLinkMatch = notesRaw.match(/Slack:\s*(https?:\/\/\S+)/);
    items.push({
      row: i + 2, id: id, date: dateStr,
      type: String(r[FIX_COL.TYPE - 1] || '').trim(), name: name,
      issue: String(r[FIX_COL.ISSUE - 1] || '').trim(),
      photoUrl: photo.url, photoEmbedded: photo.embedded,
      status: String(r[FIX_COL.STATUS - 1] || '').trim(),
      assignedTo: String(r[FIX_COL.ASSIGNED_TO - 1] || '').trim(),
      priority: String(r[FIX_COL.PRIORITY - 1] || '').trim(),
      notes: notesRaw,
      slackLink: slackLinkMatch ? slackLinkMatch[1] : '',
      reportedBy: String(r[FIX_COL.REPORTED_BY - 1] || '').trim(),
      updatedAt: updatedStr
    });
  }
  return { items: items, totals: computeFixTotals_(items), filters: extractFixFilters_(items), sheetGid: sh.getSheetId() };
}

function emptyFixTotals_() { return { total: 0, done: 0, pending: 0, inProgress: 0, donePct: 0, byType: {}, byPriority: {}, byStatus: {} }; }
function emptyFixFilters_() { return { types: [], statuses: [], priorities: [], assignees: [] }; }

function computeFixTotals_(items) {
  var t = { total: items.length, done: 0, pending: 0, inProgress: 0, donePct: 0, byType: {}, byPriority: {}, byStatus: {} };
  items.forEach(function(it) {
    var s = (it.status || '').toLowerCase();
    if (s === 'done' || s.indexOf('done') >= 0) t.done++;
    else if (s.indexOf('progress') >= 0) t.inProgress++;
    else if (s === 'pending' || s.indexOf('pending') >= 0 || s === '') t.pending++;
    if (it.type)     t.byType[it.type]         = (t.byType[it.type] || 0) + 1;
    if (it.priority) t.byPriority[it.priority] = (t.byPriority[it.priority] || 0) + 1;
    if (it.status)   t.byStatus[it.status]     = (t.byStatus[it.status] || 0) + 1;
  });
  if (items.length > 0) t.donePct = Math.round((t.done / items.length) * 100);
  return t;
}

function extractFixFilters_(items) {
  var ty={},st={},pr={},asg={};
  items.forEach(function(it) {
    if (it.type) ty[it.type] = true;
    if (it.status) st[it.status] = true;
    if (it.priority) pr[it.priority] = true;
    if (it.assignedTo) asg[it.assignedTo] = true;
  });
  return { types: Object.keys(ty).sort(), statuses: Object.keys(st).sort(),
           priorities: Object.keys(pr).sort(), assignees: Object.keys(asg).sort() };
}

function _generateFixId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = 'FIX-';
  for (var i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function addFix(payload, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!payload || !payload.name) throw new Error('Name is required');
  
  var sh = _ss().getSheetByName(FIXES_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + FIXES_SHEET);
  
  var lastDataRow = 1;
  var col = sh.getRange(2, FIX_COL.ID, sh.getMaxRows() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] && String(col[i][0]).trim() !== '') lastDataRow = i + 2;
  }
  var newRow = lastDataRow + 1;
  
  var existingIds = {};
  sh.getRange(2, FIX_COL.ID, Math.max(1, lastDataRow - 1), 1).getValues().forEach(function(r) {
    if (r[0]) existingIds[String(r[0]).trim()] = true;
  });
  var fixId;
  do { fixId = _generateFixId_(); } while (existingIds[fixId]);
  
  var dateVal = new Date();
  if (payload.date) {
    var parsed = new Date(payload.date);
    if (!isNaN(parsed.getTime())) dateVal = parsed;
  }
  
  // Write each field to its exact column individually
  sh.getRange(newRow, FIX_COL.ID).setValue(fixId);
  sh.getRange(newRow, FIX_COL.DATE).setValue(dateVal);
  sh.getRange(newRow, FIX_COL.TYPE).setValue(payload.type || '');
  sh.getRange(newRow, FIX_COL.NAME).setValue(String(payload.name).trim());
  sh.getRange(newRow, FIX_COL.ISSUE).setValue(payload.issue || '');
  sh.getRange(newRow, FIX_COL.STATUS).setValue(payload.status || 'Pending');
  sh.getRange(newRow, FIX_COL.ASSIGNED_TO).setValue(payload.assignedTo || '');
  sh.getRange(newRow, FIX_COL.PRIORITY).setValue(payload.priority || '');
  sh.getRange(newRow, FIX_COL.NOTES).setValue(payload.notes || '');
  sh.getRange(newRow, FIX_COL.REPORTED_BY).setValue(user.email);
  sh.getRange(newRow, FIX_COL.UPDATED_AT).setValue(new Date());
  SpreadsheetApp.flush();
  
  var photoUrl = '';
  if (photoData && photoData.bytes) {
    try {
      photoUrl = uploadPhotoToDrive_(photoData, 'Fix - ' + payload.name);
      if (photoUrl) {
        _writePhotoCell_(sh, newRow, FIX_COL.PHOTO, photoUrl, payload.name);
        SpreadsheetApp.flush();
      }
    } catch(e) { Logger.log('Photo upload failed: ' + e); }
  }
  _logActivity_(user, 'add', 'fix', 'Row ' + newRow + ': ' + fixId + ' - "' + payload.name + '"');
  _touchSync_('fixes'); _bustSectionCache_('fixes'); _bustSectionCache_('fixes');
  if (payload.mentionedEmails && payload.mentionedEmails.length > 0) {
    _sendMentionEmails_(payload.mentionedEmails, 'Fix', payload.name, payload.issue || '', user.email);
    _sendMentionSlackDMs_(payload.mentionedEmails, 'Fix', payload.name, payload.issue || '', user.name || user.email);
  }
  return { ok: true, row: newRow, id: fixId };
}

// ============================================================
// AUDITS — read + manual add + PDF parse
// ============================================================

function getAuditsData() {
  requireRole_(VALID_ROLES);
  var sh = _ss().getSheetByName(AUDITS_SHEET);
  if (!sh) return { rows: [], sessions: [], totals: emptyAuditTotals_(), filters: emptyAuditFilters_(), sheetGid: null };
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { rows: [], sessions: [], totals: emptyAuditTotals_(), filters: emptyAuditFilters_(), sheetGid: sh.getSheetId() };
  
  var values = sh.getRange(2, 1, lastRow - 1, 13).getValues();
  var rows = [];
  var sessionMap = {};
  
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var auditId = String(r[AUDIT_COL.AUDIT_ID - 1] || '').trim();
    var question = String(r[AUDIT_COL.QUESTION - 1] || '').trim();
    if (!auditId && !question) continue;
    var dt = r[AUDIT_COL.DATE - 1];
    var dateStr = '';
    if (dt instanceof Date) dateStr = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    else if (dt) dateStr = String(dt);
    var pdfLink = String(r[AUDIT_COL.PDF_LINK - 1] || '').trim();
    
    var row = {
      row: i + 2, auditId: auditId, date: dateStr,
      auditor: String(r[AUDIT_COL.AUDITOR - 1] || '').trim(),
      section: String(r[AUDIT_COL.SECTION - 1] || '').trim(),
      question: question,
      questionId: String(r[AUDIT_COL.QUESTION_ID - 1] || '').trim(),
      result: String(r[AUDIT_COL.RESULT - 1] || '').trim(),
      comment: String(r[AUDIT_COL.COMMENT - 1] || '').trim(),
      photoRefs: String(r[AUDIT_COL.PHOTO_REFS - 1] || '').trim(),
      photoCount: r[AUDIT_COL.PHOTO_COUNT - 1] || 0,
      pdfLink: pdfLink,
      photoUrls: String(r[AUDIT_COL.PHOTO_URLS - 1] || '').trim()
    };
    rows.push(row);
    
    if (auditId && !sessionMap[auditId]) {
      sessionMap[auditId] = { auditId: auditId, date: dateStr, auditor: row.auditor, section: row.section,
                              pdfLink: pdfLink, questionCount: 0, passCount: 0, failCount: 0 };
    }
    if (auditId) {
      sessionMap[auditId].questionCount++;
      if (row.result.toLowerCase() === 'yes') sessionMap[auditId].passCount++;
      else if (row.result.toLowerCase() === 'no') sessionMap[auditId].failCount++;
    }
  }
  
  var sessions = Object.keys(sessionMap).map(function(k) {
    var s = sessionMap[k];
    s.passPct = s.questionCount > 0 ? Math.round((s.passCount / s.questionCount) * 100) : 0;
    return s;
  });
  sessions.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
  
  return { rows: rows, sessions: sessions, totals: computeAuditTotals_(rows, sessions),
           filters: extractAuditFilters_(rows), sheetGid: sh.getSheetId() };
}

function emptyAuditTotals_() { return { totalRows: 0, totalSessions: 0, passCount: 0, failCount: 0, passPct: 0, bySection: {}, byResult: {}, byAuditor: {} }; }
function emptyAuditFilters_() { return { sections: [], auditors: [], results: [], auditIds: [] }; }

function computeAuditTotals_(rows, sessions) {
  var t = { totalRows: rows.length, totalSessions: sessions.length, passCount: 0, failCount: 0, passPct: 0,
            bySection: {}, byResult: {}, byAuditor: {} };
  rows.forEach(function(r) {
    var res = (r.result || '').toLowerCase();
    if (res === 'yes') t.passCount++;
    else if (res === 'no') t.failCount++;
    if (r.section)  t.bySection[r.section]   = (t.bySection[r.section] || 0) + 1;
    if (r.result)   t.byResult[r.result]     = (t.byResult[r.result] || 0) + 1;
    if (r.auditor)  t.byAuditor[r.auditor]   = (t.byAuditor[r.auditor] || 0) + 1;
  });
  if (rows.length > 0) t.passPct = Math.round((t.passCount / rows.length) * 100);
  return t;
}

function extractAuditFilters_(rows) {
  var sec={},aud={},res={},ids={};
  rows.forEach(function(r) {
    if (r.section) sec[r.section] = true;
    if (r.auditor) aud[r.auditor] = true;
    if (r.result) res[r.result] = true;
    if (r.auditId) ids[r.auditId] = true;
  });
  return { sections: Object.keys(sec).sort(), auditors: Object.keys(aud).sort(),
           results: Object.keys(res).sort(), auditIds: Object.keys(ids).sort() };
}

function _generateAuditId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = 'AMP';
  for (var i = 0; i < 5; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function addAuditSession(payload, pdfData) {
  var user = requireRole_(WRITE_ROLES);
  if (!payload) throw new Error('No payload');
  if (!payload.auditor) throw new Error('Auditor is required');
  if (!payload.section) throw new Error('Section is required');
  if (!payload.questions || payload.questions.length === 0) throw new Error('At least one question is required');
  
  var sh = _ss().getSheetByName(AUDITS_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + AUDITS_SHEET);
  
  var lastDataRow = 1;
  var col = sh.getRange(2, AUDIT_COL.AUDIT_ID, sh.getMaxRows() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] && String(col[i][0]).trim() !== '') lastDataRow = i + 2;
  }
  
  var existingIds = {};
  sh.getRange(2, AUDIT_COL.AUDIT_ID, Math.max(1, lastDataRow - 1), 1).getValues().forEach(function(r) {
    if (r[0]) existingIds[String(r[0]).trim()] = true;
  });
  var auditId;
  do { auditId = _generateAuditId_(); } while (existingIds[auditId]);
  
  var pdfLink = '';
  if (pdfData && pdfData.bytes) {
    try { pdfLink = uploadPdfToDrive_(pdfData, 'Audit_' + auditId); } catch(e) { Logger.log('PDF error: ' + e); }
  }
  
  var dateVal = new Date();
  if (payload.date) {
    var parsed = new Date(payload.date);
    if (!isNaN(parsed.getTime())) dateVal = parsed;
  }
  
  var newRows = [];
  payload.questions.forEach(function(q) {
    newRows.push([
      auditId, dateVal, payload.auditor, q.section || payload.section,
      q.question || '', q.questionId || '', q.result || '', q.comment || '',
      q.photoRefs || '', q.photoCount || 0, pdfLink, q.photoUrls || '', ''
    ]);
  });
  
  var startRow = lastDataRow + 1;
  sh.getRange(startRow, 1, newRows.length, 13).setValues(newRows);
  _logActivity_(user, 'add', 'audit-session', auditId + ': ' + newRows.length + ' rows');
  _touchSync_('audits'); _bustSectionCache_('audits');
  return { ok: true, auditId: auditId, rowsAdded: newRows.length, pdfLink: pdfLink };
}

// ============================================================
// PHASE 4b — PDF AUTO-PARSE
// ============================================================

/**
 * parseAuditPdf: Accepts base64 PDF, uploads to Drive,
 * uses Drive OCR conversion to extract text, parses sections + flagged "No" questions.
 * Returns preview data (NOT yet saved to sheet).
 */
function parseAuditPdf(pdfData) {
  var user = requireRole_(WRITE_ROLES);
  if (!pdfData || !pdfData.bytes) throw new Error('No PDF data provided');
  
  // 1. Upload PDF to Drive folder
  var folder = DriveApp.getFolderById(ensurePdfFolder_());
  var bytes = Utilities.base64Decode(pdfData.bytes);
  var fileName = 'Audit_PendingParse_' + new Date().getTime() + '.pdf';
  var blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  var pdfFile = folder.createFile(blob);
  try { pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
  var pdfLink = 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view';
  
  // 2. Use Drive Advanced API to convert PDF → Google Doc with OCR
  var docId, docText;
  try {
    var resource = { title: 'OCR_TEMP_' + new Date().getTime(), mimeType: 'application/vnd.google-apps.document' };
    var docFile = Drive.Files.copy(resource, pdfFile.getId(), { ocr: true, ocrLanguage: 'en' });
    docId = docFile.id;
    docText = DocumentApp.openById(docId).getBody().getText();
    // Clean up temp doc
    try { DriveApp.getFileById(docId).setTrashed(true); } catch(e) {}
  } catch(e) {
    // Cleanup PDF if OCR failed
    try { pdfFile.setTrashed(true); } catch(ce) {}
    throw new Error('OCR conversion failed: ' + e.toString() + '. Make sure Drive API is enabled in Services.');
  }
  
  // 3. Parse the text
  var parsed = _parseAuditDocText_(docText);
  
  // 4. Return preview data (filter to "No" only per user request)
  var flaggedQuestions = parsed.questions.filter(function(q) {
    return (q.result || '').toLowerCase() === 'no';
  });
  
  _logActivity_(user, 'parse', 'audit-pdf', 'Parsed ' + parsed.questions.length + ' Qs, ' + flaggedQuestions.length + ' flagged');
  
  return {
    ok: true,
    pdfLink: pdfLink,
    pdfFileId: pdfFile.getId(),
    date: parsed.date,
    auditor: parsed.auditor,
    flaggedQuestions: flaggedQuestions,
    allQuestionsCount: parsed.questions.length,
    rawText: docText.substring(0, 500) // First 500 chars for debug
  };
}

/**
 * _parseAuditDocText_: Parse OCR-converted audit doc text.
 * Extracts: date, auditor, sections, questions (with results + comments).
 * Returns: { date, auditor, questions: [{section, question, result, comment, photoRefs}] }
 */
function _parseAuditDocText_(text) {
  if (!text) return { date: '', auditor: '', questions: [] };
  
  // Normalize newlines and collapse extra whitespace
  var lines = text.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
  
  // Extract date + auditor from cover sheet
  // Pattern: "2 May 2026 / Ahmed Mohamed"
  var date = '', auditor = '';
  for (var i = 0; i < Math.min(lines.length, 15); i++) {
    var ln = lines[i];
    var m = ln.match(/(\d{1,2}\s+\w+\s+\d{4})\s*\/\s*(.+)/);
    if (m) {
      date = m[1].trim();
      auditor = m[2].trim();
      break;
    }
    // Alternative: "Prepared by Ahmed Mohamed" / "Conducted on 02.05.2026"
    if (!auditor && /prepared\s*by/i.test(ln)) {
      var pm = ln.match(/prepared\s*by\s*(.+)/i);
      if (pm) auditor = pm[1].trim();
    }
    if (!date && /conducted\s*on/i.test(ln)) {
      var dm = ln.match(/conducted\s*on\s*(.+)/i);
      if (dm) date = dm[1].trim().split(/\s/)[0]; // first token (date part)
    }
  }
  
  // Walk through lines and detect sections + questions
  // Pattern: SECTION_HEADER (all caps from KNOWN_SECTIONS)
  //   ... eventually ...
  //   QuestionText (mixed case, can span multiple lines)
  //   Yes/No (standalone line)
  //   CommentText (optional, may be on next line)
  
  var questions = [];
  var currentSection = '';
  var i = 0;
  var skipFlagged = false; // skip the "Flagged items" summary block
  
  while (i < lines.length) {
    var line = lines[i];
    
    // Detect "Flagged items" section header — skip everything in it
    if (/^flagged\s*items?$/i.test(line)) {
      skipFlagged = true;
      i++;
      continue;
    }
    
    // Section detection — match against known sections (case-insensitive)
    var upperLine = line.toUpperCase().replace(/\s+/g, ' ').trim();
    var matchedSection = null;
    for (var si = 0; si < KNOWN_SECTIONS.length; si++) {
      var ks = KNOWN_SECTIONS[si];
      if (upperLine === ks || upperLine.indexOf(ks) === 0) {
        matchedSection = ks;
        break;
      }
    }
    
    if (matchedSection) {
      currentSection = matchedSection;
      skipFlagged = false; // exit flagged-summary mode when a real section header appears
      i++;
      continue;
    }
    
    if (skipFlagged) { i++; continue; }
    
    // Look for "Yes" or "No" result on this line (case-sensitive, standalone)
    // The structure is: question text appears BEFORE the Yes/No
    if ((/^Yes$/i.test(line) || /^No$/i.test(line)) && questions.length >= 0) {
      // Question text is in the lines immediately before this one (until we hit a section header or another result)
      var qLines = [];
      var j = i - 1;
      while (j >= 0) {
        var prev = lines[j];
        if (!prev) { j--; continue; }
        // Stop conditions:
        if (/^(Yes|No)$/i.test(prev)) break; // hit previous result
        if (/^Photo\s+\d+/i.test(prev)) break; // photo caption — comment ended
        var prevUpper = prev.toUpperCase().replace(/\s+/g, ' ').trim();
        var hitSection = false;
        for (var ssi = 0; ssi < KNOWN_SECTIONS.length; ssi++) {
          if (prevUpper === KNOWN_SECTIONS[ssi] || prevUpper.indexOf(KNOWN_SECTIONS[ssi]) === 0) { hitSection = true; break; }
        }
        if (hitSection) break;
        if (/^flagged\s*items?$/i.test(prev)) break;
        qLines.unshift(prev);
        j--;
        // Safety: cap question to 4 lines
        if (qLines.length >= 4) break;
      }
      
      // Find comment after the Yes/No (until photo or next section/question)
      var cLines = [];
      var k = i + 1;
      while (k < lines.length) {
        var next = lines[k];
        if (!next) { k++; continue; }
        // Stop on Yes/No (next question's result)
        if (/^(Yes|No)$/i.test(next)) break;
        // Stop on Photo X (photo caption)
        if (/^Photo\s+\d+/i.test(next)) break;
        // Stop on section header
        var nextUpper = next.toUpperCase().replace(/\s+/g, ' ').trim();
        var hitSec2 = false;
        for (var ssj = 0; ssj < KNOWN_SECTIONS.length; ssj++) {
          if (nextUpper === KNOWN_SECTIONS[ssj] || nextUpper.indexOf(KNOWN_SECTIONS[ssj]) === 0) { hitSec2 = true; break; }
        }
        if (hitSec2) break;
        if (/^flagged\s*items?$/i.test(next)) break;
        cLines.push(next);
        k++;
        if (cLines.length >= 5) break; // safety cap
      }
      
      // Comment might be just lines until something that looks like next question (Yes/No will catch it)
      // But we need to NOT include the next question text in the comment
      // Heuristic: only first 1-2 lines after Yes/No are usually the comment; longer text is next question
      var comment = '';
      if (cLines.length > 0) {
        // Take the FIRST line as comment; if very short, also include 2nd
        comment = cLines[0];
        if (comment.length < 80 && cLines[1] && cLines[1].length < 120) {
          // Only if it doesn't look like the start of a new question (ends in ? or is a long sentence)
          // — leave it as first line only for safety
        }
      }
      
      var question = qLines.join(' ').trim();
      var result = line.toLowerCase() === 'yes' ? 'Yes' : 'No';
      
      // Generate question ID (random 7 chars for traceability)
      var qId = _genQuestionId_();
      
      if (question.length > 5) {
        questions.push({
          section: currentSection || '',
          question: question,
          result: result,
          comment: comment,
          questionId: qId,
          photoRefs: ''
        });
      }
    }
    
    i++;
  }
  
  return { date: date, auditor: auditor, questions: questions };
}

function _genQuestionId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 7; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/**
 * submitParsedAudit: Save user-edited preview rows to the sheet.
 * Generates AMP-ID, uses already-uploaded PDF link.
 */
function submitParsedAudit(payload) {
  var user = requireRole_(WRITE_ROLES);
  if (!payload) throw new Error('No payload');
  if (!payload.auditor) throw new Error('Auditor is required');
  if (!payload.questions || payload.questions.length === 0) throw new Error('No questions to save');
  
  var sh = _ss().getSheetByName(AUDITS_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + AUDITS_SHEET);
  
  var lastDataRow = 1;
  var col = sh.getRange(2, AUDIT_COL.AUDIT_ID, sh.getMaxRows() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] && String(col[i][0]).trim() !== '') lastDataRow = i + 2;
  }
  
  var existingIds = {};
  sh.getRange(2, AUDIT_COL.AUDIT_ID, Math.max(1, lastDataRow - 1), 1).getValues().forEach(function(r) {
    if (r[0]) existingIds[String(r[0]).trim()] = true;
  });
  var auditId;
  do { auditId = _generateAuditId_(); } while (existingIds[auditId]);
  
  var dateVal = new Date();
  if (payload.date) {
    var parsed = new Date(payload.date);
    if (!isNaN(parsed.getTime())) dateVal = parsed;
  }
  
  var newRows = [];
  payload.questions.forEach(function(q) {
    newRows.push([
      auditId, dateVal, payload.auditor, q.section || '',
      q.question || '', q.questionId || '', q.result || 'No', q.comment || '',
      q.photoRefs || '', 0, payload.pdfLink || '', '', ''
    ]);
  });
  
  var startRow = lastDataRow + 1;
  sh.getRange(startRow, 1, newRows.length, 13).setValues(newRows);
  
  _logActivity_(user, 'parse-save', 'audit-session', auditId + ': ' + newRows.length + ' rows (from PDF)');
  _touchSync_('audits'); _bustSectionCache_('audits');
  return { ok: true, auditId: auditId, rowsAdded: newRows.length };
}

// ============================================================
// PHOTO + PDF UPLOAD
// ============================================================

function ensurePhotoFolder_() {
  var mpKey = _currentMpKey_();
  var mp = _findMpByKey_(mpKey) || { display: mpKey };
  var folderName = 'NPD Dashboard - ' + mp.display + ' - Photos';
  var propKey = 'PHOTO_FOLDER_ID_' + mpKey;
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(propKey);
  if (folderId) {
    try { var f = DriveApp.getFolderById(folderId); if (f && !f.isTrashed()) return f.getId(); } catch(e) {}
  }
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) { var ex = folders.next(); props.setProperty(propKey, ex.getId()); return ex.getId(); }
  var nf = DriveApp.createFolder(folderName);
  props.setProperty(propKey, nf.getId());
  return nf.getId();
}

function ensurePdfFolder_() {
  var mpKey = _currentMpKey_();
  var mp = _findMpByKey_(mpKey) || { display: mpKey };
  var folderName = 'NPD Dashboard - ' + mp.display + ' - Audit PDFs';
  var propKey = 'PDF_FOLDER_ID_' + mpKey;
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(propKey);
  if (folderId) {
    try { var f = DriveApp.getFolderById(folderId); if (f && !f.isTrashed()) return f.getId(); } catch(e) {}
  }
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) { var ex = folders.next(); props.setProperty(propKey, ex.getId()); return ex.getId(); }
  var nf = DriveApp.createFolder(folderName);
  props.setProperty(propKey, nf.getId());
  return nf.getId();
}

// ============================================================
// PHOTO UPDATES FOR EXISTING ROWS (Phase 5b)
// ============================================================

function updateMealPhoto(row, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || row < 2) throw new Error('Invalid row');
  if (!photoData || !photoData.bytes) throw new Error('No photo provided');
  var sh = _meals();
  var lastRow = sh.getLastRow();
  if (row > lastRow) throw new Error('Row out of range');
  var name = String(sh.getRange(row, COL.NAME).getValue() || '').trim();
  var photoUrl = uploadPhotoToDrive_(photoData, (name || 'meal') + ' - photo');
  _writePhotoCell_(sh, row, COL.PHOTO, photoUrl, name || 'meal');
  SpreadsheetApp.flush();
  _DASHBOARD_CACHE = null;
  _logActivity_(user, 'update photo', 'meal', 'Row ' + row + ': "' + name + '"');
  _touchSync_('meals'); _bustSectionCache_('meals');
  return { ok: true, photoUrl: photoUrl, row: row };
}

function updateBhPhoto(row, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || row < 3) throw new Error('Invalid row');
  if (!photoData || !photoData.bytes) throw new Error('No photo provided');
  var sh = _ss().getSheetByName(BH_SHEET);
  if (!sh) throw new Error('BH sheet not found');
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var name = String(sh.getRange(row, 2).getValue() || '').trim();
  var photoUrl = uploadPhotoToDrive_(photoData, (name || 'bh meal') + ' - photo');
  // BH photo column = C (3)
  _writePhotoCell_(sh, row, 3, photoUrl, name || 'bh meal');
  SpreadsheetApp.flush();
  _logActivity_(user, 'update photo', 'bh', 'Row ' + row + ': "' + name + '"');
  _touchSync_('bh'); _bustSectionCache_('bh');
  return { ok: true, photoUrl: photoUrl, row: row };
}

function updateIngPhoto(row, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || row < 2) throw new Error('Invalid row');
  if (!photoData || !photoData.bytes) throw new Error('No photo provided');
  var sh = _ss().getSheetByName(INGREDIENTS_SHEET);
  if (!sh) throw new Error('Ingredients sheet not found');
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var name = String(sh.getRange(row, 1).getValue() || '').trim();
  var photoUrl = uploadPhotoToDrive_(photoData, (name || 'ingredient') + ' - photo');
  // Ingredients photo column = C (3)
  _writePhotoCell_(sh, row, 3, photoUrl, name || 'ingredient');
  SpreadsheetApp.flush();
  _logActivity_(user, 'update photo', 'ingredient', 'Row ' + row + ': "' + name + '"');
  _touchSync_('ingredients'); _bustSectionCache_('ingredients');
  return { ok: true, photoUrl: photoUrl, row: row };
}

function updateFixPhoto(row, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || row < 2) throw new Error('Invalid row');
  if (!photoData || !photoData.bytes) throw new Error('No photo provided');
  var sh = _ss().getSheetByName(FIXES_SHEET);
  if (!sh) throw new Error('Fixes sheet not found');
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var id = String(sh.getRange(row, 1).getValue() || '').trim();
  var name = String(sh.getRange(row, 5).getValue() || '').trim();
  var photoUrl = uploadPhotoToDrive_(photoData, (name || 'fix') + ' - photo');
  // Fixes photo column = F (6)
  _writePhotoCell_(sh, row, 6, photoUrl, name || 'fix');
  SpreadsheetApp.flush();
  _logActivity_(user, 'update photo', 'fix', id + ' (row ' + row + '): "' + name + '"');
  _touchSync_('fixes'); _bustSectionCache_('fixes');
  return { ok: true, photoUrl: photoUrl, row: row };
}

/**
 * Update a Quality row's photo. slot must be 'photo1', 'photo2', or 'final'.
 * sheetName is the Quality month tab name (e.g. "Quality Points/April")
 */
function updateQualityPhoto(sheetName, row, slot, photoData) {
  var user = requireRole_(WRITE_ROLES);
  if (!row || row < 2) throw new Error('Invalid row');
  if (!photoData || !photoData.bytes) throw new Error('No photo provided');
  if (!sheetName) throw new Error('Quality month sheet name required');
  if (['photo1', 'photo2', 'final'].indexOf(slot) === -1) throw new Error('Invalid photo slot');
  var sh = _ss().getSheetByName(sheetName);
  if (!sh) throw new Error('Quality sheet "' + sheetName + '" not found');
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var name = String(sh.getRange(row, QUALITY_COL.NAME).getValue() || '').trim();
  var photoUrl = uploadPhotoToDrive_(photoData, (name || 'quality') + ' - ' + slot);
  var col;
  if (slot === 'photo1') col = QUALITY_COL.PHOTO1;
  else if (slot === 'photo2') col = QUALITY_COL.PHOTO2;
  else col = QUALITY_COL.FINAL_PRODUCT_PHOTO;
  _writePhotoCell_(sh, row, col, photoUrl, (name || 'quality') + ' - ' + slot);
  SpreadsheetApp.flush();
  _logActivity_(user, 'update photo', 'quality', sheetName + ' row ' + row + ' (' + slot + '): "' + name + '"');
  _touchSync_('quality'); _bustSectionCache_('quality');
  return { ok: true, photoUrl: photoUrl, row: row, slot: slot };
}

// ============================================================
// DELETE ROW ENDPOINTS (Phase 5b) — Admin only
// ============================================================

function deleteMealRow(row) {
  var user = requireRole_(ADMIN_ROLES);
  if (!row || row < 2) throw new Error('Invalid row');
  var sh = _meals();
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var name = String(sh.getRange(row, COL.NAME).getValue() || '').trim();
  sh.deleteRow(row);
  _DASHBOARD_CACHE = null;
  _logActivity_(user, 'delete', 'meal', 'Row ' + row + ': "' + name + '"');
  _touchSync_('meals'); _bustSectionCache_('meals');
  return { ok: true, row: row };
}

function deleteBhRow(row) {
  var user = requireRole_(ADMIN_ROLES);
  if (!row || row < 3) throw new Error('Invalid row');
  var sh = _ss().getSheetByName(BH_SHEET);
  if (!sh) throw new Error('BH sheet not found');
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var name = String(sh.getRange(row, 2).getValue() || '').trim();
  sh.deleteRow(row);
  _logActivity_(user, 'delete', 'bh', 'Row ' + row + ': "' + name + '"');
  _touchSync_('bh'); _bustSectionCache_('bh');
  return { ok: true, row: row };
}

function deleteIngRow(row) {
  var user = requireRole_(ADMIN_ROLES);
  if (!row || row < 2) throw new Error('Invalid row');
  var sh = _ss().getSheetByName(INGREDIENTS_SHEET);
  if (!sh) throw new Error('Ingredients sheet not found');
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var name = String(sh.getRange(row, 1).getValue() || '').trim();
  sh.deleteRow(row);
  _logActivity_(user, 'delete', 'ingredient', 'Row ' + row + ': "' + name + '"');
  _touchSync_('ingredients'); _bustSectionCache_('ingredients');
  return { ok: true, row: row };
}

function deleteFixRow(row) {
  var user = requireRole_(ADMIN_ROLES);
  if (!row || row < 2) throw new Error('Invalid row');
  var sh = _ss().getSheetByName(FIXES_SHEET);
  if (!sh) throw new Error('Fixes sheet not found');
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var id = String(sh.getRange(row, 1).getValue() || '').trim();
  var name = String(sh.getRange(row, 5).getValue() || '').trim();
  sh.deleteRow(row);
  _logActivity_(user, 'delete', 'fix', id + ' (row ' + row + '): "' + name + '"');
  _touchSync_('fixes'); _bustSectionCache_('fixes');
  return { ok: true, row: row };
}

function deleteQualityRow(sheetName, row) {
  var user = requireRole_(ADMIN_ROLES);
  if (!row || row < 2) throw new Error('Invalid row');
  if (!sheetName) throw new Error('Sheet name required');
  var sh = _ss().getSheetByName(sheetName);
  if (!sh) throw new Error('Quality sheet "' + sheetName + '" not found');
  if (row > sh.getLastRow()) throw new Error('Row out of range');
  var name = String(sh.getRange(row, QUALITY_COL.NAME).getValue() || '').trim();
  sh.deleteRow(row);
  _logActivity_(user, 'delete', 'quality', sheetName + ' row ' + row + ': "' + name + '"');
  _touchSync_('quality'); _bustSectionCache_('quality');
  return { ok: true, row: row };
}

// ============================================================
// DIAGNOSTIC — inspect a single cell's photo state
// ============================================================
/**
 * Run from Apps Script editor:
 *   _debugPhotoRow('meal', 78)   → inspect UAE NPD Progress Tracker row 78 column Q
 *   _debugPhotoRow('bh', 5)
 *   _debugPhotoRow('ingredient', 10)
 *   _debugPhotoRow('fix', 2)
 *   _debugPhotoRow('quality', 5, 'photo1', 'Quality Points/April')
 * Logs formula, raw value, extracted URL, embedded flag.
 */
function _debugPhotoRow(entity, row, slot, sheetName) {
  var sh, col, label;
  if (entity === 'meal')       { sh = _meals(); col = COL.PHOTO; label = MEALS_SHEET + ' col Q'; }
  else if (entity === 'bh')    { sh = _ss().getSheetByName(BH_SHEET); col = 3; label = BH_SHEET + ' col C'; }
  else if (entity === 'ingredient') { sh = _ss().getSheetByName(INGREDIENTS_SHEET); col = 3; label = INGREDIENTS_SHEET + ' col C'; }
  else if (entity === 'fix')   { sh = _ss().getSheetByName(FIXES_SHEET); col = 6; label = FIXES_SHEET + ' col F'; }
  else if (entity === 'quality') {
    if (!sheetName) throw new Error('Quality requires sheetName');
    sh = _ss().getSheetByName(sheetName);
    col = slot === 'photo1' ? QUALITY_COL.PHOTO1 : (slot === 'photo2' ? QUALITY_COL.PHOTO2 : QUALITY_COL.FINAL_PRODUCT_PHOTO);
    label = sheetName + ' col ' + col + ' (' + slot + ')';
  }
  else throw new Error('Unknown entity: ' + entity);
  if (!sh) throw new Error('Sheet not found');
  
  var rng = sh.getRange(row, col);
  var formula = rng.getFormula();
  var value = rng.getValue();
  var displayValue = rng.getDisplayValue();
  var extracted = _extractPhoto_([formula], value);
  
  var cellImageUrl = '';
  var cellImageAvailable = false;
  if (value && typeof value === 'object' && typeof value.getUrl === 'function') {
    try { cellImageUrl = value.getUrl() || ''; cellImageAvailable = true; } catch(e) { cellImageUrl = '(getUrl threw: ' + e + ')'; }
  }
  
  var report = {
    location: label + ' row ' + row,
    formula: formula || '(no formula)',
    rawValueType: typeof value,
    rawValuePreview: (typeof value === 'string') ? value.substring(0, 100) : (value === null ? 'null' : String(value).substring(0, 100)),
    displayValue: String(displayValue).substring(0, 100),
    cellImageAvailable: cellImageAvailable,
    cellImageUrl: cellImageUrl || '(none)',
    extractedUrl: extracted.url || '(no URL extracted)',
    embeddedFlag: extracted.embedded,
    diagnosis: ''
  };
  
  if (formula && formula.indexOf('IMAGE(') >= 0 && !extracted.url) {
    report.diagnosis = '⚠️ Formula has IMAGE() but URL extraction failed. Check formula format.';
  } else if (extracted.url) {
    report.diagnosis = '✅ Photo URL extracted successfully. Should display on dashboard.';
  } else if (cellImageAvailable && !cellImageUrl) {
    report.diagnosis = '⚠️ CellImage detected but getUrl() returned empty. This is an old "insert image" object — dashboard will show View link.';
  } else if (extracted.embedded) {
    report.diagnosis = 'ℹ️ Embedded image (inserted into cell, no URL accessible). Dashboard will show "View in Sheet" link.';
  } else {
    report.diagnosis = 'ℹ️ Cell is empty. No photo here.';
  }
  
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function uploadPhotoToDrive_(photoData, displayName) {
  if (!photoData || !photoData.bytes) throw new Error('No photo data');
  var folder = DriveApp.getFolderById(ensurePhotoFolder_());
  var bytes = Utilities.base64Decode(photoData.bytes);
  var mime = photoData.mimeType || 'image/png';
  var ext = mime.split('/')[1] || 'png';
  if (ext.indexOf(';') >= 0) ext = ext.split(';')[0];
  if (ext === 'jpeg') ext = 'jpg';
  var safeName = (displayName || 'photo').replace(/[^a-zA-Z0-9 _-]/g, '_').replace(/\s+/g, '_').substring(0, 60);
  var fileName = safeName + '_' + new Date().getTime() + '.' + ext;
  var blob = Utilities.newBlob(bytes, mime, fileName);
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

function uploadPdfToDrive_(pdfData, displayName) {
  if (!pdfData || !pdfData.bytes) throw new Error('No PDF data');
  var folder = DriveApp.getFolderById(ensurePdfFolder_());
  var bytes = Utilities.base64Decode(pdfData.bytes);
  var safeName = (displayName || 'pdf').replace(/[^a-zA-Z0-9 _-]/g, '_').replace(/\s+/g, '_').substring(0, 60);
  var fileName = safeName + '_' + new Date().getTime() + '.pdf';
  var blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

// ============================================================
// ACTIVITY LOG
// ============================================================

function _logActivity_(user, action, entity, details) {
  try {
    var ss = _ss();
    var log = ss.getSheetByName(ACTIVITY_SHEET);
    if (!log) {
      log = ss.insertSheet(ACTIVITY_SHEET);
      log.getRange(1, 1, 1, 6).setValues([['Timestamp', 'User', 'Role', 'Action', 'Entity', 'Details']]);
      log.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#0f9d58').setFontColor('#ffffff');
      log.setFrozenRows(1);
    }
    log.appendRow([new Date(), user.email || '(unknown)', user.role || '(none)', action, entity, details || '']);
  } catch(e) { Logger.log('Activity log error: ' + e); }
}

// ============================================================
// HEALTH CHECK
// ============================================================

// ============================================================
// MULTI-MARKET SETUP — ONE-TIME RUN
// ============================================================

/**
 * One-time setup. Creates the "NPD Training - All Markets" folder
 * and clones the UAE master spreadsheet for each non-UAE MP (with all data cleared).
 * Adds an "MP Registry" hidden sheet inside the UAE master listing all spreadsheet IDs.
 * Adds an "Allowed MPs" column to the Access Control sheet for per-MP permissions.
 *
 * Idempotent: safe to re-run — only creates what's missing.
 *
 * RUN THIS ONCE from the Apps Script editor: Run > createMpWorkspaces
 */
function createMpWorkspaces() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  
  var master = _master_();
  var masterId = master.getId();
  
  // 1. Find or create "NPD Training - All Markets" folder
  var folders = DriveApp.getFoldersByName(ALL_MARKETS_FOLDER_NAME);
  var rootFolder;
  if (folders.hasNext()) {
    rootFolder = folders.next();
  } else {
    rootFolder = DriveApp.createFolder(ALL_MARKETS_FOLDER_NAME);
  }
  
  // 2. Ensure MP Registry sheet exists in master
  var reg = master.getSheetByName(MP_REGISTRY_SHEET);
  if (!reg) {
    reg = master.insertSheet(MP_REGISTRY_SHEET);
    reg.getRange(1, 1, 1, 3).setValues([['MP Key', 'Display Name', 'Spreadsheet ID']]);
    reg.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#0f9d58').setFontColor('#ffffff');
    reg.setFrozenRows(1);
    reg.setColumnWidth(1, 140);
    reg.setColumnWidth(2, 160);
    reg.setColumnWidth(3, 360);
    reg.hideSheet();
  }
  
  // 3. Ensure Access Control has "Allowed MPs" column D
  var access = master.getSheetByName(ACCESS_SHEET);
  if (access) {
    var lastCol = Math.max(3, access.getLastColumn());
    var headers = access.getRange(1, 1, 1, Math.max(4, lastCol)).getValues()[0];
    if (lastCol < 4 || String(headers[3] || '').trim() === '') {
      access.getRange(1, 4).setValue('Allowed MPs');
      access.getRange(1, 4).setFontWeight('bold').setBackground('#0f9d58').setFontColor('#ffffff');
      access.setColumnWidth(4, 180);
    }
  }
  
  // 4. Build map of MPs already in registry
  var existing = {};
  if (reg.getLastRow() > 1) {
    var regData = reg.getRange(2, 1, reg.getLastRow() - 1, 3).getValues();
    regData.forEach(function(r) { if (r[0]) existing[String(r[0]).trim()] = r[2]; });
  }
  
  // 5. For each non-UAE MP, create a clone if not exists
  var created = [], reused = [], failed = [];
  
  MP_DEFAULTS.forEach(function(mp) {
    if (mp.key === MASTER_MP_KEY) return;
    
    // Check if registered + still exists
    if (existing[mp.key]) {
      try {
        SpreadsheetApp.openById(existing[mp.key]);
        reused.push(mp.key);
        return;
      } catch(e) {
        // Was registered but file deleted — recreate below
      }
    }
    
    try {
      var newName = 'NPD Training - ' + mp.display;
      var copy = DriveApp.getFileById(masterId).makeCopy(newName, rootFolder);
      var newSs = SpreadsheetApp.openById(copy.getId());
      _clearClonedSheetData_(newSs);
      reg.appendRow([mp.key, mp.display, copy.getId()]);
      created.push(mp.key);
    } catch(e) {
      failed.push(mp.key + ' (' + e.toString() + ')');
    }
  });
  
  var msg = '✅ Multi-Market Setup Complete\n\n' +
    'Folder: ' + ALL_MARKETS_FOLDER_NAME + '\n' +
    'Master MP: ' + MASTER_MP_KEY + '\n' +
    'Created: ' + (created.length === 0 ? '(none)' : created.join(', ')) + '\n' +
    'Already registered: ' + (reused.length === 0 ? '(none)' : reused.join(', ')) + '\n' +
    (failed.length > 0 ? 'Failed: ' + failed.join('; ') + '\n' : '') +
    '\nNext steps:\n' +
    '1. Refresh the dashboard — you should see an MP picker in the sidebar.\n' +
    '2. To grant Editor/Viewer access to specific MPs, edit the Access Control sheet ' +
    'column D ("Allowed MPs") with comma-separated keys (e.g. "KSA-Riyadh,Qatar"). ' +
    'Admins automatically get access to all MPs.';
  
  Logger.log(msg);
  if (ui) ui.alert('Setup Complete', msg, ui.ButtonSet.OK);
  return { created: created, reused: reused, failed: failed };
}

// Clear data rows from a cloned spreadsheet so it starts empty
function _clearClonedSheetData_(ss) {
  var sheetsToClear = [
    { name: MEALS_SHEET, headerRows: 1 },
    { name: BH_SHEET, headerRows: 2 },
    { name: INGREDIENTS_SHEET, headerRows: 1 },
    { name: FIXES_SHEET, headerRows: 1 },
    { name: AUDITS_SHEET, headerRows: 1 }
  ];
  sheetsToClear.forEach(function(spec) {
    var sh = ss.getSheetByName(spec.name);
    if (!sh) return;
    var lastRow = sh.getLastRow();
    if (lastRow > spec.headerRows) {
      sh.getRange(spec.headerRows + 1, 1, lastRow - spec.headerRows, sh.getMaxColumns()).clear();
    }
    // Reset row heights to default
    try { sh.setRowHeights(spec.headerRows + 1, Math.max(1, sh.getMaxRows() - spec.headerRows), 21); } catch(e) {}
  });
  // Clear Quality Points/* tabs (data only)
  ss.getSheets().forEach(function(sh) {
    if (sh.getName().indexOf(QUALITY_PREFIX) === 0) {
      var lastRow = sh.getLastRow();
      if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getMaxColumns()).clear();
      try { sh.setRowHeights(2, Math.max(1, sh.getMaxRows() - 1), 21); } catch(e) {}
    }
  });
  // Remove MP Registry sheet from clones (only master should have it)
  var clonedReg = ss.getSheetByName(MP_REGISTRY_SHEET);
  if (clonedReg) {
    try { ss.deleteSheet(clonedReg); } catch(e) {}
  }
  // Clear Activity Log
  var log = ss.getSheetByName(ACTIVITY_SHEET);
  if (log) {
    var lr = log.getLastRow();
    if (lr > 1) log.getRange(2, 1, lr - 1, log.getMaxColumns()).clear();
  }
  // Keep Access Control sheet but minimal — Ahmed as Admin (won't actually be used since
  // master Access Control is source of truth, but kept for safety)
  var ac = ss.getSheetByName(ACCESS_SHEET);
  if (ac) {
    var alr = ac.getLastRow();
    if (alr > 1) ac.getRange(2, 1, alr - 1, ac.getMaxColumns()).clear();
    ac.getRange(2, 1, 1, 3).setValues([['a.mohamed@calo.app', 'Admin', 'Auto-seeded clone admin']]);
  }
}

function healthCheck() {
  var report = {
    masterSpreadsheetId: MASTER_SPREADSHEET_ID,
    currentMpKey: _currentMpKey_(),
    currentMpSpreadsheetId: _currentSpreadsheetId_(),
    mpRegistry: _getMpRegistry_(),
    user: null,
    mealsSheetExists: false, mealsCount: 0,
    bhSheetExists: false, bhMealsCount: 0,
    qualitySheets: [], qualityEntriesTotal: 0,
    ingredientsSheetExists: false, ingredientsCount: 0,
    fixesSheetExists: false, fixesCount: 0,
    auditsSheetExists: false, auditsCount: 0,
    accessSheetExists: false, activityLogExists: false,
    photoFolderId: null, pdfFolderId: null,
    driveApiEnabled: false
  };
  
  try { report.user = getUserRole_(); } catch(e) { report.user = { error: e.toString() }; }
  try { var sh = _meals(); report.mealsSheetExists = true; report.mealsCount = Math.max(0, sh.getLastRow() - 1); } catch(e) {}
  try { var bh = _ss().getSheetByName(BH_SHEET); if (bh) { report.bhSheetExists = true; report.bhMealsCount = Math.max(0, bh.getLastRow() - 2); } } catch(e) {}
  try { var months = _findQualitySheets_(); report.qualitySheets = months.map(function(m) { return m.name; });
        months.forEach(function(m) { var s = _ss().getSheetByName(m.name); if (s) report.qualityEntriesTotal += Math.max(0, s.getLastRow() - 1); }); } catch(e) {}
  try { var ing = _ss().getSheetByName(INGREDIENTS_SHEET); if (ing) { report.ingredientsSheetExists = true; report.ingredientsCount = Math.max(0, ing.getLastRow() - 1); } } catch(e) {}
  try { var fx = _ss().getSheetByName(FIXES_SHEET); if (fx) { report.fixesSheetExists = true; report.fixesCount = Math.max(0, fx.getLastRow() - 1); } } catch(e) {}
  try { var au = _ss().getSheetByName(AUDITS_SHEET); if (au) { report.auditsSheetExists = true; report.auditsCount = Math.max(0, au.getLastRow() - 1); } } catch(e) {}
  try { var access = _ss().getSheetByName(ACCESS_SHEET); report.accessSheetExists = !!access; } catch(e) {}
  try { var log = _ss().getSheetByName(ACTIVITY_SHEET); report.activityLogExists = !!log; } catch(e) {}
  try { report.photoFolderId = ensurePhotoFolder_(); } catch(e) {}
  try { report.pdfFolderId = ensurePdfFolder_(); } catch(e) {}
  
  // Drive API check
  try {
    if (typeof Drive !== 'undefined' && Drive.Files) report.driveApiEnabled = true;
  } catch(e) {}

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

// ============================================================
// COMMENTS — with @mention email notifications
// ============================================================

function _ensureCommentsSheet_() {
  var master = _master_();
  var sh = master.getSheetByName(COMMENTS_SHEET);
  if (!sh) {
    sh = master.insertSheet(COMMENTS_SHEET);
    sh.getRange(1, 1, 1, 6).setValues([['Timestamp','Section','Row Key','Author','Comment','Mentions']]);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#00c07f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function getComments(section, rowKey) {
  requireRole_(VALID_ROLES);
  var sh = _master_().getSheetByName(COMMENTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]) === section && String(data[i][2]) === String(rowKey)) {
      var ts = data[i][0];
      var tsStr = '';
      if (ts instanceof Date) tsStr = Utilities.formatDate(ts, Session.getScriptTimeZone(), 'MMM dd, yyyy HH:mm');
      result.push({
        timestamp: tsStr,
        author:    String(data[i][3] || ''),
        text:      String(data[i][4] || ''),
        mentions:  data[i][5] ? String(data[i][5]).split(',') : []
      });
    }
  }
  return result;
}

function addComment(section, rowKey, text) {
  var user = requireRole_(VALID_ROLES);
  if (!text || !text.trim()) throw new Error('Comment cannot be empty');
  text = text.trim();

  // Parse @email mentions
  var mentions = [];
  var mentionRe = /@([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
  var m;
  while ((m = mentionRe.exec(text)) !== null) {
    var mEmail = m[1].toLowerCase();
    if (mentions.indexOf(mEmail) === -1) mentions.push(mEmail);
  }

  var sh = _ensureCommentsSheet_();
  sh.appendRow([new Date(), section, String(rowKey), user.email, text, mentions.join(',')]);
  SpreadsheetApp.flush();

  // Send mention emails
  if (mentions.length > 0) {
    var dashUrl = ScriptApp.getService().getUrl();
    var safeText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    mentions.forEach(function(email) {
      try {
        MailApp.sendEmail({
          to: email,
          subject: '[CALO NPD] You were mentioned in a comment',
          htmlBody:
            '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">' +
            '<div style="background:#00c07f;padding:18px 24px;border-radius:10px 10px 0 0">' +
            '<span style="color:#fff;font-size:20px;font-weight:900;letter-spacing:-0.5px">CALO</span>' +
            '<span style="color:rgba(255,255,255,.8);font-size:12px;margin-left:10px">NPD Training Dashboard</span>' +
            '</div>' +
            '<div style="border:1px solid #e8e8e8;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px">' +
            '<p style="margin:0 0 10px;color:#374151"><strong>' + user.email + '</strong> mentioned you in a comment on the <strong>' + section + '</strong> section:</p>' +
            '<blockquote style="margin:0 0 14px;padding:10px 14px;background:#f9fafb;border-left:3px solid #00c07f;border-radius:4px;color:#1a1a1a;font-size:13px;white-space:pre-wrap">' + safeText + '</blockquote>' +
            '<a href="' + dashUrl + '" style="display:inline-block;background:#00c07f;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Open Dashboard →</a>' +
            '<p style="color:#9ca3af;font-size:11px;margin-top:18px">UAE NPD Training Dashboard · CALO Food Company</p>' +
            '</div></div>'
        });
      } catch(e) { Logger.log('Mention email to ' + email + ' failed: ' + e); }
    });
  }

  return { ok: true, mentions: mentions };
}

function getAuthorizedEmails() {
  requireRole_(VALID_ROLES);
  var access = _master_().getSheetByName(ACCESS_SHEET);
  if (!access || access.getLastRow() < 2) return [];
  var data = access.getRange(2, 1, access.getLastRow() - 1, 1).getValues();
  return data.map(function(r) { return String(r[0] || '').trim(); }).filter(Boolean);
}

// ============================================================
// WEEKLY EMAIL REPORT — admin-only, runs via time trigger
// ============================================================

function sendWeeklyReport() {
  var master = _master_();
  var access = master.getSheetByName(ACCESS_SHEET);
  if (!access || access.getLastRow() < 2) return;

  var data = access.getRange(2, 1, access.getLastRow() - 1, 2).getValues();
  var adminEmails = [];
  data.forEach(function(row) {
    if (String(row[1]).trim() === 'Admin' && row[0]) adminEmails.push(String(row[0]).trim());
  });
  if (adminEmails.length === 0) return;

  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy');
  var statsHtml = '';

  try { var dash = getDashboardData(); var t = dash.totals;
    statsHtml += _weeklySection_('🍽️ Meals Overview', [
      ['Total Meals', t.total], ['Launched', t.launched, '#00c07f'],
      ['Rework', t.rework, '#f59e0b'], ['Ideas', t.idea, '#3b82f6'],
      ['Not Launched', t.notLaunched, '#a855f7']]);
  } catch(e) {}
  try { var q = getQualityData(); var qt = q.totals;
    statsHtml += _weeklySection_('⭐ Quality Points', [
      ['Total Issues', qt.total], ['Done', qt.done, '#00c07f'],
      ['Pending', qt.pending, '#f59e0b'], ['In Progress', qt.inProgress, '#4285f4']]);
  } catch(e) {}
  try { var fx = getFixesData(); var ft = fx.totals;
    statsHtml += _weeklySection_('🔧 Fixes', [
      ['Total', ft.total], ['Done', ft.done, '#00c07f'],
      ['Pending', ft.pending, '#f59e0b'], ['In Progress', ft.inProgress, '#4285f4']]);
  } catch(e) {}
  try { var ing = getIngredientsData(); var it = ing.totals;
    statsHtml += _weeklySection_('🧂 Ingredients', [
      ['Total', it.total], ['Done', it.done, '#00c07f'], ['Pending', it.pending, '#f59e0b']]);
  } catch(e) {}

  var html =
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">' +
    '<div style="background:#00c07f;padding:22px 32px;border-radius:12px 12px 0 0">' +
    '<div style="color:#fff;font-size:26px;font-weight:900;letter-spacing:-0.5px">CALO</div>' +
    '<div style="color:rgba(255,255,255,.85);font-size:13px;margin-top:2px">NPD Training Dashboard · Weekly Report</div>' +
    '</div>' +
    '<div style="border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;padding:24px 32px;background:#fff">' +
    '<p style="color:#6b7280;font-size:13px;margin:0 0 18px">Week ending <strong style="color:#1a1a1a">' + now + '</strong></p>' +
    statsHtml +
    '<div style="margin-top:24px"><a href="' + ScriptApp.getService().getUrl() + '" style="display:inline-block;background:#00c07f;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Open Dashboard →</a></div>' +
    '<p style="color:#d1d5db;font-size:11px;margin-top:24px;border-top:1px solid #f3f4f6;padding-top:14px">You are receiving this as an Admin on the UAE NPD Training Dashboard.</p>' +
    '</div></div>';

  adminEmails.forEach(function(email) {
    try { MailApp.sendEmail({ to: email, subject: '[CALO NPD] Weekly Dashboard Report — ' + now, htmlBody: html }); }
    catch(e) { Logger.log('Weekly report to ' + email + ' failed: ' + e); }
  });
}

function _weeklySection_(title, rows) {
  var rowsHtml = rows.map(function(r) {
    var color = r[2] ? 'color:' + r[2] + ';font-weight:700' : 'color:#1a1a1a;font-weight:600';
    return '<tr><td style="padding:7px 14px;background:#f9fafb;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6">' + r[0] + '</td>' +
      '<td style="padding:7px 14px;font-size:14px;border-bottom:1px solid #f3f4f6;' + color + '">' + (r[1] !== undefined ? r[1] : '—') + '</td></tr>';
  }).join('');
  return '<div style="margin-bottom:20px"><div style="font-size:14px;font-weight:700;color:#374151;margin-bottom:8px">' + title + '</div>' +
    '<table style="border-collapse:collapse;width:100%;border:1px solid #f3f4f6;border-radius:8px;overflow:hidden">' + rowsHtml + '</table></div>';
}

function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendWeeklyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  SpreadsheetApp.getUi().alert('✅ Weekly Trigger Set',
    'Reports will be emailed every Monday at 8am to all Admin accounts.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
// ─── @mention helpers ─────────────────────────────────────────────────────────

function getMentionableUsers() {
  requireRole_(VALID_ROLES);
  var cache = CacheService.getScriptCache();
  var cached = cache.get('mention_users_v3');
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  var byEmail = {};

  // Source 1: Admin SDK Directory — lists every user in the Workspace domain
  try {
    var domain = Session.getActiveUser().getEmail().split('@')[1];
    var pageToken;
    do {
      var resp = AdminDirectory.Users.list({
        domain: domain, maxResults: 500, orderBy: 'givenName', pageToken: pageToken
      });
      (resp.users || []).forEach(function(u) {
        if (u.suspended) return;
        var gn = u.name && u.name.givenName;
        var fn = u.name && u.name.familyName;
        var name  = (gn && fn) ? (gn + ' ' + fn) : ((u.name && u.name.fullName) || u.primaryEmail);
        var email = u.primaryEmail;
        if (name && email) byEmail[email.toLowerCase()] = { name: name, email: email };
      });
      pageToken = resp.nextPageToken;
    } while (pageToken);
  } catch(e) {
    Logger.log('getMentionableUsers AdminDirectory error: ' + e);
  }

  // Source 2: People API fallback (if Admin SDK not enabled or no admin access)
  if (Object.keys(byEmail).length === 0) {
    try {
      var pt;
      do {
        var p2 = { readMask: 'names,emailAddresses',
                   sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'], pageSize: 200 };
        if (pt) p2.pageToken = pt;
        var r2 = People.People.listDirectoryPeople(p2);
        (r2.people || []).forEach(function(p) {
          var n = p.names && p.names[0] && p.names[0].displayName;
          var e = p.emailAddresses && p.emailAddresses[0] && p.emailAddresses[0].value;
          if (n && e) byEmail[e.toLowerCase()] = { name: n, email: e };
        });
        pt = r2.nextPageToken;
      } while (pt);
    } catch(e) { Logger.log('getMentionableUsers People API error: ' + e); }
  }

  // Source 3: MENTION_USERS script property — always merged in
  try {
    var props = PropertiesService.getScriptProperties();
    var mpKey = _currentMpKey_();
    var prop = props.getProperty('MENTION_USERS_' + mpKey) || props.getProperty('MENTION_USERS') || '';
    prop.split(',').forEach(function(entry) {
      var colon = entry.indexOf(':');
      if (colon < 1) return;
      var n = entry.substring(0, colon).trim();
      var e = entry.substring(colon + 1).trim();
      if (n && e) byEmail[e.toLowerCase()] = { name: n, email: e };
    });
  } catch(e) { Logger.log('getMentionableUsers Script Property error: ' + e); }

  var users = Object.keys(byEmail).map(function(k){ return byEmail[k]; });
  users.sort(function(a,b){ return a.name.localeCompare(b.name); });
  try { cache.put('mention_users_v3', JSON.stringify(users), 300); } catch(e) {}
  return users;
}

function clearMentionUsersCache() {
  var c = CacheService.getScriptCache();
  c.remove('mention_users_v3');
  c.remove('mention_users_v2');
  c.remove('mention_users_v1');
  return 'Mention user cache cleared.';
}

function _sendMentionEmails_(mentionedEmails, sectionLabel, itemName, itemText, reporterEmail) {
  if (!mentionedEmails || mentionedEmails.length === 0) return;
  var reporter = reporterEmail || Session.getActiveUser().getEmail();
  mentionedEmails.forEach(function(toEmail) {
    try {
      MailApp.sendEmail({
        to: toEmail,
        subject: 'You were mentioned in ' + sectionLabel + ': ' + itemName,
        body: 'Hi,\n\n' + reporter + ' mentioned you in "' + itemName + '":\n\n' +
              '"' + itemText + '"\n\n' +
              'Log in to the NPD Training Dashboard to view it.\n\nNPD Training Dashboard',
        replyTo: reporter
      });
    } catch(e) { Logger.log('Mention email failed to ' + toEmail + ': ' + e); }
  });
}

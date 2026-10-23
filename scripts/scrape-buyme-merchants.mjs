#!/usr/bin/env node
import fs from 'node:fs';

const ENDPOINT = 'https://buyme.co.il/brands/13438757/options';
const OUTPUT = new URL('../data/buyme-all-merchants.json', import.meta.url);
const OVERRIDES_FILE = new URL('./buyme-hebrew-name-overrides.json', import.meta.url);
const MIN_MERCHANTS = 500;

const res = await fetch(ENDPOINT, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://buyme.co.il/brands/13438757',
  },
});

if (!res.ok) {
  throw new Error(`BuyMe request failed: ${res.status} ${res.statusText}`);
}

const { brands } = await res.json();
const names = brands.map((b) => b.title);

if (names.length < MIN_MERCHANTS) {
  throw new Error(
    `Only ${names.length} merchants scraped (expected at least ${MIN_MERCHANTS}) — refusing to overwrite`
  );
}

const invalid = names.filter((name) => typeof name !== 'string' || name.trim() === '');
if (invalid.length > 0) {
  throw new Error(
    `${invalid.length} scraped entr${invalid.length === 1 ? 'y is' : 'ies are'} not a non-empty string — refusing to overwrite`
  );
}

// Mirrors `storeKey` in WalletExtender's src/domain/stores.ts (a separate repo
// since the split). This script runs as a plain Node ESM file, so it
// can't `import` that module anyway — inlined instead.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;
const storeKey = (name) =>
  name
    .replace(BIDI_CONTROLS, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('he');

const uniqueKeys = new Set(names.map(storeKey));
if (uniqueKeys.size < names.length) {
  throw new Error(
    `${names.length} merchants scraped but only ${uniqueKeys.size} unique storeKey-normalized names — refusing to overwrite`
  );
}

// ---------------------------------------------------------------------------
// Hebrew alias extraction.
//
// BuyMe's own `searchTerms` field per brand is an SEO keyword bag, not a
// clean name list — mixed in with a merchant's real Hebrew name/transliteration
// are generic category words ("ספורט", "אופנה"), competitor mentions, hashtag
// campaign tags, and keyboard-layout-confusion typos. This heuristic tries to
// pull out the one clean Hebrew alias, when one exists, for a merchant whose
// official `name` is Latin-only (nothing to add for an already-Hebrew name).
//
// `buyme-hebrew-name-overrides.json` — a one-time hand-curated pass over the
// dataset this heuristic existed against when the feature shipped — takes
// priority when a merchant's `name` is a known key in it (including `null`,
// meaning "no good alias, don't guess"). A brand-new merchant BuyMe adds
// later has no override entry, so it falls through to this heuristic's own
// best-effort guess, unreviewed — see the project's design docs for why:
// ongoing curation of every new merchant isn't something an unattended
// monthly job can do, so coverage for new entries is heuristic-quality, not
// hand-verified.
const STOPWORDS = new Set([
  'אופנה','ספורט','מסעדה','מסעדות','בגדים','חשמל','תינוק','תינוקות','הורים טריים',
  'מוצרים לתינוק','אביזרי תינוקות','חופשה','מלונות','איפור','טיפוח','יופי','קפה',
  'ארוחת בוקר','ארוחת ערב','בית קפה','ארוחות בוקר','נעליים','נעלי ספורט','ריצה',
  'כדורגל','כדור','יוגה','פאדל','סניקרס','חולצות','מכנסים','שמלה','שמלות','אוכל',
  'מסעדה יפנית','דגים','פירות ים','סושי','אלקטרוניקה','מוצרי חשמל','מוצרי חשמל לבית',
  'חשמל לבית','מקרר','מסכים','טלויזיות','חשמלי',"גאדג'טים",'עגלות','לידה','שילב',
  'המתנות האהובות','מתנות','תרבות','פנאי','אתגר','חוויה','חוויות','טבע','נופש',
  'ילדים','לילדים','גברים','נשים','לגברים','לנשים','בית','לבית','ריהוט','עיצוב',
  'תכשיטים','תיקים','משקפיים','אופטיקה','נעלי ילדים','נעלי נשים','נעלי גברים',
  'בגדי ים','הלבשה תחתונה','גופיות','טייצים','טייץ','סטייל','אוכל מהיר','פיצה',
  'המבורגר','בשרי','חלבי','טבעוני','צמחוני','יין','יינות','בירה','קוקטיילים',
  'סאקה','טוקיו','יפן','גיוזה','ראמן','טמפורה','מסעדת שף','תל אביב','ירושלים',
  'חיפה','באר שבע','אילת','נתניה','רעננה','הרצליה','פארק','גן חיות','אקווריום',
  'מוזיאון','תיאטרון','קולנוע','סרטים','הופעות','מוזיקה','ריקוד','אמנות','ציור',
  'צילום','סדנה','סדנאות','העשרה','לימוד','קורס','קורסים','ספא','עיסוי','בריכה',
  'חדר כושר','כושר','אימון','אימונים','מכון כושר','יופי וטיפוח','קוסמטיקה','בושם',
  'בשמים','שיער','מספרה','ציפורניים','מניקור','פדיקור','עור','טבעי','אורגני',
  'מתנה','גיפט','שובר','שוברים','זיכוי','הנחה','מבצע','מבצעים','חדש','חדשים',
  'מומלץ','מומלצים','פופולרי','אקסלוסיבי','יוקרה','פרימיום','מקצועי','איכות',
  'איכותי','שירות','לקוחות','אונליין','משלוחים','משלוח','חינם','מימוש','כלים',
  'מכון','מקומי','נוער','משחקי','תל','בתל אביב','באילת','טעימות','הרחבת','טבעות',
  'הלבשה','מוטגי אופנה','מסעדת','ביגוד','תשלום אונליין','מעדניה','תשלום','גיפט קארד',
  'כרטיס מתנה','מארז','מארזים','חבילה','חבילות','קופון','קופונים','אקטיבציה',
  'עסקים במילואים','תשלום טלפוני','עד הבית','וולנס','מותגים','מנות ראשונות',
]);

function hebrewRatio(s) {
  const clean = s.replace(/[^A-Za-z֑-׿]/g, '');
  if (!clean.length) return 0;
  return (s.match(/[֑-׿]/g) || []).length / clean.length;
}
function isHebrewHeavy(s) {
  return hebrewRatio(s) >= 0.6;
}
function looksLikeJunk(s) {
  if (s.includes('#')) return true;
  if (/[0-9]/.test(s)) return true;
  if (s.trim().length < 2 || s.trim().length > 25) return true;
  return false;
}

const PHONETIC_MAP = [
  [/th/gi, 't'], [/sh/gi, 'w'], [/ch/gi, 'x'], [/ph/gi, 'f'], [/ck/gi, 'k'],
  [/[aeiou]/gi, ''],
  [/b/gi, 'ב'], [/c/gi, 'ק'], [/d/gi, 'ד'], [/f/gi, 'פ'], [/g/gi, 'ג'],
  [/h/gi, 'ה'], [/j/gi, 'ג'], [/k/gi, 'ק'], [/l/gi, 'ל'], [/m/gi, 'מ'],
  [/n/gi, 'נ'], [/p/gi, 'פ'], [/q/gi, 'ק'], [/r/gi, 'ר'], [/s/gi, 'ס'],
  [/t/gi, 'ת'], [/v/gi, 'ב'], [/w/gi, 'ב'], [/x/gi, 'קס'], [/y/gi, 'י'], [/z/gi, 'ז'],
];
function foldLatinToHebrewish(s) {
  let out = s.toLowerCase();
  for (const [re, rep] of PHONETIC_MAP) out = out.replace(re, rep);
  return out;
}
function stripNonHebrew(s) {
  return s.replace(/[^֑-׿]/g, '');
}
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}
function latinCore(name) {
  return name.replace(/[^A-Za-z]/g, '');
}

function guessHeName(name, rawSearchTerms) {
  const core = latinCore(name);
  if (isHebrewHeavy(name) || core.length < 2) return null; // already Hebrew, or nothing Latin to alias

  let terms = [];
  try {
    terms = JSON.parse(rawSearchTerms || '[]');
  } catch {
    /* no searchTerms to work with */
  }

  const candidates = new Set();
  for (const raw of terms) {
    for (const chunk of raw.split(/[-–—,]/)) {
      const c = chunk.trim();
      if (c) candidates.add(c);
    }
  }

  const nameFolded = foldLatinToHebrewish(core);
  let best = null;
  for (const c of candidates) {
    if (!isHebrewHeavy(c) || looksLikeJunk(c) || STOPWORDS.has(c)) continue;
    const heOnly = stripNonHebrew(c);
    if (heOnly.length < 2) continue;
    const dist = levenshtein(heOnly, nameFolded);
    const score = dist / Math.max(nameFolded.length, heOnly.length, 1);
    if (!best || score < best.score) best = { heName: c, score };
  }

  // Above ~0.6 the candidate is little better than noise — leave unset
  // rather than ship a guess with no real phonetic relationship.
  return best && best.score <= 0.6 ? best.heName : null;
}

// ---------------------------------------------------------------------------
// Claude lookup for merchants with no override — i.e. genuinely new ones,
// since every merchant that existed at launch has an explicit override
// (including explicit nulls). Optional: with no ANTHROPIC_API_KEY, every new
// merchant falls back to the phonetic heuristic above, same as before this
// existed. A typical month adds a handful of new merchants, not hundreds, so
// this stays well under MAX_LLM_LOOKUPS and costs cents, not dollars — see
// the design docs' Hebrew alias names addendum for the request that led here
// (avoid re-auditing hundreds of entries by hand every time the heuristic's
// guess is wrong).
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const LLM_MODEL = 'claude-haiku-4-5-20251001';
const MAX_LLM_LOOKUPS = 30;

async function lookupHeNameViaClaude(name) {
  const prompt =
    `What is the Hebrew name or spelling that Israeli shoppers commonly use for the ` +
    `brand/business "${name}"? This is for an Israeli gift-card app matching search ` +
    `queries, so accuracy matters more than a guess. Use web search if you are not ` +
    `already confident. You may explain your reasoning, but your reply MUST end with ` +
    `a final line, and nothing after it, in exactly this format:\n` +
    `ANSWER: <the Hebrew name>\n` +
    `or, if there is no well-established separate Hebrew name (a well-known ` +
    `international brand Israelis write in Latin as-is, or you are not reasonably ` +
    `confident):\n` +
    `ANSWER: NONE`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
      // allowed_callers: ['direct'] is required for models that don't
      // support programmatic (code-execution-routed) tool calling —
      // Anthropic's docs say omitting it returns a 400 telling you to set
      // it. A live run without this field did 400 (not 401/403, so the key
      // itself was fine) — matches that documented failure mode exactly.
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 2, allowed_callers: ['direct'] },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API request failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  // Tool-using responses commonly carry more than one text block — a
  // "let me search for that" block before the tool call, then the real
  // answer after. Joining every block and testing the whole thing for
  // "looks like Hebrew" (as an earlier version of this function did) let a
  // narration block in English dilute a perfectly good answer below the
  // Hebrew-density threshold, silently discarding it. Asking for a fixed
  // "ANSWER: ..." final line and parsing only that line is immune to
  // however much narration comes before it.
  const fullText = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const match = fullText.match(/ANSWER:\s*(.+?)\s*$/m);
  const answer = match ? match[1].trim() : '';

  if (!answer || answer.toUpperCase() === 'NONE') return null;
  // Guard against the model not following the "only the name" instruction —
  // never ship a response that doesn't look like a clean Hebrew name.
  if (!isHebrewHeavy(answer) || looksLikeJunk(answer)) return null;
  return answer;
}

let overrides = {};
try {
  overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf-8'));
} catch {
  // No overrides file — every merchant falls through to the heuristic.
}

// Names already resolved by a previous run (or, on the very first run after
// this feature shipped, by the launch dataset itself) — never re-queried via
// Claude, even without an override entry. Without this, "no override" would
// wrongly mean "genuinely new": most of the merchants live when this feature
// shipped have no override either, because their heuristic guess was already
// fine and nothing needed correcting. Re-reading the file this script is
// about to overwrite, before overwriting it, is what makes "new" mean
// "actually new since last month" instead of "happens to lack an override".
let knownNames = new Set();
try {
  const previous = JSON.parse(fs.readFileSync(OUTPUT, 'utf-8'));
  knownNames = new Set(previous.map((e) => e.name));
} catch {
  // No previous output on disk yet — every merchant is "new" this run.
}

const entries = [];
let llmLookupsUsed = 0;
for (const b of brands) {
  const hasOverride = Object.prototype.hasOwnProperty.call(overrides, b.title);
  const isNewMerchant = !hasOverride && !knownNames.has(b.title);
  let heName;

  if (hasOverride) {
    heName = overrides[b.title];
  } else if (
    isNewMerchant &&
    ANTHROPIC_API_KEY &&
    llmLookupsUsed < MAX_LLM_LOOKUPS &&
    !isHebrewHeavy(b.title)
  ) {
    llmLookupsUsed++;
    try {
      heName = await lookupHeNameViaClaude(b.title);
    } catch (err) {
      console.warn(
        `Claude lookup failed for "${b.title}": ${err.message} — falling back to heuristic`
      );
      heName = guessHeName(b.title, b.searchTerms);
    }
  } else {
    heName = guessHeName(b.title, b.searchTerms);
  }

  entries.push({ name: b.title, heName: heName || null });
}

// Compare against the previous run's entries (not just names) so the
// summary can distinguish "a merchant was added/removed" from "an existing
// merchant's Hebrew alias changed" — both produce a git diff on the file,
// but they're different kinds of news to report.
let previousEntries = [];
try {
  previousEntries = JSON.parse(fs.readFileSync(OUTPUT, 'utf-8'));
} catch {
  /* handled above via knownNames; re-reading here is cheap and keeps this
     section independent of that earlier read */
}
const previousHeNameByName = new Map(previousEntries.map((e) => [e.name, e.heName]));
const newNames = new Set(entries.map((e) => e.name));

const added = entries.filter((e) => !knownNames.has(e.name)).map((e) => e.name);
const removed = [...knownNames].filter((n) => !newNames.has(n));
const aliasChanged = entries
  .filter((e) => knownNames.has(e.name) && previousHeNameByName.get(e.name) !== e.heName)
  .map((e) => `${e.name}: ${previousHeNameByName.get(e.name) ?? '(none)'} → ${e.heName ?? '(none)'}`);

fs.writeFileSync(OUTPUT, JSON.stringify(entries, null, 2) + '\n');
const withHeName = entries.filter((e) => e.heName).length;
const summary =
  `Wrote ${entries.length} merchants (${withHeName} with a Hebrew alias, ` +
  `${llmLookupsUsed} via Claude) to ${OUTPUT.pathname}`;
console.log(summary);

// Written unconditionally — the workflow only opens an issue from this file
// when its own `git diff` on the data file finds a real change, so an
// unused file on a no-change run is harmless.
const issueBody = [
  summary,
  '',
  `**Added (${added.length}):**`,
  added.length ? added.map((n) => `- ${n}`).join('\n') : '(none)',
  '',
  `**Removed (${removed.length}):**`,
  removed.length ? removed.map((n) => `- ${n}`).join('\n') : '(none)',
  '',
  `**Hebrew alias changed for an existing merchant (${aliasChanged.length}):**`,
  aliasChanged.length ? aliasChanged.map((n) => `- ${n}`).join('\n') : '(none)',
].join('\n');
fs.writeFileSync(new URL('../buyme-refresh-summary.md', import.meta.url), issueBody + '\n');

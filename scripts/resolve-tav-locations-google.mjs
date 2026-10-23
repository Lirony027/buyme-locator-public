#!/usr/bin/env node
/**
 * Pipelines B′ and C′ — Google Places for the three Shufersal banners and
 * the 179 תו הזהב chains that carry no address of their own.
 *
 * Reads poc/.cache/tav-payloads.json rather than fetching it: that cache is
 * scripts/fetch-tav-payloads.mjs's job, done once and reused here the same
 * way scripts/resolve-tav-addresses.mjs reuses it. Because Task 1 extracted
 * the Places client, this script is the loop and the disk cache only — it
 * writes no HTTP code of its own.
 */
import fs from 'node:fs';

import { createBudget } from '../poc/lib/call-budget.mjs';
import { israelTiles } from '../poc/lib/israel-tiles.mjs';
import { createPlacesClient, dedupeByCoordinate, MAX_RESULTS_PER_QUERY } from '../poc/lib/places.mjs';
import { brandForms, nameMatchesForms } from '../poc/lib/match-chains.mjs';
import { branchTruth, mergeBrands, partition } from '../poc/lib/tav-catalogue.mjs';

const ROOT = new URL('..', import.meta.url);
const PAYLOADS = new URL('poc/.cache/tav-payloads.json', ROOT);
const CACHE_DIR = new URL('poc/.cache/', ROOT);
const CACHE = new URL('poc/.cache/tav-google-places.json', ROOT);
const OUTPUT = new URL('poc/tav-locations-google.json', ROOT);

/** Grid used only for chains that hit the 60-result cap nationally. */
const TILE_ROWS = 3;
const TILE_COLS = 4;

/**
 * Shared with every other source in the same refresh. SPENT_ALREADY is set by
 * a caller that runs a second source after this one, the same way
 * scripts/resolve-buyme-chains-google.mjs's budget works.
 */
const CALL_BUDGET = 4500;
const budget = createBudget(CALL_BUDGET, Number(process.env.PLACES_CALLS_SPENT) || 0);

const API_KEY = process.env.GOOGLE_PIPELINE_API_KEY || '';
if (!API_KEY) {
  console.error(
    'GOOGLE_PIPELINE_API_KEY is not set.\n\n' +
      'This pipeline needs a Google Cloud key with the Places API enabled.\n' +
      'Put it in .env.local (already git-ignored) as:\n' +
      '  GOOGLE_PIPELINE_API_KEY=...\n' +
      'and run with: node --env-file=.env.local scripts/resolve-tav-locations-google.mjs\n\n' +
      'Use a key restricted to the Places API. Do NOT reuse the page key.'
  );
  process.exit(1);
}

const places = createPlacesClient({ apiKey: API_KEY, budget });

let cache = {};
if (fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf-8'));

function saveCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const temp = new URL('poc/.cache/tav-google-places.json.tmp', ROOT);
  fs.writeFileSync(temp, JSON.stringify(cache, null, 1));
  fs.renameSync(temp, CACHE);
}

if (!fs.existsSync(PAYLOADS)) {
  throw new Error(`${PAYLOADS} is missing — run scripts/fetch-tav-payloads.mjs first`);
}
const { cubes, branches } = JSON.parse(fs.readFileSync(PAYLOADS, 'utf-8'));

const { banners, chains } = partition(mergeBrands(cubes));

// Banners first: they are the only chains with a published denominator, so a
// budget that runs out mid-run still leaves the accuracy check intact.
const targets = [...banners, ...chains];

console.log(`${targets.length} targets (${banners.length} banners + ${chains.length} chains); querying Google Places...`);

const out = [];
let tiled = 0;
let rawTotal = 0;
let filteredTotal = 0;

for (const brand of targets) {
  const key = brand.name;

  if (!(key in cache)) {
    const query = `${brand.name} ישראל`;
    let locations = await places.searchAll(query, null);

    // Hitting the cap means there are certainly more than 60 — only then is
    // the tiled sweep worth its ~12x cost.
    if (locations.length >= MAX_RESULTS_PER_QUERY) {
      tiled++;
      for (const tile of israelTiles(TILE_ROWS, TILE_COLS)) {
        const inTile = await places.searchAll(query, { rectangle: tile });
        locations = locations.concat(inTile);
      }
    }

    const deduped = dedupeByCoordinate(locations);

    // The cache holds Places' raw, unfiltered results — including each
    // result's `name` — so that retuning the brand matcher below costs zero
    // further API calls, the same lesson scripts/resolve-buyme-chains-osm.mjs
    // records for caching the raw OSM dump.
    cache[key] = deduped;
    saveCache();
  }

  // Anchored brand matching, not Places' relevance ranking: a generic
  // Hebrew brand name like ביגוד ("clothing") gets category matches from
  // Places, not brand matches — 426 pins measured live, of which only 4 of
  // a 20-result sample even contained the brand name. Hebrew name plus the
  // catalogue's `latin` transliteration (nameInAnotherLanguage): Google
  // itself frequently displays a store under its Latin form — סם אדלמן is
  // "Sam Edelman", לונגצ'אמפ is "Longchamp" — so omitting it loses real
  // matches for no safety gain. The transliteration is loose (`be parm` for
  // בי פארם) as a *search query*, but that risk does not apply here: this
  // is a match form, never a query, and `nameMatchesForms`'s anchoring
  // (equals, or starts with the form plus a space) means a loose Latin form
  // can only match a Places result whose own display name equals or begins
  // with it — it can never widen the match the way a query would.
  const forms = brandForms({ name: brand.name, heName: brand.latin });
  const filtered = cache[key].filter((loc) => nameMatchesForms(loc.name, forms));

  rawTotal += cache[key].length;
  filteredTotal += filtered.length;

  if (filtered.length > 0) {
    out.push({ name: key, locations: filtered.map(({ lat, lng, label }) => ({ lat, lng, label })) });
  }
}

console.log(
  `Brand matching: ${rawTotal} raw Places results across ${targets.length} targets, ` +
    `${filteredTotal} survived the anchored brand filter.`
);

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: 'google-places',
      callsUsed: budget.used(),
      branchTruth: branchTruth(branches),
      brands: out,
    },
    null,
    2
  ) + '\n'
);

const total = out.reduce((n, b) => n + b.locations.length, 0);
console.log(
  `Wrote ${out.length} of ${targets.length} targets (${total} branches) using ${budget.used()} API calls ` +
    `(${tiled} needed the tiled sweep) to poc/tav-locations-google.json`
);

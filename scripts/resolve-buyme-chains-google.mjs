#!/usr/bin/env node
import fs from 'node:fs';

import { israelTiles } from '../poc/lib/israel-tiles.mjs';
import { createBudget } from '../poc/lib/call-budget.mjs';
import { createPlacesClient, dedupeByCoordinate, MAX_RESULTS_PER_QUERY } from '../poc/lib/places.mjs';

const BUYME_ENDPOINT = 'https://buyme.co.il/brands/13438757/options';

const ROOT = new URL('..', import.meta.url);
const CACHE_DIR = new URL('poc/.cache/', ROOT);
const CACHE = new URL('poc/.cache/google-places.json', ROOT);
const OUTPUT = new URL('poc/buyme-chains-google.json', ROOT);

/** BuyMe's own region id for "מימוש אונליין". Must match the OSM pipeline. */
const ONLINE_REGION_ID = 3038;
/** Grid used only for chains that hit the cap nationally. */
const TILE_ROWS = 3;
const TILE_COLS = 4;
/**
 * Shared with every other source in the same refresh. SPENT_ALREADY is set by
 * scripts/refresh-google-data.mjs when it runs a second source after this one.
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
      'and run with: node --env-file=.env.local scripts/resolve-buyme-chains-google.mjs\n\n' +
      'Use a key restricted to the Places API. Do NOT reuse the page key.'
  );
  process.exit(1);
}

const places = createPlacesClient({ apiKey: API_KEY, budget });

let cache = {};
if (fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf-8'));

function saveCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const temp = new URL('poc/.cache/google-places.json.tmp', ROOT);
  fs.writeFileSync(temp, JSON.stringify(cache, null, 1));
  fs.renameSync(temp, CACHE);
}

const res = await fetch(BUYME_ENDPOINT, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://buyme.co.il/brands/13438757',
  },
});
if (!res.ok) throw new Error(`BuyMe request failed: ${res.status} ${res.statusText}`);
const { brands } = await res.json();

// Identical rule to scripts/resolve-buyme-chains-osm.mjs. These two filters
// must agree: a brand counted as a chain here but online-only there (or the
// reverse) would appear in both lists on the page.
const chains = brands.filter(
  (b) =>
    !b.googleMapAddr &&
    (b.supplier_regions ?? []).some((r) => Number(r.region_id) !== ONLINE_REGION_ID)
);

console.log(`${chains.length} chain candidates; querying Google Places...`);

const out = [];
let tiled = 0;

for (const brand of chains) {
  const key = brand.title;

  if (!(key in cache)) {
    const query = `${brand.title} ישראל`;
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

    cache[key] = deduped;
    saveCache();
  }

  if (cache[key].length > 0) out.push({ name: key, locations: cache[key] });
}

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), source: 'google-places', callsUsed: budget.used(), brands: out },
    null,
    2
  ) + '\n'
);

const total = out.reduce((n, b) => n + b.locations.length, 0);
console.log(
  `Wrote ${out.length} of ${chains.length} chains (${total} branches) using ${budget.used()} API calls ` +
    `(${tiled} chains needed the tiled sweep) to poc/buyme-chains-google.json`
);

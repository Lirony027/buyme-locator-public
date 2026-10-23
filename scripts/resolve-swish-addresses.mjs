#!/usr/bin/env node
/**
 * Geocodes every Swish branch address.
 *
 * This is the whole location pipeline for this source — there is no Google
 * Places path and no OSM/Overpass path, because Swish publishes street
 * addresses for 98.9% of its branches and nothing has to be guessed.
 *
 * Free geocoders only: Nominatim then Photon, via the shared cascade in
 * poc/lib/geocode.mjs. Their output is ODbL, permanent and committable,
 * which is why poc/swish-locations.json is a tracked file while
 * poc/tav-locations-google.json is git-ignored.
 */
import fs from 'node:fs';

import { branchQuery, mergeCards } from '../poc/lib/swish-catalogue.mjs';
import { createGeocoder } from '../poc/lib/geocode.mjs';

const ROOT = new URL('..', import.meta.url);
const CHAINS_CACHE = new URL('poc/.cache/swish-chains.json', ROOT);
const BRANCH_DIR = new URL('poc/.cache/swish-branches/', ROOT);
const GEOCODE_CACHE = new URL('poc/.cache/swish-geocode.json', ROOT);
const CACHE_DIR = new URL('poc/.cache/', ROOT);
const OUTPUT = new URL('poc/swish-locations.json', ROOT);

if (!fs.existsSync(CHAINS_CACHE)) {
  throw new Error('poc/.cache/swish-chains.json is missing — run scripts/fetch-swish-payloads.mjs first');
}

const { cards } = JSON.parse(fs.readFileSync(CHAINS_CACHE, 'utf-8'));
const chains = mergeCards(cards);

const branchesById = {};
for (const chain of chains) {
  const file = new URL(`${chain.chainId}.json`, BRANCH_DIR);
  if (fs.existsSync(file)) branchesById[chain.chainId] = JSON.parse(fs.readFileSync(file, 'utf-8'));
}

let cache = {};
if (fs.existsSync(GEOCODE_CACHE)) cache = JSON.parse(fs.readFileSync(GEOCODE_CACHE, 'utf-8'));

function saveCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Write-then-rename: a crash mid-write must not truncate the live cache,
  // or the next run loses every lookup this one paid for — and at ~1 req/sec
  // over thousands of addresses that is hours.
  const temp = new URL('poc/.cache/swish-geocode.json.tmp', ROOT);
  fs.writeFileSync(temp, JSON.stringify(cache, null, 1));
  fs.renameSync(temp, GEOCODE_CACHE);
}

const { geocode } = createGeocoder({});

const total = Object.values(branchesById).reduce((n, list) => n + list.length, 0);
console.log(`Geocoding up to ${total} Swish branches (~1 req/sec, cached across runs)...`);

const out = [];
let placed = 0;
let unusable = 0;
let missed = 0;
let done = 0;

for (const chain of chains) {
  const branches = branchesById[chain.chainId] ?? [];
  const locations = [];

  for (const branch of branches) {
    done++;
    const query = branchQuery(branch);
    if (!query) {
      unusable++;
      continue;
    }

    if (!(query in cache)) {
      cache[query] = await geocode(query);
      saveCache();
    }

    const resolved = cache[query];
    if (!resolved) {
      missed++;
      continue;
    }

    locations.push({
      lat: resolved.lat,
      lng: resolved.lng,
      // The branch's own name is more useful on a pin than the address it
      // was geocoded from — "טימברלנד-אילת- מול הים" locates a person in a
      // way "הפלמ\"ח 1, אילת" does not.
      label: branch.branchName || query,
      precision: resolved.precision,
    });
    placed++;
  }

  if (done % 500 === 0) console.log(`  ${done}/${total} branches — ${placed} placed`);

  if (locations.length) {
    out.push({
      chainId: chain.chainId,
      name: chain.name,
      locations,
      // Each chain's own branch count, chainId-scoped — not the name-level
      // sum from branchTruth(). mergeCards() keys chains on chainId because
      // two chains may legitimately share a display name; writing the
      // name-level sum here would double-count if that ever happened, since
      // scripts/catalogues/swish.mjs already sums `published` by name again.
      published: branches.length,
    });
  }
}

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), source: 'nominatim+photon', chains: out },
    null,
    1
  ) + '\n'
);

const pct = ((placed / Math.max(total - unusable, 1)) * 100).toFixed(1);
console.log(
  `\nWrote poc/swish-locations.json: ${placed} locations across ${out.length} chains.\n` +
    `  ${total} branches published, ${unusable} carry no usable address,\n` +
    `  ${placed} geocoded and ${missed} missed (${pct}% of usable).`
);

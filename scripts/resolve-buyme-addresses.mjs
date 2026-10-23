#!/usr/bin/env node
import fs from 'node:fs';

import { addressVariants } from '../poc/lib/address-variants.mjs';
import { computePrecision, createGeocoder } from '../poc/lib/geocode.mjs';

const BUYME_ENDPOINT = 'https://buyme.co.il/brands/13438757/options';

const ROOT = new URL('..', import.meta.url);
const CACHE_DIR = new URL('poc/.cache/', ROOT);
const GEO_CACHE = new URL('poc/.cache/geocode.json', ROOT);
const OUTPUT = new URL('poc/buyme-addresses.json', ROOT);

const { geocode } = createGeocoder({});

let cache = {};
if (fs.existsSync(GEO_CACHE)) cache = JSON.parse(fs.readFileSync(GEO_CACHE, 'utf-8'));

// One-time relabel: entries cached before the precision rule was corrected
// carry the old label. Coordinates are unaffected, so this needs no network.
// Entries cached before `source` existed cannot be re-derived as Photon vs.
// Nominatim, so they are treated as viaFallback: false; that residual
// under-labelling (a pre-existing Photon hit staying `exact`) is accepted.
let relabelled = 0;
for (const [address, entry] of Object.entries(cache)) {
  if (!entry) continue;
  const variants = addressVariants(address);
  const wasCityOnly = entry.precision === 'approximate' && variants.length > 1;
  const corrected = computePrecision({
    address,
    cityOnlyVariant: wasCityOnly,
    viaFallback: entry.source === 'photon',
  });
  if (entry.precision !== corrected) {
    entry.precision = corrected;
    relabelled++;
  }
}
if (relabelled > 0) {
  saveCache();
  console.log(`Relabelled ${relabelled} cached entries under the corrected precision rule`);
}

function saveCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Write-then-rename: a crash mid-write must not leave the live cache
  // truncated, or the next run loses every lookup this one paid for.
  const temp = new URL('poc/.cache/geocode.json.tmp', ROOT);
  fs.writeFileSync(temp, JSON.stringify(cache, null, 1));
  fs.renameSync(temp, GEO_CACHE);
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

const withAddress = brands.filter((b) => b.googleMapAddr && String(b.googleMapAddr).trim() !== '');
console.log(`${withAddress.length} brands carry an address; geocoding (~15 min on a cold cache)...`);

const out = [];
let done = 0;

for (const brand of withAddress) {
  const address = String(brand.googleMapAddr).trim();
  done++;

  if (!(address in cache)) {
    cache[address] = await geocode(address);
    saveCache();
  }

  const resolved = cache[address];
  if (resolved) out.push({ name: brand.title, address, ...resolved });
  if (done % 25 === 0) console.log(`  ${done}/${withAddress.length} (${out.length} located)`);
}

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), source: 'nominatim+photon', brands: out },
    null,
    2
  ) + '\n'
);

const approx = out.filter((b) => b.precision === 'approximate').length;
console.log(
  `Wrote ${out.length}/${withAddress.length} located brands (${Math.round((out.length / withAddress.length) * 100)}%, ${approx} approximate) to poc/buyme-addresses.json`
);

#!/usr/bin/env node
/**
 * Pipeline A′ — the ten תו הזהב entries that carry a real address.
 *
 * Free geocoders only: Nominatim then Photon. Their output is ODbL, permanent
 * and committable, which is exactly why Google is not used here even though it
 * would score higher. Permanence is worth more than the accuracy — the same
 * trade the BuyMe address pipeline makes.
 */
import fs from 'node:fs';

import { createGeocoder } from '../poc/lib/geocode.mjs';
import { mergeBrands, partition } from '../poc/lib/tav-catalogue.mjs';

const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('poc/.cache/tav-payloads.json', ROOT);
const GEOCODE_CACHE = new URL('poc/.cache/tav-geocode.json', ROOT);
const OUTPUT = new URL('poc/tav-addresses.json', ROOT);
const CACHE_DIR = new URL('poc/.cache/', ROOT);

const { geocode } = createGeocoder({});

let cache = {};
if (fs.existsSync(GEOCODE_CACHE)) cache = JSON.parse(fs.readFileSync(GEOCODE_CACHE, 'utf-8'));

function saveCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Write-then-rename: a crash mid-write must not leave the live cache
  // truncated, or the next run loses every lookup this one paid for.
  const temp = new URL('poc/.cache/tav-geocode.json.tmp', ROOT);
  fs.writeFileSync(temp, JSON.stringify(cache, null, 1));
  fs.renameSync(temp, GEOCODE_CACHE);
}

if (!fs.existsSync(CACHE)) {
  throw new Error(`${CACHE} is missing — run the תו הזהב fetch script first`);
}
const { cubes } = JSON.parse(fs.readFileSync(CACHE, 'utf-8'));
const { addressed } = partition(mergeBrands(cubes));

console.log(`${addressed.length} תו הזהב brands carry an address; geocoding (~1 req/sec)...`);

const out = [];

for (const brand of addressed) {
  const query = `${brand.address}, ${brand.city}`;

  if (!(query in cache)) {
    cache[query] = await geocode(query);
    saveCache();
  }

  const resolved = cache[query];
  if (resolved) out.push({ name: brand.name, address: brand.address, ...resolved });
}

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), source: 'nominatim+photon', brands: out },
    null,
    2
  ) + '\n'
);

console.log(`Wrote ${out.length}/${addressed.length} located brands to poc/tav-addresses.json`);

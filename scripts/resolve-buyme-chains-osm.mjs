#!/usr/bin/env node
import fs from 'node:fs';

import { brandForms, matchesBrand } from '../poc/lib/match-chains.mjs';

const BUYME_ENDPOINT = 'https://buyme.co.il/brands/13438757/options';
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const UA = 'BuyMeLocator/1.0 (https://github.com/Lirony027/buyme-locator-public)';

const ROOT = new URL('..', import.meta.url);
const MERCHANTS = new URL('data/buyme-all-merchants.json', ROOT);
const CACHE_DIR = new URL('poc/.cache/', ROOT);
const OSM_CACHE = new URL('poc/.cache/osm-shops.json', ROOT);
const OUTPUT = new URL('poc/buyme-chains-osm.json', ROOT);

/** Refuse to overwrite good output from a degraded scrape. */
const MIN_OSM_OBJECTS = 5000;

async function fetchBrands() {
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
  return brands;
}

/**
 * Every named shop and key amenity in Israel, in one query.
 *
 * Per-chain queries would mean 412 requests with politeness gaps — about
 * three hours, and repeated load on a free service. One dump plus local
 * matching runs in seconds and, more importantly, lets the matching rules
 * be retuned with no network round trip at all.
 */
async function fetchOsmShops() {
  if (fs.existsSync(OSM_CACHE)) {
    const cached = JSON.parse(fs.readFileSync(OSM_CACHE, 'utf-8'));
    console.log(`Using cached OSM dump (${cached.length} objects)`);
    return cached;
  }

  const query = `[out:json][timeout:300];area["ISO3166-1"="IL"]->.il;
(
  nwr["shop"]["name"](area.il);
  nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|cinema|pharmacy)$"]["name"](area.il);
);
out center;`;

  console.log('Fetching the Israel-wide OSM shop dump (this takes a minute)...');
  const res = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
  });

  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith('<')) {
    throw new Error(`Overpass request failed: ${res.status} — ${text.slice(0, 200)}`);
  }

  const elements = JSON.parse(text).elements ?? [];
  if (elements.length < MIN_OSM_OBJECTS) {
    throw new Error(
      `Only ${elements.length} OSM objects returned (expected at least ${MIN_OSM_OBJECTS}) — refusing to cache a degraded dump`
    );
  }

  const slim = elements
    .map((el) => {
      const centre = el.center ?? el;
      return centre.lat == null ? null : { lat: centre.lat, lng: centre.lon, tags: el.tags ?? {} };
    })
    .filter(Boolean);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(OSM_CACHE, JSON.stringify(slim));
  console.log(`Cached ${slim.length} OSM objects`);
  return slim;
}

const brands = await fetchBrands();
const shops = await fetchOsmShops();

// The curated Hebrew alias per merchant, already maintained by the app.
const heByName = new Map(
  JSON.parse(fs.readFileSync(MERCHANTS, 'utf-8')).map((m) => [m.name, m.heName])
);

/** BuyMe's own region id for "מימוש אונליין" (online redemption). */
const ONLINE_REGION_ID = 3038;

// Chains only. A brand with its own address is Pipeline A's job. A brand is
// excluded as online-only when it has no physical region — testing
// `online_redeem` instead would discard the 147 brands that redeem BOTH
// online and in store (FOX among them), which measured as 401 lost branches.
const chains = brands.filter(
  (b) =>
    !b.googleMapAddr &&
    (b.supplier_regions ?? []).some((r) => Number(r.region_id) !== ONLINE_REGION_ID)
);

const out = [];
for (const brand of chains) {
  const heName = heByName.get(brand.title) ?? null;
  const forms = brandForms({ name: brand.title, heName });
  if (forms.length === 0) continue;

  const seen = new Set();
  const locations = [];
  for (const shop of shops) {
    if (!matchesBrand(shop.tags, forms)) continue;
    // OSM often carries both a node and a building way for one shop.
    const bucket = `${shop.lat.toFixed(4)},${shop.lng.toFixed(4)}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    // The `name` tag is nearly always just the brand again, which leaves an
    // OSM row with a distance but no way to tell which branch it is. Compose
    // a street address when the object carries one.
    const street = shop.tags['addr:street'];
    const houseNumber = shop.tags['addr:housenumber'];
    const city = shop.tags['addr:city'];
    const streetLine = street ? [street, houseNumber].filter(Boolean).join(' ') : '';
    const composed = [streetLine, city].filter(Boolean).join(', ');

    locations.push({
      lat: Number(shop.lat.toFixed(6)),
      lng: Number(shop.lng.toFixed(6)),
      label: composed || shop.tags.name || shop.tags['name:he'] || shop.tags.brand || brand.title,
    });
  }

  if (locations.length > 0) out.push({ name: brand.title, heName, locations });
}

// fs accepts URL objects directly — deriving a path string from a file://
// URL breaks on Windows, where `.pathname` yields a leading-slash "/D:/...".
fs.mkdirSync(new URL('poc/', ROOT), { recursive: true });
fs.writeFileSync(
  OUTPUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), source: 'openstreetmap', brands: out }, null, 2) + '\n'
);

const totalLocations = out.reduce((n, b) => n + b.locations.length, 0);
console.log(
  `Wrote ${out.length} of ${chains.length} chains (${totalLocations} branches) to poc/buyme-chains-osm.json`
);

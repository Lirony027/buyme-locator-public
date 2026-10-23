#!/usr/bin/env node
/**
 * Fetches תו הזהב's two public endpoints and caches them.
 *
 * No key, no auth, no scraping: the site is an Angular SPA over an open JSON
 * API. The browser User-Agent and Referer mirror what
 * scripts/scrape-buyme-merchants.mjs already sends.
 *
 * Everything downstream reads the cache, so the pipeline can be re-run and
 * tuned offline — the same reason the OSM pipeline dumps Overpass once.
 */
import fs from 'node:fs';
import https from 'node:https';

import { assertFloors, mergeBrands, partition } from '../poc/lib/tav-catalogue.mjs';
import { normalizeStoreName } from '../poc/lib/store-key.mjs';

const ROOT = new URL('..', import.meta.url);
const CACHE_DIR = new URL('poc/.cache/', ROOT);
const CACHE = new URL('poc/.cache/tav-payloads.json', ROOT);

const BRANDS_ENDPOINT = 'https://tavhazahav.shufersal.co.il/TavimApi/api/resource/tavzahav';
const BRANCHES_ENDPOINT = 'https://tavhazahav.shufersal.co.il/TavimApi/api/info/getBranches';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://tavhazahav.shufersal.co.il/tavhazahav/',
};

/**
 * node:https rather than fetch, and the curve list is the reason.
 *
 * This host and Node's bundled undici cannot complete a handshake: undici
 * offers the finite-field group ffdhe4096, the server accepts it and then
 * sends records Node rejects with ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC.
 * curl and browsers never hit it because they lead with elliptic curves.
 * Naming P-256 and P-384 keeps TLS 1.3 and simply stops offering the group
 * that breaks — preferable to pinning maxVersion to TLS 1.2, which also works
 * but downgrades the connection to work around a key-exchange bug.
 *
 * Only this API host is affected; media.shufersal.co.il is fine with fetch,
 * which is why scripts/fetch-tav-logos.mjs does not need any of this.
 */
function getJson(url) {
  return new Promise((resolve, reject) => {
    // agent: false disables Node's default connection-pooling agent. Node's
    // default agent already has keepAlive: false, so per Node's documented
    // behaviour this changes nothing about connection reuse; the only effect
    // it might have — untested — is avoiding TLS session resumption pinning
    // repeat requests to whichever backend answered first.
    const req = https.get(url, { headers: HEADERS, ecdhCurve: 'P-256:P-384', agent: false }, (res) => {
      // A mid-body connection drop emits on the response, not the request.
      // Without this, Node throws on the unhandled 'error' and the process
      // dies with a stack trace that does not say which endpoint failed.
      // Attached before the statusCode check so it also covers the
      // res.resume() drain below, not just the success path.
      res.on('error', reject);

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`${url} failed: ${res.statusCode} ${res.statusMessage}`));
        return;
      }
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`${url} returned malformed JSON: ${error.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`${url} timed out after 30s`));
    });
  });
}

/**
 * One endpoint, fetched until the answer stops growing.
 *
 * This API is served by more than one backend and they disagree: measured on
 * 2026-09-14, the brands endpoint returned 210 entries or 206 depending on
 * which one answered, the 206 being a stale CMS cache missing four brands
 * (קלארינס, סורובסקי, דרימי, אקס-איי מוביליטי). It is not round-robin — three
 * identical short answers in a row were observed — so a fixed number of
 * attempts cannot be trusted to see the full set.
 *
 * Fetching until several consecutive responses add nothing new converges on
 * the union regardless of which backend answers. Both observed runs reached
 * the full payload within six attempts. The endpoint is free and
 * unauthenticated, so the extra requests cost nothing.
 *
 * Without this, the catalogue silently loses whichever brands the stale
 * backend is missing, and the page's own coverage line reports the loss as
 * fact. The floor guard cannot catch it: four missing brands out of 207 is
 * nowhere near the 150 floor.
 *
 * STABLE_ROUNDS must exceed the longest observed run of identical stale
 * answers, not merely equal it. Three identical short answers in a row were
 * observed from the stale backend — if STABLE_ROUNDS is also 3, that exact
 * failure satisfies the convergence check: three stale responses agreeing
 * with each other looks indistinguishable from three genuine responses
 * agreeing after real convergence, and the "backends disagree" note never
 * fires because every observed size was identical. Set to 5 so a run of 3
 * stale answers cannot pass as converged; the next person to tune this
 * number needs a margin above whatever the longest observed stale run is,
 * not the exact figure.
 */
const STABLE_ROUNDS = 5;
const MAX_ATTEMPTS = 20;

async function fetchConverged(url, extract, keyOf, label) {
  const seen = new Map();
  const sizes = [];
  let stable = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && stable < STABLE_ROUNDS; attempt++) {
    const items = extract(await getJson(url));
    if (!Array.isArray(items)) throw new Error(`${url} did not return the expected array`);
    sizes.push(items.length);

    const before = seen.size;
    for (const item of items) {
      const key = keyOf(item);
      if (!seen.has(key)) seen.set(key, item);
    }
    stable = seen.size === before ? stable + 1 : 0;

    if (stable < STABLE_ROUNDS) await new Promise((r) => setTimeout(r, 500));
  }

  if (stable < STABLE_ROUNDS) {
    throw new Error(
      `${url} never converged after ${sizes.length} attempts (sizes seen: ${sizes.join(', ')}) — ` +
        `refusing to cache a possibly-incomplete union`
    );
  }

  const spread = [...new Set(sizes)].sort((a, b) => a - b);
  console.log(
    `${label}: ${sizes.length} fetches returned ${spread.join('/')} -> ${seen.size} after union` +
      (spread.length > 1 ? '  (backends disagree; union taken)' : '')
  );
  return [...seen.values()];
}

const cubes = await fetchConverged(
  BRANDS_ENDPOINT,
  (payload) => payload?.content?.data?.networkingCubes,
  // Not the name alone: three names legitimately appear twice, under
  // different networkingType or categories, and collapsing those here would
  // undo the merge poc/lib/tav-catalogue.mjs exists to do deliberately.
  (cube) =>
    [
      normalizeStoreName(cube.name),
      (cube.networkingType?.pickedKeys ?? []).join(','),
      (cube.fieldProperty ?? []).join(','),
      cube.icon?.url ?? '',
    ].join('|'),
  'brands'
);

const branches = await fetchConverged(
  BRANCHES_ENDPOINT,
  (payload) => payload?.content,
  (branch) => String(branch.branchID),
  'branches'
);

// Throws before anything is written, so a shape change is a loud failure
// rather than a silently half-empty competitor layer.
assertFloors(cubes, branches);

fs.mkdirSync(CACHE_DIR, { recursive: true });
const temp = new URL('poc/.cache/tav-payloads.json.tmp', ROOT);
fs.writeFileSync(temp, JSON.stringify({ fetchedAt: new Date().toISOString(), cubes, branches }, null, 1));
fs.renameSync(temp, CACHE);

const brands = mergeBrands(cubes);
const { addressed, banners, onlineOnly, chains } = partition(brands);

console.log(
  `Cached ${cubes.length} raw entries -> ${brands.length} brands, and ${branches.length} Shufersal branches.\n` +
    `  ${addressed.length} have an address, ${banners.length} are banners with a published count,\n` +
    `  ${onlineOnly.length} are online-only, ${chains.length} need Google Places.`
);

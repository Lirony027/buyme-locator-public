#!/usr/bin/env node
/**
 * Measures what fraction of Swish's published addresses actually geocode,
 * on a random sample, before the full resolver is built on the assumption
 * that most of them do.
 *
 * The spec names this the largest open number in the design: a raw Nominatim
 * probe on 20 addresses hit 80% with no variant cascade and no Photon
 * fallback. If the real rate is far lower, the coverage story changes and
 * that is a decision for the user, not something to discover at the end.
 *
 * Shares poc/.cache/swish-geocode.json with the full resolver, so nothing
 * measured here is paid for twice.
 */
import fs from 'node:fs';

import { branchQuery, mergeCards } from '../poc/lib/swish-catalogue.mjs';
import { createGeocoder } from '../poc/lib/geocode.mjs';

const ROOT = new URL('..', import.meta.url);
const CHAINS_CACHE = new URL('poc/.cache/swish-chains.json', ROOT);
const BRANCH_DIR = new URL('poc/.cache/swish-branches/', ROOT);
const GEOCODE_CACHE = new URL('poc/.cache/swish-geocode.json', ROOT);
const CACHE_DIR = new URL('poc/.cache/', ROOT);

const SAMPLE_SIZE = Number(process.argv[2] ?? 300);

if (!fs.existsSync(CHAINS_CACHE)) {
  throw new Error('poc/.cache/swish-chains.json is missing — run scripts/fetch-swish-payloads.mjs first');
}

const { cards } = JSON.parse(fs.readFileSync(CHAINS_CACHE, 'utf-8'));
const chains = mergeCards(cards);

const queries = [];
let unusable = 0;
for (const chain of chains) {
  const file = new URL(`${chain.chainId}.json`, BRANCH_DIR);
  if (!fs.existsSync(file)) continue;
  for (const branch of JSON.parse(fs.readFileSync(file, 'utf-8'))) {
    const query = branchQuery(branch);
    if (query) queries.push(query);
    else unusable++;
  }
}

/**
 * Deterministic sampling. A fixed seed makes a re-run comparable rather than
 * a fresh coin toss, which matters when this number is the basis of a
 * go/no-go decision.
 */
let seed = 20260915;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const unique = [...new Set(queries)];
const sample = [];
const pool = [...unique];
while (sample.length < Math.min(SAMPLE_SIZE, unique.length)) {
  sample.push(...pool.splice(Math.floor(random() * pool.length), 1));
}

let cache = {};
if (fs.existsSync(GEOCODE_CACHE)) cache = JSON.parse(fs.readFileSync(GEOCODE_CACHE, 'utf-8'));

function saveCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const temp = new URL('poc/.cache/swish-geocode.json.tmp', ROOT);
  fs.writeFileSync(temp, JSON.stringify(cache, null, 1));
  fs.renameSync(temp, GEOCODE_CACHE);
}

const { geocode } = createGeocoder({});

console.log(
  `${queries.length} usable queries (${unique.length} distinct) from ${chains.length} chains; ` +
    `${unusable} branches carry no usable address.\n` +
    `Sampling ${sample.length} at ~1 req/sec — about ${Math.ceil(sample.length * 1.2 / 60)} min.\n`
);

let hit = 0;
const precision = { exact: 0, approximate: 0 };
const bySource = { nominatim: 0, photon: 0 };
const misses = [];

for (const [i, query] of sample.entries()) {
  if (!(query in cache)) {
    cache[query] = await geocode(query);
    saveCache();
  }
  const resolved = cache[query];
  if (resolved) {
    hit++;
    precision[resolved.precision] = (precision[resolved.precision] ?? 0) + 1;
    bySource[resolved.source] = (bySource[resolved.source] ?? 0) + 1;
  } else if (misses.length < 25) {
    misses.push(query);
  }
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${sample.length} — ${hit} resolved`);
}

const pct = (n) => ((n / Math.max(sample.length, 1)) * 100).toFixed(1);
console.log(
  `\n=== Swish geocode rate ===\n` +
    `  sample            ${sample.length} distinct addresses\n` +
    `  resolved          ${hit} (${pct(hit)}%)\n` +
    `  exact             ${precision.exact ?? 0}\n` +
    `  approximate       ${precision.approximate ?? 0}\n` +
    `  via nominatim     ${bySource.nominatim ?? 0}\n` +
    `  via photon        ${bySource.photon ?? 0}\n` +
    `  branches with no usable address: ${unusable}\n` +
    `\n  projected placed locations: ~${Math.round((hit / Math.max(sample.length, 1)) * queries.length)}` +
    ` of ${queries.length} usable\n`
);
if (misses.length) console.log(`  sample misses:\n    ${misses.join('\n    ')}`);

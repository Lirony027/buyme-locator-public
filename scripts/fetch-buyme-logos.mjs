#!/usr/bin/env node
/**
 * Downloads every BuyMe merchant logo into `poc/logos/`, so the map can draw
 * a brand chip per pin without the visitor's browser fetching anything from
 * buyme.co.il.
 *
 * Bundled rather than hot-linked deliberately: hot-linked chips break the day
 * BuyMe blocks referrers or renames a file, and the `?v=` stamp in each URL
 * means a replaced logo 404s until the next data refresh. Serving them from
 * the deployment costs ~2MB once and cannot break between refreshes.
 *
 * The files are git-ignored — they are BuyMe's images, not this repository's,
 * and re-running this script reproduces them.
 */
import fs from 'node:fs';

const BUYME_ENDPOINT = 'https://buyme.co.il/brands/13438757/options';
const FILES_BASE = 'https://buyme.co.il/files/';

const ROOT = new URL('..', import.meta.url);
const LOGO_DIR = new URL('poc/logos/', ROOT);

/** Politeness gap between downloads. These are 1-3KB files, not a scrape. */
const DELAY_MS = 120;
/** A "logo" larger than this is not a logo; refuse it rather than ship it. */
const MAX_BYTES = 512 * 1024;

const force = process.argv.slice(2).includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

fs.mkdirSync(LOGO_DIR, { recursive: true });

let downloaded = 0;
let reused = 0;
let failed = 0;
let bytes = 0;

for (const brand of brands) {
  if (!brand.logo) continue;

  // "siteNewLogo2208.jpg?v=1788267103" -> extension only; the file is named
  // for the supplier id so the page can address it without the version stamp.
  const extension = (brand.logo.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const target = new URL(`${brand.suppliers_id}.${extension}`, LOGO_DIR);

  if (!force && fs.existsSync(target)) {
    reused++;
    bytes += fs.statSync(target).size;
    continue;
  }

  try {
    const image = await fetch(FILES_BASE + brand.logo, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://buyme.co.il/' },
    });
    await sleep(DELAY_MS);
    if (!image.ok) throw new Error(`${image.status} ${image.statusText}`);

    const buffer = Buffer.from(await image.arrayBuffer());
    if (buffer.length === 0) throw new Error('empty response');
    if (buffer.length > MAX_BYTES) throw new Error(`${buffer.length} bytes is too large for a logo`);

    fs.writeFileSync(target, buffer);
    downloaded++;
    bytes += buffer.length;
  } catch (error) {
    // A missing logo costs one chip, not the run: the page falls back to a pin.
    failed++;
    console.warn(`  ${brand.title}: ${error.message}`);
  }

  if ((downloaded + reused) % 100 === 0) {
    console.log(`  ${downloaded + reused}/${brands.length}...`);
  }
}

console.log(
  `${downloaded} downloaded, ${reused} already present, ${failed} failed — ` +
    `${(bytes / 1024 / 1024).toFixed(1)}MB in poc/logos/`
);

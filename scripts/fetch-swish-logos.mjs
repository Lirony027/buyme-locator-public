#!/usr/bin/env node
/**
 * Downloads each Swish chain's logo into poc/logos-swish/.
 *
 * A separate directory from poc/logos/ and poc/logos-tav/, for the reason
 * scripts/fetch-tav-logos.mjs records: the catalogues never cross-reference,
 * and a shared directory would let one source's logo silently serve
 * another's brand if two slugs ever collided.
 *
 * Swish serves these from pics.k4a.co.il under a uuid filename, so the slug
 * is already unique and no transliteration is needed.
 */
import fs from 'node:fs';

import { logoSlug, mergeCards } from '../poc/lib/swish-catalogue.mjs';

const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('poc/.cache/swish-chains.json', ROOT);
const LOGO_DIR = new URL('poc/logos-swish/', ROOT);

if (!fs.existsSync(CACHE)) {
  console.error('Missing poc/.cache/swish-chains.json. Run scripts/fetch-swish-payloads.mjs first.');
  process.exit(1);
}

const { cards } = JSON.parse(fs.readFileSync(CACHE, 'utf-8'));
const chains = mergeCards(cards);

fs.mkdirSync(LOGO_DIR, { recursive: true });

let written = 0;
let skipped = 0;
let failed = 0;

for (const chain of chains) {
  const slug = logoSlug(chain.logoUrl);
  if (!slug) {
    console.warn(`  ${chain.name}: no unique logo path`);
    failed++;
    continue;
  }

  const target = new URL(slug, LOGO_DIR);
  if (fs.existsSync(target)) { skipped++; continue; }

  let temp;
  try {
    const res = await fetch(chain.logoUrl);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // Temp-then-rename, for the reason fetch-tav-logos.mjs documents: a hard
    // kill during writeFileSync leaves a truncated file that existsSync
    // skips forever on every later run.
    temp = new URL(`${slug}.tmp`, LOGO_DIR);
    fs.writeFileSync(temp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(temp, target);
    written++;
  } catch (error) {
    console.warn(`  ${chain.name}: ${error.message}`);
    if (temp) {
      try { fs.unlinkSync(temp); } catch {}
    }
    failed++;
  }
}

console.log(
  `poc/logos-swish/: ${written} downloaded, ${skipped} already present, ${failed} unavailable ` +
    `(those chains fall back to a plain pin).`
);

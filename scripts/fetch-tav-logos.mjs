#!/usr/bin/env node
/**
 * Downloads each תו הזהב brand's logo into poc/logos-tav/.
 *
 * Kept in a separate directory from poc/logos/ rather than merged: the two
 * catalogues are resolved independently and never cross-reference, and a
 * shared directory would make one source's logo silently serve the other's
 * brand if the names ever collided.
 */
import fs from 'node:fs';

import { LOGO_BASE, logoSlug, mergeBrands } from '../poc/lib/tav-catalogue.mjs';

const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('poc/.cache/tav-payloads.json', ROOT);
const LOGO_DIR = new URL('poc/logos-tav/', ROOT);

if (!fs.existsSync(CACHE)) {
  console.error('Missing poc/.cache/tav-payloads.json. Run scripts/fetch-tav-payloads.mjs first.');
  process.exit(1);
}

const { cubes } = JSON.parse(fs.readFileSync(CACHE, 'utf-8'));
const brands = mergeBrands(cubes);

fs.mkdirSync(LOGO_DIR, { recursive: true });

let written = 0;
let skipped = 0;
let failed = 0;

for (const brand of brands) {
  const slug = logoSlug(brand.logoPath);
  if (!slug) {
    // A brand with no slug cannot yield a unique filename, so it falls back
    // to a plain pin. Log the name so operators can see which ones.
    console.warn(`  ${brand.name}: no unique logo path`);
    failed++;
    continue;
  }

  const target = new URL(slug, LOGO_DIR);
  if (fs.existsSync(target)) { skipped++; continue; }

  let temp;
  try {
    const res = await fetch(LOGO_BASE + brand.logoPath);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // Write to a temp file in the same directory, then rename atomically.
    // A hard kill during writeFileSync would leave a truncated file that
    // existsSync would skip forever on the next run. Rename is atomic on
    // POSIX and NTFS, so the destination is either complete or absent.
    temp = new URL(`${slug}.tmp`, LOGO_DIR);
    fs.writeFileSync(temp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(temp, target);
    written++;
  } catch (error) {
    console.warn(`  ${brand.name}: ${error.message}`);
    // A temp file only exists if the write got that far; unlink is itself
    // allowed to fail, since a leftover here is untidy rather than harmful.
    if (temp) {
      try { fs.unlinkSync(temp); } catch {}
    }
    failed++;
  }
}

console.log(
  `poc/logos-tav/: ${written} downloaded, ${skipped} already present, ${failed} unavailable ` +
    `(those brands fall back to a plain pin).`
);

#!/usr/bin/env node
/**
 * Re-runs Pipeline C and rebuilds the Google page.
 *
 * Exists because Google forbids caching its coordinates beyond 30 days, and
 * the refresh cannot run in CI: a CI job would have to commit its output to
 * be useful, which is precisely the violation .gitignore prevents. So this
 * runs on the machine that opens the page, writing only local files.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
// fileURLToPath, not `.pathname`: on Windows the latter yields "/D:/..." with
// a leading slash, which is not a usable path. The same mistake was caught in
// the scaffold's Overpass script.
const ROOT_PATH = fileURLToPath(ROOT);
const CACHE = new URL('poc/.cache/google-places.json', ROOT);

/** Refresh well inside the 30-day limit rather than on its edge. */
const MAX_AGE_DAYS = 21;

const args = process.argv.slice(2);
const force = args.includes('--force');

let ageDays = Infinity;
try {
  const chains = JSON.parse(fs.readFileSync(new URL('poc/buyme-chains-google.json', ROOT), 'utf-8'));
  ageDays = Math.floor((Date.now() - new Date(chains.generatedAt)) / 86400000);
} catch {
  // No prior run — treat as infinitely stale.
}

if (!force && ageDays < MAX_AGE_DAYS) {
  console.log(`Google data is ${ageDays} day(s) old (refresh at ${MAX_AGE_DAYS}). Nothing to do. Use --force to override.`);
  process.exit(0);
}

console.log(`Google data is ${ageDays === Infinity ? 'absent' : ageDays + ' day(s) old'} — refreshing.`);

// The cache is what makes a re-run cheap, but it is also what would make a
// refresh a no-op: stale coordinates must actually be re-fetched.
if (fs.existsSync(CACHE)) {
  fs.rmSync(CACHE);
  console.log('Cleared the Places cache so coordinates are genuinely re-fetched.');
}

for (const script of ['scripts/resolve-buyme-chains-google.mjs', 'scripts/build-google-page.mjs']) {
  console.log(`\n> ${script}`);
  const result = spawnSync(process.execPath, ['--env-file=.env.local', script], {
    cwd: ROOT_PATH,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`\n${script} failed with exit code ${result.status}. Refresh aborted.`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nRefresh complete.');

#!/usr/bin/env node
/**
 * Fetches the Swish chain list for both shipping cards and caches it.
 *
 * No key and no auth: the site invokes React Server Actions, which answer a
 * plain scripted POST. See poc/lib/swish-api.mjs for why the action ids are
 * derived rather than hardcoded, and why each action is posted to a
 * particular page.
 *
 * Task 4 extends this script with the branch crawl. Everything downstream
 * reads the cache, so the pipeline can be re-run and tuned offline — the
 * same reason the תו הזהב and Overpass pipelines dump their payloads once.
 */
import fs from 'node:fs';

import { CARDS, mergeCards, partition } from '../poc/lib/swish-catalogue.mjs';
import { ACTION_HOST_PAGES, createSwishClient } from '../poc/lib/swish-api.mjs';

const ROOT = new URL('..', import.meta.url);
const CACHE_DIR = new URL('poc/.cache/', ROOT);
const CHAINS_CACHE = new URL('poc/.cache/swish-chains.json', ROOT);

const client = createSwishClient({});

console.log('Deriving the server-action ids from the live bundle...');
const actionIds = await client.resolveActionIds();
console.log(`  chains  ${actionIds.chains}\n  branches ${actionIds.branches}`);

/** tagsForChains is grouped by tag; each entry already carries its own tagName. */
async function fetchCard(card) {
  const result = await client.callAction(actionIds.chains, [CARDS[card]], ACTION_HOST_PAGES.chains);
  const tags = result?.data?.tagsForChains;
  if (!Array.isArray(tags)) {
    throw new Error(`${card}: getChainsListByCategory did not return tagsForChains`);
  }
  const entries = tags.flatMap((tag) => tag?.chainsByWallet ?? []);
  console.log(`  ${card} (${CARDS[card]}): ${tags.length} tags, ${entries.length} entries`);
  return entries;
}

console.log('Fetching both card catalogues...');
const cards = { plus: await fetchCard('plus'), premium: await fetchCard('premium') };

const chains = mergeCards(cards);
const { placeable, onlineOnly } = partition(chains);
const tiers = chains.reduce((acc, c) => ({ ...acc, [c.tier]: (acc[c.tier] ?? 0) + 1 }), {});

fs.mkdirSync(CACHE_DIR, { recursive: true });
// Write-then-rename: a crash mid-write must not leave the cache truncated,
// or the next run loses everything this one paid for.
const temp = new URL('poc/.cache/swish-chains.json.tmp', ROOT);
fs.writeFileSync(
  temp,
  JSON.stringify({ fetchedAt: new Date().toISOString(), actionIds, cards }, null, 1)
);
fs.renameSync(temp, CHAINS_CACHE);

console.log(
  `\nCached ${cards.plus.length} + ${cards.premium.length} entries -> ${chains.length} distinct chains.\n` +
    `  tiers: ${tiers.both ?? 0} both cards, ${tiers.plus ?? 0} Plus only, ${tiers.premium ?? 0} Premium only\n` +
    `  ${placeable.length} placeable, ${onlineOnly.length} online-only`
);

/**
 * Branches belong to the chain, not to the card.
 *
 * Verified before relying on it: for a chain both cards carry, the two
 * branch payloads differ in exactly one field — remarkVar, the card's own
 * marketing blurb. branchName, cityName, storeAddress, storeStreetNumber,
 * phone, openHours, kosher, regoin, logo and webSite are byte-identical, and
 * multi-branch chains return the same location set under either card.
 *
 * So each chainId is crawled once rather than once per card: ~1,050 calls
 * instead of ~2,045, for the same data.
 */
const BRANCH_DIR = new URL('poc/.cache/swish-branches/', ROOT);
fs.mkdirSync(BRANCH_DIR, { recursive: true });

const cardOf = (chain) => (chain.cards.includes('plus') ? CARDS.plus : CARDS.premium);

let fetched = 0;
let cached = 0;
let failed = 0;
let branchCount = 0;
const startedAt = Date.now();

console.log(`\nCrawling branches for ${chains.length} chains (resumable; ~1/sec)...`);

for (const [index, chain] of chains.entries()) {
  const target = new URL(`${chain.chainId}.json`, BRANCH_DIR);

  if (fs.existsSync(target)) {
    try {
      branchCount += JSON.parse(fs.readFileSync(target, 'utf-8')).length;
      cached++;
      continue;
    } catch {
      // A truncated file from a hard kill. Re-fetch rather than trust it.
      fs.rmSync(target, { force: true });
    }
  }

  try {
    const result = await client.callAction(
      actionIds.branches,
      [chain.chainId, cardOf(chain)],
      ACTION_HOST_PAGES.branches
    );
    const branches = result?.data?.branchesByChainID ?? [];
    const temp = new URL(`${chain.chainId}.json.tmp`, BRANCH_DIR);
    fs.writeFileSync(temp, JSON.stringify(branches));
    fs.renameSync(temp, target);
    branchCount += branches.length;
    fetched++;
  } catch (error) {
    // One chain failing must not lose the other thousand: the run is long,
    // and every success is already on disk. Report at the end instead.
    console.warn(`  ${chain.name} (${chain.chainId}): ${error.message}`);
    failed++;
  }

  if ((index + 1) % 100 === 0) {
    const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`  ${index + 1}/${chains.length} — ${branchCount} branches so far, ${mins} min elapsed`);
  }
}

console.log(
  `\nBranches: ${fetched} fetched, ${cached} already cached, ${failed} failed.\n` +
    `  ${branchCount} branches across ${chains.length} chains ` +
    `(mean ${(branchCount / Math.max(chains.length, 1)).toFixed(1)} per chain).`
);
if (failed) {
  console.log('  Re-run this script to retry the failures; cached chains are skipped.');
}

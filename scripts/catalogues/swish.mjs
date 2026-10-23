/**
 * The Swish catalogue: the union of Swish Plus and Swish Premium, as one
 * source on the page.
 *
 * Deliberately never cross-references the BuyMe or תו הזהב catalogues, for
 * the reason scripts/catalogues/tav.mjs records at length.
 *
 * `tiers` is the field that makes one source honest about two cards. The two
 * lists are 94% identical, so they ship merged — but a count read off the
 * union is true for neither card alone, and `tiers` is what lets the page
 * say so. It is sparse on purpose: 991 chains are in both cards and carry no
 * entry; only the 55 Premium-only and 5 Plus-only chains appear.
 */
import fs from 'node:fs';

import {
  CARD_LABELS,
  assertFloors,
  logoSlug,
  mergeCards,
  partition,
} from '../../poc/lib/swish-catalogue.mjs';

const ROOT = new URL('../..', import.meta.url);

const read = (path, label) => {
  const url = new URL(path, ROOT);
  if (!fs.existsSync(url)) throw new Error(`Missing ${label}. Run its resolver script first.`);
  return JSON.parse(fs.readFileSync(url, 'utf-8'));
};

export async function buildSwishCatalogue() {
  const { cards } = read('poc/.cache/swish-chains.json', 'poc/.cache/swish-chains.json');
  const resolved = read('poc/swish-locations.json', 'poc/swish-locations.json');

  const chains = mergeCards(cards);
  const { onlineOnly } = partition(chains);

  // The resolver already carried each chain's published count forward, so the
  // denominators are read straight off it rather than re-deriving them from
  // the branch cache — one source of truth, and the build no longer needs
  // poc/.cache/swish-branches/ to exist at all.
  const publishedByName = {};
  let publishedTotal = 0;
  for (const chain of resolved.chains) {
    publishedByName[chain.name] = (publishedByName[chain.name] ?? 0) + chain.published;
    publishedTotal += chain.published;
  }
  assertFloors(chains, publishedTotal);

  const locations = [];
  for (const chain of resolved.chains) {
    for (const location of chain.locations) {
      locations.push({
        brand: chain.name,
        lat: location.lat,
        lng: location.lng,
        label: location.label,
        // Every Swish coordinate comes from geocoding Swish's own published
        // address. There is no Google path here, so the page's provenance
        // tag reads "כתובת Swish" for all of them.
        source: 'address',
        precision: location.precision,
      });
    }
  }

  const placed = new Set(locations.map((l) => l.brand));
  // A chain tagged online-only by category can still have real placed
  // branches (see poc/lib/swish-catalogue.mjs's partition() docs — "a chain
  // that sells online and also has branches has branches"); the spec's own
  // online-only listing is for chains with no placeable branch at all, so
  // anything already placed on the map is excluded here.
  const onlineNames = onlineOnly.map((c) => c.name).filter((n) => !placed.has(n));
  const unmappedCount = chains.filter(
    (c) => !placed.has(c.name) && !onlineNames.includes(c.name)
  ).length;

  const types = {};
  const aliases = {};
  const logos = {};
  const tiers = {};
  for (const chain of chains) {
    if (!placed.has(chain.name)) continue;
    if (chain.types.length) types[chain.name] = chain.types;
    // Loose Latin search hints — page search only, never a geocoder query.
    if (chain.aliases.length) aliases[chain.name] = chain.aliases;
    const slug = logoSlug(chain.logoUrl);
    if (slug && fs.existsSync(new URL(`poc/logos-swish/${slug}`, ROOT))) logos[chain.name] = slug;
    // Sparse: only the chains one card carries and the other does not.
    if (chain.tier !== 'both') tiers[chain.name] = chain.tier;
  }

  return {
    id: 'swish',
    label: 'Swish',
    cardLabels: CARD_LABELS,
    generatedAt: resolved.generatedAt,
    locations,
    onlineOnly: onlineNames.sort((a, b) => a.localeCompare(b, 'he')),
    catalogueSize: chains.length,
    unmappedCount,
    logos,
    types,
    aliases,
    tiers,
    // Only chains we actually placed: a denominator for a chain with no pins
    // would report 0/20 and read as "Swish has none here", which is the
    // opposite of what it means.
    branchTruth: Object.fromEntries(
      Object.entries(publishedByName).filter(([name]) => placed.has(name))
    ),
  };
}

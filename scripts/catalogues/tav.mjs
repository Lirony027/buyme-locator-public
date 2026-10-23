/**
 * The תו הזהב catalogue, assembled from three resolved files.
 *
 * Deliberately never cross-references the BuyMe catalogue. The two spell the
 * same chains differently (BuyMe files FOX, this files פוקס גברים/נשים/
 * ילדים/הום as four brands), and a wrong merge would attribute one voucher's
 * coverage to the other — in a sales tool, the worst available bug.
 */
import fs from 'node:fs';

import { logoSlug, mergeBrands, partition } from '../../poc/lib/tav-catalogue.mjs';

const ROOT = new URL('../..', import.meta.url);

const read = (path, label) => {
  const url = new URL(path, ROOT);
  if (!fs.existsSync(url)) throw new Error(`Missing ${label}. Run its resolver script first.`);
  return JSON.parse(fs.readFileSync(url, 'utf-8'));
};

export async function buildTavCatalogue() {
  const { cubes } = read('poc/.cache/tav-payloads.json', 'poc/.cache/tav-payloads.json');
  const addresses = read('poc/tav-addresses.json', 'poc/tav-addresses.json');
  const google = read('poc/tav-locations-google.json', 'poc/tav-locations-google.json');

  const brands = mergeBrands(cubes);
  const { onlineOnly } = partition(brands);
  const byName = new Map(brands.map((b) => [b.name, b]));

  const locations = [];

  // Pipeline A′: ODbL, permanent, and legal to show on a Google map.
  for (const brand of addresses.brands) {
    locations.push({
      brand: brand.name,
      lat: brand.lat,
      lng: brand.lng,
      label: brand.address,
      source: 'address',
      precision: brand.precision,
    });
  }

  // Pipelines B′ and C′.
  for (const brand of google.brands) {
    for (const location of brand.locations) {
      locations.push({
        brand: brand.name,
        lat: location.lat,
        lng: location.lng,
        label: location.label,
        source: 'google',
        precision: 'exact',
      });
    }
  }

  const placed = new Set(locations.map((l) => l.brand));
  const onlineNames = onlineOnly.map((b) => b.name);
  const unmappedCount = brands.filter(
    (b) => !placed.has(b.name) && !onlineNames.includes(b.name)
  ).length;

  const types = {};
  const aliases = {};
  const logos = {};
  for (const brand of brands) {
    if (!placed.has(brand.name)) continue;
    if (brand.types.length) types[brand.name] = brand.types;
    // A loose transliteration — "be parm" for בי פארם. Fine for someone
    // typing a Latin guess into the brand box, and never sent to Places.
    if (brand.latin) aliases[brand.name] = [brand.latin];
    const slug = logoSlug(brand.logoPath);
    if (slug && fs.existsSync(new URL(`poc/logos-tav/${slug}`, ROOT))) logos[brand.name] = slug;
  }

  return {
    id: 'tav',
    label: 'תו הזהב',
    generatedAt: google.generatedAt,
    locations,
    onlineOnly: onlineNames.sort((a, b) => a.localeCompare(b, 'he')),
    catalogueSize: brands.length,
    unmappedCount,
    logos,
    types,
    aliases,
    branchTruth: google.branchTruth ?? null,
  };
}

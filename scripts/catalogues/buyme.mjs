import fs from 'node:fs';

const ROOT = new URL('../..', import.meta.url);
const ADDRESSES = new URL('poc/buyme-addresses.json', ROOT);
const CHAINS = new URL('poc/buyme-chains-google.json', ROOT);
const LOGO_DIR = new URL('poc/logos/', ROOT);
const BUYME_ENDPOINT = 'https://buyme.co.il/brands/13438757/options';

const ONLINE_REGION_ID = 3038;
const MIN_BRANDS = 500;

const read = (url, label) => {
  if (!fs.existsSync(url)) throw new Error(`Missing ${label}. Run its resolver script first.`);
  return JSON.parse(fs.readFileSync(url, 'utf-8'));
};

export async function buildBuymeCatalogue() {
  const addresses = read(ADDRESSES, 'poc/buyme-addresses.json');
  const chains = read(CHAINS, 'poc/buyme-chains-google.json');

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
  if (brands.length < MIN_BRANDS) {
    throw new Error(
      `Only ${brands.length} brands returned (expected at least ${MIN_BRANDS}) — refusing to write a page whose coverage caveat would be silently empty`
    );
  }

  const onlineOnly = brands
    .filter(
      (b) =>
        b.online_redeem &&
        !b.googleMapAddr &&
        !(b.supplier_regions ?? []).some((r) => Number(r.region_id) !== ONLINE_REGION_ID)
    )
    .map((b) => b.title)
    .sort((a, b) => a.localeCompare(b, 'he'));
  if (onlineOnly.length === 0) {
    throw new Error('No online-only merchants found — region filtering has probably broken');
  }

  const locations = [];

  // Pipeline A, unchanged: OSM-derived, ODbL, free and permanent. Legal to show
  // on a Google map, and the reason Google is only asked for the chain gap.
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

  for (const brand of chains.brands) {
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
  const unmappedCount = brands.filter(
    (b) => !placed.has(b.title) && !onlineOnly.includes(b.title)
  ).length;

  /**
   * Brand name -> logo filename under poc/logos/, for the brands actually on
   * the map. Only files already on disk are listed, so a brand whose logo failed
   * to download simply keeps the plain pin instead of pointing at a 404.
   *
   * Run scripts/fetch-buyme-logos.mjs to populate the directory.
   */
  /**
   * Brand name -> its BuyMe categories, for the "what kind of shop is this"
   * tag on each result and info bubble.
   *
   * PROMO_CATEGORY_IDS are merchandising collections, not store types: "new on
   * the shelf" and a reservist-support campaign tell a user nothing about what
   * they would be walking into. A brand carrying only those is left untagged
   * rather than labelled with them — as are the 48 mapped brands BuyMe files
   * under no category at all.
   */
  const PROMO_CATEGORY_IDS = new Set([97, 504]);
  const types = {};
  for (const brand of brands) {
    if (!placed.has(brand.title)) continue;
    const names = (brand.categories_on_brands ?? [])
      .filter((c) => !PROMO_CATEGORY_IDS.has(Number(c.categories_id)))
      .map((c) => c.name)
      .filter(Boolean);
    if (names.length) types[brand.title] = [...new Set(names)];
  }

  /**
   * Brand name -> BuyMe's own alternate spellings, so a chain can be found by
   * the script the user types rather than the one BuyMe filed it under:
   * "mcdonalds" reaches מקדונלד'ס, "פוקס" reaches FOX.
   *
   * searchTerms is a keyword field, not a name field — alongside the spellings
   * it carries category words ("אופנה", "משלוחים"), marketing hashtags and
   * keyboard-layout mash ("wnesubkswx"). A term used by more than a handful of
   * brands is a category rather than a name, which filters the generic ones out
   * without a hand-maintained stoplist.
   */
  const GENERIC_ALIAS_BRANDS = 3;
  /**
   * Generous, because BuyMe's ordering is not by usefulness: "mcdonalds" is the
   * last of מקדונלד'ס's terms, behind "וופר" and "צ'יפס", and a tight cap cut
   * exactly the spelling someone would type.
   */
  const MAX_ALIASES_PER_BRAND = 16;

  const termsByBrand = new Map();
  for (const brand of brands) {
    if (!placed.has(brand.title)) continue;
    let parsed = [];
    try {
      parsed = JSON.parse(brand.searchTerms || '[]');
    } catch {
      parsed = [];
    }
    const title = brand.title.toLowerCase();
    const cleaned = [
      ...new Set(
        (Array.isArray(parsed) ? parsed : [])
          .map((term) => String(term).trim().toLowerCase())
          .filter((term) => term.length >= 3 && !term.startsWith('#') && term !== title)
      ),
    ];
    if (cleaned.length) termsByBrand.set(brand.title, cleaned);
  }

  const brandsPerTerm = new Map();
  for (const terms of termsByBrand.values()) {
    for (const term of terms) brandsPerTerm.set(term, (brandsPerTerm.get(term) ?? 0) + 1);
  }

  const aliases = {};
  for (const [title, terms] of termsByBrand) {
    const kept = terms
      .filter((term) => brandsPerTerm.get(term) <= GENERIC_ALIAS_BRANDS)
      .slice(0, MAX_ALIASES_PER_BRAND);
    if (kept.length) aliases[title] = kept;
  }

  const logos = {};
  let missingLogos = 0;
  for (const brand of brands) {
    if (!placed.has(brand.title) || !brand.logo) continue;
    const extension = (brand.logo.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
    const file = `${brand.suppliers_id}.${extension}`;
    if (fs.existsSync(new URL(file, LOGO_DIR))) logos[brand.title] = file;
    else missingLogos++;
  }

  return {
    id: 'buyme',
    label: 'BuyMe',
    // Google's own generatedAt, not BuyMe's: this is what the 30-day caching
    // limit applies to, and what the page's age line reports.
    generatedAt: chains.generatedAt,
    locations,
    onlineOnly,
    catalogueSize: brands.length,
    unmappedCount,
    logos,
    types,
    aliases,
    branchTruth: null,
    // Not part of the published contract — kept only so build-google-page.mjs's
    // summary log can report it without re-reading the raw BuyMe brand list.
    missingLogos,
  };
}

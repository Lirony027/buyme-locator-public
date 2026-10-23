import { normalizeStoreName } from './store-key.mjs';

/** Umbraco serves every brand logo under this prefix; icon.url is the rest. */
export const LOGO_BASE = 'https://media.shufersal.co.il/umbracoMedia/prod';

/**
 * The three Shufersal banners whose branch count getBranches publishes, and
 * therefore the only chains in either catalogue with a true denominator.
 * שופרסל אקספרס and בי פארם appear in networkingCubes but not in getBranches.
 */
export const SHUFERSAL_BANNERS = Object.freeze(['שופרסל שלי', 'שופרסל דיל', 'יוניברס']);

/**
 * Refuse a payload too short to be real rather than writing a page whose
 * coverage caveat is silently empty — the same guard, and the same reason, as
 * MIN_BRANDS in scripts/build-google-page.mjs. It matters more here: this is
 * an undocumented internal API that can change shape in a deploy with no
 * notice, and a half-empty competitor layer is invisible while a build
 * failure is not.
 */
const MIN_BRANDS = 150;
const MIN_BRANCHES = 150;

export function assertFloors(cubes, branches) {
  if (!Array.isArray(cubes) || cubes.length < MIN_BRANDS) {
    throw new Error(
      `Only ${cubes?.length ?? 0} תו הזהב brands returned (expected at least ${MIN_BRANDS}) — refusing to build`
    );
  }
  if (!Array.isArray(branches) || branches.length < MIN_BRANCHES) {
    throw new Error(
      `Only ${branches?.length ?? 0} Shufersal branches returned (expected at least ${MIN_BRANCHES}) — refusing to build`
    );
  }
}

const kindsOf = (cube) => cube?.networkingType?.pickedKeys ?? [];

/**
 * One brand per distinct name, because the catalogue files three names twice:
 * שופרסל אונליין and שילב each as a Network entry and an OnlineStores one,
 * סאקוני as two Network entries under different categories. Unmerged, the
 * page shows one brand as two.
 */
export function mergeBrands(cubes) {
  const byName = new Map();

  for (const cube of cubes) {
    const name = normalizeStoreName(cube?.name);
    if (!name) continue;

    let brand = byName.get(name);
    if (!brand) {
      brand = { name, types: [], kinds: [], address: '', city: '', latin: '', logoPath: '' };
      byName.set(name, brand);
    }

    for (const type of cube?.fieldProperty ?? []) {
      const clean = normalizeStoreName(type);
      if (clean && !brand.types.includes(clean)) brand.types.push(clean);
    }
    for (const kind of kindsOf(cube)) {
      if (kind && !brand.kinds.includes(kind)) brand.kinds.push(kind);
    }

    // First entry to carry each of these wins; the duplicates are the same
    // business, so a second opinion adds nothing.
    if (!brand.address) {
      const address = normalizeStoreName(cube?.address);
      if (address) {
        brand.address = address;
        brand.city = normalizeStoreName(cube?.city);
      }
    }
    if (!brand.latin) brand.latin = normalizeStoreName(cube?.nameInAnotherLanguage);
    if (!brand.logoPath) brand.logoPath = String(cube?.icon?.url ?? '');
  }

  return [...byName.values()];
}

/**
 * Which of the four location paths each brand takes.
 *
 * `onlineOnly` is a listing, not a placement path — a brand can be both
 * online-only and addressed (קסטרו אונליין is), so it overlaps `addressed` by
 * design. The three placement arrays are mutually exclusive and together with
 * `onlineOnly` they partition every brand; a pure online-only brand (no
 * address) appears in `onlineOnly` alone and in none of the other three.
 */
export function partition(brands) {
  const banners = [];
  const addressed = [];
  const onlineOnly = [];
  const chains = [];

  for (const brand of brands) {
    // Only when every entry was OnlineStores: שילב carries branches too.
    if (brand.kinds.length === 1 && brand.kinds[0] === 'OnlineStores') onlineOnly.push(brand);

    if (brand.address) addressed.push(brand);
    else if (SHUFERSAL_BANNERS.includes(brand.name)) banners.push(brand);
    else if (brand.kinds.length === 1 && brand.kinds[0] === 'OnlineStores') continue;
    else chains.push(brand);
  }

  return { addressed, banners, onlineOnly, chains };
}

/**
 * The filename a brand's logo is saved under.
 *
 * Umbraco's own path segment is already unique and filesystem-safe
 * ("/media/qzgb35nx/186.png" -> "qzgb35nx-186.png"), so it is the slug. The
 * brand name would need transliterating Hebrew into a filename, which is both
 * lossy and ambiguous. A path with fewer than two segments yields '' rather
 * than a bare filename that could collide across brands.
 */
export function logoSlug(logoPath) {
  const parts = String(logoPath || '').split('/').filter(Boolean);
  if (parts.length < 2) return '';
  return parts.slice(-2).join('-');
}

/** Banner -> how many branches Shufersal itself publishes for it. */
export function branchTruth(branches) {
  const counts = {};
  for (const branch of branches) {
    const network = normalizeStoreName(branch?.companyNetwork);
    if (!SHUFERSAL_BANNERS.includes(network)) continue;
    counts[network] = (counts[network] ?? 0) + 1;
  }
  return counts;
}

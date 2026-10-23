/**
 * The Swish catalogue: the union of two cards, as one source.
 *
 * Swish sells a family of gift cards, each with its own chain list. Plus and
 * Premium ship, and they are 94% the same list — 991 chains in both, 55 only
 * in Premium (which adds food retail and pharma), 5 only in Plus. They are
 * unioned into a single source, which is why `tier` exists: a count read off
 * the union is true for neither card alone, and the tier badge is the only
 * thing on the page standing between that and a false comparative claim.
 *
 * Deliberately never cross-references the BuyMe or תו הזהב catalogues, for
 * the reason scripts/catalogues/tav.mjs already records.
 */
import { normalizeStoreName } from './store-key.mjs';

/** The two products this source covers, by Swish's own categoryId. */
export const CARDS = Object.freeze({ plus: 105984, premium: 104068 });

export const CARD_LABELS = Object.freeze({ plus: 'Swish Plus', premium: 'Swish Premium' });

/** The one category that means "no door to walk through". */
export const ONLINE_CATEGORY = 'רכישה אונליין';

/**
 * Cities that are not cities. Swish files multi-site arrangements under a
 * placeholder rather than leaving the field blank, so a geocoder handed one
 * returns a confident wrong answer instead of a miss.
 */
export const SENTINEL_CITIES = Object.freeze(['מיקומים שונים']);

/**
 * Floors, for the same reason and with the same effect as MIN_BRANDS in
 * poc/lib/tav-catalogue.mjs: these are undocumented internal endpoints with
 * no stability contract, and a half-empty competitor layer is invisible on
 * the page while a build failure is not.
 */
const MIN_CHAINS = 900;
const MIN_BRANCHES = 4000;

export function assertFloors(chains, branchCount) {
  if (!Array.isArray(chains) || chains.length < MIN_CHAINS) {
    throw new Error(
      `Only ${chains?.length ?? 0} Swish chains resolved (expected at least ${MIN_CHAINS}) — refusing to build`
    );
  }
  if (!Number.isFinite(branchCount) || branchCount < MIN_BRANCHES) {
    throw new Error(
      `Only ${branchCount} Swish branches crawled (expected at least ${MIN_BRANCHES}) — refusing to build`
    );
  }
}

/**
 * One chain per chainId across both cards, carrying which cards accept it.
 *
 * Keyed on chainId rather than name because the id is what the branches
 * endpoint takes, and because two chains may legitimately share a display
 * name. Each card's list files a handful of chains under two tags (999
 * entries for 996 chains; 1049 for 1046), so types union rather than
 * overwrite — unmerged, one brand renders as two.
 */
export function mergeCards({ plus = [], premium = [] } = {}) {
  const byId = new Map();

  const absorb = (entries, card) => {
    for (const raw of entries ?? []) {
      const chainId = raw?.chainId;
      if (chainId == null) continue;
      const name = normalizeStoreName(raw?.storeName);
      if (!name) continue;

      let chain = byId.get(chainId);
      if (!chain) {
        chain = { chainId, name, types: [], aliases: [], logoUrl: '', cards: [] };
        byId.set(chainId, chain);
      }

      if (!chain.cards.includes(card)) chain.cards.push(card);

      const type = normalizeStoreName(raw?.tagName);
      if (type && !chain.types.includes(type)) chain.types.push(type);

      // A loose Latin (sometimes Hebrew) search hint, populated on about a
      // fifth of entries. Page search only — never a geocoder query, the
      // same rule תו הזהב's nameInAnotherLanguage carries.
      for (const piece of String(raw?.searchKeyWords ?? '').split(';')) {
        const alias = normalizeStoreName(piece);
        if (alias && !chain.aliases.includes(alias)) chain.aliases.push(alias);
      }

      if (!chain.logoUrl) chain.logoUrl = String(raw?.logo ?? '');
    }
  };

  absorb(plus, 'plus');
  absorb(premium, 'premium');

  for (const chain of byId.values()) {
    chain.tier = chain.cards.length === 2 ? 'both' : chain.cards[0];
  }

  return [...byId.values()];
}

/**
 * Online-only is a listing, not a placement path.
 *
 * A chain counts as online-only only when every tag it carries is the online
 * category — the same "only when every entry was OnlineStores" rule תו הזהב
 * uses, and for the same reason: a chain that sells online and also has
 * branches has branches.
 */
export function partition(chains) {
  const placeable = [];
  const onlineOnly = [];
  for (const chain of chains) {
    if (chain.types.length === 1 && chain.types[0] === ONLINE_CATEGORY) onlineOnly.push(chain);
    else placeable.push(chain);
  }
  return { placeable, onlineOnly };
}

/**
 * The geocoder query for one branch, or '' when the branch cannot honestly
 * yield one. Returning '' rather than a partial query matters: a geocoder
 * given "מיקומים שונים" answers with somewhere, and a wrong pin in a sales
 * tool is worse than a missing one.
 */
export function branchQuery(branch) {
  const street = normalizeStoreName(branch?.storeAddress);
  const number = normalizeStoreName(branch?.storeStreetNumber);
  const city = normalizeStoreName(branch?.cityName);
  if (!street || !city) return '';
  if (SENTINEL_CITIES.includes(city)) return '';
  return `${street}${number ? ` ${number}` : ''}, ${city}`;
}

/**
 * Chain name -> how many branches Swish itself publishes for it.
 *
 * This is the instrument the other two sources never had. BuyMe can only say
 * "16 found" against an unknown total; תו הזהב gets a real denominator for
 * three Shufersal banners. Swish publishes one for every chain, so coverage
 * is a true ratio catalogue-wide and a chain that geocodes 9 of 20 is
 * visibly incomplete on its own row.
 *
 * A chain with no crawled branch list is omitted rather than recorded as 0 —
 * "we did not look" and "Swish publishes none" are different claims.
 */
export function branchTruth(chains, branchesById) {
  const counts = {};
  for (const chain of chains) {
    const branches = branchesById?.[chain.chainId];
    if (!Array.isArray(branches)) continue;
    counts[chain.name] = (counts[chain.name] ?? 0) + branches.length;
  }
  return counts;
}

/**
 * The filename a chain's logo is saved under.
 *
 * Swish already names these by uuid, so the basename is unique and
 * filesystem-safe as-is. Anything that is not a plain `name.ext` yields ''
 * and the chain falls back to a plain pin, rather than risking a filename
 * that collides across chains.
 */
export function logoSlug(logoUrl) {
  const base = String(logoUrl || '').split('?')[0].split('/').filter(Boolean).pop() || '';
  // svg is deliberately excluded: it comes from a third-party URL with no
  // content-type validation, and an SVG can carry executable script.
  return /^[\w.-]+\.(png|jpe?g|webp)$/i.test(base) ? base : '';
}

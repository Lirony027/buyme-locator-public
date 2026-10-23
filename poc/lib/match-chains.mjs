import { storeKey, foldHebrewSpellingVariants } from './store-key.mjs';

/**
 * Every tag an Israeli OSM retail object might carry its name under.
 * Matching only `name` and `brand` missed sub-branded branches entirely —
 * "Fox Home", "FOX Men" and "Castro Outlet" are all real objects the
 * two-tag query did not see.
 */
const OSM_NAME_TAGS = ['name', 'name:he', 'name:en', 'brand', 'operator', 'alt_name'];

/**
 * Shortest form worth matching on. Three, not two: the real catalogue
 * contains the brand "את" and the aliases "שף", "לי", "מק", "גס" — all
 * common Hebrew words that matched 9 unrelated businesses in live OSM
 * data. Brands whose Latin name is short (MAC, LEE) still match through
 * that Latin form, so the recall cost is close to zero.
 */
const MIN_FORM_LENGTH = 3;

/**
 * The normalized strings a brand may be recognised by: its BuyMe name and,
 * where one exists, the curated Hebrew alias from
 * `data/buyme-all-merchants.json`.
 *
 * Including the alias is what lifted measured chain coverage from ~21-30%
 * to ~35-40% — Israeli OSM objects are frequently tagged only in Hebrew,
 * so a Latin-only brand name never reaches them.
 */
export function brandForms(brand) {
  const forms = new Set();
  for (const raw of [brand?.name, brand?.heName]) {
    if (!raw) continue;
    const key = storeKey(raw);
    if (key.length >= MIN_FORM_LENGTH) forms.add(key);
  }
  return [...forms];
}

/** Every distinct normalized name this OSM object carries. */
export function osmNameKeys(tags) {
  const keys = new Set();
  for (const tag of OSM_NAME_TAGS) {
    const value = tags?.[tag];
    if (!value) continue;
    const key = storeKey(value);
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * Whether one normalized name is a branch of a brand with these forms.
 *
 * Anchored: the name must equal a form outright, or begin with the form
 * followed by a separator. A bare "starts with" test matched "Castrol" for
 * "Castro" and inflated אייס to 190% of its real branch count; requiring
 * the boundary is what brought that back to a plausible 60% while keeping
 * legitimate sub-brands like "Fox Home" and "ביגוד נגבה".
 *
 * Both sides are tet/tav folded, because BuyMe's own catalogue disagrees
 * with itself on that spelling and neither OSM nor Google Places has any
 * reason to match either choice.
 *
 * The one anchoring rule in the codebase — `matchesBrand` delegates here
 * rather than repeating it, so the OSM and Google pipelines cannot drift
 * apart on what counts as a match.
 */
export function nameMatchesForms(name, forms) {
  if (!forms || forms.length === 0) return false;
  const key = foldHebrewSpellingVariants(storeKey(name));
  if (!key) return false;

  return forms.some((form) => {
    const needle = foldHebrewSpellingVariants(form);
    return key === needle || key.startsWith(needle + ' ');
  });
}

/**
 * Whether this OSM object is a branch of a brand with these forms.
 *
 * Checks every name-bearing tag against `nameMatchesForms` — an OSM object
 * counts as a match if any one of its tags is anchored to a form.
 */
export function matchesBrand(tags, forms) {
  if (!forms || forms.length === 0) return false;
  const keys = osmNameKeys(tags);
  if (keys.length === 0) return false;

  return keys.some((key) => nameMatchesForms(key, forms));
}

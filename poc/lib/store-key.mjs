/**
 * Mirrors WalletExtender's `src/domain/stores.ts` (a separate repo since the
 * split). Copied, not imported: these modules run under bare Node ESM
 * with no TypeScript loader, the same constraint `scripts/scrape-buyme-merchants.mjs`
 * documents at its own inlined copy. Keep the two in sync by hand.
 */

/** Bidi formatting characters that ride along invisibly in copied Hebrew. */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

/** Display form: whitespace tidied, every letter preserved. */
export function normalizeStoreName(raw) {
  return String(raw ?? '')
    .replace(BIDI_CONTROLS, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Comparison form. Case folding is a no-op for Hebrew, which has no case. */
export function storeKey(name) {
  return normalizeStoreName(name).toLocaleLowerCase('he');
}

/**
 * Folds ט to ת before comparing. The two letters represent one sound in
 * modern Hebrew, so a transliterated foreign name lands on either spelling
 * depending on who typed it. Comparison only — never applied to a name on
 * its way to the screen.
 */
export function foldHebrewSpellingVariants(s) {
  return String(s ?? '').replace(/ט/g, 'ת');
}

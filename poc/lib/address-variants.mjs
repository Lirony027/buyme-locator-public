import { normalizeStoreName } from './store-key.mjs';

/** Words that geocoders tokenize badly and that carry no locating information. */
const NOISE_WORDS = /(^|\s)(רחוב|קניון|מתחם|בניין|קומה)(\s|$)/g;

/**
 * Whether a comma segment reads as an actual street line rather than a
 * venue name — it carries a house number, or opens with a street word.
 * Used only to decide whether a leading segment is safe to drop.
 */
function looksLikeStreet(segment) {
  return /\d/.test(segment) || /^(דרך|שדרות|שד'|רח')\s/.test(segment.trim());
}

/**
 * Progressively looser geocoder queries for one address, most specific
 * first. Callers try them in order and stop at the first hit.
 *
 * Measured against BuyMe's real `googleMapAddr` values: the exact string
 * alone resolved 61–83% depending on sample, and every miss carried a venue
 * name glued to the front ("קניון TLV, קרליבך 4, ...") or a bare "רחוב"
 * prefix. Those two shapes are what the middle variants strip.
 *
 * The final city-only variant deliberately trades precision for a real
 * coordinate. Callers must record that it was used so the page can mark
 * such a point approximate rather than presenting it as a street address.
 */
export function addressVariants(raw) {
  const addr = normalizeStoreName(raw);
  if (addr === '') return [];

  const out = [addr];
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);

  if (parts.length > 2 && !looksLikeStreet(parts[0])) {
    out.push(parts.slice(1).join(', '));
  }
  if (parts.length >= 2) {
    out.push(parts.slice(-2).join(', '));
  }

  const stripped = normalizeStoreName(addr.replace(NOISE_WORDS, ' '));
  if (stripped !== '' && stripped !== addr) {
    out.push(stripped);
  }
  if (parts.length >= 2) {
    out.push(parts[parts.length - 1]);
  }

  return [...new Set(out)].filter(Boolean);
}

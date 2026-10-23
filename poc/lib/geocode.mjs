import { addressVariants } from './address-variants.mjs';
import { ISRAEL_BOUNDS } from './israel-tiles.mjs';

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';
const UA = 'BuyMeLocator/1.0 (https://github.com/Lirony027/buyme-locator-public)';

/** Nominatim's usage policy: at most one request per second. */
const NOMINATIM_DELAY_MS = 1100;
const PHOTON_DELAY_MS = 400;

/**
 * A hit outside this box is a wrong answer, not a hit. `israel-tiles.mjs`
 * owns these numbers — no dependency on Google or `places.mjs`, just the
 * same source `places.mjs` itself builds its own `inIsrael` from, so this
 * stays a leaf module usable without pulling in the Places client.
 */
const inIsrael = (lat, lng) =>
  lat > ISRAEL_BOUNDS.south && lat < ISRAEL_BOUNDS.north && lng > ISRAEL_BOUNDS.west && lng < ISRAEL_BOUNDS.east;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Precision is a property of what the address and the matching source can
 * support, never of which query path happened to succeed.
 */
export function computePrecision({ address, cityOnlyVariant, viaFallback }) {
  if (!/\d/.test(address)) return 'approximate'; // no house number -> locality centroid at best
  if (cityOnlyVariant) return 'approximate';
  if (viaFallback) return 'approximate';
  return 'exact';
}

/**
 * The geocoding cascade shared by every address pipeline: try Nominatim
 * against progressively looser query variants (see address-variants.mjs,
 * most specific first), fall back to Photon on the first variant if every
 * Nominatim attempt misses, and reject anything outside Israel's bounding
 * box as a wrong answer rather than a coarse one.
 *
 * `fetchImpl` and `sleepImpl` are injected — the same shape as
 * `createPlacesClient` in places.mjs — so tests exercise every branch of the
 * cascade without a network call or the real 1-second-per-request delay.
 */
export function createGeocoder({ fetchImpl = fetch, sleepImpl = defaultSleep } = {}) {
  async function nominatim(query) {
    const url =
      `${NOMINATIM_ENDPOINT}?format=json&limit=1&countrycodes=il&q=` + encodeURIComponent(query);
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) return null;
      const hits = await res.json().catch(() => []);
      if (!hits.length) return null;
      const lat = Number(hits[0].lat);
      const lng = Number(hits[0].lon);
      return inIsrael(lat, lng) ? { lat, lng } : null;
    } catch {
      // A network-level failure is a miss, not a crash: the run is long and
      // resumable, and one flaky request must not lose the whole batch.
      return null;
    } finally {
      // In `finally` so a failure can never be used to burst past the
      // 1 req/sec Nominatim usage policy on retry.
      await sleepImpl(NOMINATIM_DELAY_MS);
    }
  }

  async function photon(query) {
    const url = `${PHOTON_ENDPOINT}?limit=1&lang=default&q=` + encodeURIComponent(query);
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      const feature = body?.features?.[0];
      if (!feature) return null;
      const [lng, lat] = feature.geometry.coordinates;
      return inIsrael(lat, lng) ? { lat, lng } : null;
    } catch {
      return null;
    } finally {
      await sleepImpl(PHOTON_DELAY_MS);
    }
  }

  /**
   * Resolves one address query, or `null` if no variant resolves. The
   * caller need not know about the variant cascade, the rate limit or the
   * Photon fallback — only the final coordinate and how much to trust it.
   */
  async function geocode(query) {
    const variants = addressVariants(query);
    if (!variants.length) return null;

    let hit = null;
    let variantIndex = -1;

    for (let i = 0; i < variants.length; i++) {
      hit = await nominatim(variants[i]);
      if (hit) {
        variantIndex = i;
        break;
      }
    }

    let viaFallback = false;
    if (!hit) {
      hit = await photon(variants[0]);
      if (hit) {
        variantIndex = 0;
        // Photon is the last-resort fallback and its result type is not
        // inspected, so it carries no street-level guarantee. Marking every
        // Photon hit approximate keeps precision a property of what was
        // matched rather than of which query path happened to succeed.
        viaFallback = true;
      }
    }

    if (!hit) return null;

    const cityOnlyVariant = variantIndex === variants.length - 1 && variants.length > 1;

    return {
      lat: hit.lat,
      lng: hit.lng,
      source: viaFallback ? 'photon' : 'nominatim',
      precision: computePrecision({ address: query, cityOnlyVariant, viaFallback }),
    };
  }

  return { geocode };
}

import { ISRAEL_BOUNDS } from './israel-tiles.mjs';

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/** Places API (New) hard limits: 20 per page, 60 across all pages. */
const PAGE_SIZE = 20;
// Exported: callers need this same cap to decide when a national query has
// truncated results and a tiled sweep is worth its extra cost.
export const MAX_RESULTS_PER_QUERY = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const inIsrael = (lat, lng) =>
  lat > ISRAEL_BOUNDS.south && lat < ISRAEL_BOUNDS.north && lng > ISRAEL_BOUNDS.west && lng < ISRAEL_BOUNDS.east;

/** Keeps the first of each 4-decimal-rounded lat,lng. */
export function dedupeByCoordinate(locations) {
  const seen = new Set();
  const deduped = [];
  for (const location of locations) {
    // Tiles share edges, and Places holds its own duplicates.
    const bucket = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    deduped.push(location);
  }
  return deduped;
}

/**
 * A Places Text Search (New) client. The API key, the shared call budget and
 * `fetchImpl` (for tests, so nothing ever hits the network) all arrive here
 * rather than living at module scope, so two sources can each hold their own
 * client against the one shared budget.
 */
export function createPlacesClient({ apiKey, budget, fetchImpl = fetch }) {
  /**
   * One Text Search page. `restriction` is a `locationRestriction` value or
   * null for a whole-country query biased by regionCode.
   */
  async function searchPage(textQuery, restriction, pageToken) {
    budget.spend();

    // languageCode, not just regionCode: without it Places answers in English
    // and the page listed "Yaldei Teheran St 5, Rishon LeZion" to Hebrew
    // readers. regionCode only biases which results come back, not their script.
    const body = { textQuery, pageSize: PAGE_SIZE, regionCode: 'IL', languageCode: 'he' };
    if (restriction) body.locationRestriction = restriction;
    if (pageToken) body.pageToken = pageToken;

    const res = await fetchImpl(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // The field mask is mandatory — omitting it is an error, not a default.
        // Ask only for what the page renders: position, name, address.
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,nextPageToken',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Places request failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  /** Every result for one query, following nextPageToken up to the 60 cap. */
  async function searchAll(textQuery, restriction) {
    const found = [];
    let pageToken;

    do {
      const data = await searchPage(textQuery, restriction, pageToken);
      for (const place of data.places ?? []) {
        const lat = place.location?.latitude;
        const lng = place.location?.longitude;
        if (lat == null || lng == null || !inIsrael(lat, lng)) continue;
        found.push({
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          label: place.formattedAddress || place.displayName?.text || textQuery,
          name: place.displayName?.text || '',
        });
      }
      pageToken = data.nextPageToken;
      // A short pause between pages; the token needs a moment to become valid.
      if (pageToken) await sleep(600);
    } while (pageToken && found.length < MAX_RESULTS_PER_QUERY);

    return found;
  }

  return { searchAll };
}

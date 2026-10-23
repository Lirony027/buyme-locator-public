import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGeocoder } from './geocode.mjs';

/** Pulls the `q` search param back out of a Nominatim/Photon request URL. */
function decodedQuery(url) {
  return new URL(url).searchParams.get('q');
}

/**
 * A fetchImpl that answers Nominatim and Photon requests from two lookup
 * tables keyed by the exact (decoded) query string. A query with no entry
 * is a miss — an empty Nominatim array or an empty Photon feature list —
 * never a thrown error, matching what the real services return.
 */
function stubFetch({ nominatim = {}, photon = {} } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const query = decodedQuery(url);
    if (url.includes('nominatim')) {
      const hit = nominatim[query];
      return { ok: true, json: async () => (hit ? [{ lat: String(hit.lat), lon: String(hit.lng) }] : []) };
    }
    const hit = photon[query];
    return {
      ok: true,
      json: async () => (hit ? { features: [{ geometry: { coordinates: [hit.lng, hit.lat] } }] } : { features: [] }),
    };
  };
  impl.calls = calls;
  return impl;
}

/** Records every delay requested instead of actually waiting. */
function recordingSleep() {
  const calls = [];
  const impl = async (ms) => {
    calls.push(ms);
  };
  impl.calls = calls;
  return impl;
}

test('a hit on the exact query string reports the exact variant in precision', async () => {
  const fetchImpl = stubFetch({ nominatim: { 'הרצל 5, תל אביב': { lat: 32.07, lng: 34.78 } } });
  const { geocode } = createGeocoder({ fetchImpl, sleepImpl: recordingSleep() });

  const hit = await geocode('הרצל 5, תל אביב');

  assert.deepEqual(hit, { lat: 32.07, lng: 34.78, source: 'nominatim', precision: 'exact' });
});

test('a Nominatim miss on every variant falls through to Photon, marked source: photon', async () => {
  const fetchImpl = stubFetch({ photon: { 'הרצל 5, תל אביב': { lat: 32.07, lng: 34.78 } } });
  const { geocode } = createGeocoder({ fetchImpl, sleepImpl: recordingSleep() });

  const hit = await geocode('הרצל 5, תל אביב');

  assert.equal(hit.source, 'photon');
  // A Photon hit carries no street-level guarantee, regardless of the
  // address itself carrying a house number.
  assert.equal(hit.precision, 'approximate');
});

test('a result outside Israel bounds is rejected as a bad geocode rather than returned', async () => {
  const paris = { lat: 48.85, lng: 2.35 };
  const fetchImpl = stubFetch({ nominatim: { 'תל אביב': paris }, photon: { 'תל אביב': paris } });
  const { geocode } = createGeocoder({ fetchImpl, sleepImpl: recordingSleep() });

  const hit = await geocode('תל אביב');

  assert.equal(hit, null);
});

test('a query no variant resolves returns null rather than throwing', async () => {
  const fetchImpl = stubFetch({});
  const { geocode } = createGeocoder({ fetchImpl, sleepImpl: recordingSleep() });

  const hit = await geocode('קניון עזריאלי, הרצל 5, תל אביב');

  assert.equal(hit, null);
});

test('sleepImpl is called between Nominatim requests, holding the rate limit in place', async () => {
  const fetchImpl = stubFetch({ nominatim: { 'תל אביב': { lat: 32.07, lng: 34.78 } } });
  const sleepImpl = recordingSleep();
  const { geocode } = createGeocoder({ fetchImpl, sleepImpl });

  // Four variants: only the last ("תל אביב") resolves, so every earlier
  // variant must still have paused for the full Nominatim delay.
  await geocode('קניון עזריאלי, הרצל 5, תל אביב');

  assert.equal(sleepImpl.calls.length, 4);
  assert.ok(sleepImpl.calls.every((ms) => ms === 1100));
});

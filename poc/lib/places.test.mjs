import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPlacesClient, dedupeByCoordinate, inIsrael } from './places.mjs';

const place = (lat, lng, address) => ({
  location: { latitude: lat, longitude: lng },
  formattedAddress: address,
  displayName: { text: address },
});

/** Returns each queued response in turn, recording what it was asked. */
function stubFetch(pages) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => pages[calls.length - 1] ?? { places: [] } };
  };
  impl.calls = calls;
  return impl;
}

const client = (pages, budget) =>
  createPlacesClient({
    apiKey: 'test-key',
    budget: budget ?? { spend() {}, used: () => 0, remaining: () => 999 },
    fetchImpl: stubFetch(pages),
  });

test('inIsrael accepts a point inside the bounds and rejects one outside', () => {
  assert.equal(inIsrael(32.07, 34.79), true);
  assert.equal(inIsrael(48.85, 2.35), false);
});

test('inIsrael rejects null coordinates rather than coercing them to zero', () => {
  assert.equal(inIsrael(null, 34.79), false);
  assert.equal(inIsrael(32.07, undefined), false);
});

test('drops results outside Israel', async () => {
  const found = await client([
    { places: [place(32.07, 34.79, 'תל אביב'), place(48.85, 2.35, 'Paris')] },
  ]).searchAll('דוגמה ישראל', null);
  assert.equal(found.length, 1);
  assert.equal(found[0].label, 'תל אביב');
});

test('carries the place displayName as name, separately from the address label', async () => {
  const found = await client([
    {
      places: [
        {
          location: { latitude: 32.07, longitude: 34.79 },
          formattedAddress: 'הרצל 1, תל אביב',
          displayName: { text: 'קסטרו הרצל' },
        },
      ],
    },
  ]).searchAll('דוגמה ישראל', null);
  assert.equal(found[0].label, 'הרצל 1, תל אביב');
  assert.equal(found[0].name, 'קסטרו הרצל');
});

test('name falls back to an empty string when the place carries no displayName', async () => {
  const found = await client([
    {
      places: [
        {
          location: { latitude: 32.07, longitude: 34.79 },
          formattedAddress: 'הרצל 1, תל אביב',
        },
      ],
    },
  ]).searchAll('דוגמה ישראל', null);
  assert.equal(found[0].name, '');
});

test('rounds coordinates to six decimals', async () => {
  const found = await client([{ places: [place(32.0712345678, 34.7912345678, 'א')] }])
    .searchAll('דוגמה', null);
  assert.equal(found[0].lat, 32.071235);
  assert.equal(found[0].lng, 34.791235);
});

test('follows nextPageToken across pages', async () => {
  const found = await client([
    { places: [place(32.07, 34.79, 'ראשון')], nextPageToken: 'token-2' },
    { places: [place(32.08, 34.8, 'שני')] },
  ]).searchAll('דוגמה', null);
  assert.deepEqual(found.map((f) => f.label), ['ראשון', 'שני']);
});

test('sends languageCode he so results come back in Hebrew', async () => {
  const fetchImpl = stubFetch([{ places: [] }]);
  await createPlacesClient({
    apiKey: 'k',
    budget: { spend() {} },
    fetchImpl,
  }).searchAll('דוגמה', null);
  assert.equal(fetchImpl.calls[0].languageCode, 'he');
  assert.equal(fetchImpl.calls[0].regionCode, 'IL');
});

test('spends one budget call per page', async () => {
  let spent = 0;
  await client(
    [{ places: [], nextPageToken: 't' }, { places: [] }],
    { spend() { spent++; }, used: () => spent, remaining: () => 9 }
  ).searchAll('דוגמה', null);
  assert.equal(spent, 2);
});

test('a throwing budget stops the search rather than billing', async () => {
  await assert.rejects(
    () => client([{ places: [] }], { spend() { throw new Error('budget exhausted'); } })
      .searchAll('דוגמה', null),
    /budget/i
  );
});

test('a failed request throws with the status', async () => {
  const failing = createPlacesClient({
    apiKey: 'k',
    budget: { spend() {} },
    fetchImpl: async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'slow down' }),
  });
  await assert.rejects(() => failing.searchAll('דוגמה', null), /429/);
});

test('dedupeByCoordinate keeps the first of two points at the same place', () => {
  // Tiles share edges, and Places holds duplicates of its own.
  const deduped = dedupeByCoordinate([
    { lat: 32.0712, lng: 34.7912, label: 'ראשון' },
    { lat: 32.07121, lng: 34.79119, label: 'כפילות' },
    { lat: 32.2, lng: 34.9, label: 'אחר' },
  ]);
  assert.deepEqual(deduped.map((d) => d.label), ['ראשון', 'אחר']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addressVariants } from './address-variants.mjs';

test('the exact address is always tried first', () => {
  const v = addressVariants("Ahad Ha'Am St 54, Tel Aviv-Yafo");
  assert.equal(v[0], "Ahad Ha'Am St 54, Tel Aviv-Yafo");
});

test('drops a leading venue name when a later segment looks like a street', () => {
  // Real BuyMe address; the mall name is what made Nominatim miss it.
  const v = addressVariants('קניון TLV, קרליבך 4, תל אביב-יפו');
  assert.ok(v.includes('קרליבך 4, תל אביב-יפו'));
});

test('keeps a leading segment that is itself a street', () => {
  // Four segments, so the drop-leading-venue variant (parts.slice(1)) is
  // distinguishable from the unrelated last-two-segments variant
  // (parts.slice(-2)) — with only three segments the two slices coincide
  // and the assertion below could never fail either way.
  // "דרך מנחם בגין 21" must be recognised as a street and NOT dropped.
  const v = addressVariants('דרך מנחם בגין 21, קומה 2, חדר 5, תל אביב');
  assert.equal(v[0], 'דרך מנחם בגין 21, קומה 2, חדר 5, תל אביב');
  assert.ok(!v.includes('קומה 2, חדר 5, תל אביב'), 'must not drop a real street segment');
});

test('drops a leading segment that is NOT a street', () => {
  // Same shape, but the first segment is a venue name with no house number,
  // so it is dropped — this is the branch the previous test never reaches.
  const v = addressVariants('מלון דן, קומה 2, חדר 5, תל אביב');
  assert.ok(v.includes('קומה 2, חדר 5, תל אביב'));
});

test('strips noise words that geocoders tokenize badly', () => {
  const v = addressVariants('רחוב סתיו 1, הוד השרון');
  assert.ok(v.some((x) => x === 'סתיו 1, הוד השרון'));
});

test('falls back to the city alone as the last resort', () => {
  const v = addressVariants('בית מלאכה לקדרות- טליה אלמוג, נאות מרדכי');
  assert.equal(v[v.length - 1], 'נאות מרדכי');
});

test('a single-segment address yields just itself', () => {
  assert.deepEqual(addressVariants('גשר הזיו'), ['גשר הזיו']);
});

test('never returns duplicates or empty strings', () => {
  const v = addressVariants('תל אביב');
  assert.deepEqual(v, ['תל אביב']);
});

test('an empty or blank address yields no variants at all', () => {
  assert.deepEqual(addressVariants('   '), []);
  assert.deepEqual(addressVariants(null), []);
});

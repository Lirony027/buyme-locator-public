import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARDS,
  ONLINE_CATEGORY,
  mergeCards,
  partition,
  branchQuery,
  branchTruth,
  logoSlug,
  assertFloors,
} from './swish-catalogue.mjs';

const entry = (over) => ({
  chainId: 1001352,
  storeName: 'אפרודיטה',
  tagName: 'אופנה ולייף סטייל',
  searchKeyWords: 'afridita',
  logo: 'https://pics.k4a.co.il/share/NewUploads/BusinessLogo/416c062d-9144-4fa4-be01-d2390bc2a3ad.jpg',
  ...over,
});

test('card ids are the two products the page ships', () => {
  assert.deepEqual(CARDS, { plus: 105984, premium: 104068 });
});

test('a chain in both cards is tier "both" and appears once', () => {
  const chains = mergeCards({ plus: [entry({})], premium: [entry({})] });
  assert.equal(chains.length, 1);
  assert.equal(chains[0].tier, 'both');
  assert.deepEqual(chains[0].cards, ['plus', 'premium']);
});

test('a chain only Premium carries is tier "premium"', () => {
  // סופר פארם is one of the 55 — Premium adds food retail and pharma.
  const chains = mergeCards({
    plus: [],
    premium: [entry({ chainId: 7, storeName: 'סופר פארם', tagName: 'רשתות שיווק מזון ופארמה' })],
  });
  assert.equal(chains[0].tier, 'premium');
});

test('a chain only Plus carries is tier "plus"', () => {
  // קפה קפה is one of the 5.
  const chains = mergeCards({ plus: [entry({ chainId: 9, storeName: 'קפה קפה' })], premium: [] });
  assert.equal(chains[0].tier, 'plus');
});

test('one chain filed under two tags unions its types instead of splitting', () => {
  // Three chains really are filed twice in each card's list: 999 entries
  // for 996 chains, 1049 for 1046.
  const chains = mergeCards({
    plus: [entry({ tagName: 'אופנה ולייף סטייל' }), entry({ tagName: 'הכל לבית' })],
    premium: [],
  });
  assert.equal(chains.length, 1);
  assert.deepEqual(chains[0].types, ['אופנה ולייף סטייל', 'הכל לבית']);
});

test('searchKeyWords splits on semicolons and drops empties', () => {
  const chains = mergeCards({ plus: [entry({ searchKeyWords: 'nautica;נוטיקה;' })], premium: [] });
  assert.deepEqual(chains[0].aliases, ['nautica', 'נוטיקה']);
});

test('a store name with stray whitespace normalizes', () => {
  const chains = mergeCards({ plus: [entry({ storeName: '  אפרודיטה  ' })], premium: [] });
  assert.equal(chains[0].name, 'אפרודיטה');
});

test('an entry with no chainId or no name is skipped, not crashed on', () => {
  const chains = mergeCards({
    plus: [entry({ chainId: null }), entry({ chainId: 5, storeName: '   ' })],
    premium: [],
  });
  assert.deepEqual(chains, []);
});

test('a chain tagged only online is online-only, and is not placeable', () => {
  const chains = mergeCards({ plus: [entry({ tagName: ONLINE_CATEGORY })], premium: [] });
  const { placeable, onlineOnly } = partition(chains);
  assert.deepEqual(onlineOnly.map((c) => c.name), ['אפרודיטה']);
  assert.equal(placeable.length, 0);
});

test('a chain tagged online AND something else is still placeable', () => {
  const chains = mergeCards({
    plus: [entry({ tagName: ONLINE_CATEGORY }), entry({ tagName: 'אופנה ולייף סטייל' })],
    premium: [],
  });
  const { placeable, onlineOnly } = partition(chains);
  assert.equal(onlineOnly.length, 0);
  assert.deepEqual(placeable.map((c) => c.name), ['אפרודיטה']);
});

test('branchQuery joins street, number and city', () => {
  assert.equal(
    branchQuery({ storeAddress: 'הפלמ"ח', storeStreetNumber: '1', cityName: 'אילת' }),
    'הפלמ"ח 1, אילת'
  );
});

test('branchQuery omits a missing house number rather than emitting a gap', () => {
  assert.equal(branchQuery({ storeAddress: 'אליפלט', storeStreetNumber: '', cityName: 'תל אביב - יפו' }),
    'אליפלט, תל אביב - יפו');
});

test('branchQuery refuses the "various locations" sentinel', () => {
  // Measured live: 'א' in city 'מיקומים שונים'. It is a placeholder, not a place.
  assert.equal(branchQuery({ storeAddress: 'א', storeStreetNumber: '', cityName: 'מיקומים שונים' }), '');
});

test('branchQuery refuses a branch with no street or no city', () => {
  assert.equal(branchQuery({ storeAddress: '', storeStreetNumber: '3', cityName: 'חיפה' }), '');
  assert.equal(branchQuery({ storeAddress: 'הרצל', storeStreetNumber: '3', cityName: '' }), '');
});

test('branchTruth reports how many branches Swish itself publishes per chain', () => {
  const chains = mergeCards({ plus: [entry({ chainId: 3, storeName: 'טימברלנד' })], premium: [] });
  assert.deepEqual(branchTruth(chains, { 3: [{}, {}, {}] }), { טימברלנד: 3 });
});

test('branchTruth omits a chain with no branch list rather than claiming zero', () => {
  const chains = mergeCards({ plus: [entry({ chainId: 3, storeName: 'טימברלנד' })], premium: [] });
  assert.deepEqual(branchTruth(chains, {}), {});
});

test('logoSlug is the unique filename Swish already uses', () => {
  assert.equal(
    logoSlug('https://pics.k4a.co.il/share/NewUploads/BusinessLogo/416c062d-9144-4fa4-be01-d2390bc2a3ad.jpg'),
    '416c062d-9144-4fa4-be01-d2390bc2a3ad.jpg'
  );
});

test('logoSlug rejects anything that is not a plain unique filename', () => {
  assert.equal(logoSlug(''), '');
  assert.equal(logoSlug('https://pics.k4a.co.il/share/NewUploads/'), '');
  assert.equal(logoSlug('https://pics.k4a.co.il/logo'), '');
});

test('assertFloors refuses a short catalogue rather than building a thin page', () => {
  assert.throws(() => assertFloors(new Array(899), 9000), /899/);
  assert.throws(() => assertFloors(new Array(1051), 3999), /3999/);
  assert.doesNotThrow(() => assertFloors(new Array(1051), 8100));
});

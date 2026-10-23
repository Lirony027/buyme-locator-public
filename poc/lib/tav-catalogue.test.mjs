import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHUFERSAL_BANNERS,
  LOGO_BASE,
  mergeBrands,
  partition,
  branchTruth,
  assertFloors,
  logoSlug,
} from './tav-catalogue.mjs';

const cube = (over) => ({
  name: 'דוגמה',
  address: '',
  city: '',
  nameInAnotherLanguage: 'example',
  fieldProperty: ['אופנה'],
  networkingType: { savedValue: 'Network', pickedKeys: ['Network'] },
  icon: { url: '/media/aaaa1111/1.png' },
  ...over,
});

test('merges two entries that share a name, unioning their categories', () => {
  // סאקוני really is filed twice, under אופנה and under הנעלה.
  const merged = mergeBrands([
    cube({ name: 'סאקוני', fieldProperty: ['אופנה'] }),
    cube({ name: 'סאקוני', fieldProperty: ['הנעלה'] }),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].types, ['אופנה', 'הנעלה']);
});

test('normalizes a trailing space so the name joins against getBranches', () => {
  // networkingCubes files "שופרסל דיל ", getBranches files "שופרסל דיל".
  const merged = mergeBrands([cube({ name: 'שופרסל דיל ' })]);
  assert.equal(merged[0].name, 'שופרסל דיל');
});

test('a brand is online-only only when every one of its entries is', () => {
  // שילב is both a Network and an OnlineStores entry: it has real branches.
  const merged = mergeBrands([
    cube({ name: 'שילב', networkingType: { pickedKeys: ['Network'] } }),
    cube({ name: 'שילב', networkingType: { pickedKeys: ['OnlineStores'] } }),
  ]);
  const { onlineOnly, chains } = partition(merged);
  assert.equal(onlineOnly.length, 0);
  assert.deepEqual(chains.map((b) => b.name), ['שילב']);
});

test('a brand whose only entry is OnlineStores is online-only', () => {
  const merged = mergeBrands([
    cube({ name: 'חנות רשת', networkingType: { pickedKeys: ['OnlineStores'] } }),
  ]);
  const { onlineOnly, chains } = partition(merged);
  assert.deepEqual(onlineOnly.map((b) => b.name), ['חנות רשת']);
  assert.equal(chains.length, 0);
});

test('an online-only brand with an address is still placed', () => {
  // קסטרו אונליין: spendable online, and it has a door.
  const merged = mergeBrands([
    cube({
      name: 'קסטרו אונליין',
      address: 'אלנבי 26',
      city: 'תל אביב',
      networkingType: { pickedKeys: ['OnlineStores'] },
    }),
  ]);
  const { addressed, onlineOnly } = partition(merged);
  assert.deepEqual(addressed.map((b) => b.name), ['קסטרו אונליין']);
  assert.deepEqual(onlineOnly.map((b) => b.name), ['קסטרו אונליין']);
});

test('the four paths partition every brand exactly once for placement', () => {
  const merged = mergeBrands([
    cube({ name: 'מסעדה', address: 'הרצל 1', city: 'תל אביב' }),
    cube({ name: 'שופרסל שלי' }),
    cube({ name: 'רק אונליין', networkingType: { pickedKeys: ['OnlineStores'] } }),
    cube({ name: 'רשת רגילה' }),
  ]);
  const { addressed, banners, onlineOnly, chains } = partition(merged);
  assert.equal(addressed.length + banners.length + onlineOnly.length + chains.length, 4);
  assert.deepEqual(banners.map((b) => b.name), ['שופרסל שלי']);
  assert.deepEqual(chains.map((b) => b.name), ['רשת רגילה']);
});

test('builds a full logo URL from the Umbraco path', () => {
  const merged = mergeBrands([cube({ icon: { url: '/media/qzgb35nx/186.png' } })]);
  assert.equal(LOGO_BASE + merged[0].logoPath, 'https://media.shufersal.co.il/umbracoMedia/prod/media/qzgb35nx/186.png');
});

test('survives an entry with no icon, no categories and no latin name', () => {
  const merged = mergeBrands([
    { name: 'חסר', networkingType: { pickedKeys: ['Network'] } },
  ]);
  assert.equal(merged[0].logoPath, '');
  assert.deepEqual(merged[0].types, []);
  assert.equal(merged[0].latin, '');
});

test('counts branches per banner as the published denominator', () => {
  const truth = branchTruth([
    { companyNetwork: 'שופרסל שלי' },
    { companyNetwork: 'שופרסל שלי' },
    { companyNetwork: 'יוניברס' },
    { companyNetwork: 'רשת שאינה באנר' },
  ]);
  assert.deepEqual(truth, { 'שופרסל שלי': 2, 'יוניברס': 1 });
});

test('the banner list is the three with a published denominator', () => {
  assert.deepEqual([...SHUFERSAL_BANNERS], ['שופרסל שלי', 'שופרסל דיל', 'יוניברס']);
});

test('logoSlug takes the last two Umbraco path segments', () => {
  assert.equal(logoSlug('/media/qzgb35nx/186.png'), 'qzgb35nx-186.png');
});

test('logoSlug returns empty for a path too short to be unique', () => {
  // A bare filename would collide across brands; better no logo than the
  // wrong brand's logo.
  assert.equal(logoSlug('/186.png'), '');
  assert.equal(logoSlug(''), '');
  assert.equal(logoSlug(null), '');
});

test('floors reject a payload too short to trust', () => {
  const enough = (n) => Array.from({ length: n }, () => cube({}));
  assert.throws(() => assertFloors(enough(10), enough(200)), /brands/i);
  assert.throws(() => assertFloors(enough(200), enough(10)), /branches/i);
  assert.doesNotThrow(() => assertFloors(enough(200), enough(200)));
});

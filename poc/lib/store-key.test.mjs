import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStoreName, storeKey, foldHebrewSpellingVariants } from './store-key.mjs';

test('collapses whitespace and trims', () => {
  assert.equal(normalizeStoreName('  קפה   גרג  '), 'קפה גרג');
});

test('strips invisible bidi control characters', () => {
  // These ride along when Hebrew is copied out of another app.
  assert.equal(normalizeStoreName('‏שדרות הנשיא 35‎'), 'שדרות הנשיא 35');
});

test('storeKey lowercases Latin names', () => {
  assert.equal(storeKey('  ASA  Izakaya '), 'asa izakaya');
});

test('storeKey leaves Hebrew unchanged apart from spacing', () => {
  assert.equal(storeKey('טרקלין  חשמל'), 'טרקלין חשמל');
});

test('handles null and undefined without throwing', () => {
  assert.equal(normalizeStoreName(null), '');
  assert.equal(normalizeStoreName(undefined), '');
});

test('folds tet to tav so both spellings of a transliterated name agree', () => {
  // BuyMe's own data disagrees with itself: CASTRO carries קסתרו,
  // CASTRO HOME carries קסטרו.
  assert.equal(
    foldHebrewSpellingVariants('קסטרו'),
    foldHebrewSpellingVariants('קסתרו')
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { brandForms, osmNameKeys, matchesBrand, nameMatchesForms } from './match-chains.mjs';

test('a brand contributes both its name and its Hebrew alias', () => {
  assert.deepEqual(brandForms({ name: 'adidas', heName: 'אדידס' }).sort(), ['adidas', 'אדידס']);
});

test('a brand with no alias contributes only its name', () => {
  assert.deepEqual(brandForms({ name: 'טרקלין חשמל', heName: null }), ['טרקלין חשמל']);
});

test('forms shorter than three characters are dropped as too weak to match on', () => {
  assert.deepEqual(brandForms({ name: 'X', heName: null }), []);
  // Real catalogue entries: a two-character brand and a two-character
  // alias, both common Hebrew words that matched unrelated businesses.
  assert.deepEqual(brandForms({ name: 'את', heName: null }), []);
  assert.deepEqual(brandForms({ name: '4Chef', heName: 'שף' }), ['4chef']);
});

test('a brand with a short Latin name still matches through that name', () => {
  // MAC's alias "מק" is now too short, but "mac" itself is three characters.
  const forms = brandForms({ name: 'MAC', heName: 'מק' });
  assert.deepEqual(forms, ['mac']);
  assert.ok(matchesBrand({ name: 'MAC Cosmetics' }, forms));
});

test('osmNameKeys reads every name-bearing tag', () => {
  const keys = osmNameKeys({
    name: 'Castro',
    'name:he': 'קסטרו',
    brand: 'Castro',
    shop: 'clothes',
  });
  assert.ok(keys.includes('castro'));
  assert.ok(keys.includes('קסטרו'));
  assert.equal(keys.filter((k) => k === 'castro').length, 1, 'duplicates collapse');
});

test('matches a sub-branded branch name', () => {
  // Real OSM values the naive query missed.
  const forms = brandForms({ name: 'FOX', heName: 'פוקס' });
  assert.ok(matchesBrand({ name: 'Fox Home' }, forms));
  assert.ok(matchesBrand({ name: 'FOX Men' }, forms));
});

test('does NOT match a longer word that merely starts with the brand', () => {
  // The precision failure that produced אייס at 190%.
  const forms = brandForms({ name: 'Castro', heName: 'קסטרו' });
  assert.equal(matchesBrand({ name: 'Castrol' }, forms), false);
  assert.equal(matchesBrand({ name: 'Castrolounge' }, forms), false);
});

test('matches through the Hebrew alias when the OSM object is tagged in Hebrew', () => {
  const forms = brandForms({ name: 'adidas', heName: 'אדידס' });
  assert.ok(matchesBrand({ 'name:he': 'אדידס' }, forms));
});

test('matches across the tet/tav spelling split', () => {
  // BuyMe says קסתרו for CASTRO; OSM says קסטרו.
  const forms = brandForms({ name: 'CASTRO', heName: 'קסתרו' });
  assert.ok(matchesBrand({ 'name:he': 'קסטרו' }, forms));
});

test('an object with no name tags matches nothing', () => {
  assert.equal(matchesBrand({ shop: 'clothes' }, brandForms({ name: 'FOX', heName: null })), false);
});

test('an empty form list matches nothing', () => {
  assert.equal(matchesBrand({ name: 'Fox' }, []), false);
});

test('nameMatchesForms: an exact match', () => {
  const forms = brandForms({ name: 'ביגוד', heName: null });
  assert.ok(nameMatchesForms('ביגוד', forms));
});

test('nameMatchesForms: a sub-brand match at a word boundary', () => {
  // The false-positive class this fix targets: ביגוד alone is a category
  // name ("clothing") that returned 426 Google pins, but a real sub-brand
  // like "ביגוד נגבה" should still be recognised.
  const forms = brandForms({ name: 'ביגוד', heName: null });
  assert.ok(nameMatchesForms('ביגוד נגבה', forms));
});

test('nameMatchesForms: rejects the brand appearing mid-string with no boundary', () => {
  // The same failure the module's own comment records: a bare "starts with"
  // matched "Castrol" for "Castro". Here in Hebrew: קסטרולים ("saucepans")
  // starts with the same letters as קסתרו but is not a branch of it.
  const forms = brandForms({ name: 'Castro', heName: 'קסתרו' });
  assert.equal(nameMatchesForms('Castrol', forms), false);
  assert.equal(nameMatchesForms('קסטרולים', forms), false);
});

test('nameMatchesForms: rejects an unrelated name entirely', () => {
  const forms = brandForms({ name: 'ביגוד', heName: null });
  assert.equal(nameMatchesForms('סופר פארם', forms), false);
});

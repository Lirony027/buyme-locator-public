import { test } from 'node:test';
import assert from 'node:assert/strict';

import { distanceMeters, withinRadius } from './geo.mjs';

test('a point is zero metres from itself', () => {
  assert.equal(distanceMeters({ lat: 32.0745, lng: 34.7918 }, { lat: 32.0745, lng: 34.7918 }), 0);
});

test('one degree of latitude is about 111.19 km', () => {
  const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111195) < 100, `expected ~111195m, got ${d}`);
});

test('Azrieli to Dizengoff Center is roughly 1.6 km', () => {
  const d = distanceMeters({ lat: 32.0745, lng: 34.7918 }, { lat: 32.0759, lng: 34.7745 });
  assert.ok(d > 1500 && d < 1800, `expected 1500-1800m, got ${d}`);
});

test('distance is symmetric', () => {
  const a = { lat: 31.7825, lng: 35.2197 };
  const b = { lat: 32.8156, lng: 34.9892 };
  assert.ok(Math.abs(distanceMeters(a, b) - distanceMeters(b, a)) < 1e-6);
});

test('withinRadius keeps only points inside and sorts them nearest first', () => {
  const centre = { lat: 32.0745, lng: 34.7918 };
  const locations = [
    { name: 'far', lat: 32.8156, lng: 34.9892 },
    { name: 'near', lat: 32.0746, lng: 34.7919 },
    { name: 'mid', lat: 32.0759, lng: 34.7745 },
  ];
  const hits = withinRadius(locations, centre, 2000);
  assert.deepEqual(hits.map((h) => h.name), ['near', 'mid']);
});

test('withinRadius annotates each hit with its distance', () => {
  const hits = withinRadius(
    [{ name: 'near', lat: 32.0746, lng: 34.7919 }],
    { lat: 32.0745, lng: 34.7918 },
    1000
  );
  assert.equal(hits.length, 1);
  assert.ok(typeof hits[0].distanceMeters === 'number');
  assert.equal(hits[0].name, 'near');
});

test('an empty input yields an empty result rather than throwing', () => {
  assert.deepEqual(withinRadius([], { lat: 32, lng: 34 }, 1000), []);
});

test('a point exactly on the radius boundary is included', () => {
  const centre = { lat: 0, lng: 0 };
  const oneDegreeNorth = { lat: 1, lng: 0 };
  const d = distanceMeters(centre, oneDegreeNorth);
  assert.equal(withinRadius([oneDegreeNorth], centre, d).length, 1);
});

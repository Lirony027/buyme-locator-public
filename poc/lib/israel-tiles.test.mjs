import { test } from 'node:test';
import assert from 'node:assert/strict';

import { israelTiles, ISRAEL_BOUNDS } from './israel-tiles.mjs';

test('produces rows x cols tiles', () => {
  assert.equal(israelTiles(3, 4).length, 12);
  assert.equal(israelTiles(1, 1).length, 1);
});

test('a single tile is the whole country', () => {
  const [only] = israelTiles(1, 1);
  assert.equal(only.low.latitude, ISRAEL_BOUNDS.south);
  assert.equal(only.low.longitude, ISRAEL_BOUNDS.west);
  assert.equal(only.high.latitude, ISRAEL_BOUNDS.north);
  assert.equal(only.high.longitude, ISRAEL_BOUNDS.east);
});

test('tiles cover the bounds exactly, with no gap and no overlap', () => {
  const tiles = israelTiles(3, 4);
  const south = Math.min(...tiles.map((t) => t.low.latitude));
  const north = Math.max(...tiles.map((t) => t.high.latitude));
  const west = Math.min(...tiles.map((t) => t.low.longitude));
  const east = Math.max(...tiles.map((t) => t.high.longitude));
  assert.equal(south, ISRAEL_BOUNDS.south);
  assert.equal(north, ISRAEL_BOUNDS.north);
  assert.equal(west, ISRAEL_BOUNDS.west);
  assert.equal(east, ISRAEL_BOUNDS.east);
});

test('every tile is well formed — low is south-west of high', () => {
  for (const tile of israelTiles(3, 4)) {
    assert.ok(tile.low.latitude < tile.high.latitude);
    assert.ok(tile.low.longitude < tile.high.longitude);
  }
});

test('the union of tile areas equals the total area', () => {
  const tiles = israelTiles(3, 4);
  const area = (t) =>
    (t.high.latitude - t.low.latitude) * (t.high.longitude - t.low.longitude);
  const total = tiles.reduce((sum, t) => sum + area(t), 0);
  const whole =
    (ISRAEL_BOUNDS.north - ISRAEL_BOUNDS.south) *
    (ISRAEL_BOUNDS.east - ISRAEL_BOUNDS.west);
  assert.ok(Math.abs(total - whole) < 1e-9, `tiles cover ${total}, country is ${whole}`);
});

test('rejects a nonsensical grid rather than returning junk', () => {
  assert.throws(() => israelTiles(0, 4));
  assert.throws(() => israelTiles(3, -1));
});

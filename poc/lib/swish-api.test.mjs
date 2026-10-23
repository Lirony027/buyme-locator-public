import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_NAMES,
  extractChunkPaths,
  extractActionId,
  parseActionResult,
  createSwishClient,
} from './swish-api.mjs';

// A verbatim-shaped slice of a real deployed chunk.
const CHUNK = `var t=e.i(95187),i=(0,t.createServerReference)("7fef9360999fd421ead72f89b70f48266bb0b4f748",t.callServer,void 0,t.findSourceMapURL,"getChainsListByCategory");e.s(["getChainsListByCategory",()=>i])},14328,e=>{"use strict";var t=e.i(95187),i=(0,t.createServerReference)("7f38426dd2af95755a1f0b47afe442c8cc1763580b",t.callServer,void 0,t.findSourceMapURL,"getBranchesByChain")`;

test('finds every distinct chunk path in the page html', () => {
  const html =
    '<script src="/_next/static/chunks/a1b7.js"></script>' +
    '<script src="/_next/static/chunks/51952.js"></script>' +
    '<script src="/_next/static/chunks/a1b7.js"></script>';
  assert.deepEqual(extractChunkPaths(html), [
    '/_next/static/chunks/a1b7.js',
    '/_next/static/chunks/51952.js',
  ]);
});

test('extracts each action id by the action name it is registered under', () => {
  assert.equal(
    extractActionId(CHUNK, ACTION_NAMES.chains),
    '7fef9360999fd421ead72f89b70f48266bb0b4f748'
  );
  assert.equal(
    extractActionId(CHUNK, ACTION_NAMES.branches),
    '7f38426dd2af95755a1f0b47afe442c8cc1763580b'
  );
});

test('an absent action yields empty string rather than a wrong id', () => {
  assert.equal(extractActionId(CHUNK, 'getSomethingElse'), '');
  assert.equal(extractActionId('', ACTION_NAMES.chains), '');
});

test('parses the action result out of an RSC flight body', () => {
  const body =
    '0:{"a":"$@1","f":""}\n' +
    '2:T1dcc7,<div>unrelated</div>\n' +
    '1:{"status":true,"data":{"tagsForChains":[{"tagId":0}]},"message":null}\n';
  assert.deepEqual(parseActionResult(body).data.tagsForChains, [{ tagId: 0 }]);
});

test('parses a result containing braces and escaped quotes inside strings', () => {
  const body = '1:{"status":true,"data":{"note":"a \\"} {\\" trap"}}';
  assert.equal(parseActionResult(body).data.note, 'a "} {" trap');
});

test('a body with no action result is null, not a throw', () => {
  // This is exactly what a stale action id produces: HTTP 200, page
  // re-render, no result. It must be distinguishable from an empty list.
  assert.equal(parseActionResult('0:{"a":"$@1"}\n2:T1dcc7,<div></div>'), null);
  assert.equal(parseActionResult(''), null);
});

test('resolveActionIds reads the ids out of the live chunks', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('product-')) {
      return { ok: true, status: 200, text: async () => '<script src="/_next/static/chunks/x.js">' };
    }
    return { ok: true, status: 200, text: async () => CHUNK };
  };
  const client = createSwishClient({ fetchImpl, sleepImpl: async () => {} });
  const ids = await client.resolveActionIds();
  assert.equal(ids.chains, '7fef9360999fd421ead72f89b70f48266bb0b4f748');
  assert.equal(ids.branches, '7f38426dd2af95755a1f0b47afe442c8cc1763580b');
  assert.ok(calls.some((u) => u.endsWith('/x.js')));
});

test('resolveActionIds throws when an id cannot be derived', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'nothing useful' });
  const client = createSwishClient({ fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(() => client.resolveActionIds(), /getChainsListByCategory/);
});

test('callAction posts the args as a JSON array under the action header', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, text: async () => '1:{"status":true,"data":{"ok":1}}' };
  };
  const client = createSwishClient({ fetchImpl, sleepImpl: async () => {} });
  const out = await client.callAction('abc123', [1001447, 105984], 'https://swish.co.il/home/balance-inquiry');
  assert.deepEqual(out.data, { ok: 1 });
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.body, '[1001447,105984]');
  assert.equal(seen.init.headers['Next-Action'], 'abc123');
});

test('callAction retries on 429 and then succeeds', async () => {
  let n = 0;
  const waits = [];
  const fetchImpl = async () => {
    n++;
    if (n === 1) return { ok: false, status: 429, text: async () => '' };
    return { ok: true, status: 200, text: async () => '1:{"status":true,"data":{"ok":1}}' };
  };
  const client = createSwishClient({ fetchImpl, sleepImpl: async (ms) => waits.push(ms) });
  const out = await client.callAction('abc123', [1], 'https://swish.co.il/x');
  assert.deepEqual(out.data, { ok: 1 });
  assert.equal(n, 2);
  assert.ok(waits.some((ms) => ms >= 2000), 'backed off before retrying');
});

test('callAction gives up after its retries and names the status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '' });
  const client = createSwishClient({ fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(() => client.callAction('abc123', [1], 'https://swish.co.il/x'), /403/);
});

test('callAction rejects a 200 that carries no action result', async () => {
  // The stale-id failure mode. Silently returning null here would write an
  // empty catalogue and report it as fact.
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '0:{"a":"$@1"}' });
  const client = createSwishClient({ fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(() => client.callAction('abc123', [1], 'https://swish.co.il/x'), /no action result/i);
});

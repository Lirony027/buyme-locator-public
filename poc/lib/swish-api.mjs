/**
 * Swish's site is a Next.js app-router SPA. It has no REST API: the store
 * list is fetched by invoking React Server Actions, which answer a plain
 * scripted POST with no authentication and no bot challenge.
 *
 * Two things about that plumbing are load-bearing and neither is obvious.
 *
 * 1. An action is addressed by a content hash baked into the deployed
 *    bundle, so EVERY Swish deploy changes it. A hardcoded id does not fail
 *    cleanly — the server answers 200 with a re-render of the page it was
 *    posted to and no action result in it, which a naive parser reads as
 *    "no chains". The ids are therefore derived from the live chunks, and a
 *    result-less 200 is an error rather than an empty answer.
 *
 * 2. A server action returns its result ALONGSIDE a full re-render of
 *    whatever page it was posted to, and only on a page whose bundle
 *    registers that action — other routes answer with a 2-byte body.
 *    getBranchesByChain is posted to /home/balance-inquiry rather than the
 *    product page because both host it and the re-render is 620KB instead
 *    of 2MB. Across ~1,050 calls that is 0.7GB instead of 2.1GB for an
 *    identical result.
 */

export const ACTION_NAMES = Object.freeze({
  chains: 'getChainsListByCategory',
  branches: 'getBranchesByChain',
});

const ORIGIN = 'https://swish.co.il';

/** The page whose chunks register the actions, and the cheapest host for each. */
export const ACTION_SOURCE_PAGE = `${ORIGIN}/business/all-gifts-giftcard/product-105984`;
export const ACTION_HOST_PAGES = Object.freeze({
  chains: ACTION_SOURCE_PAGE,
  branches: `${ORIGIN}/home/balance-inquiry`,
});

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Incapsula is live on this origin and passive today. Stay polite anyway. */
const THROTTLE_MS = 1000;
const RETRY_DELAYS_MS = [2000, 6000, 15000];

export function extractChunkPaths(html) {
  const found = String(html ?? '').match(/\/_next\/static\/chunks\/[A-Za-z0-9._/-]+\.js/g) || [];
  return [...new Set(found)];
}

/**
 * Matched by the action NAME, which is stable, rather than by position or by
 * the hash, which is not.
 */
export function extractActionId(source, actionName) {
  const pattern = new RegExp(
    'createServerReference\\)\\("([0-9a-f]{8,})"[^)]*?"' + actionName + '"\\)'
  );
  const match = pattern.exec(String(source ?? ''));
  return match ? match[1] : '';
}

/**
 * Pulls the action's JSON out of an RSC flight body by scanning from the
 * result marker to its balanced closing brace. A plain indexOf('}') would
 * stop inside the first nested object, and a greedy lastIndexOf would run
 * past the result into the page re-render that follows it.
 */
export function parseActionResult(body) {
  const text = String(body ?? '');
  const start = text.indexOf('{"status"');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSwishClient({ fetchImpl = fetch, sleepImpl = defaultSleep } = {}) {
  async function getText(url, init) {
    const res = await fetchImpl(url, init);
    if (!res.ok) return { ok: false, status: res.status, text: '' };
    return { ok: true, status: res.status, text: await res.text() };
  }

  async function resolveActionIds() {
    const page = await getText(ACTION_SOURCE_PAGE, { headers: { 'User-Agent': UA } });
    if (!page.ok) throw new Error(`Could not load ${ACTION_SOURCE_PAGE}: ${page.status}`);

    const ids = { chains: '', branches: '' };
    for (const path of extractChunkPaths(page.text)) {
      if (ids.chains && ids.branches) break;
      const chunk = await getText(ORIGIN + path, { headers: { 'User-Agent': UA } });
      if (!chunk.ok) continue;
      ids.chains = ids.chains || extractActionId(chunk.text, ACTION_NAMES.chains);
      ids.branches = ids.branches || extractActionId(chunk.text, ACTION_NAMES.branches);
    }

    for (const [key, name] of Object.entries(ACTION_NAMES)) {
      if (!ids[key]) {
        throw new Error(
          `Could not derive the server-action id for ${name} from ${ACTION_SOURCE_PAGE}. ` +
            `Swish has probably restructured its bundle — refusing to continue rather than ` +
            `writing an empty catalogue.`
        );
      }
    }
    return ids;
  }

  async function callAction(actionId, args, hostPage) {
    let lastStatus = 0;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleepImpl(RETRY_DELAYS_MS[attempt - 1]);

      const res = await getText(hostPage, {
        method: 'POST',
        headers: {
          'Next-Action': actionId,
          'Content-Type': 'text/plain;charset=UTF-8',
          Accept: 'text/x-component',
          Referer: hostPage,
          'User-Agent': UA,
        },
        body: JSON.stringify(args),
      });

      if (!res.ok) {
        lastStatus = res.status;
        continue;
      }

      const parsed = parseActionResult(res.text);
      if (!parsed) {
        // A 200 with no result means the id no longer addresses an action.
        // Treated as fatal, not as an empty answer, because the whole point
        // of deriving ids is that this failure must be loud.
        throw new Error(
          `${hostPage} returned 200 with no action result for ${actionId} — the action id is stale`
        );
      }

      await sleepImpl(THROTTLE_MS);
      return parsed;
    }

    throw new Error(`${hostPage} failed after ${RETRY_DELAYS_MS.length + 1} attempts (last status ${lastStatus})`);
  }

  return { resolveActionIds, callAction };
}

# Swish as a third source — design

The BuyMe store-locations page gains a third option in its source dropdown: **Swish**, alongside BuyMe and תו הזהב. Selecting it swaps the dataset behind the map exactly as תו הזהב already does.

Prior art and the constraints it establishes: [`2026-09-01-buyme-store-locations-design.md`](2026-09-01-buyme-store-locations-design.md) and [`2026-09-14-tav-hazahav-source-design.md`](2026-09-14-tav-hazahav-source-design.md). The audience is unchanged — **BuyMe sales staff, with a client in the room** — and so is the governing risk that follows from it: understating a competitor is worse than overstating one, because a salesperson repeats the number out loud to the person it disadvantages.

Nothing in either document's licence reasoning, pipeline structure or honesty requirements is relaxed here. One of them is substantially strengthened, and one new risk is introduced deliberately at the user's direction. Both are set out below.

## Swish is a materially better source than either existing one

This is the headline, and it is what makes this feature small rather than large.

BuyMe and תו הזהב both hit the same wall: neither issuer models branches, so locations had to be *guessed* through Google Places Text Search — which cost API calls, imposed a 30-day caching limit, forbade committing the coordinates, and introduced the category-matching defect that put 339 wrong pins on the live page under `חנות - משקפיים`.

**Swish publishes its branches, with street addresses.** Measured on 2026-09-15 against the live endpoints:

| | Measured |
| --- | --- |
| Branches carrying both `storeAddress` and `cityName` | **98.9%** (533 of 539, across a 70-chain random sample) |
| `מיקומים שונים` ("various locations") sentinels | 0.2% |
| Branches per chain | mean **7.7**, median 1, max 107 |
| Projected union total | **~8,100 branches** |

The projection carries a wide interval — a median of 1 against a maximum of 107 is a heavy tail, and 70 chains is a small sample against 1,051. Treat **6,000–10,000** as the honest range until the full crawl lands. For scale, BuyMe currently renders 9,034 points.

The consequence is that **this source needs no Google Places at all**. Free geocoders resolve a published street address; their output is ODbL, permanent, and committable. Every constraint Places imposed on the other two layers is simply absent here.

## What the site actually exposes

`https://swish.co.il/business/all-gifts-giftcard/product-105984` is a Next.js app-router page. The "לרשימה המלאה" control does not call a REST API — it invokes two **React Server Actions**, which answer a plain scripted `POST` with no authentication and no bot challenge:

| Action | Args | Returns |
| --- | --- | --- |
| `getChainsListByCategory` | `(categoryId)` | `data.tagsForChains` |
| `getBranchesByChain` | `(chainId, categoryNumber)` | `data.branchesByChainID` |

A chain record carries `chainId`, `storeName`, `searchKeyWords`, `subBranchRegions`, `logo`, `webSite`, `tagName`, `mustToKnow` and a null `branchesByChainID` — branches are fetched lazily, one call per chain.

A branch record carries `branchName`, `cityName`, `storeAddress`, `storeStreetNumber`, `regoin`, `phone`, `openHours`, `kosher`, `logo` and `webSite`.

### The action ids are build hashes and must never be hardcoded

Each action is addressed by a content hash baked into the deployed bundle — `getChainsListByCategory` was `7fef9360999fd421ead72f89b70f48266bb0b4f748` on 2026-09-15. **Every Swish deploy changes them.** A hardcoded id does not fail cleanly; it returns HTTP 200 carrying a page re-render with no action result in it, which a naive parser reads as "no chains".

The acquisition script therefore derives both ids at run time: fetch the product page, pull its `/_next/static/chunks/*.js`, and match `createServerReference("<id>", …, "<actionName>")`. If either derivation fails it aborts, by the same reasoning as תו הזהב's 150-brand floor — a shape change must become a loud build failure, never a quietly half-empty competitor layer.

### Post the action to the cheapest route that hosts it

A server action returns its result *alongside a full re-render of whatever page it was posted to*. Posted to the product page, each branch lookup returns **2 MB**; posted to `/home/balance-inquiry`, which hosts the same action, **620 KB**. Over 1,051 calls that is the difference between 2.1 GB and 0.7 GB, for an identical result.

Routes that do not host the action return a 2-byte body, so the choice of route is load-bearing and not interchangeable.

## Swish is a family of cards, and we ship two of them as one source

Unlike BuyMe and תו הזהב, Swish sells several gift cards, each with its own `categoryId` and its own chain list:

| Card | `categoryId` | Chain entries | Distinct chains |
| --- | --- | --- | --- |
| **Swish Plus** | 105984 | 999 | **996** |
| **Swish Premium (Rainbow)** | 104068 | 1,049 | **1,046** |
| Swish Baby | 95963 | 279 | — |
| Swish Mate | 148664 | 56 | — |
| Swish Breakfast | 56217 | 35 | — |

Plus and Premium ship; Baby, Mate and Breakfast do not. They are niche cards unlikely to arise in a sales conversation, and the card id lives in one constant, so adding them later is cheap.

### The two cards are 94% the same list

| | Count |
| --- | --- |
| Accepted by **both** cards | **991** |
| **Premium only** | **55** |
| **Plus only** | **5** |
| Union | **1,051** |

Premium is very nearly Plus plus food retail: of its 55 exclusives, 16 constitute an entire category Plus does not have — רשתות שיווק מזון ופארמה — and the rest are names like סופר פארם, קרפור, ניצת הדובדבן, מקדונלדס and סופר ספיר. The five Plus-only chains are הזקן והיין, דלל קוסמטיקס, ספייס ראן VR, קפה קפה and ראנץ האוס מצפה הימים.

### Branches belong to the chain, not the card

For a chain in both cards, the two branch payloads differ in exactly one field: `remarkVar`, the card's own marketing blurb. `branchName`, `cityName`, `storeAddress`, `storeStreetNumber`, `phone`, `openHours`, `kosher`, `regoin`, `logo`, `webSite` and `mustToKnow` are byte-identical, and multi-branch chains return the same location set under either card.

Verified rather than assumed, because it halves the crawl: **each `chainId` is fetched exactly once**, not once per card. 1,051 calls, not 2,045.

### One dropdown entry, and the badges that make it honest

**The two cards ship as a single `swish` source over the 1,051-chain union.** This was the user's explicit decision, taken with the 94% overlap in front of them. It keeps the dropdown at three entries and the page at one Swish dataset instead of two near-identical ones.

It also introduces the one new risk in this design, and the risk is stated plainly because it is real: **a count read off the union is true for neither card on its own.** A salesperson who says "Swish gets you 40 places around here" is quoting a number that includes Carrefour for a Plus holder and קפה קפה for a Premium holder.

The tier badge is the entire mitigation, which is why it is load-bearing rather than decorative:

| Class | Count | Badge |
| --- | --- | --- |
| Both cards | 991 | none |
| Premium only | 55 | `פרימיום בלבד` |
| Plus only | 5 | `פלוס בלבד` |

**Both exception sets are badged, not just Premium's.** Badging only the 55 would silently imply Premium covers the five Plus-only chains, which is the same misleading-by-omission failure in the other direction and costs nothing to avoid.

The badge renders in **four** places: the result row, the map info window, the brand-search list, and the PDF export. The PDF matters most — it is the artefact that leaves the room, where no one is present to explain it, and it is already the reason the export carries a source line at all.

## Architecture: a third normalizer, and no Google

The catalogue contract introduced for תו הזהב is unchanged and already generic. `scripts/build-google-page.mjs` gains one line.

| File | Role |
| --- | --- |
| `scripts/fetch-swish-payloads.mjs` | new — derives the action ids, fetches both chain lists and every branch list |
| `scripts/fetch-swish-logos.mjs` | new — brand logos into `poc/logos-swish/` |
| `scripts/resolve-swish-addresses.mjs` | new — geocodes every branch address |
| `poc/lib/swish-catalogue.mjs` | new — pure union, tiering, type-merge and partition logic, unit-tested |
| `scripts/catalogues/swish.mjs` | new — assembles the contract |
| `scripts/build-google-page.mjs` | one added entry in the `catalogues` object |

`poc/lib/geocode.mjs` (`createGeocoder`, `computePrecision`) and `poc/lib/address-variants.mjs` are reused verbatim. `poc/lib/places.mjs`, `poc/lib/call-budget.mjs` and `poc/lib/match-chains.mjs` are **not** used — Swish needs no Places client, no shared call ceiling and no brand-anchored matching, because it never has to guess which business a search result refers to.

### The single location path

| Path | Covers | Cost | Method | Caching |
| --- | --- | --- | --- | --- |
| **A″** | every branch with an address | free | existing Nominatim→Photon cascade | permanent, **committed** |

There is no B or C equivalent. This is the first source whose coordinates can be committed in bulk, because they are OSM-derived geocodes of Swish's own published addresses — no Google content is involved at any point, so neither the 30-day retention rule nor the git-ignore convention applies. `poc/swish-locations.json` is a tracked file.

The geocode query is `storeAddress + storeStreetNumber, cityName`, fed through `addressVariants()`. A raw Nominatim probe on 20 real Swish addresses, with no variant cascade and no Photon fallback, resolved **80%**. The cascade should improve on that, but by how much is unmeasured and is the largest open number in this design — see Risks.

Not-placed branches fall into two kinds: the `מיקומים שונים` sentinel, and the 1.1% carrying no address or no city. Neither is placed and neither is an error. A chain with no placeable branch at all is listed under `onlineOnly` if its category is רכישה אונליין, and otherwise counted in `unmappedCount`.

### Field mapping

| Contract field | Source |
| --- | --- |
| brand name | `storeName`, trimmed |
| `types` | `tagName`, verbatim — **union across tags** |
| `aliases` | `searchKeyWords`, split on `;` |
| `logos` | `logo` URL under `https://pics.k4a.co.il`, fetched into `poc/logos-swish/` |
| `tiers` | new sparse field — `'plus'` or `'premium'` for the 60 exceptions only |
| `catalogueSize` | 1,051 |
| `branchTruth` | per chain — see below |

Three details that will silently corrupt the catalogue if missed:

- **Some chains appear under two tags each** — three in each list, which is why Plus files 999 entries for 996 chains and Premium 1,049 for 1,046. Their categories must be unioned, or one brand renders as two — the same merge `mergeBrands` performs for תו הזהב.
- **The union type vocabulary is 12 categories, not 11.** Plus has 11; Premium adds רשתות שיווק מזון ופארמה. The dropdown must be built from the union.
- **`searchKeyWords` is a page-search alias only and must never reach a geocoder.** It is populated on 212 of 1,049 entries, semicolon-separated, and mixes Latin with Hebrew (`nautica;נוטיקה`). The same rule already governs תו הזהב's `nameInAnotherLanguage`.

## The coverage instrument gets much stronger

The original BuyMe design records the limitation plainly: the page "can honestly say '16 found', never '16 of 40'", because chain sizes are unknown. תו הזהב improved on that for **three** Shufersal banners, and that 186-branch denominator is what caught the Places category-matching bug.

**Swish publishes its own branch count for all 1,051 chains.** Coverage is therefore a true `geocoded / published` ratio for every brand in the catalogue, not an aggregate and not a special case. A chain that publishes 20 branches and geocodes 9 is visibly incomplete on its own row.

This is the most valuable thing the Swish source contributes, and it should be surfaced on screen, not merely computed — the same instruction the תו הזהב design gave for its own denominator, which earned its keep within a single task.

It also removes the need for the honesty hedge that layer required. תו הזהב counts must read as "found in our data" because the real estate size is unknown. Swish counts can state the real ratio, and should.

### The contract shape holds; the rendering does not

`branchTruth` stays exactly the shape it already is — `{ brandName: publishedCount }` — so תו הזהב is untouched. **The page's renderer is what breaks.** `renderCoverage` currently enumerates every key into a single line:

```js
Object.keys(BRANCH_TRUTH).forEach(function (banner) {
  known.push(banner + ' ' + found + '/' + BRANCH_TRUTH[banner]);
});
parts.push('סניפים שאותרו: ' + known.join(' · '));
```

Three banners read well. **1,051 would produce a coverage line thousands of characters long**, which is not a cosmetic problem — the coverage line is the page's honesty mechanism, and an unreadable one is a missing one.

The fix keeps both sources correct:

- **Global coverage line** — enumerate while `branchTruth` holds five keys or fewer (תו הזהב's display is then byte-identical to today's), and above that aggregate: `סניפים שאותרו: N מתוך M שפורסמו`, summing found and published across all chains.
- **Per-brand ratio** — when a single brand is active, show that brand's own `found/published` in the brand header and info window. This is where a per-chain denominator is actually actionable, it is bounded by construction, and it benefits תו הזהב's three banners too.

## Acquisition guards

- Fewer than **900** union chains, or fewer than **4,000** total branches, aborts the build rather than writing a page.
- Failure to derive either server-action id aborts.
- The crawl is **resumable**, cached per `chainId`. Sixteen minutes is long enough to crash, and both תו הזהב Places runs did exactly that on transient upstream 500s.
- Requests are throttled to roughly one per second with backoff on 403 and 429. Incapsula (`_Incapsula_Resource`) is present on the origin and was passive across every probe — 25 consecutive uncooled calls returned 0 failures at 0.93s each — but it is a live bot-protection layer and should be treated as one.

## The page

Four changes, all small, because the page was made generic when תו הזהב landed and reads its sources from `Object.keys(CATALOGUES)`:

1. One `<option value="swish">Swish</option>` in `#source`.
2. Tier-badge rendering, as an additional `iw-tag` beside the existing type and provenance tags, in the four surfaces named above.
3. A card-aware PDF heading, so a printed sheet says which Swish card its rows are true for.
4. `renderCoverage` gains the scale rule described above, and brand mode gains a per-brand `found/published` ratio.

Change 4 is the only one that touches a code path תו הזהב and BuyMe also run through. Its acceptance check is that the תו הזהב coverage line renders byte-identically to today's.

The switch behaviour established for תו הזהב is unchanged and correct here: location and radius survive, `#type` repopulates from the new vocabulary and resets, brand search clears, and the page defaults to BuyMe on every load without persisting the choice.

**The page stays BuyMe-branded**, as on both existing sources, for the reason already settled — it is BuyMe's sales collateral.

## Refresh

Swish is refreshed by its own script and **sits outside the shared Places ceiling**, because it spends nothing against it. Its data does not expire in 30 days, so it carries no staleness deadline and no compliance risk from drifting; it is refreshed because Swish's catalogue changes, not because a licence requires it.

The deploy step that `refresh-google-data.mjs` owns still applies: a refresh that does not redeploy leaves the public page unchanged.

## Risks

- **One source speaking for two cards.** Accepted deliberately. A union count is true for neither card alone, and the tier badges are the only thing standing between that and a false comparative claim. If the badges are dropped or rendered in fewer than the four named surfaces, this design's honesty argument fails.
- **The geocode rate at scale is unmeasured.** 80% on a raw 20-address probe, before the variant cascade and Photon fallback. This is the single largest unknown, and it determines whether the coverage story is strong or apologetic. **The implementation plan must measure it on a few hundred real addresses and report the number before any other work is built on top of it.**
- **The projected branch total carries a wide interval.** 6,000–10,000, from a 70-chain sample with a heavy tail. Measure at crawl time; do not quote 8,100 as fact.
- **Page weight roughly doubles.** ~8,100 added points against 9,034 today. Acceptable over Vercel with gzip, and worth re-measuring rather than assuming once the real numbers land — the same caveat תו הזהב's design attached to its own projection.
- **Action ids drift on every Swish deploy.** Handled by run-time derivation, which converts the failure into an abort rather than an empty catalogue.
- **Incapsula may tighten.** Passive today. Polite throttling and honest backoff are the mitigation; if it starts challenging, the acquisition strategy needs revisiting rather than defeating.

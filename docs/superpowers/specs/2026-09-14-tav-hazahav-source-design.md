# תו הזהב as a second source — design

The BuyMe store-locations page gains a **source dropdown**: BuyMe or תו הזהב, one at a time, never both. Selecting a source swaps the entire dataset behind the map — pins, result list, type filter, coverage line and online-only section — while the page itself stays BuyMe's.

**This page serves BuyMe sales staff, and that is what the feature is for.** A salesperson sitting with a prospective client can answer "what can I spend BuyMe on around here?" and then, in one click, "and what would the competitor give you at the same spot?". The comparison is the product. Every design decision below follows from that, and two of them invert choices the original design made for a consumer-facing page.

Prior art and the constraints it establishes: [`2026-09-01-buyme-store-locations-design.md`](2026-09-01-buyme-store-locations-design.md). Nothing in that document's licence reasoning, pipeline structure or honesty requirements is relaxed here.

## What תו הזהב actually publishes

תו הזהב is Shufersal's voucher. Its site is an Angular SPA over a **public, unauthenticated JSON API** — no scraping, no HTML parsing, no bot protection encountered. This is a materially easier acquisition problem than the one the BuyMe design surveyed and rejected, where 60% of chain sites sat behind Cloudflare.

Two endpoints carry everything, both answering 200 to a plain GET with a browser User-Agent and a Referer:

| Endpoint | Payload | Count |
| --- | --- | --- |
| `TavimApi/api/resource/tavzahav` | `content.data.networkingCubes` | **210** brands |
| `TavimApi/api/info/getBranches` | `content` | 187 rows → **186** Shufersal branches |

### The 210 brands

| `networkingType` | Count |
| --- | --- |
| `Network` (chains) | 168 |
| `Restaurant` | 24 |
| `OnlineStores` | 18 |

Categories live in `fieldProperty` and map directly onto the type filter the page already has:

| Category | Count | | Category | Count |
| --- | --- | --- | --- | --- |
| אופנה | 69 | | סופרמרקט | 7 |
| OnLine | 36 | | טיפוח | 7 |
| הנעלה | 33 | | פנאי ונופש | 7 |
| מסעדות וקולינריה | 24 | | חשמל ורכב | 4 |
| ילדים | 17 | | | |
| עיצוב הבית | 14 | | | |
| ספורט | 10 | | | |

Unlike BuyMe's `categories_on_brands`, every one of these is a genuine store type. There are no merchandising collections mixed in, so **no `PROMO_CATEGORY_IDS` equivalent is needed** — the category list transfers as-is.

### Field population, measured against the live endpoint

| Field | Populated |
| --- | --- |
| `name`, `icon`, `nameInAnotherLanguage`, `nameInUpperLetters` | 210 / 210 |
| `websilteLink` | 139 / 210 |
| `phone` | 12 / 210 |
| `city` | 11 / 210 |
| **`address`** | **10 / 210** |
| `areas` | **0 / 210** |

**There are effectively no locations in this data.** Ten addresses — nine restaurants and one Castro branch — out of 210 entries, and not a single coordinate anywhere. This is the same wall the BuyMe design hit, for the same underlying reason: neither voucher issuer models branches, because neither needs to.

Two fields look like escape hatches and are not:

- **`placeId` is populated for all 210 and is not a Google Place ID.** It is the Umbraco media id of the brand's logo — `placeId: "20443"` on an entry whose `icon.id` is also `20443`. Had it been a Google place id it would have been the single most valuable field in the payload, since place ids are the one Places output Google exempts from caching limits. It is not, and nothing here changes the 30-day rule.
- **`areas` is an empty array on every entry**, though the payload does ship a dictionary of five (דרום, ירושלים, מרכז, צפון, שרון). BuyMe's equivalent — `supplier_regions` — is what the existing Google pipeline partitions large chains across to beat the 60-result Text Search cap. That lever does not exist here.

It does not need to. `poc/lib/israel-tiles.mjs` already defeats the same cap **geographically**, by splitting the country into a rectangle grid and querying each tile. Tiling is source-agnostic and needs no region metadata at all, so the missing `areas` costs nothing. This was checked before designing around it, because a region-partitioned approach would have been dead on arrival.

### The endpoint disagrees with itself

Measured on 2026-09-14, while implementing: the brands endpoint returns **either 210 entries or 206**, depending on which backend answers. The 206 is a stale CMS cache missing four brands — קלארינס, סורובסקי, דרימי and אקס-איי מוביליטי. Eight consecutive fetches alternated 210/206/210/206…, but a later run returned 206 three times in a row, so it is not round-robin and a fixed number of attempts cannot be trusted to see the full set.

**The floor guard does not catch this**, and that is the point worth recording. Four missing brands out of 207 is nowhere near the 150 floor, so a short payload would sail through, the catalogue would quietly lose those brands, and the page's own coverage line would report the loss as fact — the exact misleading-by-omission failure this design otherwise takes care to avoid.

The acquisition script therefore fetches each endpoint repeatedly until several consecutive responses add nothing new, and takes the union. Both verification runs converged on the full payload within six attempts. The endpoints are free and unauthenticated, so the extra requests cost nothing.

The union key is deliberately not the brand name: three names legitimately appear twice, and collapsing them at fetch time would undo the merge described above.

### The 186 branches, and why they matter more than their count suggests

`getBranches` returns Shufersal's own supermarket estate across 80 distinct cities. It returns **187 rows but only 186 branches**: `דיל עכו` (`branchID` 399) is listed twice, byte-for-byte identical, consistently across every fetch. Deduplicated by `branchID` the estate is **שופרסל דיל** (84), **שופרסל שלי** (72), **יוניברס** (30).

That duplicate is worth more than a footnote, because this list is a denominator. Counting the raw rows inflates it, which makes measured coverage look worse than it is — and understating is the one direction that actually harms someone here, since a salesperson quotes these ratios to a client. The row count is not the estate; the distinct `branchID` count is.

Each row carries `branchID`, `branchName`, `city`, `companyNetwork` and an `area` code, and no more than that. There is no street address and no coordinate — `cityId` is null on every row — so `שלי ת"א בן יהודה` is a venue name to resolve, not an address to geocode.

Their real value is not as pins. **They are a true denominator, which this feature has never had.** The original design records the limitation plainly: the page "can honestly say '16 found', never '16 of 40'", because chain sizes are unknown. For three of Shufersal's banners the 40 is now published. That yields an honest `142 מתוך 186` coverage line for those chains, and — more usefully — a hard accuracy check on the Places run itself. A tiled Places search that returns 60 of a known 186 is visibly broken in a way that the same search against an unknown denominator is not.

The check covers three banners only. שופרסל אקספרס and בי פארם appear in `networkingCubes` but not in `getBranches`, so they keep the usual unknown denominator.

## Overlap with the existing BuyMe data is negligible

Nineteen of the 210 names match a chain already resolved in `poc/buyme-chains-google.json` (465 chains, 8,440 locations). The other 191 do not — not because the chains differ, but because the two catalogues spell them differently: BuyMe files `FOX`, תו הזהב files `פוקס גברים`, `פוקס נשים`, `פוקס ילדים` and `פוקס הום` as four separate entries.

Reconciling those spellings was considered and rejected. It would save a few hundred API calls at the cost of a hand-maintained alias table between two catalogues that each change independently, and a wrong merge would silently attribute one voucher's coverage to the other — in a sales tool, the single worst possible bug. **The two catalogues are resolved independently and never cross-reference.**

## Architecture: a catalogue contract, one builder

`build-google-page.mjs` already computes, internally, exactly the shape a second source needs. Extracting that shape into a named contract and giving each source its own normalizer is the whole architectural change:

```js
{ id, label, generatedAt, locations[], onlineOnly[],
  catalogueSize, unmappedCount, logos{}, types{}, aliases{}, branchTruth? }
```

| File | Role |
| --- | --- |
| `scripts/catalogues/buyme.mjs` | today's builder logic, extracted unchanged in behaviour |
| `scripts/catalogues/tav.mjs` | new — normalizes `networkingCubes` + `getBranches` |
| `scripts/build-google-page.mjs` | thin loop over both, injects `window.CATALOGUES` |

Two alternatives were weighed. **Parallel `tav-*` scripts** would leave the working BuyMe path untouched, but `build-google-page.mjs` is ~230 lines of BuyMe-specific parsing (`searchTerms`, `categories_on_brands`, `suppliers_id`, promo-category filtering) with no counterpart in Umbraco's payload, so the two builders would diverge immediately and have to be kept emitting identical page contracts by hand — precisely where a coverage line drifts out of sync between sources unnoticed. **One flat dataset with a `source` field per location** would be the smallest page change, but coverage metadata is inherently per-catalogue (210 brands versus 1,305, different unmapped counts, different online-only lists, independent `generatedAt`), so flattening forces that apart again at render time.

`generatedAt` stays **per catalogue**. The two refresh independently, and a stale competitor layer must be visible as stale rather than inheriting BuyMe's freshness.

## The three location paths

Mirrors of Pipelines A and C, with the same licence rules. No OSM/Overpass path (Pipeline B) is built for תו הזהב: the original design measured that layer at a third of chain candidates matching anything at all, and the scaffold it existed to serve is already retired.

| Path | Covers | Cost | Method | Caching |
| --- | --- | --- | --- | --- |
| **A′** | the 10 real addresses | free | existing Nominatim→Photon cascade, `resolve-buyme-addresses.mjs` logic | permanent, **committed** |
| **B′** | the 3 Shufersal banners | ~36 calls | Places Text Search, tiled | 30-day, **git-ignored** |
| **C′** | 179 chains and address-less restaurants | ~540–740 calls | Places Text Search, `israelTiles(3, 4)` on cap | 30-day, **git-ignored** |

**The 210 entries are 207 brands.** Three names appear twice — `שופרסל אונליין` and `שילב` each as a `Network` entry and an `OnlineStores` one, `סאקוני` as two `Network` entries filed under אופנה and הנעלה. Entries sharing a name must be merged, taking the union of their categories, or the page would show one brand as two. A brand counts as online-only when *every* one of its entries is `OnlineStores`, which is why שילב is a placeable chain that also sells online rather than an online-only listing.

Names also need normalizing before anything joins on them: `networkingCubes` files `"שופרסל דיל "` with a trailing space while `getBranches` files `"שופרסל דיל"` without one, so the denominator would silently fail to match.

After merging, the four paths partition the 207 exactly: **10** with an address, **3** Shufersal banners, **15** online-only with nothing to place, and **179** left for Places. The online-only *listing* holds 16, one more than that 15: קסטרו אונליין is on it and is also placed. קסטרו אונליין carries an address, so it is both listed under online-only and placed via A′ — being spendable online does not stop it having a door.

`getBranches` itself is Shufersal's own published data containing no Google content, so **it commits** — it is the denominator, not a source of coordinates.

B′ queries the three banner names under tiling rather than looking up all 186 branches individually. That is ~36 calls instead of 186, and the branch list serves its denominator role either way.

### Call budget

Roughly **600–800 calls per refresh**, putting the combined monthly total near **4,000 of the free 5,000** Text Search allowance.

`resolve-buyme-chains-google.mjs` guards this with `CALL_BUDGET = 4500`, which is **per run**. Two independent runs of 4,500 would wave through a combined overrun into billing without either one tripping. The budget must become a ceiling shared across both sources, enforced where the refresh orchestrates them rather than inside each resolver.

`scripts/refresh-google-data.mjs` refreshes both catalogues under that shared ceiling, keeping its existing 21-day threshold and `--force` flag. The Windows scheduled task documented in `poc/README-google.md` is unchanged.

### Field mapping for `tav.mjs`

| Contract field | Source |
| --- | --- |
| brand name | `name` |
| `types` | `fieldProperty`, verbatim |
| `logos` | `icon.url` under `https://media.shufersal.co.il/umbracoMedia/prod`, fetched into `poc/logos-tav/` |
| `onlineOnly` | `networkingType.pickedKeys` contains `OnlineStores` |
| `aliases` | `nameInAnotherLanguage` |
| `catalogueSize` | 207 (distinct names, after merge) |

Logos are 209 distinct files across the 210 entries (105 png, 105 jpg), fetched by a new `scripts/fetch-tav-logos.mjs` alongside the existing BuyMe equivalent. A brand whose logo fails to download keeps a plain pin, matching the current behaviour.

**`nameInAnotherLanguage` is a page-search alias only and must never reach a Places query.** It is loose transliteration — `be parm` for בי פארם, `universe` for יוניברס — which works fine for someone typing a Latin-keyboard guess into the brand box and would actively corrupt a location lookup.

### Acquisition guards

Both endpoints get a floor: fewer than 150 brands or 150 branches aborts the build rather than writing a page. This matches `build-google-page.mjs`'s existing `MIN_BRANDS` guard and its stated reason — refusing to write a page whose coverage caveat would be silently empty.

The guard matters more here than it did for BuyMe. This is an **undocumented internal API with no stability contract**; `networkingCubes` can be renamed or restructured in a Shufersal deploy with no notice and no deprecation. The floor converts that from a silently half-empty competitor layer into a loud build failure.

## The page

`window.BUYME_DATA` becomes `window.CATALOGUES`, keyed by source id, read through an `activeCatalogue()` accessor. Every existing renderer — haversine radius filter, distance sort, brand search, provenance labelling, empty-result handling, PDF export — reads that accessor and is otherwise untouched, because each only ever sees one catalogue at a time. This is what makes the change contained rather than a rewrite.

A `<select id="source">` sits beside `#type` in the topbar, two options, exclusive by construction.

**On switch:** location and radius survive and results re-run instantly with no network call — the whole dataset is already resident, which is what makes the comparison a single click rather than a re-search. `#type` repopulates from the new catalogue's vocabulary and resets to כל הסוגים, because the two vocabularies genuinely differ and silently keeping a filter that means something else in the other catalogue is worse than resetting it. Brand mode and its chip clear, since the brand will not exist in the other catalogue.

**It defaults to BuyMe on every load and the choice is not persisted.** A sales tool should open on its own product; a salesperson who left it on תו הזהב yesterday must not start tomorrow's meeting there.

**The page stays BuyMe's.** Header, logo, title and styling do not change with the source. This was chosen deliberately: the page is BuyMe's sales collateral, so a BuyMe header is correct even while the pins are the competitor's.

**The PDF export gains a source line.** This is the one place where unchanged branding is not sufficient. A salesperson leaves a printed sheet with a client, and a sheet of תו הזהב stores under a BuyMe header with nothing saying so is a document that misleads on its face, away from the room where it could be explained. Naming the source is a labelling requirement, not a branding change.

## Deployment, and what hosting changes

The page is already public at `https://poc-six-taupe.vercel.app/buyme-map-google.html`, linked through `poc/.vercel/` to the project `poc`. `.vercelignore` restricts the deployment to the generated page and `logos/`, keeping every JSON payload and pipeline script off the public host. Deploying is `npx vercel@latest --prod` from `poc/`; the CLI is not installed locally and does not need to be.

Three consequences follow from being hosted rather than opened as a local file. They predate this feature — the page has been public since `2cf9810` — but תו הזהב is the first change to touch them, so they are settled here rather than inherited unexamined.

**The refresh does not redeploy, and that is a live compliance gap.** `scripts/refresh-google-data.mjs` and the Windows scheduled task rebuild the page *locally*. Nothing pushes it. The public page can therefore drift past Google's 30-day caching limit while local data is perfectly fresh, and the drift is invisible: the page renders the `generatedAt` of whenever it was last deployed, so a stale public page looks exactly like a current one. The refresh must end in a deploy, or the mechanism the original design chose to handle the 30-day rule — regenerating the data rather than guarding the page against staleness — does not actually reach the artefact anyone opens.

**The page key can now be referrer-restricted.** The original design records that an HTTP-referrer restriction is unavailable "because a `file://` page sends no referrer", leaving a daily quota cap as the only ceiling on damage. That was true of a local file and is not true of an https origin. `GOOGLE_PAGE_API_KEY` should be restricted to the Vercel origin, with the quota cap retained as a second bound rather than the only one.

**The licence question the original design parks is already answered by default.** That document states plainly that publishing or hosting the page "puts that question back on the table and must be re-examined rather than assumed settled". Google-derived coordinates have been publicly served since the page went up. Adding a competitor's catalogue alongside them does not change the licence position, but it is the point at which the default answer should become a deliberate one.

## Understating the competitor is the risk that matters

The original design's central honesty requirement is that an empty result never be stated as an absence, because at 35–40% chain coverage a confident negative was frequently wrong. That requirement stands unchanged for the BuyMe layer.

**For the תו הזהב layer the dangerous direction inverts.** A salesperson reads "3 stores nearby" off the competitor layer and says it out loud to a client. If the real number is 30 and our Places run found 3, they have made a false comparative claim in good faith, to the person it disadvantages, on BuyMe's behalf. That is a worse failure than the overstatement the original document was built to prevent, and it is new to this feature.

Three things hold against it, and none is optional:

1. **Every count on the competitor layer reads as "found in our data"**, never as a fact about the competitor's estate.
2. **The coverage line renders for both sources**, with the same prominence and the same caveats.
3. **The 186-branch denominator is a real accuracy check** and should be surfaced, not just computed. It is the only place in either catalogue where we can state a genuine ratio.

## Risks

- **Understating תו הזהב.** Addressed above; the governing risk of the feature.
- **The API is undocumented and may change without notice.** The 150-brand floor turns a shape change into a build failure rather than a quiet half-empty layer.
- **Page weight grows by ~40%.** BuyMe currently renders 9,034 points in a 1.72 MB file. תו הזהב projects to ~3,470 points (179 chains at BuyMe's measured 18.2 locations/chain, plus 186 branches and 10 addresses), taking the page to roughly **2.4 MB**. Acceptable over Vercel with gzip; not free, and worth re-measuring rather than assuming once the real numbers land.
- **The chain projection is an extrapolation from a different catalogue.** BuyMe's 18.2 locations per chain is a measured average over 465 chains; תו הזהב's mix is more fashion-and-footwear heavy and may not match. The original design's chain projection was 3× optimistic from exactly this kind of cross-inference — treat ~3,280 as a planning figure to be replaced by a measurement, not a target.
- **Combined Places budget.** ~4,000 of 5,000 free calls per month leaves less headroom than either source has alone. A shared ceiling is required, not advisory.
- **Places false positives on Hebrew chain names.** The BuyMe pipeline's אייס problem (190% of a chain's real size, from matching things that were not the chain) applies identically here and needs the same review sweep against real data before the layer is trusted in front of a client.
- **Publishing a competitor's catalogue on a public URL.** The data comes from Shufersal's own unauthenticated public endpoint and is displayed, not redistributed as a file. The page is already deployed to Vercel, so this is a live consideration rather than a hypothetical one, and worth a deliberate look before the source dropdown ships.
- **A public page is anonymous.** Anyone with the link sees BuyMe's sales framing of a competitor, with no sign-in and no audience control. The page carries no secret beyond the restricted page key, but it was designed as a local file for one operator and is now a URL that can be forwarded. Worth knowing; not addressed here.

## Out of scope

- Any app integration. This remains the standalone web POC — no React Native screen, no `src/data/` change, no bundle impact.
- Showing both sources at once, on the map or in the list. The dropdown is exclusive by design.
- Reconciling brand identities across the two catalogues.
- An OSM/Overpass path for תו הזהב.
- Any change to BuyMe's existing pipelines beyond extracting `buyme.mjs` and sharing the call budget.
- A third source. The contract is shaped so one would be a normalizer rather than a fork, but none is planned.

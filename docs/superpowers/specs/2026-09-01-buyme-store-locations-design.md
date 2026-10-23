# BuyMe store locations — design

A standalone HTML page, opened locally, where you **enter a location and a radius and get back the stores that accept BuyMe within it**. A BuyMe card spends at any of 1,305 merchants, so the question it answers is "I hold BuyMe credit — what can I spend it on around here?", which no existing screen answers and which the bundled directory cannot answer because it holds names only.

The interaction is the specification, not a presentation detail. A radius query returns a definite answer — *these N stores, none others* — and the user cannot distinguish "nothing here accepts BuyMe" from "our data does not cover here". That makes **coverage a correctness requirement rather than a quality metric**, and it is the constraint that drives every source decision below.

This is a proof of concept. Nothing is wired into the app: no `expo-location`, no React Native screen, no addition to `src/data/`. The location is typed, not read from a device. The output is a file you open in a browser.

## What BuyMe actually provides

The existing scraper (`scripts/scrape-buyme-merchants.mjs`) reads `https://buyme.co.il/brands/13438757/options` and keeps only `title` and a derived Hebrew alias. The same response carries fields it discards, and those fields are the whole basis for this feature. Measured against the live endpoint, 1,305 brands:

| Bucket | Count | What is available |
| --- | --- | --- |
| `googleMapAddr` populated | 611 | A free-text address string. No coordinates. |
| Nationwide chain, region only | 216 | `supplier_regions` names, no address |
| Regional chain, region only | 196 | `supplier_regions` names, no address |
| `online_redeem` | 257 | Location is irrelevant by nature |
| Nothing | 25 | — |

**`googleMapAddr` is one address per brand, not per branch.** A single-site business — a restaurant, a spa, a guesthouse — has its address there. A chain has `null`, because BuyMe never modelled branches at all. `adidas` carries no address and 12 regions; its `siteAddress` points at adidas's own store locator.

This was confirmed exhaustively before looking elsewhere: there is no per-brand branch endpoint (`/branches`, `/api/brands/{id}` and four other shapes all 404), and `smallPrint` — populated for 1,300 of 1,305 — is redemption terms, not branch lists. **Branch-level data does not exist anywhere in BuyMe's API.** Everything below follows from that.

## Coverage is bimodal, and that shapes the whole design

The two halves of the catalogue need different sources and reach very different quality. This is the central fact of the design, not an implementation detail.

The asymmetry has a single cause worth stating plainly, because it is easy to assume both halves lean on "OpenStreetMap" equally and conclude the two results should be similar. They use **different layers of OSM, with very different densities**:

| Layer | Reached via | Used for | Density in Israel |
| --- | --- | --- | --- |
| Street and address data | Nominatim geocoding | the 611 single-site brands | dense — **~90%** |
| Shop and POI objects | Overpass tag matching | the 412 chains | sparse — **~40%** |

Israeli streets are well mapped; Israeli shops are not. Every coverage number below follows from that one fact, and it is also why no amount of query tuning closes the chain gap.

**Single-site brands (611) resolve well.** Their own `googleMapAddr` geocodes against free geocoders. Measured on a spread of 24 real address strings: 83% on the exact string, **96% with a fallback cascade** (three of those rescued by Photon after Nominatim missed). An earlier 18-address sample scored 61% naive, so sampling variance at this size is real — the design assumes **~90%**, not 96%.

Every naive miss had a venue name glued to the front (`קניון TLV, קרליבך 4, תל אביב-יפו`) or a `רחוב` prefix, which is what the cascade strips. One address that should plainly have worked (`דרך בן צבי 84, תל אביב יפו`) simply missed — free geocoders have a noise floor and the cascade exists to absorb it.

**Chains (412) resolve badly, and this is a data ceiling rather than a technique failure.** Measured against OpenStreetMap:

| chain | naive query | Hebrew-aware + anchored |
| --- | --- | --- |
| FOX | 21% | **35%** |
| adidas | 30% | **40%** |
| קסטרו | 25% | 27% |
| אייס | 190% — false positives | **60%** |
| סופר-פארם | 55% | — |
| MAC | 0% | — |

(Denominators are estimates of real chain size, so read these as directional.)

Two independent findings say ~40% is the ceiling, not a starting point:

1. **Expanding by `brand:wikidata` adds nothing.** adidas name-matching found 12 branches; expanding by `Q3895` — how OSM canonically models a chain — found 11, a subset. The missing branches are not mis-tagged, they are **absent**.
2. **OSM holds 12,755 named shops and key amenities for all of Israel.** FOX alone has roughly 180 branches. Israeli retail is thinly mapped; no query technique recovers data that was never entered.

### The national average hides a gradient, and the gradient is what matters

~40% is a country-wide figure. Because the feature is a radius query at a user-chosen point, what actually matters is coverage *at that point*. Simulating the real interaction — count BuyMe-accepting stores OSM can find within a radius — gives a very different picture:

| Location | @500m | @1km | @2km | distinct brands @2km |
| --- | --- | --- | --- | --- |
| Azrieli, Tel Aviv | 21 | **31** | 54 | 41 |
| Jerusalem centre | 6 | **12** | 13 | 11 |
| Beer Sheva centre | 0 | **1** | 2 | 2 |

(Three further locations rate-limited out; the gradient across the three measured is stark enough to decide on.)

**Free data yields a Tel Aviv application.** 31 stores within a kilometre of Azrieli is a genuinely useful answer. One store within a kilometre of central Beer Sheva is not a degraded answer — it is a wrong one, delivered confidently. A browse-map could survive this, because sparse pins visibly look sparse. A radius search cannot: it invites the user to type any location in the country and then reports near-emptiness for most of them, indistinguishably from a true negative.

This single measurement is why the design targets Google Places rather than treating it as an optional upgrade.

## Why the naive query failed in both directions at once

The first probe matched one regex against `brand` and `name`. It produced אייס at 190% (matching things that are not the chain) and MAC at 0% (never matching `m.a.c` as OSM spells it). Recall and precision failed simultaneously, which is why the fix is not "match harder".

Three changes, measured together:

- **Match the Hebrew alias too.** `src/data/buyme-all-merchants.json` already carries a curated `heName` per merchant, and Israeli OSM objects are frequently tagged in Hebrew. This is existing project data doing new work, not a new dataset.
- **Match more tags** — `brand`, `name`, `name:he`, `name:en`, `operator`, `alt_name`. This is what surfaces `Fox Home`, `FOX Men` and `Castro Outlet`, sub-brands the single-tag query missed.
- **Anchor the pattern** to the whole tag value or value-plus-separator, so `Castro` matches `Castro Tel Aviv` but not `Castrol`. This is the lever that took אייס from 190% to a plausible 60%.

## Scraping chain websites was measured and rejected

The obvious follow-up — visit the sites of chains OSM covers badly and read their store locators — was surveyed across 20 real chain URLs from the BuyMe list rather than argued about:

| Outcome | Share |
| --- | --- |
| Behind bot protection (Cloudflare, 403, interstitial) | **60%** |
| No machine-readable structure (JS-rendered) | 35% |
| Usable JSON-LD | **5%** (1 of 20) |

Three compounding problems make this a dead end:

1. **Only 113 of 412 chains have an external `siteAddress` at all.** The rest point back at BuyMe pages. The addressable set is a quarter of the problem before anything else.
2. **60% are bot-protected.** Working around anti-bot measures is out of scope as a matter of policy, not difficulty.
3. **The single JSON-LD success was a one-site restaurant**, not a chain — it would not have added branch coverage.

Projected yield is roughly **6 chains out of 412**, each needing bespoke and individually-maintained code, against a single Overpass query that already covers all 412 at 35–40%. Recorded here so the option is not re-proposed later.

Mall directories are the one unexplored lever worth noting: ~50 malls cover much of Israeli chain retail, and one mall's coordinates serve dozens of chains — a far better ratio than per-chain scraping. Given the 60% bot-protection rate across Israeli retail sites, the expectation is similar walls. Not built; documented so the idea is not lost.

## Three pipelines, two pages, one shared foundation

Google Places roughly doubles chain coverage — Google's Israeli retail data is near-complete, and Text Search paginates to 60 results in 3 calls, so 412 chains cost ~1,236 calls against a **5,000/month free allowance**. It is genuinely free at this volume.

What it cannot do is share a map with OSM tiles. Two Places policies constrain it:

> "Places API results displayed on a map must be shown on a Google Map, with proper attribution."

and only **place IDs** are exempt from caching restrictions — coordinates, names and addresses may not be stored indefinitely (30 days is the standard limit).

The constraint runs in one direction only, and that asymmetry is what the design exploits. Google content must stay on a Google map and must expire. **OSM-derived content is under ODbL and may be displayed anywhere with attribution**, including on a Google map. So rather than two isolated stacks, the work splits into three pipelines where the largest one is shared:

| Pipeline | Covers | Source | Coverage | Caching | Needs a key |
| --- | --- | --- | --- | --- | --- |
| **A** | 611 single-site | Nominatim → Photon | ~90% | permanent, committed | no |
| **B** | 412 chains | Overpass tag matching | ~35–40% | permanent, committed | no |
| **C** | 412 chains | Google Places Text Search | ~70–90% | ≤30 days, git-ignored | yes |

Two pages consume them, and they are **not equal deliverables**:

- **`poc/buyme-map-google.html`** — Google Maps JS, fed by **A + C**. **The target.** The only combination whose coverage holds up outside Tel Aviv, which is what a location-and-radius search requires.
- **`poc/buyme-map-osm.html`** — Leaflet + OSM tiles, fed by **A + B**. **A development scaffold.** It needs no key, so the whole interaction — location input, radius filtering, brand search, provenance labelling — can be built and verified before any billing account exists.

An earlier draft of this document had these the other way around, treating the Leaflet page as the primary deliverable and Google as an optional upgrade. The per-location coverage measurements above overturned that: the free page is a Tel Aviv application, and shipping it as though it covered Israel would be the misleading-by-omission failure this design otherwise takes care to avoid. It is retained because building it first is genuinely the fastest route to a working Google page, not because it is a fallback anyone should rely on.

Pipeline A is built once and feeds both, and it is the reason the free half is still worth having: those ~550 single-site brands are geocoded free, permanently cacheable, and display fine on a Google map. **Google is only ever asked to fill the chain gap**, which is what keeps call volume at roughly a quarter of the free allowance.

The rule that keeps it licence-clean is narrower than "never mix", but it is absolute: **no Google-derived coordinate may reach the Leaflet page, and no Google-derived coordinate may be committed.** OSM-derived coordinates travelling onto the Google page are permitted and expected.

One caveat recorded deliberately: ODbL's share-alike obligations attach to *distributing* a derived database, not to rendering one locally. These pages are local files. Publishing or hosting either page — or committing Pipeline C's output — puts that question back on the table and must be re-examined rather than assumed settled.

## Pipeline A — single-site geocoding (shared)

`scripts/resolve-buyme-addresses.mjs` → `poc/buyme-addresses.json` (committed)

The foundation both pages stand on, and the only pipeline whose output is trusted without caveat.

1. **BuyMe brands** — one request, the same endpoint the existing scraper uses.
2. **Geocode the 611** through the cascade: exact string → drop a leading venue name when a later segment looks like a street → last two comma segments → strip `רחוב`/`קניון`/`מתחם` noise → city only. Nominatim first at ≤1 request/second per its usage policy with an honest User-Agent; Photon as fallback.

Results are cached on disk keyed by the address string, so re-runs are resumable and cost nothing. The run is ~12–20 minutes, dominated entirely by Nominatim's rate limit rather than by any work this code does.

Every resolved point records **which cascade variant produced it**. A city-only fallback is a real coordinate but a coarse one, and the page must be able to say so rather than presenting it as a street address.

Google Geocoding would reach ~99% here instead of ~90%, for 611 of its 10,000 free monthly calls. It is deliberately not used: that 9% would make the most reliable data in the system perishable under the 30-day rule and unusable without a key. Permanence is worth more than the accuracy here.

## Pipeline B — chains via OpenStreetMap (free page)

`scripts/resolve-buyme-chains-osm.mjs` → `poc/buyme-chains-osm.json` (committed)

Branch discovery costs **one request**, not 412:

1. **One Overpass query** for every named shop and key amenity in Israel — 12,755 objects, cached to disk.
2. **Match locally** per the rules above: brand `name` + `heName` against the six OSM tags, anchored.

Querying Overpass once per chain would mean 412 requests with politeness gaps, roughly three hours, and repeated load on a free service. One dump plus local matching runs in seconds, and — the more important benefit — **matching becomes tunable offline**, so precision work costs nothing and hits no rate limit. Given that anchoring and alias matching are the levers that move coverage most, being able to iterate on them without a network round trip is what makes tuning them practical at all.

## Pipeline C — chains via Google Places (Google page)

`scripts/resolve-buyme-chains-google.mjs` → `poc/buyme-chains-google.json` (git-ignored)

Text Search per chain, paginated to 60. The ~50 largest chains partition across BuyMe's own 15 `supplier_regions` to get past the 60-result cap, which lands the total near ~3,300 calls — still inside the free allowance.

**Inert without a key.** `GOOGLE_PIPELINE_API_KEY` absent means the script explains what is missing and exits, exactly as `scrape-buyme-merchants.mjs` already treats `ANTHROPIC_API_KEY` as optional. Obtaining the key and enabling billing is a manual step for the repository owner; nothing here creates accounts or handles credentials.

The output carries its own `generatedAt` and is git-ignored, because committing it would be the 30-day caching violation in durable form.

### What the free tiers actually allow

Checked against Google's published pricing rather than assumed, because an earlier draft of this document treated Google as a cost centre and that shaped the whole build order wrongly:

| SKU | Tier | Free per month |
| --- | --- | --- |
| Places Autocomplete (**per session**) | Essentials | **unlimited, no charge** |
| Dynamic Maps (Maps JavaScript loads) | Essentials | 10,000 |
| Geocoding | Essentials | 10,000 |
| Places Text Search (this pipeline) | Pro | 5,000 |

At personal-wallet volumes every one of these is free. The pipeline's ~1,236–3,300 Text Search calls sit inside the 5,000, and session-based Autocomplete has no cap at all.

**Two keys, not one**, because their exposure differs by orders of magnitude. `GOOGLE_PIPELINE_API_KEY` lives in `.env.local` (already git-ignored) and is restricted to the Places API; it never reaches a browser. `GOOGLE_PAGE_API_KEY` is embedded in the generated page and is therefore visible to anyone who opens the file, so it is restricted to Maps JavaScript + Places + Geocoding and capped by a daily quota. A `file://` page sends no referrer, so HTTP-referrer restriction is unavailable and the quota cap is the real ceiling on damage.

### Refresh, and why CI cannot do it

The 30-day caching limit is handled by **regenerating the data, not by guarding the page against staleness** — fixing the cause rather than the symptom.

That refresh cannot live in GitHub Actions, which is where this project's other scheduled work sits. A CI job would have to commit its output for the result to be useful, and committing Google-derived coordinates is exactly the durable violation the git-ignore exists to prevent. The refresh therefore runs **on the machine that opens the page**, writing only local, git-ignored files: `scripts/refresh-google-data.mjs` re-runs Pipeline C and rebuilds the page, driven by an OS-level scheduled task.

A stale page is consequently possible if that task silently stops. The page carries its `generatedAt` in the coverage line so the condition is visible rather than invisible; hard-refusing to render past 30 days was considered and deliberately not taken, on the grounds that the refresh is the control and a second mechanism guarding the same rule invites both being half-maintained.

## The pages

`poc/buyme-map-osm.html` and `poc/buyme-map-google.html`. Local files opened directly — not Claude Artifacts, whose CSP blocks external map tiles and would rule out a real slippy map.

### The search interaction

The page's primary control is a **location field and a radius**, not a map to pan. Typing a location and choosing a radius produces a result list of stores accepting BuyMe within it, sorted by distance, with the matching pins shown on the map.

**Resolving the typed location** is a geocode of one string per search. On the scaffold this is Nominatim, **called on submit rather than per keystroke** — Nominatim's usage policy discourages autocomplete-style querying, and one request per search is comfortably within it. The consequence is a deliberate one: no type-ahead dropdown.

**The Google page uses Places Autocomplete, and this is the feature's largest day-to-day difference** — larger, in ordinary use, than the coverage gain that motivated the switch. The scaffold makes you know a location's name and type it in full; autocomplete lets you find it by prefix. It is session-based, which is the variant Google charges nothing for at any volume, so the constraint that forced on-submit geocoding on the scaffold simply does not exist here.

Autocomplete supplies the chosen place's coordinates directly, so the Geocoding API is only a fallback for a location typed in full and submitted without picking a suggestion. Place Details, Directions and travel-time were all considered and deliberately excluded: each is free at this volume, and each would widen the page past the one question it exists to answer.

**Radius filtering is client-side haversine** over the fully preloaded dataset. No query hits the network once the location is resolved, so radius changes are instant and the page works offline after first load. This is identical on both pages, which is part of why the renderer swap is cheap.

Radii offered are 500m / 1km / 2km / 5km. The measurements above are what set that range: below 500m even Tel Aviv returns single digits, and beyond 5km "nearby" stops meaning anything.

**An empty result must never be stated as an absence.** Zero matches renders as "no stores found in our data within Xm" together with the coverage note for that area — never as "no stores accept BuyMe here". This is the single most important honesty requirement on the page, because the radius interaction makes a confident negative the default reading, and outside Tel Aviv that negative is frequently wrong.

### Presentation

Both render the same shape: a map with clustered pins, and a result list searchable by brand name in Hebrew or Latin.

**Each brand states its provenance and its uncertainty.** A chain row reads `16 branches via OpenStreetMap — likely incomplete`; a city-only geocode is marked as approximate. This is a requirement, not decoration. At 35–40% chain coverage a page that implies completeness is actively misleading — it would show no adidas near you while an adidas is 200m away. Stating the source and its limits is what makes a partial dataset honest rather than wrong.

Online-only merchants are listed separately, not dropped: "spendable, but not anywhere in particular" is a true and useful answer.

Because the two pages differ only in their chain source and their renderer, the sidebar, search, provenance labelling and brand-grouping logic are written once in a shared module and included by both. The Google page is then a thin variant, not a second implementation.

## Build order

**The scaffold first** — Pipeline A, Pipeline B, and `buyme-map-osm.html` — then swap in Pipeline C and the Google renderer.

Almost everything the feature consists of is renderer-agnostic: Pipeline A's geocoding cascade, the location-input geocode, the haversine radius filter, distance sorting, brand search, provenance labelling and the empty-result handling. None of it cares where a chain coordinate came from. Building it against OSM data needs no key, no billing and no account, so the entire interaction can be proven while the Google credentials are still being set up.

Pipeline C is by comparison trivial — an API that returns coordinates directly, with no matching or geocoding step at all. Swapping it in exchanges one input file for another against a page already known to work.

Going straight to Google instead would block every line of progress on a manual credential step that only the repository owner can perform, in order to skip building the easy half of the work.

Verification for the swap is concrete: **the Beer Sheva query is the acceptance test.**

## Implementation status — scaffold built and measured

The scaffold shipped. Its measured results correct several projections above, and the corrections matter more than the projections did:

| | Projected | **Measured** |
| --- | --- | --- |
| Single-site brands located | ~90% | **594 / 610 (97%)** |
| Chain branches | ~2,500 | **818** |
| Chains with any location | — | 163 of 484 candidates |
| Total mapped locations | ~3,000 | **1,412** |
| Beer Sheva @1km | 1 (OSM-only probe) | **8** |

**The chain projection was 3× optimistic, and the cause was selection bias in my own sampling.** The ten chains measured during feasibility were the largest and best-mapped in the country; the catalogue's long tail is far worse covered. Only a third of chain candidates match anything in OSM at all. This weakens the free-data case and is the strongest single argument for Pipeline C.

**364 of 1,304 merchants (28%) are placed nowhere** — 321 physical chains absent from OSM, 16 addresses that never geocoded, 27 with no region data. The page states this in its coverage line rather than implying its dataset is the catalogue.

**The Beer Sheva acceptance number is therefore 8, not 1.** Pipeline A's geocoded single-site businesses supply seven of those eight. Google must beat 8 to justify its key, billing and monthly refresh.

One implementation lesson worth recording, because it was reasoned about wrongly and only a real test caught it: **a `file://` page cannot load a local `<script src>` subresource.** The bundle-as-classic-script design was correct that `fetch()` of local JSON is blocked, but wrong that a script tag escapes the same restriction — the map rendered while every count read zero. The data is now injected directly into the page between markers, leaving no subresource to block. The Google page must be built the same way.

A second lesson, cheaper to state than it was to find: OSM's Israeli coverage is not one thing. Nominatim reads street data, which is dense; Overpass reads shop/POI objects, which are sparse. The scaffold's own Overpass query also asked only for `shop=*` and seven `amenity` values, missing `tourism=hotel` (487 objects), `tourism=museum` (227), `tourism=guest_house` (207) and more — tag families that map directly onto the unmapped merchants' categories. Widening it is the remaining free lever, unbuilt.

## Risks

- **False positives survive anchoring.** אייס went from 190% to 60%, which is plausible but unverified per-branch. Output needs a review sweep against real data before the page is trusted — the same discipline the Jah Spa regression established in `2026-08-28-store-autocomplete-directories-design.md`.
- **Geocodes are street-level, not venue-level.** Nominatim returned `bus_stop`, `residential` and `marina` objects for valid addresses. The pin lands on the right street, not the shop door.
- **Both free services are rate-limited and occasionally fail.** Overpass returned 504s and 429s during measurement. Disk caching plus retry-with-backoff is what makes a long run resumable rather than restartable.
- **Chain branch counts are unknown.** Coverage percentages here use estimated denominators; the page can honestly say "16 found", never "16 of 40".
- **Google's own coverage outside Tel Aviv is assumed, not measured.** The ~70–90% figure comes from Places' general completeness, and the geographic gradient that broke OSM has not been re-tested against Google. The Beer Sheva acceptance test in *Build order* exists precisely to catch this before the design is trusted.
- **Pipeline C's output expires.** A stale git-ignored file is indistinguishable from a fresh one at a glance; it carries `generatedAt` so the page can refuse to present data older than 30 days rather than silently serving expired results.

## Out of scope

- Any app integration — no `expo-location`, no screen, no `src/data/` change, no bundle impact.
- Per-chain website scrapers, and anything that circumvents bot protection.
- Mall directory scraping (documented above as a future lever).
- Paid API usage beyond the free allowances.
- Reading the device's real position. The location is **typed**; distance and radius are computed from that typed point. Geolocation is a plausible later addition and changes nothing about the data or the filtering.
- Routing, directions or travel time — distance is straight-line only.
- Any change to the existing merchant refresh workflow or `buyme-all-merchants.json`.

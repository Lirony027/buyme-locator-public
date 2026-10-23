# The Google page

`poc/buyme-map-google.html` is generated, git-ignored, and carries a public
API key plus Google-derived coordinates. Do not commit it.

## Keys

Both live in `.env.local` (git-ignored):

    GOOGLE_PIPELINE_API_KEY=...   # server-side, Places API only, never in a page
    GOOGLE_PAGE_API_KEY=...       # embedded in the page, therefore public

The page key cannot be referrer-restricted, because a `file://` page sends no
referrer. Restrict it by API (Maps JavaScript API + Places API (New)) and set a
daily quota cap — the cap, not the restriction, is what bounds the damage.
Step-by-step setup: `docs/google-api-keys.md`.

## Refreshing

Google forbids keeping its coordinates beyond 30 days, so the data must be
regenerated. This cannot run in CI: a CI job would have to commit its output
to be useful, which is exactly the violation `.gitignore` prevents.

    node scripts/refresh-google-data.mjs

It is a no-op if the data is under 21 days old; pass `--force` to override.

### Scheduling it (Windows)

Run once, in an elevated PowerShell, from the repository root:

    $action  = New-ScheduledTaskAction -Execute "node" `
                 -Argument "scripts/refresh-google-data.mjs" `
                 -WorkingDirectory (Get-Location).Path
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
    Register-ScheduledTask -TaskName "BuyMe Google data refresh" `
                 -Action $action -Trigger $trigger

Weekly against a 21-day threshold means three chances to catch up before the
30-day limit is reached, so one missed run is not a compliance problem.

Check it ran:

    Get-ScheduledTaskInfo -TaskName "BuyMe Google data refresh"

## The Swish pipeline

Swish is the third source on the page. Unlike BuyMe and תו הזהב, it needs no
Google key and consumes no Places quota — the only key involved anywhere in
this chain is `GOOGLE_PAGE_API_KEY`, which the page itself needs regardless
of source. Run in this order:

    node scripts/fetch-swish-payloads.mjs
    node scripts/fetch-swish-logos.mjs
    node scripts/resolve-swish-addresses.mjs
    node --env-file=.env.local scripts/build-google-page.mjs

`poc/swish-locations.json` and `poc/logos-swish/` are **committed on
purpose** — unlike their תו הזהב and BuyMe equivalents, which are
git-ignored. Nothing in the Swish output is Google-derived, so none of the
licensing/retention concerns that force the other two sources out of the
repo apply here.

Note: `poc/swish-locations.json` alone is not enough to rebuild the page —
chain metadata (types, aliases, tiers, logos) lives in the git-ignored
`poc/.cache/swish-chains.json`, so a fresh checkout must re-run
`fetch-swish-payloads.mjs` (which always includes the ~18-minute branch
crawl) before `build-google-page.mjs` will succeed.

The chain-and-branch crawl in `fetch-swish-payloads.mjs` is resumable: it
writes each chain's branch list to its own cache file as it goes, so a
re-run after a failure (network blip, kill, whatever) skips every chain
that's already cached and only retries what's missing.

Swish invokes React Server Actions with ids that are derived from the live
bundle on every run, not hardcoded (see `poc/lib/swish-api.mjs`). If Swish
redesigns their site and the derivation stops matching, the fetch aborts
with an explicit "Could not derive the server-action id for ... " error —
it does not silently return an empty catalogue.

`scripts/build-google-page.mjs` calls `buildSwishCatalogue()`, which throws
if `poc/.cache/swish-chains.json` is missing, so `scripts/refresh-google-data.mjs`
(which ends by calling the page builder) now depends on the Swish cache
existing — the same coupling `buildTavCatalogue()` already introduced for
תו הזהב. **Swish is deliberately not added to `refresh-google-data.mjs`'s
own script list.** That script is gated on Google's 21-day staleness and
begins by deleting the Places cache; folding Swish into it would mean Swish
only refreshes when Google happens to be stale, and would invite someone to
later extend the cache-clearing to `poc/.cache/swish-geocode.json` — which
has no expiry, cost hours of Nominatim calls to build, and has no reason to
ever be cleared automatically. Swish refreshes on its own schedule, by
running the four commands above.

### Measured figures (from the live run this pipeline was built against)

- **Chains**: 1,051 distinct chains (999 on the Plus card, 1,049 on
  Premium).
- **Tier split** (all 1,051 chains): 991 both cards, 5 Plus-only, 55
  Premium-only. Restricted to the 995 chains that actually place a pin, the
  split narrows to 5 Plus-only and 52 Premium-only (tier badges are sparse
  by design — most chains carry no tier tag because they're on both cards).
- **Branches**: 6,947 branches crawled across the 1,051 chains (mean 6.6 per
  chain); 35 of those carry no usable address and are excluded before
  geocoding.
- **Geocode rate**: a 300-address deterministic sample geocoded at 99.0%
  before committing to the full run; the full run against all 6,912 usable
  addresses geocoded at 99.7% (6,893 resolved, 19 missed) — consistent with
  the sample, on the favorable side.
- **Placed locations**: 6,893 locations across 995 chains end up on the
  page.

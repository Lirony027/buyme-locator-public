# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single generated web page — a Google Map of where BuyMe, תו הזהב (Tav HaZahav) and Swish gift cards can be used, for BuyMe sales staff. Plain Node ESM scripts (`.mjs`), no dependencies, no bundler. Node 20+.

Live: https://poc-six-taupe.vercel.app/buyme-map-google.html

## Commands

```bash
npm test                                   # all lib tests (node --test "poc/lib/*.test.mjs")
node --test poc/lib/geocode.test.mjs       # one test file
node --test --test-name-pattern="venue name" poc/lib/address-variants.test.mjs   # one test
npm run build                              # regenerate poc/buyme-map-google.html (needs .env.local)
npm run refresh:google                     # re-pull BuyMe Google data; no-op if <21 days old, --force to override
npm run refresh:merchants                  # re-scrape BuyMe's merchant list into data/buyme-all-merchants.json
npm run deploy                             # publish poc/ to Vercel
```

Scripts that call Google need `node --env-file=.env.local ...` (keys: `GOOGLE_PIPELINE_API_KEY` server-side Places only; `GOOGLE_PAGE_API_KEY` embedded in the page, therefore public). Nothing redeploys automatically: after refreshing a source, build, deploy, then check the live page lists every source in its dropdown.

## Architecture

**Pipeline shape.** Per source: `scripts/fetch-*` (raw upstream payloads → `poc/.cache/`) → `scripts/resolve-*` (addresses → coordinates) → `scripts/catalogues/<source>.mjs` (assembles `{label, locations, unmappedCount, catalogueSize, generatedAt, ...}`) → `scripts/build-google-page.mjs`, which builds all three catalogues and **injects** them as `window.CATALOGUES` between the `/* BUYME_DATA_START */` / `/* BUYME_DATA_END */` markers in `poc/google-page-template.html` (inlined, not linked, because the page must also work from `file://`). The build fails if any source's inputs are missing — every catalogue throws "Missing X. Run its resolver script first."

**Testable logic lives in `poc/lib/`** (pure functions + `node:test` tests next to them); `scripts/` are thin I/O drivers around it. Tests stub network via injected `fetchImpl`, never hit live services.

**Sources differ in geocoding and in what may be committed:**
- **BuyMe** — chains from `data/buyme-all-merchants.json` (curated Hebrew names; `scripts/buyme-hebrew-name-overrides.json`), addresses in `poc/buyme-addresses.json`, coordinates from Google Places (`resolve-buyme-chains-google.mjs`) into git-ignored `poc/buyme-chains-google.json`.
- **תו הזהב** — `fetch-tav-payloads` → `resolve-tav-addresses` (committed `poc/tav-addresses.json`) → `resolve-tav-locations-google` (git-ignored `tav-locations-google.json`).
- **Swish** — no Google at all: Nominatim/Photon geocoding (`poc/lib/geocode.mjs`, rate-limited). Run order: `fetch-swish-payloads` → `fetch-swish-logos` → `resolve-swish-addresses` → build. `poc/swish-locations.json` and `poc/logos-swish/` are committed, but the build also needs git-ignored `poc/.cache/swish-chains.json`, so a fresh checkout must re-run the ~18-min (resumable) fetch. Swish server-action ids are derived from the live bundle each run (`poc/lib/swish-api.mjs`) and fail loudly if the derivation breaks.
- `buyme-map-osm.html` / `build-poc-data.mjs` / `resolve-buyme-chains-osm.mjs` are the older OSM-based page, not deployed.

**Places quota** is shared across sources via `poc/lib/call-budget.mjs` (`createBudget(ceiling, spentAlready)`) — don't give a resolver its own independent limit.

## Constraints that shape the code

- **Google's 30-day retention rule.** Google-derived coordinates and the generated page (which embeds them plus the public key) are git-ignored and must stay that way; `poc/.vercelignore` keeps raw JSON off the deployment too. The refresh cannot run in CI for the same reason. `refresh-google-data.mjs` clears the Places cache and is deliberately *not* extended to Swish — never make it clear `poc/.cache/swish-geocode.json` (no expiry, hours of Nominatim calls to rebuild).
- **Never cross-reference sources.** The catalogues are built independently; merging chains across BuyMe/Tav/Swish risks attributing one card's coverage to another — the worst bug for a sales tool.
- Use `fileURLToPath`, not `URL.pathname`, for filesystem paths (Windows).

## Further docs

- `README.md` — keys, the refresh schedule and per-source refresh steps; `poc/README-google.md` — older notes on keys and the Swish pipeline.
- `docs/superpowers/specs/` — design specs per source.

# Getting the Google API keys

Building the map needs **your own Google Cloud project with billing enabled** and
**two API keys**. The keys used by the live deployment are not shared. Keep them
separate, because one ends up public:

| Key | Goes in `.env.local` as | Used by | Visibility |
|---|---|---|---|
| Pipeline key | `GOOGLE_PIPELINE_API_KEY` | `resolve-buyme-chains-google.mjs`, `resolve-tav-locations-google.mjs` (server-side Places Text Search) | Secret: never put it in a page |
| Page key | `GOOGLE_PAGE_API_KEY` | Written into `poc/buyme-map-google.html` by the build | **Public**: anyone who opens the page can read it |

Only two Google APIs are used:

- **Places API (New)**: Text Search from the pipeline, and the address search box
  (`gmp-place-autocomplete`) on the page.
- **Maps JavaScript API**: the map itself, with advanced markers.

## 1. Create a project and turn on billing

1. Open https://console.cloud.google.com and sign in.
2. In the project picker at the top, choose **New project**, name it (e.g.
   `buyme-locator`) and create it. Make sure it is the selected project for the rest of
   these steps.
3. Go to **Billing** and link a billing account. Google Maps Platform requires one even
   when your usage stays inside the free monthly allowance.

## 2. Enable the two APIs

Go to **APIs & Services → Library**, search for each of the following and click
**Enable**:

- **Places API (New)**. Make sure it's this one and not the legacy "Places API".
  The pipeline calls `places.googleapis.com/v1/places:searchText`, which only the
  new API serves.
- **Maps JavaScript API**

## 3. Create the pipeline key

1. **APIs & Services → Credentials → Create credentials → API key.**
2. Open the new key (**Edit API key**), rename it e.g. `buyme-locator pipeline`.
3. **API restrictions → Restrict key →** tick **Places API (New)** only.
4. **Application restrictions**: leave **None**, unless the refresh always runs from a
   fixed public IP, in which case choose **IP addresses** and add it.
5. Save, and copy the key into `.env.local` as `GOOGLE_PIPELINE_API_KEY=...`.

## 4. Create the page key

1. Create a second API key the same way and rename it e.g. `buyme-locator page`.
2. **API restrictions → Restrict key →** tick **Maps JavaScript API** and
   **Places API (New)**.
3. **Application restrictions**:
   - **None** if the page will be opened from disk (`file://`). A file opened from
     disk sends no referrer, so a website restriction would block it.
   - **Websites** if it will only ever be served from your own domain. Add e.g.
     `https://your-project.vercel.app/*`. This is the safer choice, but the page will
     then no longer work when opened from disk.
4. Save, and copy the key into `.env.local` as `GOOGLE_PAGE_API_KEY=...`.

## 5. Cap the usage

The page key is public, so a **daily quota is what bounds the cost** if someone reuses
it. Budget alerts only warn you; they do not stop spending.

1. **APIs & Services → Enabled APIs & services →** open each API **→ Quotas & System
   Limits**, and lower the per-day limits to what you expect to use:
   - **Maps JavaScript API**: map loads per day.
   - **Places API (New)**: requests per day. A full BuyMe or תו הזהב refresh spends
     up to 4,500 Text Search calls (the scripts enforce this ceiling themselves via
     `poc/lib/call-budget.mjs`), so leave headroom for a refresh day.
2. **Billing → Budgets & alerts**: add a monthly budget with an email alert.

Pipeline requests are billed as Places **Text Search** (the field mask asks for name,
address and location). Google gives a free monthly allowance per SKU. Check the
current numbers at https://mapsplatform.google.com/pricing before a first full refresh.

## 6. Use them

```bash
cp .env.example .env.local      # then paste both keys in
```

Then run the full refresh once and build: see "Refreshing the data" in the README.

## Map ID

The page creates its map with `mapId: 'DEMO_MAP_ID'`, Google's built-in ID for
development, which advanced markers require. It needs no setup. For a production
deployment you can create your own under **Google Maps Platform → Map management** and
replace it in `poc/google-page-template.html`.

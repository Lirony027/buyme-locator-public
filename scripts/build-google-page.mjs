#!/usr/bin/env node
import fs from 'node:fs';
import { buildBuymeCatalogue } from './catalogues/buyme.mjs';
import { buildTavCatalogue } from './catalogues/tav.mjs';
import { buildSwishCatalogue } from './catalogues/swish.mjs';

const ROOT = new URL('..', import.meta.url);
const TEMPLATE = new URL('poc/google-page-template.html', ROOT);
const OUTPUT = new URL('poc/buyme-map-google.html', ROOT);

const API_KEY = process.env.GOOGLE_PAGE_API_KEY || '';
if (!API_KEY) {
  console.error(
    'GOOGLE_PAGE_API_KEY is not set.\n\n' +
      'This is the BROWSER key, embedded in the generated page and therefore\n' +
      'public. It must be a different key from GOOGLE_PIPELINE_API_KEY, restricted\n' +
      'to Maps JavaScript + Places + Geocoding and capped by a daily quota.\n' +
      'Put it in .env.local and run with --env-file=.env.local'
  );
  process.exit(1);
}

const catalogues = {
  buyme: await buildBuymeCatalogue(),
  tav: await buildTavCatalogue(),
  swish: await buildSwishCatalogue(),
};
const payload = JSON.stringify(catalogues);
const scriptSafe = payload.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

const START = '/* BUYME_DATA_START */';
const END = '/* BUYME_DATA_END */';
let html = fs.readFileSync(TEMPLATE, 'utf-8');

const startAt = html.indexOf(START);
const endAt = html.indexOf(END);
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  throw new Error(`Could not find the ${START} / ${END} markers in the template`);
}

// Injected, not linked: a file:// page cannot load a local <script src>
// subresource — verified on the scaffold, where the map rendered while every
// count read zero.
html =
  html.slice(0, startAt + START.length) +
  `\nwindow.CATALOGUES = ${scriptSafe};\n` +
  html.slice(endAt);
html = html.replace('__GOOGLE_PAGE_API_KEY__', API_KEY);

fs.writeFileSync(OUTPUT, html);

for (const catalogue of Object.values(catalogues)) {
  const ageDays = Math.floor((Date.now() - new Date(catalogue.generatedAt)) / 86400000);
  console.log(
    `  ${catalogue.label}: ${catalogue.locations.length} locations, ` +
      `${catalogue.unmappedCount} of ${catalogue.catalogueSize} unmapped, ` +
      `${ageDays} day(s) old (must be refreshed within 30).`
  );
  if (catalogue.missingLogos) {
    console.log(
      `    ${catalogue.missingLogos} logo(s) fall back to a plain pin — run scripts/fetch-buyme-logos.mjs`
    );
  }
}

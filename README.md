# Terrapedia

Countries, former states and history, answered by **Chronos**, a small search engine that runs entirely in your browser.

**Live demo:** https://preethambollineni2013.github.io/Terrapedia/

## What it does

- Search by name, topic or question.
- Browse entries in three groups: countries, former states (such as the Soviet Union or Austria-Hungary) and history (events and eras).
- Compare two entries side by side, with typo correction ("Showing results for...") and autocomplete.
- Every answer names the sources behind it. The **Sources** tab lists all providers and what each is used for.
  
## Easter egg

There is a hidden way to take the page away and explore that Earth yourself. It is not listed anywhere on the site, and I am not going to tell you how to trigger it.

## Run it locally

It is a site built with HTML, So Download all files in one folder and run index.html.

The globe needs internet access for the Cesium library and the satellite imagery.This is important. Everything else works offline.

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Page layout: heading, search bar, filter chips, results, footer |
| `style.css` | All styling |
| `data.js` | The knowledge base: every country, former state and history entry |
| `search.js` | Chronos: indexing, ranking, typo fixing, direct answers, autocomplete |
| `sources.js` | Which providers back each answer, and the Sources page |
| `app.js` | Reads the search box and draws results and entry pages |
| `earth-mode.js` | The Easter egg logic (go read it) |
| `globe.js` | The Earth background: loads CesiumJS and satellite imagery, with fallbacks and error recovery |

## Credits

- Copyright 2026 Terrapedia. Built by Preetham.
- Globe: [CesiumJS](https://cesium.com/platform/cesiumjs/).

- Imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics), with NASA Blue Marble as a fallback.
- Facts and figures are summarised from the reference providers listed on the Sources tab. Figures are rounded and can lag the latest releases, so check the provider for current numbers.

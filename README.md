# Terrapedia

Countries, former states and history, answered by **Chronos**, a small search engine that runs entirely in your browser.

**Live demo:** https://preethambollineni2013.github.io/Terrapedia/

## What it does

- Search by name, topic or question: `capital of Japan`, `when did the Berlin Wall fall`, `India vs Brazil`, `largest country`, `1945`.
- Browse entries in three groups: countries, former states (such as the Soviet Union or Austria-Hungary) and history (events and eras).
- Compare two entries side by side, with typo correction ("Showing results for...") and autocomplete.
- Every answer names the sources behind it. The **Sources** tab lists all providers and what each is used for.
- A satellite Earth sits behind the page as the background.

## Easter egg

There is a hidden way to take the page away and explore that Earth yourself. It is not listed anywhere on the site, and I am not going to tell you how to trigger it.

Find it yourself by reading the code. Start with `earth-mode.js`, then follow it into `globe.js`.

If the globe cannot load (offline, blocked CDN, no WebGL), the page keeps its plain dark background and nothing breaks. Problems are logged to the browser console with the prefix `Terrapedia globe`.

## Run it locally

It is a static site, so there is nothing to build.

```bash
git clone https://github.com/preethambollineni2013/Terrapedia.git
cd Terrapedia
python3 -m http.server 8000
```

Then open http://localhost:8000. You can also open `index.html` directly, but a local server is more reliable.

The globe needs internet access for the Cesium library and the satellite imagery. Everything else works offline.

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

## Adding an entry

Open `data.js` and add a line using one of three helpers: `C` (country), `F` (former state) or `H` (history).

```js
C("id", "Name", ["alias", "another alias"], ["tag", "tag"], "Region",
  "One-sentence summary.",
  { Capital: "...", Population: "about ...", Area: "... km²", Languages: "...", Currency: "...", Continent: "..." },
  [[1900, "Something happened"], [1950, "Something else happened"]]),
```

Tips:

- Give each entry a unique `id`.
- Add common alternative names as aliases (for example `czech republic` for Czechia). A longer name wins over shorter ones inside it, so "Austria-Hungary" does not also match "Austria" and "Hungary".
- Keep population and area figures rounded and prefixed with "about" where they are estimates.
- For former states, use historical figures tied to a year and say so in the value.

## Credits

- Copyright 2026 Terrapedia. Built by Preetham.
- Globe: [CesiumJS](https://cesium.com/platform/cesiumjs/).
- Imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics), with NASA Blue Marble as a fallback.
- Facts and figures are summarised from the reference providers listed on the Sources tab. Figures are rounded and can lag the latest releases, so check the provider for current numbers.

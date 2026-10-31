// sources.js
// Who provides the information behind each answer.
// Every entry part (summary, timeline, a single fact) maps to one or more providers.
// Chronos reports which parts it used, and the page turns that into a source line.

const Sources = (function () {

  const PROVIDERS = {
    factbook: {
      name: "CIA World Factbook",
      url: "https://www.cia.gov/the-world-factbook/",
      kind: "Government reference",
      covers: "Capitals, area, languages, currencies and continents"
    },
    unpd: {
      name: "UN World Population Prospects",
      url: "https://population.un.org/wpp/",
      kind: "Intergovernmental statistics",
      covers: "Population figures"
    },
    worldbank: {
      name: "World Bank Open Data",
      url: "https://data.worldbank.org/",
      kind: "Intergovernmental statistics",
      covers: "Population figures (cross-check)"
    },
    britannica: {
      name: "Encyclopaedia Britannica",
      url: "https://www.britannica.com/",
      kind: "Encyclopedia",
      covers: "Summaries, timelines and historical eras"
    },
    unesco: {
      name: "UNESCO Silk Roads Programme",
      url: "https://www.unesco.org/en/silkroad",
      kind: "Intergovernmental programme",
      covers: "Silk Road routes, goods and history"
    },
    ofhist: {
      name: "US State Department, Office of the Historian",
      url: "https://history.state.gov/",
      kind: "Government history office",
      covers: "Cold War events and diplomacy"
    },
    nww2: {
      name: "The National WWII Museum",
      url: "https://www.nationalww2museum.org/",
      kind: "Museum",
      covers: "World War II events and dates"
    },
    loc: {
      name: "Library of Congress Country Studies",
      url: "https://www.loc.gov/collections/country-studies/",
      kind: "National library",
      covers: "Soviet Union and Yugoslavia country profiles (1980s and 1990s)"
    },
    wilson: {
      name: "Wilson Center Digital Archive",
      url: "https://digitalarchive.wilsoncenter.org/",
      kind: "Research archive",
      covers: "Primary documents on the Soviet Union and the Cold War"
    },
    dhm: {
      name: "Deutsches Historisches Museum",
      url: "https://www.dhm.de/",
      kind: "Museum",
      covers: "Prussian and German history"
    },
    science: {
      name: "Science Museum Group",
      url: "https://www.sciencemuseumgroup.org.uk/",
      kind: "Museum",
      covers: "Industrial Revolution technology"
    }
  };

  // Extra providers for specific history and former-state entries (Britannica is always added)
  // Dissolved states have no live database, so their figures are historical
  // estimates tied to a year (a census or a peak) and come from reference works.
  const HISTORY_EXTRA = {
    "soviet-union": ["loc", "ofhist", "wilson"],
    "yugoslavia": ["loc"],
    "prussia": ["dhm"],
    "silk-road": ["unesco"],
    "cold-war": ["ofhist", "wilson"],
    "world-war-ii": ["nww2"],
    "industrial-revolution": ["science"]
  };

  const FACT_PROVIDERS = { Population: ["unpd", "worldbank"] };

  // part is "summary", "timeline" or "fact:Key"
  function idsFor(entry, part) {
    if (entry.type === "country") {
      if (part.indexOf("fact:") === 0) return FACT_PROVIDERS[part.slice(5)] || ["factbook"];
      return ["britannica"];
    }
    return (HISTORY_EXTRA[entry.id] || []).concat(["britannica"]);
  }

  function describe(id) {
    return Object.assign({ id: id }, PROVIDERS[id]);
  }

  // used: [{ entry, part }]  ->  unique provider list, in order of first use
  function cite(used) {
    const seen = [];
    used.forEach(function (u) {
      idsFor(u.entry, u.part).forEach(function (id) {
        if (seen.indexOf(id) < 0) seen.push(id);
      });
    });
    return seen.map(describe);
  }

  // Everything one entry page draws on
  function forEntry(entry) {
    const parts = ["summary", "timeline"].concat(Object.keys(entry.facts).map(function (k) { return "fact:" + k; }));
    return cite(parts.map(function (part) { return { entry: entry, part: part }; }));
  }

  // Directory: each provider with the entries it supports
  function directory() {
    return Object.keys(PROVIDERS).map(function (id) {
      const entries = DATA.filter(function (entry) {
        return forEntry(entry).some(function (p) { return p.id === id; });
      }).map(function (entry) { return entry.name; });
      return Object.assign(describe(id), { entries: entries });
    });
  }

  function linkHtml(p) {
    return '<a href="' + p.url + '" target="_blank" rel="noopener noreferrer">' + p.name + "</a>";
  }

  return { cite: cite, forEntry: forEntry, directory: directory, linkHtml: linkHtml };
})();

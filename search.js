// search.js
// Chronos: the search brain of Terrapedia.
// Reads DATA once, builds an index, and answers from it. No API, no internet.
//
// What it does:
//  1. Normalises words (stemming, irregular verbs, synonyms) the same way for
//     the index and for the question, so "fell" finds "falls" and "people" finds "population".
//  2. Fixes typos against real words in the data, and shows "did you mean".
//  3. Ranks entries with BM25 plus a bonus for entries named in the question.
//  4. Answers directly: facts, comparisons, rankings, years and ranges, events, eras.
//  5. Reports which part of an entry each answer used, so the page can cite sources.

const Chronos = (function () {

  // ---------- vocabulary tables ----------

  const STOP_WORDS = new Set(
    ("a an the of in on at to is are was were be been and or for with about what whats who when where which how " +
     "tell me show give explain do does did it its this that from by as please can you i my there than then into " +
     "vs versus compare compared difference between most least highest lowest").split(" ")
  );

  // main word -> words that mean the same
  const SYNONYMS = {
    country: ["nation"],
    population: ["people", "inhabitants", "citizens", "populous"],
    language: ["languages", "speak", "spoken", "tongue"],
    currency: ["money", "cash"],
    war: ["conflict", "battle", "fight"],
    independence: ["freedom", "liberation", "independent"],
    uprising: ["revolt", "rebellion", "riot"],
    empire: ["imperial", "emperor"],
    trade: ["commerce", "merchant"],
    ancient: ["old", "antique"],
    fall: ["collapse", "crumble"],
    end: ["finish", "dissolve", "abolish", "terminate"],
    begin: ["start", "commence"],
    build: ["construct", "erect"],
    found: ["establish", "create"],
    surrender: ["capitulate"]
  };

  // irregular verbs the stemmer cannot handle
  const IRREGULAR = {
    fell: "fall", fallen: "fall", began: "begin", begun: "begin", built: "build",
    won: "win", fought: "fight", led: "lead", took: "take", made: "make",
    came: "come", went: "go", rose: "rise", risen: "rise", ran: "run", sank: "sink"
  };

  // filled once stem() exists: stemmed synonym -> stemmed main word
  const MAIN_STEM = {};

  // words that mean something to us even if the data never uses them
  const INTENT_WORDS = ["capital", "population", "area", "language", "currency", "continent",
    "largest", "biggest", "smallest", "populous", "country", "history", "happened", "founder",
    "compare", "versus", "difference", "between", "century", "highest", "lowest"];

  // question pattern -> fact keys that answer it (first key that exists wins per list)
  const FACT_QUESTIONS = [
    [/capital/, ["Capital"]],
    [/population|how many people|populous|inhabitants/, ["Population"]],
    [/\barea\b|how (big|large)|\bsize\b|square/, ["Area"]],
    [/language|speak|spoken/, ["Languages", "Language"]],
    [/currency|money|\bcash\b/, ["Currency"]],
    [/continent|where is|which continent/, ["Continent"]],
    [/who (founded|started|created|established)|founder/, ["Founder"]],
    [/result|outcome|consequence/, ["Result", "Outcome"]],
    [/legacy/, ["Legacy"]],
    [/ruler|ruled|leader|emperor|tsar|czar|sultan|king/, ["Notable_rulers", "Notable_leaders"]],
    [/successor|replaced|split|broke|became|what came after/, ["Successor_states"]],
    [/government|ruled by|system of rule/, ["Government"]]
  ];

  // ---------- text helpers ----------

  function clean(text) {
    return String(text)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Cut endings so "revolutions" matches "revolution" and "founded" matches "founder"
  function stem(word) {
    if (word.length < 4 || /^\d/.test(word)) return word;
    let w = word;
    if (/ies$/.test(w)) return w.replace(/ies$/, "y");
    if (/(ss|us|is)$/.test(w)) return w;
    if (/(sses|xes|ches|shes)$/.test(w)) w = w.replace(/es$/, "");
    else if (/s$/.test(w)) w = w.replace(/s$/, "");
    if (w.length > 5 && /ly$/.test(w)) w = w.replace(/ly$/, "");
    if (/ing$/.test(w) && w.length > 5) w = w.replace(/ing$/, "");
    else if (/ed$/.test(w) && w.length > 4) w = w.replace(/ed$/, "");
    else if (/er$/.test(w) && w.length > 5) w = w.replace(/er$/, "");
    return w;
  }

  // One canonical form per idea: irregular verb -> synonym main word -> stem
  function canon(raw) {
    const s = stem(IRREGULAR[raw] || raw);
    return MAIN_STEM[s] || s;
  }

  Object.keys(SYNONYMS).forEach(function (main) {
    SYNONYMS[main].forEach(function (word) { MAIN_STEM[stem(word)] = stem(main); });
  });

  function keywords(text) {
    return clean(text).split(" ").filter(function (w) {
      return w && !STOP_WORDS.has(w);
    }).map(canon);
  }

  // Edit distance where swapping two neighbouring letters counts as one edit
  function editDistance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) { d.push([i]); }
    for (let j = 1; j <= b.length; j++) { d[0][j] = j; }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  function formatYear(year) {
    return year < 0 ? (-year) + " BCE" : String(year);
  }

  // "about 1.43 billion" -> 1430000000, "377,975 km²" -> 377975
  function magnitude(text) {
    const m = /(\d[\d,]*\.?\d*)\s*(billion|million)?/i.exec(text || "");
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (/billion/i.test(m[2] || "")) n *= 1e9;
    else if (/million/i.test(m[2] || "")) n *= 1e6;
    return n;
  }

  function label(key) { return key.replace(/_/g, " "); }

  // ---------- training: build the index ----------


  function fieldsOf(entry) {
    const facts = Object.keys(entry.facts).map(function (k) { return label(k) + " " + entry.facts[k]; }).join(" ");
    const events = entry.timeline.map(function (e) { return e[1]; }).join(" ");
    return [
      ["name", entry.name, 6],
      ["alias", entry.aliases.join(" "), 5],
      ["tag", entry.tags.join(" "), 3],
      ["region", entry.region + " " + entry.era + " " + entry.type, 2],
      ["summary", entry.summary, 1.5],
      ["detail", facts + " " + events, 1]
    ];
  }

  const rawVocab = new Set(INTENT_WORDS);
  Object.keys(SYNONYMS).forEach(function (main) {
    rawVocab.add(main);
    SYNONYMS[main].forEach(function (s) { rawVocab.add(s); });
  });

  const entryIndex = new Map(); // entry -> { weights, where, length }
  const index = DATA.map(function (entry) {
    const weights = {};
    const where = {};     // keyword -> field that gave it the most weight
    const bestWeight = {};
    let length = 0;

    fieldsOf(entry).forEach(function (field) {
      clean(field[1]).split(" ").forEach(function (raw) {
        if (!raw) return;
        if (raw.length > 3 && !STOP_WORDS.has(raw)) rawVocab.add(raw);
      });
      keywords(field[1]).forEach(function (word) {
        weights[word] = (weights[word] || 0) + field[2];
        length += field[2];
        if (!bestWeight[word] || field[2] > bestWeight[word]) {
          bestWeight[word] = field[2];
          where[word] = field[0];
        }
      });
    });

    const item = { entry: entry, weights: weights, where: where, length: length };
    entryIndex.set(entry, item);
    return item;
  });

  const averageLength = index.reduce(function (s, i) { return s + i.length; }, 0) / index.length;

  const docCount = {};
  index.forEach(function (item) {
    Object.keys(item.weights).forEach(function (w) { docCount[w] = (docCount[w] || 0) + 1; });
  });

  const rawList = Array.from(rawVocab);

  function rarity(word) {
    const n = docCount[word] || 0;
    return Math.log(1 + (index.length - n + 0.5) / (n + 0.5));
  }

  const nameTable = DATA.map(function (entry) {
    return { entry: entry, names: [entry.name].concat(entry.aliases).map(clean) };
  });

  // ---------- typo handling ----------

  // Closest real word to a mistyped one, or null
  function fixWord(raw) {
    if (raw.length < 4) return null;
    const max = raw.length >= 8 ? 2 : 1;
    let best = null;
    rawList.forEach(function (candidate) {
      if (Math.abs(candidate.length - raw.length) > max) return;
      const edits = editDistance(raw, candidate);
      if (edits <= max && (!best || edits < best.edits)) best = { word: candidate, edits: edits };
    });
    return best ? best.word : null;
  }

  // Decide what to do with one raw token.
  // Returns { kind: "ok" | "prefix" | "typo" | "none", words: [...] }
  function resolveToken(raw, isLast) {
    if (docCount[canon(raw)] || rawVocab.has(raw) || /\d/.test(raw)) return { kind: "ok", words: [raw] };
    if (isLast && raw.length >= 3) {
      const starts = rawList.filter(function (c) { return c.indexOf(raw) === 0 && c !== raw; });
      if (starts.length) return { kind: "prefix", words: starts.slice(0, 6) };
    }
    const fixed = fixWord(raw);
    return fixed ? { kind: "typo", words: [fixed] } : { kind: "none", words: [] };
  }

  // The question with typos repaired, or null if nothing needed fixing
  function didYouMean(question) {
    const tokens = clean(question).split(" ");
    let changed = false;
    const fixed = tokens.map(function (raw, i) {
      if (!raw || STOP_WORDS.has(raw)) return raw;
      const r = resolveToken(raw, i === tokens.length - 1);
      if (r.kind === "typo") { changed = true; return r.words[0]; }
      return raw;
    });
    return changed ? fixed.join(" ") : null;
  }

  // ---------- understanding the question ----------

  // -> { weights: { keyword: importance }, show: { keyword: word to display } }
  function buildQuery(question) {
    const weights = {};
    const show = {};
    function add(raw, importance) {
      const word = canon(raw);
      if (!docCount[word]) return;
      if (importance > (weights[word] || 0)) { weights[word] = importance; show[word] = raw; }
    }

    const tokens = clean(question).split(" ").filter(function (w) { return w && !STOP_WORDS.has(w); });
    tokens.forEach(function (raw, i) {
      const r = resolveToken(raw, i === tokens.length - 1);
      if (r.kind === "ok") add(raw, 1);
      else if (r.kind === "typo") add(r.words[0], 0.7);
      else if (r.kind === "prefix") r.words.forEach(function (w) { add(w, 0.5); });
    });
    return { weights: weights, show: show };
  }

  // Entries named in the question, in the order they appear. Tolerates typos in names.
  function findNamedEntries(question) {
    const text = " " + clean(question) + " ";
    const found = [];

    nameTable.forEach(function (row) {
      let spot = -1;
      row.names.forEach(function (name) {
        const at = text.indexOf(" " + name + " ");
        if (at >= 0 && (spot < 0 || at < spot)) spot = at;
      });
      if (spot < 0) {
        // fuzzy: a single-word name written with one slip, like "japn" or "brazl"
        clean(question).split(" ").forEach(function (token) {
          if (token.length < 4 || rawVocab.has(token) || STOP_WORDS.has(token)) return;
          row.names.forEach(function (name) {
            if (name.indexOf(" ") < 0 && name.length >= 5 && editDistance(token, name) <= 1) {
              const at = text.indexOf(" " + token + " ");
              if (at >= 0 && (spot < 0 || at < spot)) spot = at;
            }
          });
        });
      }
      if (spot >= 0) found.push({ entry: row.entry, spot: spot });
    });

    found.sort(function (a, b) { return a.spot - b.spot; });
    return found.map(function (f) { return f.entry; });
  }

  function scoreEntry(item, weights) {
    const k = 1.2, b = 0.75;
    let total = 0;
    for (const word in weights) {
      const count = item.weights[word];
      if (!count) continue;
      const lengthPart = 1 - b + b * item.length / averageLength;
      total += weights[word] * rarity(word) * (count * (k + 1)) / (count + k * lengthPart);
    }
    return total;
  }

  // ---------- public: search ----------

  function search(question, type) {
    const query = buildQuery(question);
    if (!Object.keys(query.weights).length) return [];

    const named = findNamedEntries(question);

    let results = index
      .filter(function (item) { return type === "all" || item.entry.type === type; })
      .map(function (item) {
        const isNamed = named.indexOf(item.entry) >= 0;
        return {
          entry: item.entry,
          score: scoreEntry(item, query.weights) + (isNamed ? 12 : 0),
          named: isNamed
        };
      })
      .sort(function (a, b) { return b.score - a.score; });

    // Second pass: borrow strong keywords from the best result so related entries move up
    if (results.length && results[0].score > 3) {
      const best = entryIndex.get(results[0].entry);
      const wider = Object.assign({}, query.weights);
      Object.keys(best.weights).forEach(function (w) {
        if (best.weights[w] >= 3 && !wider[w]) wider[w] = 0.15;
      });
      results.forEach(function (r) {
        const item = entryIndex.get(r.entry);
        r.score += scoreEntry(item, wider) - scoreEntry(item, query.weights);
      });
      results.sort(function (a, b) { return b.score - a.score; });
    }

    // Drop weak tails: must pass a floor and be within reach of the leader
    const top = results.length ? results[0].score : 0;
    results = results.filter(function (r) { return r.score > 0.5 && r.score >= top * 0.12; });

    // Explain each match
    results.forEach(function (r) {
      const item = entryIndex.get(r.entry);
      const why = [];
      if (r.named) why.push("named in question");
      Object.keys(query.weights)
        .filter(function (w) { return item.weights[w]; })
        .sort(function (a, b) { return item.weights[b] - item.weights[a]; })
        .slice(0, 3)
        .forEach(function (w) { why.push(query.show[w] + " (" + item.where[w] + ")"); });
      r.why = why;
    });

    return results;
  }

  // ---------- public: answer ----------
  // Returns null, or { html, used: [{ entry, part }] }

  function answer(question, type) {
    question = didYouMean(question) || question; // answer the repaired question
    const text = clean(question);
    const named = findNamedEntries(question).filter(function (e) {
      return type === "all" || e.type === type;
    });

    return rankingAnswer(text, named, type) ||
      compareAnswer(text, named) ||
      factAnswer(text, named) ||
      yearAnswer(text, named, type) ||
      eraAnswer(text, named) ||
      eventAnswer(question, text, named, type) ||
      whereAnswer(text, named) ||
      summaryAnswer(named);
  }

  // "most populous country", "largest country", "smallest country"
  function rankingAnswer(text, named, type) {
    if (named.length || (type !== "all" && type !== "country")) return null;
    const asc = /smallest|least|lowest|fewest|tiniest/.test(text);
    let key = null;
    if (/populous|population/.test(text) && /most|least|highest|lowest|largest|biggest|smallest|greatest|fewest|top/.test(text)) key = "Population";
    else if (/largest|biggest|smallest|tiniest/.test(text)) key = "Area";
    if (!key) return null;

    const rows = DATA.filter(function (e) { return e.type === "country" && e.facts[key]; })
      .map(function (e) { return { entry: e, n: magnitude(e.facts[key]) }; })
      .filter(function (r) { return r.n !== null; })
      .sort(function (a, b) { return asc ? a.n - b.n : b.n - a.n; });
    if (!rows.length) return null;

    const top = rows.slice(0, 3);
    const html = "By " + key.toLowerCase() + " (" + (asc ? "lowest" : "highest") + " first), among the " +
      rows.length + " countries in Terrapedia:<br>" +
      top.map(function (r, i) {
        return (i + 1) + ". <b>" + r.entry.name + "</b>: " + r.entry.facts[key];
      }).join("<br>");
    return { html: html, used: top.map(function (r) { return { entry: r.entry, part: "fact:" + key }; }) };
  }

  // Which fact keys of this entry does the question ask for?
  function factsAsked(text, entry) {
    const wanted = [];
    FACT_QUESTIONS.forEach(function (pair) {
      if (!pair[0].test(text)) return;
      const key = pair[1].find(function (k) { return entry.facts[k]; });
      if (key && wanted.indexOf(key) < 0) wanted.push(key);
    });
    // Any fact label whose words all appear in the question, like "key figures"
    const asked = new Set(keywords(text));
    Object.keys(entry.facts).forEach(function (key) {
      const parts = key.split("_").map(function (w) { return canon(w.toLowerCase()); });
      if (parts.every(function (p) { return asked.has(p); }) && wanted.indexOf(key) < 0) wanted.push(key);
    });
    return wanted;
  }

  function factAnswer(text, named) {
    const lines = [];
    const used = [];
    named.slice(0, 3).forEach(function (entry) {
      factsAsked(text, entry).forEach(function (key) {
        lines.push("<b>" + entry.name + "</b> · " + label(key) + ": " + entry.facts[key]);
        used.push({ entry: entry, part: "fact:" + key });
      });
    });
    return lines.length ? { html: lines.join("<br>"), used: used } : null;
  }

  function compareAnswer(text, named) {
    if (named.length < 2) return null;
    const wantsCompare = /\b(vs|versus|compare|compared|comparison|difference|differences|between)\b/.test(text);
    const hasFact = named.some(function (e) { return factsAsked(text, e).length; });
    const andOnly = /\band\b/.test(text) && !hasFact;
    if (!wantsCompare && !andOnly) return null;

    const a = named[0], b = named[1];
    const shared = Object.keys(a.facts).filter(function (k) { return k in b.facts; });
    const used = [{ entry: a, part: "summary" }, { entry: b, part: "summary" }];

    // Nothing comparable (a country and an empire): show both summaries instead
    if (!shared.length) {
      return {
        html: "<b>" + a.name + "</b>: " + a.summary + "<br><b>" + b.name + "</b>: " + b.summary,
        used: used
      };
    }
    shared.forEach(function (k) {
      used.push({ entry: a, part: "fact:" + k });
      used.push({ entry: b, part: "fact:" + k });
    });
    const rows = shared.map(function (k) {
      return "<tr><td>" + label(k) + "</td><td>" + a.facts[k] + "</td><td>" + b.facts[k] + "</td></tr>";
    }).join("");
    const extra = named.length > 2 ? "<br><small>Showing the first two of " + named.length + " names found.</small>" : "";
    return {
      html: "<b>" + a.name + " vs " + b.name + "</b><table><tr><th></th><th>" + a.name + "</th><th>" +
        b.name + "</th></tr>" + rows + "</table>" + extra,
      used: used
    };
  }

  // "what happened in 1945", "1960s", "between 1900 and 1950"
  function parseYears(text) {
    const years = [];
    let decade = null;
    const dm = /\b(\d{3})0s\b/.exec(text);
    if (dm) decade = parseInt(dm[1], 10) * 10;

    const re = /\b(\d{1,4})\s*(bce|bc|ce|ad)?\b/g;
    let m;
    while ((m = re.exec(text))) {
      const digits = m[1];
      if (!m[2] && digits.length < 3) continue;
      const n = parseInt(digits, 10);
      years.push(/^(bce|bc)$/.test(m[2] || "") ? -n : n);
    }
    return { years: years, decade: decade };
  }

  function yearAnswer(text, named, type) {
    const parsed = parseYears(text);
    let from, to;
    if (parsed.decade !== null) { from = parsed.decade; to = parsed.decade + 9; }
    else if (parsed.years.length >= 2 && /\b(between|from|to|until|through|and)\b/.test(text)) {
      from = Math.min(parsed.years[0], parsed.years[1]);
      to = Math.max(parsed.years[0], parsed.years[1]);
    } else if (parsed.years.length === 1) { from = to = parsed.years[0]; }
    else return null;

    // Look only at named entries if any have events, otherwise everything
    let pool = DATA.filter(function (e) { return type === "all" || e.type === type; });
    if (named.length) pool = named;

    const events = [];
    pool.forEach(function (entry) {
      entry.timeline.forEach(function (ev) {
        events.push({ entry: entry, year: ev[0], text: ev[1] });
      });
    });

    const hits = events.filter(function (e) { return e.year >= from && e.year <= to; })
      .sort(function (a, b) { return a.year - b.year; });
    const when = from === to ? formatYear(from) : formatYear(from) + " to " + formatYear(to);

    function line(e) {
      return "<b>" + formatYear(e.year) + "</b>: " + e.text + " (" + e.entry.name + ")";
    }
    function used(list) {
      return list.map(function (e) { return { entry: e.entry, part: "timeline" }; });
    }

    if (hits.length) {
      const shown = hits.slice(0, 8);
      const more = hits.length > shown.length ? "<br><small>" + (hits.length - shown.length) + " more not shown.</small>" : "";
      return { html: "Events in " + when + ":<br>" + shown.map(line).join("<br>") + more, used: used(shown) };
    }

    const middle = (from + to) / 2;
    const near = events.sort(function (a, b) { return Math.abs(a.year - middle) - Math.abs(b.year - middle); }).slice(0, 2);
    if (!near.length) return null;
    return {
      html: "Nothing recorded for " + when + ". Closest events:<br>" + near.map(line).join("<br>"),
      used: used(near)
    };
  }

  // "when did the Cold War start": the era string of a history entry
  function eraAnswer(text, named) {
    if (!/\b(start|started|begin|began|era|period|how long|dates?|span)\b/.test(text)) return null;
    const entry = named.find(function (e) { return e.type !== "country"; });
    if (!entry) return null;
    return {
      html: "<b>" + entry.name + "</b> · period: " + entry.era,
      used: [{ entry: entry, part: "summary" }]
    };
  }

  function findEvent(question, named, type) {
    const skip = new Set(["happen", "year", "date", "time", "occur"]);
    const asked = new Set(keywords(question).filter(function (w) { return !skip.has(w); }));
    const candidates = [];

    DATA.filter(function (e) { return type === "all" || e.type === type; }).forEach(function (entry) {
      const isNamed = named.indexOf(entry) >= 0;
      entry.timeline.forEach(function (ev) {
        const hits = Array.from(new Set(keywords(ev[1]).filter(function (w) { return asked.has(w); })));
        if (hits.length < 2 && !(hits.length === 1 && isNamed)) return;
        const score = hits.reduce(function (s, w) { return s + rarity(w); }, 0) + (isNamed ? 1 : 0);
        candidates.push({ entry: entry, year: ev[0], text: ev[1], score: score });
      });
    });

    candidates.sort(function (a, b) { return b.score - a.score; });
    return candidates;
  }

  function eventAnswer(question, text, named, type) {
    if (!/\b(when|year|date|happen|happened|what happened)\b/.test(text)) return null;
    const found = findEvent(question, named, type);
    if (!found.length) return null;

    const best = found[0];
    // Same event in other entries with an equal score, like two independence days
    const ties = found.slice(1).filter(function (c) {
      return c.score >= best.score * 0.99 && c.entry !== best.entry;
    }).slice(0, 2);

    let html = "<b>" + formatYear(best.year) + "</b>: " + best.text + " (" + best.entry.name + ")";
    if (ties.length) {
      html += "<br><small>Similar: " + ties.map(function (t) {
        return formatYear(t.year) + " " + t.text + " (" + t.entry.name + ")";
      }).join("; ") + "</small>";
    }
    return {
      html: html,
      used: [best].concat(ties).map(function (e) { return { entry: e.entry, part: "timeline" }; })
    };
  }

  function whereAnswer(text, named) {
    if (!named.length || !/\bwhere\b/.test(text)) return null;
    const e = named[0];
    return { html: "<b>" + e.name + "</b> · region: " + e.region, used: [{ entry: e, part: "summary" }] };
  }

  function summaryAnswer(named) {
    if (!named.length) return null;
    return {
      html: "<b>" + named[0].name + "</b>: " + named[0].summary,
      used: [{ entry: named[0], part: "summary" }]
    };
  }

  // ---------- public: autocomplete ----------

  function suggest(typed) {
    const text = clean(typed);
    if (text.length < 2) return [];

    return nameTable
      .map(function (row) {
        let best = 9;
        row.names.forEach(function (name) {
          let rank = 9;
          if (name.indexOf(text) === 0) rank = 0;
          else if (name.indexOf(text) >= 0) rank = 1;
          else if (text.length > 3 && editDistance(text, name.slice(0, text.length)) <= 1) rank = 2;
          if (rank < best) best = rank;
        });
        return { entry: row.entry, rank: best };
      })
      .filter(function (r) { return r.rank < 9; })
      .sort(function (a, b) { return a.rank - b.rank; })
      .slice(0, 5)
      .map(function (r) { return r.entry; });
  }

  return { search: search, answer: answer, suggest: suggest, didYouMean: didYouMean };
})();

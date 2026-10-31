/* Terrapedia summary.js: Chronos reads several internet sources and writes one summary.
   Sources: Wikipedia, Simple English Wikipedia, Wikidata, REST Countries, World Bank.
   Method: extractive. It keeps the sentences that several sources agree on, drops repeats,
   and tags each sentence with the sources that back it. No API key, no server.
   Load AFTER live.js. It upgrades TerrapediaLive.top and TerrapediaLive.render. */
(function () {
  const L = window.TerrapediaLive;
  if (!L || !L.lookup) { console.warn("Terrapedia summary: live.js not loaded"); return; }
  const origTop = L.top, origRender = L.render;
  const cache = {};

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safe = (p) => p.catch(() => null);
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);

  async function getJSON(url) {
    if (cache[url]) return cache[url];
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + " " + url);
    return (cache[url] = await r.json());
  }

  // ---------- collecting ----------

  async function wikiExtract(host, title) {
    const d = await getJSON("https://" + host + "/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=" + encodeURIComponent(title));
    const p = Object.values(d.query.pages)[0];
    if (!p || p.missing !== undefined || !p.extract) return null;
    if (/may (also )?refer to/.test(p.extract.slice(0, 300))) return null;
    return { text: p.extract.slice(0, 3000), url: "https://" + host + "/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")) };
  }

  async function wikidata(title) {
    const d = await getJSON("https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=en&limit=1&search=" + encodeURIComponent(title));
    const e = d.search && d.search[0];
    if (!e || !e.description || String(e.label).toLowerCase() !== title.toLowerCase()) return null;
    const art = /^(a|an|the)\s/i.test(e.description) ? "" : (/^[aeiou]/i.test(e.description) ? "an " : "a ");
    return { text: e.label + " is " + art + e.description + ".", url: "https://www.wikidata.org/wiki/" + e.id };
  }

  async function countries(title) {
    const f = "name,cca2,capital,population,area,languages,currencies,region,subregion,flags";
    const d = await getJSON("https://restcountries.com/v3.1/name/" + encodeURIComponent(title) + "?fullText=true&fields=" + f);
    const c = d[0], name = c.name.common, facts = [];
    const where = [c.subregion, c.region].filter(Boolean).join(", ");
    if (c.capital && c.capital.length) facts.push("The capital of " + name + " is " + c.capital.join(", ") + (where ? " (" + where + ")." : "."));
    facts.push(name + " has a population of about " + fmt(c.population) + " and covers " + fmt(c.area) + " km².");
    const langs = Object.values(c.languages || {}).join(", "), cur = Object.values(c.currencies || {}).map((x) => x.name).join(", ");
    if (langs || cur) facts.push([langs && "Languages spoken include " + langs, cur && "the currency is " + cur].filter(Boolean).join("; ") + ".");
    const out = { rest: { name: "REST Countries", url: "https://restcountries.com", facts }, wb: null, flag: c.flags && c.flags.png };
    try {
      const w = await getJSON("https://api.worldbank.org/v2/country/" + c.cca2 + "?format=json");
      const x = w[1] && w[1][0];
      if (x && x.incomeLevel && x.incomeLevel.value && !/aggregate/i.test(x.incomeLevel.value))
        out.wb = { name: "World Bank", url: "https://data.worldbank.org/country/" + c.cca2.toLowerCase(),
          facts: ["The World Bank classes " + name + " as a " + x.incomeLevel.value.toLowerCase() + " economy" + (x.region && x.region.value ? " in " + x.region.value : "") + "."] };
    } catch (e) { /* optional source */ }
    return out;
  }

  async function gather(title) {
    const [en, simple, wd, cf] = await Promise.all([
      safe(wikiExtract("en.wikipedia.org", title)),
      safe(wikiExtract("simple.wikipedia.org", title)),
      safe(wikidata(title)),
      safe(countries(title)),
    ]);
    const docs = [];
    if (en) docs.push({ name: "Wikipedia", url: en.url, sents: sentences(en.text), lead: true });
    if (simple) docs.push({ name: "Simple English Wikipedia", url: simple.url, sents: sentences(simple.text) });
    if (wd) docs.push({ name: "Wikidata", url: wd.url, sents: [wd.text] });
    if (cf) { docs.push(cf.rest); if (cf.wb) docs.push(cf.wb); }
    return { docs, flag: cf && cf.flag };
  }

  // ---------- summarising ----------

  const STOP = new Set("the a an of and or to in on for with is are was were be by as at from that this it its which who his her their has have had not but also than then into over after before about".split(" "));
  const words = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
  const sentences = (t) =>
    (t.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]+(?=\s|$)/g) || [])
      .map((s) => s.trim()).filter((s) => s.length > 22 && s.length < 420);
  const sim = (a, b) => { let i = 0; a.forEach((w) => { if (b.has(w)) i++; }); return i / Math.max(1, a.size + b.size - i); };

  function summarise(docs, title) {
    const all = [];
    docs.forEach((d, di) => (d.sents || []).forEach((s, si) => all.push({ s, di, si, w: new Set(words(s)) })));
    const df = {};
    docs.forEach((d) => {
      const seen = new Set();
      (d.sents || []).forEach((s) => words(s).forEach((w) => seen.add(w)));
      seen.forEach((w) => { df[w] = (df[w] || 0) + 1; });
    });
    const tw = new Set(words(title));
    all.forEach((x) => {
      let sc = 0;
      x.w.forEach((w) => { sc += df[w] > 1 ? Math.pow(df[w], 1.5) : 0.3; }); // words several sources share count more
      sc /= Math.sqrt(x.w.size || 1);
      if ([...x.w].some((w) => tw.has(w))) sc *= 1.25;
      sc *= 1 / (1 + 0.15 * x.si);
      if (docs[x.di].lead) sc *= 1.2;
      x.sc = sc;
    });
    const chosen = [];
    const lead = all.find((x) => docs[x.di].lead && x.si === 0);
    if (lead) chosen.push(lead);
    [...all].sort((a, b) => b.sc - a.sc).forEach((x) => {
      if (chosen.length >= 5 || chosen.indexOf(x) >= 0) return;
      if (chosen.some((c) => sim(c.w, x.w) > 0.35)) return;
      chosen.push(x);
    });
    chosen.sort((a, b) => a.di - b.di || a.si - b.si);
    return chosen.map((x) => {
      const refs = [];
      all.forEach((y) => { if (refs.indexOf(y.di) < 0 && (y === x || sim(x.w, y.w) > 0.35)) refs.push(y.di); });
      return { text: x.s, refs: refs.sort((a, b) => a - b) };
    });
  }

  // ---------- showing ----------

  const tag = (refs) => ' <sup>[' + refs.map((i) => i + 1).join(",") + "]</sup>";

  function paint(title, g, sents, extra) {
    const docs = g.docs, n = docs.length;
    let h = '<div class="live-box"><h3>' + esc(title) + " <small>(summary from " + n + " internet source" + (n > 1 ? "s" : "") + ")</small></h3>";
    if (extra && extra.fixed) h += "<small>Showing results for “" + esc(extra.fixed) + "”</small>";
    if (g.flag) h += '<div><img src="' + g.flag + '" alt="" style="height:40px;border-radius:4px"></div>';
    if (sents.length) h += "<p>" + sents.map((s) => esc(s.text) + tag(s.refs)).join(" ") + "</p>";
    const facts = [];
    docs.forEach((d, i) => (d.facts || []).forEach((f) => facts.push("<li>" + esc(f) + tag([i]) + "</li>")));
    if (facts.length) h += "<ul>" + facts.join("") + "</ul>";
    h += "<p><small>" + docs.map((d, i) => "[" + (i + 1) + '] <a href="' + d.url + '" target="_blank" rel="noopener">' + esc(d.name) + "</a>").join(" · ") + "</small></p>";
    if (extra && extra.more && extra.more.length)
      h += "<p><small>More: " + extra.more.map((m) => '<a href="' + m.url + '" target="_blank" rel="noopener">' + esc(m.title) + "</a>").join(" · ") + "</small></p>";
    h += "<small>Written automatically by Chronos: it reads each source, keeps the sentences several sources agree on and drops repeats. Fetched " + new Date().toLocaleString() + ".</small></div>";
    return h;
  }

  let timer = 0, token = 0;

  L.top = function (q, el) {
    clearTimeout(timer);
    const t = ++token;
    el.innerHTML = '<div class="live-box"><em>Reading sources on the internet…</em></div>';
    timer = setTimeout(async function () {
      try {
        const r = await L.lookup(q);
        if (t !== token || !document.body.contains(el)) return;
        if (!r) { el.innerHTML = ""; return; }
        const g = await gather(r.title);
        if (t !== token || !document.body.contains(el)) return;
        const sents = summarise(g.docs, r.title);
        if (!sents.length && !g.docs.some((d) => d.facts)) { origTop.call(L, q, el); return; }
        el.innerHTML = paint(r.title, g, sents, { fixed: r.fixed, more: r.more });
      } catch (e) {
        if (t === token) el.innerHTML = '<div class="live-box"><small>Could not reach the internet. Showing Terrapedia’s saved data.</small></div>';
      }
    }, 350);
  };

  L.render = async function (entry, el) {
    el.innerHTML = '<div class="live-box"><em>Reading sources on the internet…</em></div>';
    try {
      const name = entry.name || entry.title;
      const g = await gather(name);
      if (!document.body.contains(el)) return;
      const sents = summarise(g.docs, name);
      if (!sents.length && !g.docs.some((d) => d.facts)) { origRender.call(L, entry, el); return; }
      el.innerHTML = paint(name, g, sents);
    } catch (e) { origRender.call(L, entry, el); }
  };

  L._summarise = summarise; // exposed for testing
})();
  

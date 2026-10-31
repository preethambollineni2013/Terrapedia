/* Terrapedia live data: pulls fresh facts from public, CORS-enabled APIs.
   Sources: REST Countries (country facts) and Wikipedia (summaries + search).
   Everything fails quietly, so the offline data.js entries always still work. */
(function () {
  const cache = {};
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);

  async function getJSON(url) {
    if (cache[url]) return cache[url];
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + " " + url);
    return (cache[url] = await r.json());
  }

  async function country(name) {
    const f = "name,capital,population,area,languages,currencies,region,subregion,flags";
    try {
      const d = await getJSON(
        "https://restcountries.com/v3.1/name/" + encodeURIComponent(name) + "?fullText=true&fields=" + f
      );
      const c = d[0];
      return {
        Capital: (c.capital || []).join(", "),
        Population: fmt(c.population),
        Area: fmt(c.area) + " km²",
        Languages: Object.values(c.languages || {}).join(", "),
        Currency: Object.values(c.currencies || {}).map((x) => x.name).join(", "),
        Region: [c.subregion, c.region].filter(Boolean).join(", "),
        flag: c.flags && c.flags.png,
      };
    } catch (e) { return null; }
  }

  async function wiki(title) {
    try {
      const d = await getJSON(
        "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_"))
      );
      if (d.type === "disambiguation") return null;
      return { text: d.extract, url: d.content_urls && d.content_urls.desktop.page, img: d.thumbnail && d.thumbnail.source };
    } catch (e) { return null; }
  }

  // Live search for questions your local data.js can't answer.
  async function search(q) {
    try {
      const d = await getJSON(
        "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=" +
          encodeURIComponent(q)
      );
      return d.query.search.map((s) => ({
        title: s.title,
        snippet: s.snippet.replace(/<[^>]+>/g, ""),
        url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(s.title.replace(/ /g, "_")),
      }));
    } catch (e) { return []; }
  }

  // Fills `el` with a "Live data" box for an entry.
  async function render(entry, el) {
    const name = entry.name || entry.title;
    el.innerHTML = '<div class="live-box"><em>Loading live data…</em></div>';
    const [c, w] = await Promise.all([country(name), wiki(name)]);
    if (!c && !w) { el.innerHTML = ""; return; }
    let h = '<div class="live-box"><h3>Live data</h3>';
    if (c && c.flag) h += '<img src="' + c.flag + '" alt="" style="height:40px;border-radius:4px">';
    if (w && w.text) h += "<p>" + w.text + "</p>";
    if (c) {
      h += "<ul>";
      for (const k of ["Capital", "Population", "Area", "Languages", "Currency", "Region"])
        if (c[k]) h += "<li><b>" + k + ":</b> " + c[k] + "</li>";
      h += "</ul>";
    }
    h += '<small>Fetched ' + new Date().toLocaleString() + " from ";
    h += [c && "REST Countries", w && '<a href="' + w.url + '" target="_blank" rel="noopener">Wikipedia</a>']
      .filter(Boolean).join(" and ") + ".</small></div>";
    el.innerHTML = h;
  }

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Internet-first lookup: best Wikipedia match (with typo correction),
  // plus live country facts when the match is a country.
  async function lookup(q) {
    const api = "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=6&srinfo=suggestion&srsearch=";
    let d = await getJSON(api + encodeURIComponent(q));
    let list = d.query.search;
    let fixed = null;
    const sug = d.query.searchinfo && d.query.searchinfo.suggestion;
    if (!list.length && sug) {
      fixed = sug;
      d = await getJSON(api + encodeURIComponent(sug));
      list = d.query.search;
    }
    if (!list.length) return null;
    const want = (fixed || q).toLowerCase();
    const top = list.find((r) => r.title.toLowerCase() === want) || list[0];
    const [w, c1] = await Promise.all([wiki(top.title), country(top.title)]);
    const c = c1 || (await country(fixed || q));
    return {
      fixed, title: top.title, w, c,
      more: list.filter((r) => r !== top).slice(0, 4).map((r) => ({
        title: r.title,
        url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(r.title.replace(/ /g, "_")),
      })),
    };
  }

  let timer = 0, token = 0;
  // Fills `el` with the live answer for a typed query (debounced, ignores stale replies).
  function top(q, el) {
    clearTimeout(timer);
    const t = ++token;
    el.innerHTML = '<div class="live-box"><em>Searching the internet…</em></div>';
    timer = setTimeout(async () => {
      let r;
      try { r = await lookup(q); }
      catch (e) {
        if (t === token) el.innerHTML = '<div class="live-box"><small>Could not reach the internet. Showing Terrapedia’s saved data.</small></div>';
        return;
      }
      if (t !== token || !document.body.contains(el)) return;
      if (!r) { el.innerHTML = ""; return; }
      let h = '<div class="live-box"><h3>' + esc(r.title) + ' <small>(live from the internet)</small></h3>';
      if (r.fixed) h += "<small>Showing results for “" + esc(r.fixed) + "”</small>";
      if (r.c && r.c.flag) h += '<div><img src="' + r.c.flag + '" alt="" style="height:40px;border-radius:4px"></div>';
      if (r.w && r.w.text) h += "<p>" + esc(r.w.text) + "</p>";
      if (r.c) {
        h += "<ul>";
        for (const k of ["Capital", "Population", "Area", "Languages", "Currency", "Region"])
          if (r.c[k]) h += "<li><b>" + k + ":</b> " + esc(r.c[k]) + "</li>";
        h += "</ul>";
      }
      if (r.more.length)
        h += "<p><small>More: " + r.more.map((m) => '<a href="' + m.url + '" target="_blank" rel="noopener">' + esc(m.title) + "</a>").join(" · ") + "</small></p>";
      h += "<small>Fetched " + new Date().toLocaleString() + " from " +
        [r.c && "REST Countries", r.w && '<a href="' + r.w.url + '" target="_blank" rel="noopener">Wikipedia</a>'].filter(Boolean).join(" and ") + ".</small></div>";
      el.innerHTML = h;
    }, 350);
  }

  window.TerrapediaLive = { render, search, country, wiki, lookup, top };
})();
       

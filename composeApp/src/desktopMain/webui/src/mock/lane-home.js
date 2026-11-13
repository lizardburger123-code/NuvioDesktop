// Preview-only backend for Home, the catalog rows and browsing.
// Return handlers keyed by method name ("area.verb": params => result or a Promise of it).
// ctx.push(topic, data, delayMs) sends a topic to the interface; ctx.base has the handlers of
// backend.js (to wrap one, define the same name here and call ctx.base[name]); ctx.data has the
// preview's catalog.
//
// Switches for trying the hard cases (add them to the address after ?mock):
//   &stress=30x60   Home with 30 catalog rows of 60 titles each
//   &edge           rows with a very long name, an Arabic one, a single title and none at all
//   &homefail       no catalog loads and the app reports why
// From a test script: window.__homeMock.push(topic, data) sends any topic, and
// window.__homeMock.failPages = true makes every further Discover page fail until set back
// ("all" fails the first page too).
export default ctx => {
  const query = new URLSearchParams(window.location.search);
  const { all, sections } = ctx.data;
  const state = { failPages: false, pages: [] };
  window.__homeMock = {
    push: (topic, data, delay = 0) => ctx.push(topic, data, delay),
    get failPages() { return state.failPages; },
    set failPages(value) { state.failPages = value === "all" ? "all" : Boolean(value); },
    // The offsets of every Discover page asked for (to catch a list that asks twice or keeps asking).
    get pages() { return state.pages; },
  };

  const titles = (count, salt) => Array.from({ length: count }, (_, i) => {
    const item = all[(i * 7 + salt) % all.length];
    return { ...item, id: `${item.id}-${salt}-${i}` };
  });
  const extraSections = () => {
    const out = [];
    const stress = /^(\d+)x(\d+)$/.exec(query.get("stress") || "");
    if (stress) {
      for (let r = 0; r < Number(stress[1]); r += 1) {
        out.push({ key: `stress.${r}`, title: `Catalog ${r + 1}`, addonName: "Preview", type: r % 2 ? "series" : "movie", kind: r % 2 ? "series" : "movie", items: titles(Number(stress[2]), r), source: `https://preview/manifest.json|movie|stress${r}` });
      }
    }
    if (query.has("edge")) {
      out.push(
        { key: "edge.long", title: "Popular right now across every streaming service in your region, updated hourly", addonName: "A catalog addon with a very long name indeed", type: "movie", kind: "movie", items: titles(12, 3), source: "https://preview/manifest.json|movie|long" },
        { key: "edge.arabic", title: "أفلام عربية رائجة", addonName: "كتالوج عربي", type: "movie", kind: "movie", items: titles(9, 5).map((item, i) => ({ ...item, name: ["الرسالة", "عمر المختار", "الفيل الأزرق ٢", "كيرة والجن", "ولاد رزق ٣: القاضية"][i % 5] })) },
        { key: "edge.one", title: "Just added", addonName: "Preview", type: "series", kind: "series", items: titles(1, 9) },
        { key: "edge.none", title: "Nothing here", addonName: "Preview", type: "series", kind: "series", items: [] },
      );
    }
    return out;
  };
  const hero = () => [all[14], all[33], all[25], all[9]].filter(Boolean);
  const homePayload = () => (query.has("homefail")
    ? { loading: false, hero: [], sections: [], error: "Couldn't reach your addons. Check your connection." }
    : { loading: false, hero: hero(), sections: [...sections, ...extraSections()] });
  const pushHome = () => {
    if (query.has("stress") || query.has("edge") || query.has("homefail")) ctx.push("home", homePayload(), 320);
  };

  return {
    "home.subscribe": params => { const result = ctx.base["home.subscribe"](params); pushHome(); return result; },
    "home.refresh": params => { const result = ctx.base["home.refresh"](params); pushHome(); return result; },
    // Like the app: nothing without genres, and the answer takes a moment.
    "details.similar": params => new Promise(resolve => setTimeout(() => resolve((params.genres || []).length ? ctx.base["details.similar"](params) : []), 600)),
    "discover.page": params => (state.pages.push(params.skip), state.failPages && (params.skip > 0 || state.failPages === "all")
      ? new Promise((_, reject) => setTimeout(() => reject(new Error("The catalog didn't answer.")), 300))
      : ctx.base["discover.page"](params)),
  };
};

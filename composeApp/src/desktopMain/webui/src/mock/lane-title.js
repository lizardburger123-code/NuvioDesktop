// Preview-only backend for the title page and the person page.
// Return handlers keyed by method name ("area.verb": params => result or a Promise of it).
// ctx.push(topic, data, delayMs) sends a topic to the interface; ctx.base has the handlers of
// backend.js (to wrap one, define the same name here and call ctx.base[name]); ctx.data has the
// preview's catalog.
//
// The title page's `details` topic is built here, so it can carry what the page marks:
//   series:tt-missing   no addon has it ("title not found")
//   series:tt-flaky     fails the first time, loads on "Try again"
export default ctx => {
  const { push, base, data } = ctx;
  let current = null;
  const films = new Map();
  const failOnce = new Set(["tt-flaky"]);

  const build = (type, id) => {
    if (id === "tt-missing") return { error: "No addon provides meta for this content." };
    if (failOnce.delete(id)) return { error: "Could not load details from any addon." };
    if (id === "tt-flaky") return { meta: { ...data.detailsFor("movie", "tt0002"), id, name: "The Cycle" } };
    return { meta: data.detailsFor(type, id) };
  };

  const send = (type, id, delay) => {
    const result = build(type, id);
    push("details", { key: `${type}:${id}`, loading: false, meta: null, ...result, watched: films.get(id) || false }, delay);
  };

  return {
    "details.load": ({ type, id }) => {
      current = { type, id };
      push("details", { key: `${type}:${id}`, loading: true, meta: null });
      send(type, id, id === "tt-missing" || id === "tt-flaky" ? 700 : 220);
      return true;
    },
    // Films: the Trophies shelf. The base keeps the shelf; the topic is this file's.
    "watched.toggle": params => {
      const on = base["watched.toggle"](params);
      films.set(params.id, on);
      if (current) send(current.type, current.id, 0);
      return on;
    },
  };
};

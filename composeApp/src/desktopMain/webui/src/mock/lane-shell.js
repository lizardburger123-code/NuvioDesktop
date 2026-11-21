// Preview-only backend for navigation, settings, profiles and addons.
// Return handlers keyed by method name ("area.verb": params => result or a Promise of it).
// ctx.push(topic, data, delayMs) sends a topic to the interface; ctx.base has the handlers of
// backend.js (to wrap one, define the same name here and call ctx.base[name]); ctx.data has the
// preview's catalog.

// Requests this area makes. Test scripts can make any of them fail or never answer:
//   window.__mockFail["app.openUrl"] = "Only web links can be opened.";
//   window.__mockHang.add("net.get");
// and push a topic the way the app does: window.__mockPush("home", { ... }).
//
// The computer the preview pretends to run on (Settings › Performance, "auto"):
//   &lowend          a modest one, so "auto" picks Lite
//   &perfenv=lite    NUVIO_PERFORMANCE fixes the choice (lite, full or auto), as the app reports it
//   &profile=2       the profile the preview starts as (an id from its list), instead of the first
const SHELL_METHODS = [
  "app.openUrl", "app.useClassic", "legacy.open", "settings.appearance.set", "settings.subtitles.set", "settings.playback.set",
  "home.rows.set", "addons.list", "addons.remove", "addons.setEnabled", "addons.configure", "net.get", "net.set",
  "profiles.switch", "profile.setAvatar", "downloads.setFolder", "ratings.set",
];

export default ctx => {
  const fail = {};
  const hang = new Set();
  window.__mockFail = fail;
  window.__mockHang = hang;
  window.__mockPush = (topic, data) => ctx.push(topic, data);

  const guarded = name => params => {
    if (hang.has(name)) return new Promise(() => {});
    if (fail[name]) throw new Error(fail[name]);
    return ctx.base[name](params);
  };

  const query = new URLSearchParams(window.location.search);
  const lowEnd = query.has("lowend");
  const forced = ["auto", "lite", "full"].includes(query.get("perfenv")) ? query.get("perfenv") : null;
  const device = {
    os: "linux", cores: 4, memoryMb: lowEnd ? 3900 : 7900, softwareRender: false,
    lowEnd, reason: lowEnd ? "4 GB of memory" : "", overridden: Boolean(forced),
  };
  // With the environment's choice in force, the app reports it as the saved one.
  const appearance = value => (forced ? { ...value, performance: forced } : value);

  return {
    ...Object.fromEntries(SHELL_METHODS.filter(name => ctx.base[name]).map(name => [name, guarded(name)])),
    "app.bootstrap": params => {
      const boot = ctx.base["app.bootstrap"](params);
      const profile = boot.profiles.find(p => String(p.id) === query.get("profile")) || boot.profile;
      return { ...boot, profile, appearance: appearance(boot.appearance), device };
    },
    "settings.appearance.get": params => appearance(ctx.base["settings.appearance.get"](params)),
    "settings.appearance.set": params => {
      const result = guarded("settings.appearance.set")(params);
      // The preview pushes the saved appearance back; the environment's choice stays on top of it.
      if (forced && result && typeof result.then !== "function") ctx.push("appearance", appearance(result));
      return result;
    },
  };
};

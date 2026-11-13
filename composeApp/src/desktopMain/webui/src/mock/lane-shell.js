// Preview-only backend for navigation, settings, profiles and addons.
// Return handlers keyed by method name ("area.verb": params => result or a Promise of it).
// ctx.push(topic, data, delayMs) sends a topic to the interface; ctx.base has the handlers of
// backend.js (to wrap one, define the same name here and call ctx.base[name]); ctx.data has the
// preview's catalog.

// Requests this area makes. Test scripts can make any of them fail or never answer:
//   window.__mockFail["app.openUrl"] = "Only web links can be opened.";
//   window.__mockHang.add("net.get");
// and push a topic the way the app does: window.__mockPush("home", { ... }).
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
  return Object.fromEntries(SHELL_METHODS.filter(name => ctx.base[name]).map(name => [name, guarded(name)]));
};

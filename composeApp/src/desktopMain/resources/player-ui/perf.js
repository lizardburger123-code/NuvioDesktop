// Performance mode for the player overlay: <html data-perf="lite|full">.
//
// The host sends state.lite with every playerControls push (Lite on a modest computer, see
// Settings > Performance) and controls.js applies it. Until the first push the page keeps the mode
// it had last time, so the loading screen of a Lite computer is already Lite. Everything Lite
// changes is keyed on the attribute (lite.css) or on playerPerf.isLite(); Full stays as it was.
(() => {
  "use strict";

  const KEY = "nuvio.player.perf";
  const root = document.documentElement;
  const listeners = [];

  let remembered = "full";
  try {
    if (window.localStorage.getItem(KEY) === "lite") remembered = "lite";
  } catch (_) {
    // No storage for this page: start in Full until the host says otherwise.
  }
  root.dataset.perf = remembered;

  window.playerPerf = {
    isLite: () => root.dataset.perf === "lite",
    // Called with every state push. Writes nothing when the mode is unchanged.
    apply(lite) {
      const mode = lite ? "lite" : "full";
      if (root.dataset.perf === mode) return;
      root.dataset.perf = mode;
      try {
        window.localStorage.setItem(KEY, mode);
      } catch (_) {
        // Not remembered; the next push still says which mode is on.
      }
      listeners.slice().forEach(listener => {
        try {
          listener(mode === "lite");
        } catch (error) {
          console.error("perf listener", error);
        }
      });
    },
    // listener(lite) runs after every change of mode.
    onChange(listener) {
      listeners.push(listener);
    },
  };
})();

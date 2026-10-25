// Real frosted glass for the player panels.
//
// This page is a transparent WebView over mpv's video, so CSS backdrop-filter has nothing to blur.
// We tell the native player where the visible panels are and mpv blurs the video under them
// (see applyGlassRects in player_bridge.cpp). Rects are normalised to the visible picture.
(() => {
  "use strict";

  const bridge = window.chrome && window.chrome.webview;
  if (!bridge) return;

  const SURFACES = [
    ".header-actions",
    ".ornament",
    ".opening-actions",
    ".next-episode-card",
    ".player-rail-modal:not([hidden]) .track-panel",
    ".player-side-modal:not([hidden]) .player-side-panel",
  ];
  const POLL_MS = 120;
  const MAX_RECTS = 6;

  let sent = "";
  let previous = "";

  const effectiveOpacity = element => {
    let opacity = 1;
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      opacity *= Number(style.opacity);
      if (opacity < 0.05) return 0;
    }
    return opacity;
  };

  // The visible part of the video picture (the subtitle layer is sized to it).
  const pictureRect = () => {
    const layer = document.querySelector(".sub-layer");
    const width = window.innerWidth;
    const height = window.innerHeight;
    const rect = layer ? layer.getBoundingClientRect() : { left: 0, top: 0, width, height };
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(width, rect.left + rect.width);
    const bottom = Math.min(height, rect.top + rect.height);
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  };

  const collect = () => {
    if (document.body.classList.contains("pip-mode") || document.querySelector(".player.pip-mode")) return "";
    const picture = pictureRect();
    const parts = [];
    for (const selector of SURFACES) {
      for (const element of document.querySelectorAll(selector)) {
        if (parts.length >= MAX_RECTS) break;
        if (effectiveOpacity(element) < 0.5) continue;
        const box = element.getBoundingClientRect();
        if (box.width < 8 || box.height < 8) continue;
        const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
        const x = (box.left - picture.left) / picture.width;
        const y = (box.top - picture.top) / picture.height;
        const w = box.width / picture.width;
        const h = box.height / picture.height;
        if (x > 1 || y > 1 || x + w < 0 || y + h < 0) continue;
        const r = Math.min(radius, box.height / 2) / picture.height;
        parts.push([x, y, w, h, r].map(value => value.toFixed(4)).join(","));
      }
    }
    return parts.join(";");
  };

  const post = spec => {
    sent = spec;
    try {
      bridge.postMessage({ type: "glassRects", value: 0, rects: spec });
    } catch (_) {
      // The page is closing.
    }
  };

  const tick = () => {
    const spec = collect();
    if (spec !== sent) {
      const removedPanel = spec.split(";").filter(Boolean).length < sent.split(";").filter(Boolean).length;
      // Remove blur at once when a panel goes away; wait for moving panels to settle before adding.
      if (removedPanel || spec === previous) post(spec);
    }
    previous = spec;
  };

  window.setInterval(tick, POLL_MS);
  window.addEventListener("resize", () => { previous = ""; });
  window.addEventListener("pagehide", () => post(""));
})();

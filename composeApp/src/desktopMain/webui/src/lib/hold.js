// Ambient motion (the drifting background, tile spotlights) under a glass overlay makes the
// overlay re-blur its backdrop every frame. While an overlay is open that motion holds still.
export const OVERLAY = "nuvio:overlay";
let count = 0;

const announce = open => {
  if (open) document.documentElement.setAttribute("data-overlay", "");
  else document.documentElement.removeAttribute("data-overlay");
  window.dispatchEvent(new CustomEvent(OVERLAY, { detail: open }));
};

/** Hold ambient motion; returns the release function (safe to call once). */
export const holdAmbient = () => {
  count += 1;
  if (count === 1) announce(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count -= 1;
    if (count === 0) announce(false);
  };
};

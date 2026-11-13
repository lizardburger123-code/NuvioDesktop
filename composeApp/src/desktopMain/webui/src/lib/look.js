// The interface has two looks. Cinema: words across the top, white marks what is selected.
// Haze: an icon rail, glass panels, and the accent as light through haze, coloured by the film
// on screen. The choice is saved with the appearance settings; a copy in localStorage lets the
// very first frame (the intro) already wear it.
import { flushSync } from "react-dom";
import { reduceMotion } from "./motion.js";
import { softwareRender } from "./session.js";

export const LOOKS = [
  { id: "cinema", name: "Cinema", blurb: "Words across the top. White marks what is selected." },
  { id: "haze", name: "Haze", blurb: "An icon rail, a top ten, episodes as a list. Colour comes from the film, like light through haze." },
];

const KEY = "nuvio.look";
const valid = id => (LOOKS.some(look => look.id === id) ? id : "cinema");

export const lookOf = appearance => valid(appearance?.layout);

/** Before the app has its settings: what the last launch used. */
export const rememberedLook = () => {
  try { return valid(window.localStorage.getItem(KEY)); } catch { return "cinema"; }
};

export const applyLook = (id, artColor = true) => {
  const look = valid(id);
  const root = document.documentElement;
  root.dataset.layout = look;
  root.dataset.hazeArt = artColor === false ? "off" : "on";
  try { window.localStorage.setItem(KEY, look); } catch { /* a nicety */ }
  return look;
};

/** Change look with a dissolve (the whole page is the old picture, the new one shows through). */
export const switchLook = (id, commit) => {
  const before = document.activeElement;
  // The page must be in its new look before the transition takes its picture of it.
  const run = () => {
    applyLook(id);
    flushSync(() => commit(valid(id)));
    // What had focus can go with the old look (its bar, a title page's buttons): the keyboard
    // then lands on the screen's heading, as after a move, instead of the body.
    if (!before || before === document.body || before.isConnected || document.activeElement !== document.body) return;
    const heading = document.querySelector(".screen-host:not(.is-parked) h1");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) {
      heading.setAttribute("tabindex", "-1");
      heading.setAttribute("data-nav-focus", "");
    }
    heading.focus({ preventScroll: true });
  };
  if (typeof document.startViewTransition !== "function" || reduceMotion() || softwareRender()) { run(); return; }
  const root = document.documentElement;
  root.dataset.nav = "look";
  const transition = document.startViewTransition(run);
  transition.finished.finally(() => { if (root.dataset.nav === "look") delete root.dataset.nav; });
};

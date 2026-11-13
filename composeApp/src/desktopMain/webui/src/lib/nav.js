import { LuBookmark, LuFilm, LuHouse, LuLibrary, LuSettings, LuSparkles, LuTv } from "react-icons/lu";
import { goSection } from "./router.js";
import { reduceMotion } from "./motion.js";

/** The app's sections, in top-bar order (screen motion follows this order left/right). */
export const NAV_ITEMS = [
  { route: "home", label: "Home", icon: LuHouse, inTopBar: true },
  { route: "browse", kind: "movie", label: "Movies", icon: LuFilm, inTopBar: true },
  { route: "browse", kind: "series", label: "Series", icon: LuTv, inTopBar: true },
  { route: "browse", kind: "anime", label: "Anime", icon: LuSparkles, inTopBar: true },
  { route: "library", label: "Library", icon: LuLibrary, inTopBar: true },
  { route: "library", tab: "later", label: "Watch later", icon: LuBookmark },
  { route: "settings", label: "Settings", icon: LuSettings },
];

/** Open the keyboard shortcuts sheet from anywhere (Settings › About has a button for it). */
export const SHORTCUTS = "nuvio:shortcuts";

const SEARCH_FIELD = ".screen-host:not(.is-parked) :is([role='search'] input, .screen.search input)";

/**
 * Search, ready to type: opens it (or stays on it) and puts the caret in its box, with what was
 * typed before selected so new typing replaces it. Waits a few frames for a screen on its way in.
 */
export const focusSearch = () => {
  goSection("search");
  let frames = 0;
  const seek = () => {
    const field = document.querySelector(SEARCH_FIELD);
    if (!field || field.closest("[inert]")) {
      if (++frames < 40) window.requestAnimationFrame(seek);
      return;
    }
    field.focus({ preventScroll: true });
    field.select?.();
    if (field.getBoundingClientRect().top < 0) window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
  };
  window.requestAnimationFrame(seek);
};

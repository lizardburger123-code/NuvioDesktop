import { LuBookmark, LuFilm, LuHouse, LuLibrary, LuSettings, LuSparkles, LuTv } from "react-icons/lu";

/** The app's sections, in top-bar order (screen motion follows this order left/right). */
export const NAV_ITEMS = [
  { route: "home", label: "Home", icon: LuHouse, inTopBar: true },
  { route: "browse", kind: "movie", label: "Movies", icon: LuFilm, inTopBar: true },
  { route: "browse", kind: "series", label: "Series", icon: LuTv, inTopBar: true },
  { route: "browse", kind: "anime", label: "Anime", icon: LuSparkles, inTopBar: true },
  { route: "library", label: "Library", icon: LuLibrary, inTopBar: true },
  { route: "library", tab: "later", label: "Watch later", icon: LuBookmark },
  { route: "settings", label: "Settings", icon: LuSettings, inTopBar: true },
];

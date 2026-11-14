import { createContext, useContext, useSyncExternalStore } from "react";

/** True while this screen is the one on display (kept-alive screens stay mounted but parked). */
export const ScreenActiveContext = createContext(true);
export const useScreenActive = () => useContext(ScreenActiveContext);

const onVisibility = listener => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};

/** True while the page can't be seen: behind the player, or the window minimised. */
export const usePageHidden = () => useSyncExternalStore(onVisibility, () => document.visibilityState === "hidden", () => false);

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { call } from "./bridge.js";
import { useTopic } from "./store.js";
import { navigate } from "./lib/router.js";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ boot, children }) {
  const [appearance, setAppearanceState] = useState(boot.appearance);
  const [art, setArt] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const watchLater = useTopic("watchLater", []);
  const laterIds = useMemo(() => new Set(watchLater.map(item => `${item.type}:${item.id}`)), [watchLater]);

  const toast = useCallback((message, { icon, tone } = {}) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts(list => [...list.slice(-2), { id, message, icon, tone }]);
    window.setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 3200);
  }, []);

  const setAppearance = useCallback(patch => {
    setAppearanceState(prev => ({ ...prev, ...patch }));
    call("settings.appearance.set", patch).catch(error => toast(`Couldn't save: ${error.message}`, { tone: "error" }));
  }, [toast]);

  const toggleLater = useCallback(item => {
    const was = laterIds.has(`${item.type}:${item.id}`);
    call("watchLater.toggle", {
      item: { id: item.id, type: item.type, name: item.name, poster: item.poster, banner: item.banner, logo: item.logo, releaseInfo: item.releaseInfo, imdbRating: item.imdbRating, genres: item.genres },
    }).then(
      () => toast(was ? `Removed from Watch later` : `Added to Watch later`),
      error => toast(error.message, { tone: "error" }),
    );
  }, [laterIds, toast]);

  const openDetails = useCallback(item => navigate("details", { type: item.type, id: item.id, name: item.name }), []);

  /** Continue watching: replay the last source when the app still has it, else pick a source. */
  const resume = useCallback(async entry => {
    let target = { videoId: entry.videoId, season: entry.season, episode: entry.episode };
    try {
      const result = await call("play.resume", {
        type: entry.type, id: entry.id, videoId: entry.videoId, season: entry.season, episode: entry.episode,
        nextEpisode: Boolean(entry.nextEpisode),
      });
      if (result?.handled) return;
      if (result?.videoId) target = { videoId: result.videoId, season: result.season, episode: result.episode };
    } catch (error) {
      toast(error.message, { tone: "error" });
      if (entry.nextEpisode) return;
    }
    navigate("details", { type: entry.type, id: entry.id, name: entry.name, sources: target.videoId, season: target.season, episode: target.episode });
  }, [toast]);

  const removeContinue = useCallback(entry => {
    call("continue.remove", { id: entry.id, type: entry.type }).then(
      () => toast(`Removed ${entry.name} from Continue watching`),
      error => toast(error.message, { tone: "error" }),
    );
  }, [toast]);

  const value = useMemo(() => ({
    boot, profile: boot.profile, appearance, setAppearance, art, setArt, toast, toasts,
    watchLater, laterIds, toggleLater, openDetails, resume, removeContinue,
  }), [boot, appearance, setAppearance, art, toast, toasts, watchLater, laterIds, toggleLater, openDetails, resume, removeContinue]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

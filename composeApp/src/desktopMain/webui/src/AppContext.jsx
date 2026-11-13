import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { call, setLens } from "./bridge.js";
import { useTopic } from "./store.js";
import { navigate } from "./lib/router.js";
import { applyAppearance } from "./theme/appearance.js";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
// Toasts live in their own context: showing one must not re-render every screen.
const ToastContext = createContext([]);
export const useToasts = () => useContext(ToastContext);
const ToastControlContext = createContext(null);
/** { dismiss(id) } for the toast stack. */
export const useToastControl = () => useContext(ToastControlContext);

const MAX_TOASTS = 3;

export function AppProvider({ boot, children }) {
  const [appearance, setAppearanceState] = useState(boot.appearance);
  const [art, setArt] = useState(null);
  const [profile, setProfile] = useState(boot.profile);
  const [toasts, setToasts] = useState([]);
  const toastList = useRef([]);
  const toastId = useRef(0);
  const watchLater = useTopic("watchLater", []);
  const laterIds = useMemo(() => new Set(watchLater.map(item => `${item.type}:${item.id}`)), [watchLater]);

  // The list is kept in a ref as well, so toast() can see what is on screen right now.
  const publishToasts = useCallback(next => { toastList.current = next; setToasts(next); }, []);
  /** Lets a toast animate out, then drops it; its onDone hears whether its button was used. */
  const dismissToast = useCallback((id, used = false) => {
    const leaving = toastList.current.find(t => t.id === id && !t.leaving);
    if (!leaving) return;
    publishToasts(toastList.current.map(t => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => publishToasts(toastList.current.filter(t => t.id !== id)), 240);
    try { leaving.onDone?.(used); } catch (error) { console.error("toast", error); }
  }, [publishToasts]);

  /**
   * A short note at the bottom; returns its id. action: { label, run } adds a button (Undo...);
   * onDone(used) runs once when the note leaves, telling whether that button was pressed.
   * The same plain note again while it is still up refreshes that one instead of stacking a copy
   * (notes with a button never merge: each Undo belongs to its own change).
   * Toasts wait while the pointer or keyboard focus is on them (see Toasts.jsx).
   */
  const toast = useCallback((message, { icon, tone, action, duration, onDone } = {}) => {
    const text = String(message ?? "");
    const stay = duration || (action ? 5200 : 3200);
    const live = toastList.current.filter(t => !t.leaving);
    const twin = !action && !onDone && live.find(t => !t.action && !t.onDone && t.message === text && t.tone === tone);
    if (twin) {
      publishToasts(toastList.current.map(t => (t === twin ? { ...t, duration: stay, bump: t.bump + 1 } : t)));
      return twin.id;
    }
    toastId.current += 1;
    const id = toastId.current;
    const wrapped = action ? { label: action.label, run: () => { dismissToast(id, true); action.run(); } } : null;
    // A fourth note sends the oldest one on its way rather than piling up.
    live.slice(0, Math.max(0, live.length - (MAX_TOASTS - 1))).forEach(old => dismissToast(old.id));
    publishToasts([...toastList.current, { id, message: text, icon, tone, action: wrapped, onDone, duration: stay, bump: 0 }]);
    return id;
  }, [dismissToast, publishToasts]);
  const toastControl = useMemo(() => ({ dismiss: dismissToast }), [dismissToast]);

  // A request nobody waited for that failed (opening a link, a classic page...) would otherwise
  // fail in silence. Say so once: the same failure is not repeated for half a minute, and
  // several at once (a lost connection) make one note, not a pile.
  useEffect(() => {
    let last = { message: "", at: 0 };
    const onRejection = event => {
      const reason = event.reason;
      // Superseded animations and page transitions reject on purpose; nothing went wrong.
      if (reason?.name === "AbortError" || reason?.name === "InvalidStateError") return;
      const message = reason?.bridge ? reason.message : "Something didn't work. Try again, and restart Nuvio if it keeps happening.";
      const now = Date.now();
      if (now - last.at < 4000 || (message === last.message && now - last.at < 30000)) return;
      last = { message, at: now };
      toast(message, { tone: "error" });
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [toast]);

  /**
   * Changes appearance settings at once and saves them. If the save fails, what this change set
   * goes back (unless a newer change replaced it) and a note says so. Resolves to whether it was
   * saved; never rejects.
   */
  const appearanceNow = useRef(boot.appearance);
  const setAppearance = useCallback(patch => {
    const before = appearanceNow.current;
    appearanceNow.current = { ...before, ...patch };
    setAppearanceState(appearanceNow.current);
    return call("settings.appearance.set", patch).then(() => true, error => {
      const now = appearanceNow.current;
      const keys = Object.keys(patch).filter(key => now[key] === patch[key]);
      if (keys.length) {
        appearanceNow.current = { ...now, ...Object.fromEntries(keys.map(key => [key, before[key]])) };
        setAppearanceState(appearanceNow.current);
        applyAppearance(appearanceNow.current);
      }
      toast(`Couldn't save that change, so it was put back. ${error.message}`, { tone: "error" });
      return false;
    });
  }, [toast]);

  const toggleLater = useCallback(item => {
    const was = laterIds.has(`${item.type}:${item.id}`);
    const payload = { id: item.id, type: item.type, name: item.name, poster: item.poster, banner: item.banner, logo: item.logo, releaseInfo: item.releaseInfo, imdbRating: item.imdbRating, genres: item.genres };
    call("watchLater.toggle", { item: payload }).then(
      () => toast(was ? `Removed ${item.name} from your list` : `Added ${item.name} to your list`, {
        // Taking something off by accident is easy (the bookmark sits on every poster): one click undoes it.
        action: was ? { label: "Undo", run: () => call("watchLater.toggle", { item: payload }).catch(() => {}) } : undefined,
      }),
      error => toast(error.message, { tone: "error" }),
    );
  }, [laterIds, toast]);

  // An AniList title for a later season opens on that season.
  const openDetails = useCallback(item => navigate("details", { type: item.type, id: item.id, name: item.name, ...(item.season ? { season: item.season } : {}) }), []);

  /** Continue watching: replay the last source when the app still has it, else pick a source. */
  const resume = useCallback(async entry => {
    let target = { videoId: entry.videoId, season: entry.season, episode: entry.episode };
    try {
      const result = await call("play.resume", {
        type: entry.type, id: entry.id, videoId: entry.videoId, season: entry.season, episode: entry.episode,
        nextEpisode: Boolean(entry.nextEpisode),
      });
      if (result?.handled) {
        // The player is up. Behind it, open the series' own page: when the episode ends (or is
        // closed) the next one is right there, instead of Home.
        if (entry.type === "series" || entry.season != null) {
          navigate("details", { type: entry.type, id: entry.id, name: entry.name, ...(result.season ?? entry.season) != null ? { season: result.season ?? entry.season } : {} });
        }
        return;
      }
      if (result?.videoId) target = { videoId: result.videoId, season: result.season, episode: result.episode };
    } catch (error) {
      toast(error.message, { tone: "error" });
      if (entry.nextEpisode) return;
    }
    navigate("details", { type: entry.type, id: entry.id, name: entry.name, sources: target.videoId, season: target.season, episode: target.episode });
  }, [toast]);

  // Continue watching entries taken off while their Undo is up. They leave every screen that
  // reads the list at once (through a lens on the topic); the app is told only when the note has
  // gone without an Undo, because it keeps no copy to restore. Same as Library's own list.
  const leavingContinue = useRef(new Set());
  const lensContinue = useCallback(() => {
    const keys = leavingContinue.current;
    setLens("continue", keys.size ? list => (Array.isArray(list) ? list.filter(entry => !keys.has(entry.key)) : list) : null);
  }, []);
  const removeContinue = useCallback(entry => {
    const key = entry.key ?? `${entry.type}:${entry.id}`;
    if (leavingContinue.current.has(key)) return;
    const showAgain = () => { leavingContinue.current.delete(key); lensContinue(); };
    leavingContinue.current.add(key);
    lensContinue();
    toast(`Removed ${entry.name} from Continue watching`, {
      action: { label: "Undo", run: () => {} },
      onDone: undone => {
        if (undone) { showAgain(); return; }
        call("continue.remove", { id: entry.id, type: entry.type }).then(
          // The app sends the shorter list on its own; stop hiding once it surely has.
          () => window.setTimeout(showAgain, 15000),
          error => { showAgain(); toast(error.message, { tone: "error" }); },
        );
      },
    });
  }, [toast, lensContinue]);

  const value = useMemo(() => ({
    boot, profile, setProfile, appearance, setAppearance, art, setArt, toast,
    watchLater, laterIds, toggleLater, openDetails, resume, removeContinue,
  }), [boot, profile, appearance, setAppearance, art, toast, watchLater, laterIds, toggleLater, openDetails, resume, removeContinue]);

  return (
    <AppContext.Provider value={value}>
      <ToastControlContext.Provider value={toastControl}>
        <ToastContext.Provider value={toasts}>{children}</ToastContext.Provider>
      </ToastControlContext.Provider>
    </AppContext.Provider>
  );
}

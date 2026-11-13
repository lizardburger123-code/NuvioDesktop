import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DURATION, EASE, reduceMotion, useSegmentPill } from "../lib/motion.js";
import { holdAmbient } from "../lib/hold.js";
import { LuChevronDown, LuCloudDownload, LuDownload, LuExternalLink, LuLoaderCircle, LuMaximize, LuPlay, LuRefreshCw, LuSearch, LuX, LuZap } from "react-icons/lu";
import { navigate } from "../lib/router.js";
import { useScreenActive } from "../lib/screen.js";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { SOURCE_KINDS, TAG_KIND, episodeCode, qualityRank, sourceCloseness, sourceFingerprint, sourceKind, sourceMatch, sourceScore, streamInfo } from "../lib/format.js";
import SubtitlePicker from "../components/SubtitlePicker.jsx";
import TorboxClear from "../components/TorboxClear.jsx";
import { cacheItem, etaText, isSending, onCacheReady, refreshCache, sendToTorbox, torboxConnected, useTorboxCache } from "../lib/torboxCache.js";
import "./Sources.css";

const QUALITIES = ["All", "4K", "1080p", "720p"];
const SORTS = [["best", "Best first"], ["largest", "Largest first"], ["smallest", "Smallest first"]];
const LOADING = { loading: true, groups: [] };
const NO_GROUPS = [];
// After this long, an addon that still hasn't answered is called slow.
const SLOW_MS = 10000;

// The filters stay as the user left them for the rest of the session: the next episode's list
// opens the same way.
const session = { quality: "All", cachedOnly: false, showRemoved: false, sort: "best", addon: "" };
const useSessionChoice = name => {
  const [value, setValue] = useState(session[name]);
  const set = useCallback(next => setValue(prev => {
    const value = typeof next === "function" ? next(prev) : next;
    session[name] = value;
    return value;
  }), [name]);
  return [value, set];
};

// ---- The same source as last time ---------------------------------------------------------------
// Per title (and profile), the traits of the file last started from this sheet. The next
// episode's list lifts the file that matches them, by the rule the player uses for its own
// next-episode pick (SourceFingerprint.kt, mirrored in format.js).
const LAST_SOURCE = "nuvio.lastSource";
const LAST_SOURCE_MAX = 200;
const readLastSources = () => {
  try {
    const value = JSON.parse(window.localStorage.getItem(LAST_SOURCE) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};
const rememberSource = (key, traits) => {
  const all = readLastSources();
  all[key] = { ...traits, at: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > LAST_SOURCE_MAX) {
    keys.sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0)).slice(0, keys.length - LAST_SOURCE_MAX).forEach(old => { delete all[old]; });
  }
  try { window.localStorage.setItem(LAST_SOURCE, JSON.stringify(all)); } catch { /* remembering is a nicety */ }
};

/** The file that carries on from [last]: its binge group when known, else the nearest same / close match. */
const continuation = (entries, last) => {
  if (!last) return null;
  const usable = entries.filter(entry => !entry.info.removed);
  if (last.bingeGroup) {
    const same = usable.find(entry => entry.stream.bingeGroup === last.bingeGroup);
    if (same) return { entry: same, level: "same" };
  }
  let best = null;
  let bestPoints = -1;
  usable.forEach(entry => {
    const now = sourceFingerprint(entry.stream);
    const level = sourceMatch(last, now);
    if (!level) return;
    const points = (level === "same" ? 200 : 100) + sourceCloseness(last, now);
    if (points > bestPoints) {
      bestPoints = points;
      best = { entry, level };
    }
  });
  return best;
};

// ---- Reading the list ---------------------------------------------------------------------------
const words = text => String(text || "").toLowerCase().replace(/[._\-[\](){}|/\\]+/g, " ");
const sameStream = (a, b) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
};
// A torrent sent to TorBox from this list plays from TorBox's copy once it is there.
const viaTorbox = entry => (!entry.info.cached && entry.stream.hash && cacheItem(entry.stream.hash)?.ready ? { torbox: true } : {});
const isReady = entry => entry.info.cached || Boolean(entry.stream.hash && cacheItem(entry.stream.hash)?.ready);
const bestOrder = (a, b) => (a.info.removed - b.info.removed) || (isReady(b) - isReady(a))
  || (qualityRank(b.info.quality) - qualityRank(a.info.quality)) || (a.order - b.order);
const comparator = (sort, imaxFirst) => (a, b) => (a.info.removed - b.info.removed)
  || (imaxFirst ? b.info.fullFrame - a.info.fullFrame : 0)
  || (sort === "largest" ? b.info.sizeBytes - a.info.sizeBytes
    : sort === "smallest" ? (a.info.sizeBytes || Infinity) - (b.info.sizeBytes || Infinity) || 0 : 0)
  || bestOrder(a, b);
const listNames = names => (names.length <= 3 ? names.join(", ").replace(/, ([^,]*)$/, " and $1") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`);
const failure = error => (/time ?out|timed out/i.test(error) ? "didn't answer in time"
  : /resolve host|unknown ?host|no address|unreachable|refused|network|connect/i.test(error) ? "couldn't be reached"
    : "couldn't list its sources");
const removalReason = stream => (String(stream.description || stream.title || "").split(/\r?\n/)
  .find(line => /removal reason|removed:|excluded/i.test(line)) || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const typingIn = target => Boolean(target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA" || target.isContentEditable));
const isTopLayer = layer => {
  const layers = document.querySelectorAll("[data-modal-open]");
  return layers[layers.length - 1] === layer;
};

/** Side sheet listing every addon's sources for one movie or episode. */
export default function Sources({ meta, video, onClose }) {
  const { toast, profile } = useApp();
  const titleId = useId();
  const layerRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const [quality, setQuality] = useSessionChoice("quality");
  const [cachedOnly, setCachedOnly] = useSessionChoice("cachedOnly");
  const [showRemoved, setShowRemoved] = useSessionChoice("showRemoved");
  const [sort, setSort] = useSessionChoice("sort");
  const [addonChoice, setAddonChoice] = useSessionChoice("addon");
  const [fullFrameOnly, setFullFrameOnly] = useState(() => { try { return localStorage.getItem("nuvio.fullFrame") === "1"; } catch { return false; } });
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(null);
  const startingRef = useRef(null);
  // The "which subtitles?" window for the source just picked (when that setting is on).
  const [picker, setPicker] = useState(null);
  const askSubtitles = useRef(true);
  useEffect(() => {
    call("settings.subtitles.get").then(s => { askSubtitles.current = s?.askBeforePlay !== false; }, () => {});
  }, []);
  const topic = useTopic("streams", LOADING);
  const state = topic.key === video.videoId ? topic : LOADING;
  const groupsIn = state.groups || NO_GROUPS;

  // ---- Loading ----
  const [loadError, setLoadError] = useState(null);
  const [run, setRun] = useState(0);
  const load = () => {
    setLoadError(null);
    setRun(n => n + 1);
    call("streams.load", {
      type: meta.type, videoId: video.videoId, parentMetaId: meta.id, parentMetaType: meta.type,
      season: video.season ?? null, episode: video.episode ?? null,
    }).catch(error => setLoadError(error.message || "The sources couldn't be loaded."));
  };
  // A parked page of the same title can be told to open its sheet again (when the title's data is
  // pushed anew); that sheet closes at once and must not take the sources over from this one.
  const screenActive = useScreenActive();
  const shown = useRef(screenActive);
  useEffect(() => { if (shown.current) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [video.videoId]);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!state.loading) return undefined;
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [state.loading, run]);

  // A full-screen glass sheet: ambient motion behind it would make it re-blur every frame.
  useEffect(() => (shown.current ? holdAmbient() : undefined), []);

  // The sheet slides in from the edge it belongs to. Opacity sits on the sheet itself (never on an
  // ancestor), so its frosted glass keeps blurring the page behind it.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const qualityRef = useRef(null);
  useSegmentPill(qualityRef);
  useLayoutEffect(() => {
    if (!panelRef.current) return;
    panelRef.current.focus({ preventScroll: true });
    if (reduceMotion()) return;
    panelRef.current.animate(
      [{ opacity: 0, transform: "translate3d(64px, 0, 0)" }, { opacity: 1, transform: "none" }],
      { duration: DURATION.sheet + 100, easing: EASE.out },
    );
  }, []);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (!panelRef.current || reduceMotion()) { onCloseRef.current(); return; }
    setClosing(true);
    const exit = panelRef.current.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(32px, 0, 0)" }],
      { duration: DURATION.exit, easing: EASE.exit, fill: "forwards" },
    );
    exit.onfinish = () => onCloseRef.current();
  }, []);

  // Focus goes back to whatever opened the sheet (the Sources or Play button), when it is still there.
  // A sheet that opened by itself (Resume, a spotlight's Play) hands it to the title's Play button.
  const opener = useRef(undefined);
  if (opener.current === undefined) {
    const at = document.activeElement;
    opener.current = !shown.current ? null : at && at !== document.body ? at : document.querySelector(".screen-host:not(.is-parked) .details-play");
  }
  useEffect(() => () => {
    const node = opener.current;
    if (node && node !== document.body && node.isConnected && !node.closest("[inert], .is-parked")) node.focus({ preventScroll: true });
  }, []);
  // The sheet belongs to its title page: if anything navigates away underneath, it goes too.
  useEffect(() => { if (!screenActive) onCloseRef.current(); }, [screenActive]);

  // ---- Every file, read once (and kept as the same object while it stays the same) ----
  const torbox = useTorboxCache();
  const previous = useRef(new Map());
  const data = useMemo(() => {
    const before = previous.current;
    const kept = new Map();
    const entries = [];
    let imax = 0;
    let removed = 0;
    const removedIn = new Map();
    groupsIn.forEach(group => (group.streams || []).forEach(stream => {
      const old = before.get(stream.key);
      let entry = old && sameStream(old.stream, stream) ? old : null;
      if (!entry) {
        const info = streamInfo(stream);
        entry = {
          stream, info, groupId: group.addonId, addonName: group.addonName || stream.addonName || "",
          haystack: words([info.release, stream.name, stream.title, stream.description, group.addonName, info.tags.join(" ")].join(" ")),
          order: 0,
        };
      }
      entry.order = entries.length;
      kept.set(stream.key, entry);
      entries.push(entry);
      if (entry.info.fullFrame) imax += 1;
      if (entry.info.removed) {
        removed += 1;
        removedIn.set(group.addonId, (removedIn.get(group.addonId) || 0) + 1);
      }
    }));
    previous.current = kept;
    const withFiles = groupsIn.filter(group => group.streams?.length);
    return { entries, imax, removed, removedIn, withFiles };
  }, [groupsIn]);
  const allCount = data.entries.length;
  // An addon chosen earlier applies while that addon is in the list (even while it is loading).
  const addon = addonChoice && groupsIn.some(group => group.addonId === addonChoice) ? addonChoice : "";

  // ---- What is shown, in order ----
  const tokens = useMemo(() => words(query).split(" ").filter(Boolean), [query]);
  const view = useMemo(() => {
    const keep = entry => (quality === "All" || entry.info.quality === quality)
      && (!cachedOnly || isReady(entry)) && (showRemoved || !entry.info.removed)
      && (!addon || entry.groupId === addon)
      && tokens.every(token => entry.haystack.includes(token));
    const sections = groupsIn.filter(group => !addon || group.addonId === addon).map(group => ({ group, rows: [] }));
    const byId = new Map(sections.map(section => [section.group.addonId, section]));
    data.entries.forEach(entry => { if (keep(entry)) byId.get(entry.groupId)?.rows.push(entry); });
    const compare = comparator(sort, fullFrameOnly);
    sections.forEach(section => section.rows.sort(compare));
    const rows = sections.flatMap(section => section.rows);
    return { sections, rows, keys: new Set(rows.map(entry => entry.stream.key)) };
    // torbox: "On TorBox" counts as cached for the filter and the order.
  }, [data, groupsIn, quality, cachedOnly, showRemoved, addon, tokens, sort, fullFrameOnly, torbox]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = view.rows.length;

  // The best file of each kind, lifted into its own strip at the top. Every row there is a
  // different file: a file that tops several kinds says so once, and those kinds then offer their
  // next best file. A typed filter is a search, so the strip steps aside for it.
  const highlights = useMemo(() => {
    if (tokens.length) return [];
    const rows = view.rows.filter(entry => !entry.info.removed);
    if (rows.length < 3) return [];
    const score = new Map(rows.map(entry => [entry, sourceScore(entry.info, isReady(entry))]));
    const ranked = list => list.sort((a, b) => score.get(b) - score.get(a));
    const kinds = SOURCE_KINDS
      .map(kind => ({ id: kind.id, label: kind.label, rows: ranked(rows.filter(({ info }) => kind.test(info))) }))
      .filter(kind => kind.rows.length);
    const picks = [];
    const taken = new Set();
    kinds.forEach(kind => {
      const top = kind.rows[0];
      const holder = picks.find(pick => pick.entry.stream.key === top.stream.key);
      if (holder) holder.also.push(kind.label);
      const entry = holder ? kind.rows.find(candidate => !taken.has(candidate.stream.key)) : top;
      if (!entry || picks.length >= 4) return;
      taken.add(entry.stream.key);
      picks.push({ kind: kind.id, label: kind.label, best: !holder, also: [], entry });
    });
    return picks;
  }, [view, tokens]); // eslint-disable-line react-hooks/exhaustive-deps

  // The file that carries on from the last one started here, while it passes the filters.
  const memoryKey = `${profile?.id ?? 0}:${meta.type}:${meta.id}`;
  const last = useMemo(() => readLastSources()[memoryKey] || null, [memoryKey]);
  const match = useMemo(() => continuation(data.entries, last), [data, last]);
  const lead = match && view.keys.has(match.entry.stream.key) ? match : null;

  // "Play best": cached first, then the highest quality, across every addon.
  const bestEntry = useMemo(() => {
    const compare = comparator("best", fullFrameOnly);
    return view.rows.filter(entry => !entry.info.removed).reduce((best, entry) => (!best || compare(entry, best) < 0 ? entry : best), null);
  }, [view, fullFrameOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Playing ----
  const playParams = stream => ({
    type: meta.type, metaId: meta.id, metaType: meta.type, videoId: video.videoId,
    season: video.season ?? null, episode: video.episode ?? null, episodeTitle: video.title || null,
    thumbnail: video.thumbnail || null, title: meta.name, logo: meta.logo || null, poster: meta.poster || null,
    background: meta.background || null, description: meta.description || null, streamKey: stream.key,
  });

  const start = async (stream, subtitle, extra = {}) => {
    startingRef.current = stream.key;
    setStarting(stream.key);
    try {
      const params = { ...playParams(stream), ...extra };
      await call("play", subtitle === undefined ? params : { ...params, subtitle }, { timeoutMs: 60000 });
      rememberSource(memoryKey, { ...sourceFingerprint(stream), bingeGroup: stream.bingeGroup || "" });
    } finally {
      window.setTimeout(() => { startingRef.current = null; setStarting(null); }, 1500);
    }
  };

  // extra: { torbox: true } plays TorBox's cached copy of a torrent sent from this list.
  const play = (stream, extra = {}) => {
    if (startingRef.current) return;
    if (askSubtitles.current) { setPicker({ stream, extra }); return; }
    start(stream, undefined, extra).catch(error => toast(error.message, { tone: "error" }));
  };

  // ---- Cache on TorBox ----
  const [connect, setConnect] = useState(null);
  const cacheable = useMemo(() => data.entries.filter(entry => entry.stream.hash && !entry.info.cached).map(entry => entry.stream.hash), [data]);
  const hashKey = cacheable.join(",");
  // Once the list is in: which of these TorBox already has (or is downloading).
  useEffect(() => {
    if (state.loading || !cacheable.length || torboxConnected() === false) return;
    refreshCache(cacheable).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loading, hashKey]);
  // While something downloads, follow it.
  const downloading = cacheable.filter(hash => { const item = cacheItem(hash); return item && !item.ready; });
  const downloadingKey = downloading.join(",");
  useEffect(() => {
    if (!downloading.length) return undefined;
    const timer = window.setInterval(() => refreshCache(downloading).catch(() => {}), 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadingKey]);
  useEffect(() => onCacheReady(name => toast(`Ready on TorBox: ${name}`)), [toast]);

  // Save a source to disk (direct links, or a torrent's TorBox copy).
  const [saving, setSaving] = useState(null);
  const savingRef = useRef(null);
  const download = async (stream, extra = {}) => {
    if (savingRef.current) return;
    savingRef.current = stream.key;
    setSaving(stream.key);
    try {
      const params = { ...playParams(stream), ...extra };
      const result = await call("downloads.start", params, { timeoutMs: 60000 });
      toast(result?.result === "replaced" ? "Downloading again (the old copy was replaced)" : "Downloading", {
        action: { label: "Show", run: () => { close(); navigate("library", { tab: "downloads" }); } },
      });
    } catch (error) {
      if (/connect torbox/i.test(error.message)) setConnect({ retry: () => download(stream, extra) });
      else toast(error.message, { tone: "error" });
    } finally {
      savingRef.current = null;
      setSaving(null);
    }
  };

  const sendCache = async stream => {
    const info = streamInfo(stream);
    try {
      await sendToTorbox(stream.hash, info.release || stream.name);
      toast("Sent to TorBox. It plays from here once it's downloaded.");
    } catch (error) {
      if (/connect torbox/i.test(error.message)) setConnect({ retry: () => sendCache(stream) });
      else toast(error.message, { tone: "error" });
    }
  };

  // Rows are memoised; they reach the latest handlers through this one stable object.
  const handlers = useRef({});
  handlers.current = { play, download, sendCache };
  const actions = useMemo(() => ({
    play: (stream, extra) => handlers.current.play(stream, extra),
    download: (stream, extra) => handlers.current.download(stream, extra),
    sendCache: stream => handlers.current.sendCache(stream),
  }), []);

  const clearFilters = () => { setQuality("All"); setCachedOnly(false); setAddonChoice(""); setQuery(""); };

  // ---- Keyboard: arrows move through the rows, Enter plays, typing filters, Escape closes ----
  const live = useRef({});
  live.current = { query, close, bestEntry };
  // Until the user does something, focus follows the "same as last time" row as the list fills in.
  const autoFocus = useRef(true);
  useEffect(() => {
    const rows = () => [...(listRef.current?.querySelectorAll(".source-row") || [])];
    const go = row => { if (!row) return; row.focus({ preventScroll: true }); row.scrollIntoView({ block: "nearest" }); };
    const onKey = event => {
      const layer = layerRef.current;
      if (!layer || !isTopLayer(layer)) return;
      autoFocus.current = false;
      const panel = panelRef.current;
      const search = searchRef.current;
      const target = event.target;
      const { query: text, close: shut } = live.current;
      const key = event.key;
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (text) setQuery(""); else shut();
        return;
      }
      if (key === "Tab") {
        const items = [...panel.querySelectorAll("button:not([disabled]), input, select, [tabindex='0']")];
        if (!items.length) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        const at = document.activeElement;
        if (!panel.contains(at) || at === panel) { event.preventDefault(); (event.shiftKey ? lastItem : first).focus(); }
        else if (!event.shiftKey && at === lastItem) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && at === first) { event.preventDefault(); lastItem.focus(); }
        return;
      }
      if ((event.altKey && key === "ArrowLeft") || ((event.ctrlKey || event.metaKey) && /^[fk]$/i.test(key))) {
        // Back closes the sheet instead of leaving the page under it; Ctrl+F / Ctrl+K filter here.
        event.preventDefault();
        event.stopPropagation();
        if (event.altKey) shut(); else { search.focus(); search.select(); }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const row = target.closest?.(".source-item") ? target.closest(".source-item").querySelector(".source-row") : null;
      const free = target === panel || target === document.body || !panel.contains(target);
      if (key === "ArrowDown" || key === "ArrowUp") {
        if (!row && !free && target !== search) return; // the quality switch and menus keep their keys
        if (target === search && key === "ArrowUp") return;
        event.preventDefault();
        const list = rows();
        const index = row ? list.indexOf(row) : -1;
        if (key === "ArrowUp" && index <= 0) { if (row) search.focus(); return; }
        go(key === "ArrowDown" ? list[Math.min(list.length - 1, index + 1)] : list[index - 1]);
        return;
      }
      if ((key === "Home" || key === "End" || key === "PageDown" || key === "PageUp") && (row || free)) {
        event.preventDefault();
        const list = rows();
        const index = row ? list.indexOf(row) : -1;
        const step = Math.max(1, Math.floor((listRef.current?.clientHeight || 600) / 90));
        go(list[key === "Home" ? 0 : key === "End" ? list.length - 1
          : key === "PageDown" ? Math.min(list.length - 1, index + step) : Math.max(0, index - step)]);
        return;
      }
      if (key === "Enter" && target === search) {
        // Enter in the filter plays the first file it found.
        event.preventDefault();
        rows()[0]?.click();
        return;
      }
      if (typingIn(target)) return;
      if (key === "Backspace") {
        // Never "go back" from under the sheet; with a filter typed, keep editing it.
        event.stopPropagation();
        if (text) { search.focus(); search.setSelectionRange(text.length, text.length); } else event.preventDefault();
        return;
      }
      if (key === "/") {
        event.preventDefault();
        event.stopPropagation();
        search.focus();
        search.select();
        return;
      }
      if (key.length === 1 && key !== " ") {
        // Typing anywhere in the sheet filters: the character lands in the field.
        event.stopPropagation();
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
    };
    // The mouse's back button closes the sheet, like Escape.
    const onMouse = event => {
      if (event.button !== 3 || !layerRef.current || !isTopLayer(layerRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      live.current.close();
    };
    const onPointer = event => { if (panelRef.current?.contains(event.target)) autoFocus.current = false; };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mouseup", onMouse, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mouseup", onMouse, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  // A row that leaves the list (the picks change as addons answer) takes focus with it; keep the
  // keyboard inside the sheet, and on the "same as last time" row until the user takes over.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || closingRef.current || !isTopLayer(layer)) return;
    const at = document.activeElement;
    const adrift = !at || at === document.body;
    if (autoFocus.current && lead && (adrift || at === panelRef.current || at?.closest?.(".is-lead"))) {
      const row = listRef.current?.querySelector(".source-item.is-lead .source-row");
      if (row && row !== at) row.focus({ preventScroll: true });
      return;
    }
    if (adrift) panelRef.current?.focus({ preventScroll: true });
  });

  // Rows settle in once, when the first of them arrive; later answers slot in without moving
  // what is already on screen.
  const settled = useRef(false);
  useLayoutEffect(() => {
    if (settled.current || !total || !listRef.current) return;
    settled.current = true;
    if (reduceMotion()) return;
    const rows = [...listRef.current.querySelectorAll(".source-item")].slice(0, 10);
    rows.forEach((row, i) => row.animate(
      [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 380, delay: i * 22, easing: EASE.out, fill: "backwards" },
    ));
  }, [total]);

  // ---- States ----
  const pending = groupsIn.filter(group => group.loading).map(group => group.addonName);
  const failed = groupsIn.filter(group => group.error);
  const several = data.withFiles.length > 1;
  const nothing = !state.loading && !allCount;
  const filtersHideAll = allCount > 0 && total === 0;
  const kindOf = video.season != null ? "episode" : meta.type === "movie" ? "movie" : "title";

  const renderEntry = (entry, extra = {}) => {
    const { stream } = entry;
    const canCache = Boolean(stream.hash) && !entry.info.cached;
    return (
      <SourceItem
        key={`${extra.pick ? "pick:" : extra.lead ? "lead:" : ""}${stream.key}`}
        entry={entry}
        pick={extra.pick || null}
        lead={extra.lead || ""}
        addonLabel={several && (extra.pick || extra.lead) ? entry.addonName : ""}
        item={canCache ? cacheItem(stream.hash) : null}
        sending={canCache && isSending(stream.hash)}
        busy={starting === stream.key}
        waiting={starting != null && starting !== stream.key}
        saving={saving === stream.key}
        savingOther={saving != null && saving !== stream.key}
        actions={actions}
      />
    );
  };

  const emptyState = () => {
    if (loadError) {
      return (
        <div className="sources-empty" role="alert">
          <h3>Couldn't ask your addons</h3>
          <p>{loadError}</p>
          <button className="btn btn-glass btn-sm" onClick={load}><LuRefreshCw /> Try again</button>
        </div>
      );
    }
    if (state.empty === "NoAddonsInstalled" || state.empty === "NoCompatibleAddons") {
      const none = state.empty === "NoAddonsInstalled";
      return (
        <div className="sources-empty">
          <h3>{none ? "No stream addons yet" : `No addon covers this ${kindOf}`}</h3>
          <p>{none
            ? "Sources come from stream addons such as AIOStreams or Torrentio. Add one, then come back here."
            : `None of your installed addons offer sources for this ${kindOf}. A stream addon such as AIOStreams or Torrentio does.`}</p>
          <button className="btn btn-glass btn-sm" onClick={() => { close(); navigate("addons"); }}>Open addons</button>
        </div>
      );
    }
    const allFailed = state.empty === "StreamFetchFailed" || (groupsIn.length > 0 && failed.length === groupsIn.length);
    const names = listNames(failed.map(group => group.addonName));
    return (
      <div className="sources-empty">
        <h3>{allFailed ? "Your addons didn't answer" : "No sources found"}</h3>
        <p>{allFailed
          ? `No answer from ${names}. Check your connection (and that TorBox is reachable), then try again.`
          : `None of your addons returned a source for this ${kindOf}.${failed.length ? ` ${names} didn't answer.` : ""} Check your stream addon (AIOStreams) is installed and TorBox is reachable, then reload.`}</p>
        <button className="btn btn-glass btn-sm" onClick={load}><LuRefreshCw /> {allFailed ? "Try again" : "Reload"}</button>
      </div>
    );
  };

  if (!shown.current) return null;
  return createPortal(
    <>
    <div ref={layerRef} className={`sources-layer${closing ? " is-closing" : ""}`} data-modal-open onClick={close}>
      <aside
        ref={panelRef}
        className="sources"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
      >
        <header className="sources-head">
          <div className="sources-titles">
            <h2 id={titleId} className="sources-title" dir="auto">{meta.name}</h2>
            {video.season != null ? (
              <span className="sources-sub num">{episodeCode(video.season, video.episode)}{video.title ? <> · <span dir="auto">{video.title}</span></> : null}</span>
            ) : null}
          </div>
          <div className="sources-tools">
            <button className="btn btn-ghost btn-sm" onClick={load} aria-label="Reload sources" title="Reload"><LuRefreshCw /></button>
            <button className="btn btn-primary btn-sm" onClick={() => bestEntry && play(bestEntry.stream, viaTorbox(bestEntry))} disabled={!bestEntry} title="Play the best source: cached first, then the highest quality"><LuPlay /> Play best</button>
            <button className="btn btn-glass btn-icon btn-sm" onClick={close} aria-label="Close sources"><LuX /></button>
          </div>
        </header>

        <div className="sources-filters">
          <div className="sources-search">
            <LuSearch aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Filter by name or group"
              aria-label="Filter sources"
              spellCheck={false}
              autoComplete="off"
            />
            {query ? <button type="button" className="sources-search-clear" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear the filter"><LuX /></button> : null}
          </div>
          <label className={`sources-menu${sort !== "best" ? " is-set" : ""}`}>
            <span className="sr-only">Order</span>
            <select value={sort} onChange={event => setSort(event.target.value)}>
              {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <LuChevronDown aria-hidden="true" />
          </label>
          {several || addon ? (
            <label className={`sources-menu${addon ? " is-set" : ""}`}>
              <span className="sr-only">Addon</span>
              <select value={addon} onChange={event => setAddonChoice(event.target.value)}>
                <option value="">All addons</option>
                {groupsIn.filter(group => group.streams?.length || group.addonId === addon).map(group => (
                  <option key={group.addonId} value={group.addonId}>{`${group.addonName} (${group.streams?.length || 0})`}</option>
                ))}
              </select>
              <LuChevronDown aria-hidden="true" />
            </label>
          ) : null}
          <div ref={qualityRef} className="seg" role="group" aria-label="Quality">
            {QUALITIES.map(q => (
              <button key={q} aria-pressed={quality === q} onClick={() => setQuality(q)}>{q}</button>
            ))}
          </div>
          <button className="chip" aria-pressed={cachedOnly} onClick={() => setCachedOnly(v => !v)} title="Only files that play straight away">
            <LuZap /> Cached
          </button>
          <button
            className="chip"
            aria-pressed={fullFrameOnly}
            title="Put IMAX, IMAX Enhanced and Open Matte releases (taller picture, fewer black bars) at the top"
            onClick={() => setFullFrameOnly(v => { const next = !v; try { localStorage.setItem("nuvio.fullFrame", next ? "1" : "0"); } catch {} return next; })}
          >
            <LuMaximize /> IMAX first{data.imax ? <span className="num">{` (${data.imax})`}</span> : null}
          </button>
        </div>

        <div className="sources-list" ref={listRef} aria-busy={state.loading || undefined}>
          {pending.length && (allCount || slow) ? (
            <p className="sources-status" role="status">
              <LuLoaderCircle className="spin" aria-hidden="true" />
              {slow
                ? <span>Still waiting for {listNames(pending)}. {pending.length === 1 ? "It is" : "They are"} slow to answer; what's here can be picked now.</span>
                : <span>Waiting for {listNames(pending)}</span>}
            </p>
          ) : null}
          {loadError && allCount ? (
            <p className="sources-status is-error" role="alert">
              <span>Couldn't reload: {loadError}</span>
              <button className="sources-retry" onClick={load}>Try again</button>
            </p>
          ) : null}
          {lead ? (
            <section className="sources-group sources-lead" aria-label={lead.level === "same" ? "Same source as last time" : "Closest to last time"}>
              {renderEntry(lead.entry, { lead: lead.level })}
            </section>
          ) : null}
          {highlights.length ? (
            <section className="sources-group sources-picks" aria-label="Best of each">
              <header className="sources-group-head"><span>Best of each</span></header>
              {highlights.map(pick => renderEntry(pick.entry, { pick }))}
            </section>
          ) : null}
          {filtersHideAll ? (
            <div className="sources-empty is-filtered">
              <h3>Nothing matches</h3>
              <p>{`None of the ${allCount} ${allCount === 1 ? "file matches" : "files match"} ${tokens.length ? `"${query.trim()}" with ` : ""}these filters.`}</p>
              <button className="btn btn-glass btn-sm" onClick={clearFilters}>Clear filters</button>
            </div>
          ) : null}
          {nothing ? null : view.sections.map(({ group, rows }) => (
            <section key={group.addonId} className="sources-group" aria-label={group.addonName}>
              <header className="sources-group-head">
                <span>{group.addonName}</span>
                {group.loading ? <LuLoaderCircle className="spin" aria-label="Loading" /> : (
                  <span className="num t-faint">{rows.length !== (group.streams || []).length ? `${rows.length} of ${(group.streams || []).length}` : rows.length}</span>
                )}
              </header>
              {group.error ? (
                <p className="sources-note is-error" title={group.error}>
                  <span>{`${group.addonName} ${failure(group.error)}.`}</span>
                  <button className="sources-retry" onClick={load}>Try again</button>
                </p>
              ) : null}
              {!group.loading && !group.error && rows.length === 0 && !filtersHideAll ? (
                <p className="sources-note">{(group.streams || []).length ? "Nothing here matches these filters." : `No sources from this addon.`}</p>
              ) : null}
              {group.loading && !rows.length && !(group.streams || []).length ? (
                Array.from({ length: allCount ? 1 : 3 }, (_, i) => <div key={i} className="source-row source-skel" aria-hidden="true"><div className="skel" /><div className="skel" /></div>)
              ) : null}
              {rows.map(entry => renderEntry(entry))}
              {data.removedIn.get(group.addonId) && !group.loading ? (
                <button className="sources-more" onClick={() => setShowRemoved(v => !v)} title="Files this addon's own filters dropped, listed with the reason">
                  {showRemoved
                    ? "Hide the files this addon filtered out"
                    : `Show ${data.removedIn.get(group.addonId)} ${data.removedIn.get(group.addonId) === 1 ? "file" : "files"} ${group.addonName} filtered out`}
                </button>
              ) : null}
            </section>
          ))}
          {state === LOADING && !loadError ? (
            Array.from({ length: 4 }, (_, i) => <div key={i} className="source-row source-skel" aria-hidden="true"><div className="skel" /><div className="skel" /></div>)
          ) : null}
          {nothing || (loadError && !allCount) ? emptyState() : null}
        </div>
      </aside>
    </div>
      {picker ? (
        <SubtitlePicker
          key={picker.stream.key}
          request={{ type: meta.type, metaId: meta.id, metaType: meta.type, videoId: video.videoId, season: video.season ?? null, episode: video.episode ?? null, title: meta.name, streamKey: picker.stream.key }}
          onPlay={key => start(picker.stream, key, picker.extra)}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {connect ? (
        <TorboxClear mode="connect" onClose={() => setConnect(null)} onConnected={() => { const retry = connect.retry; setConnect(null); retry(); }} />
      ) : null}
    </>,
    document.body,
  );
}

/**
 * One file in the list. [pick] marks it as the best of its kind(s) in the strip at the top;
 * [lead] as the file that carries on from the last one played ("same" or "close").
 */
const SourceItem = memo(function SourceItem({ entry, pick, lead, addonLabel, item, sending, busy, waiting, saving, savingOther, actions }) {
  const { stream, info } = entry;
  const kind = pick?.kind || sourceKind(info);
  const canCache = Boolean(stream.hash) && !info.cached;
  const onTorbox = Boolean(item?.ready);
  const reason = info.removed ? removalReason(stream) : "";
  const release = info.release || stream.name || "Unnamed source";
  return (
    <div
      className={`source-item${canCache ? " has-cache" : ""}${pick ? " is-pick" : ""}${lead ? " is-lead" : ""}${info.removed ? " is-removed" : ""}${waiting ? " is-waiting" : ""}`}
      data-kind={kind || undefined}
    >
      <button
        className="source-row"
        onClick={() => { if (!waiting) actions.play(stream, onTorbox ? { torbox: true } : {}); }}
        aria-disabled={waiting || undefined}
        aria-busy={busy || undefined}
      >
        <span className={`source-q q-${(info.quality || "na").toLowerCase()}`}>
          <strong>{info.quality || "—"}</strong>
          {info.tags.includes("DV") ? <small>DV</small> : info.tags.find(t => t.startsWith("HDR")) ? <small>HDR</small> : null}
        </span>
        <span className="source-body">
          {lead ? <span className="source-pick source-lead-label">{lead === "same" ? "Same as last time" : "Closest to last time"}</span> : null}
          {pick ? (
            <span className="source-pick">
              {pick.best ? `Best ${pick.label}` : `${pick.label}, next best`}
              {pick.also.length ? <em>{` · also the best ${pick.also.slice(0, 2).join(", ")}${pick.also.length > 2 ? ` +${pick.also.length - 2}` : ""}`}</em> : null}
            </span>
          ) : null}
          <span className="source-release" dir="auto" title={release}>{release}</span>
          <span className="source-tags">
            {info.removed ? <span className="source-tag source-reason">{reason || "Filtered out by your addon"}</span> : null}
            {info.cached || onTorbox ? <span className="source-cached"><LuZap /> {onTorbox ? "On TorBox" : "Cached"}</span> : null}
            {stream.external ? <span className="source-tag">Opens in your browser</span> : null}
            {stream.p2p && !onTorbox ? <span className="source-tag">P2P</span> : null}
            {info.tags.filter(t => t !== "DV" && !t.startsWith("HDR")).map(tag => <span key={tag} className={`source-tag${TAG_KIND[tag] ? ` tag-${TAG_KIND[tag]}` : ""}`}>{tag}</span>)}
            {info.size ? <span className="source-size num">{info.size}</span> : null}
            {addonLabel ? <span className="source-addon">{addonLabel}</span> : null}
          </span>
        </span>
        {canCache ? <span className="source-cache-slot" aria-hidden="true" /> : null}
        <span className="source-dl-slot" aria-hidden="true" />
        <span className="source-go" aria-hidden="true">
          {busy ? <LuLoaderCircle className="spin" /> : stream.external ? <LuExternalLink /> : <LuPlay />}
        </span>
      </button>
      {canCache ? <CacheControl item={item} sending={sending} onSend={() => actions.sendCache(stream)} /> : null}
      {!stream.external && (!canCache || onTorbox) ? (
        <button
          className="source-dl"
          onClick={() => { if (!savingOther) actions.download(stream, onTorbox ? { torbox: true } : {}); }}
          aria-disabled={savingOther || undefined}
          aria-busy={saving || undefined}
          aria-label={`Download ${release}`}
          title="Download to this PC"
        >
          {saving ? <LuLoaderCircle className="spin" /> : <LuDownload />}
        </button>
      ) : null}
    </div>
  );
});

/** Send an uncached torrent to TorBox, then follow it until it can play from there. */
function CacheControl({ item, sending, onSend }) {
  if (sending) {
    return <span className="source-cache is-busy" role="status"><LuLoaderCircle className="spin" /> Sending…</span>;
  }
  if (item?.ready) return null;
  if (item) {
    const pct = Math.max(0, Math.min(100, Math.round((item.progress || 0) * 100)));
    const stalled = /stalled|no seeds/i.test(item.state || "") || (item.seeds === 0 && pct === 0 && /download/i.test(item.state || ""));
    const label = stalled ? "No seeds yet" : /queued/i.test(item.state || "") ? "Queued" : /meta/i.test(item.state || "") ? "Starting…" : `${pct}%`;
    return (
      <span className="source-cache is-progress" title={`TorBox: ${item.state}${item.eta ? ` · ${etaText(item.eta)} left` : ""}`} style={{ "--p": `${pct}%` }}>
        <span className="source-cache-bar"><i /></span>
        <span className="source-cache-label num">{label}{!stalled && item.eta ? <small>{etaText(item.eta)}</small> : null}</span>
      </span>
    );
  }
  return (
    <button className="source-cache" onClick={onSend} title="TorBox downloads it for you; it plays from here when it's ready">
      <LuCloudDownload /> Cache on TorBox
    </button>
  );
}

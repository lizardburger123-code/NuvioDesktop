import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DURATION, EASE, reduceMotion, useSegmentPill } from "../lib/motion.js";
import { holdAmbient } from "../lib/hold.js";
import { LuCloudDownload, LuLoaderCircle, LuMaximize, LuPlay, LuRefreshCw, LuX, LuZap } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { episodeCode, parseStream, qualityRank } from "../lib/format.js";
import SubtitlePicker from "../components/SubtitlePicker.jsx";
import TorboxClear from "../components/TorboxClear.jsx";
import { cacheItem, etaText, isSending, onCacheReady, refreshCache, sendToTorbox, torboxConnected, useTorboxCache } from "../lib/torboxCache.js";
import "./Sources.css";

const QUALITIES = ["All", "4K", "1080p", "720p"];

/** Side sheet listing every addon's sources for one movie or episode. */
export default function Sources({ meta, video, onClose }) {
  const { toast } = useApp();
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const [quality, setQuality] = useState("All");
  const [cachedOnly, setCachedOnly] = useState(false);
  const [fullFrameOnly, setFullFrameOnly] = useState(() => { try { return localStorage.getItem("nuvio.fullFrame") === "1"; } catch { return false; } });
  const [showRemoved, setShowRemoved] = useState(false);
  const [starting, setStarting] = useState(null);
  // The "which subtitles?" window for the source just picked (when that setting is on).
  const [picker, setPicker] = useState(null);
  const askSubtitles = useRef(true);
  const pickerOpen = useRef(false);
  pickerOpen.current = Boolean(picker);
  useEffect(() => {
    call("settings.subtitles.get").then(s => { askSubtitles.current = s?.askBeforePlay !== false; }, () => {});
  }, []);
  const topic = useTopic("streams", { key: null, loading: true, groups: [] });
  const state = topic.key === video.videoId ? topic : { loading: true, groups: [] };

  const load = () => call("streams.load", {
    type: meta.type, videoId: video.videoId, parentMetaId: meta.id, parentMetaType: meta.type,
    season: video.season ?? null, episode: video.episode ?? null,
  }).catch(error => toast(error.message, { tone: "error" }));

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [video.videoId]);
  // A full-screen glass sheet: ambient motion behind it would make it re-blur every frame.
  useEffect(() => holdAmbient(), []);

  useEffect(() => {
    // While the subtitle window (or the TorBox sign-in) is open, Escape belongs to it.
    const onKey = event => { if (event.key === "Escape" && !pickerOpen.current && !document.querySelector(".tbx-layer")) { event.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The sheet slides in from the edge it belongs to. Opacity sits on the sheet itself (never on an
  // ancestor), so its frosted glass keeps blurring the page behind it.
  const [closing, setClosing] = useState(false);
  const qualityRef = useRef(null);
  useSegmentPill(qualityRef);
  useLayoutEffect(() => {
    if (reduceMotion()) return;
    panelRef.current.animate(
      [{ opacity: 0, transform: "translate3d(64px, 0, 0)" }, { opacity: 1, transform: "none" }],
      { duration: DURATION.sheet + 100, easing: EASE.out },
    );
  }, []);

  const groups = useMemo(() => (state.groups || []).map(group => {
    const rows = (group.streams || []).map(stream => ({ stream, info: parseStream(stream) }))
      .filter(({ info }) => (quality === "All" || info.quality === quality) && (!cachedOnly || info.cached)
        && (showRemoved || !info.removed))
      // "IMAX first": expanded-ratio releases lead the list instead of hiding everything else.
      .sort((a, b) => (fullFrameOnly ? (b.info.fullFrame - a.info.fullFrame) : 0)
        || (b.info.cached - a.info.cached) || (qualityRank(b.info.quality) - qualityRank(a.info.quality)));
    return { ...group, rows };
  }), [state.groups, quality, cachedOnly, fullFrameOnly, showRemoved]);

  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const allCount = (state.groups || []).reduce((sum, group) => sum + (group.streams?.length || 0), 0);
  const imaxCount = useMemo(() => (state.groups || []).reduce((sum, group) =>
    sum + (group.streams || []).filter(stream => parseStream(stream).fullFrame).length, 0), [state.groups]);
  const removedCount = useMemo(() => (state.groups || []).reduce((sum, group) =>
    sum + (group.streams || []).filter(stream => parseStream(stream).removed).length, 0), [state.groups]);

  // Rows settle in as a list; only the first screenful staggers (the rest are below the fold).
  useLayoutEffect(() => {
    if (!listRef.current || reduceMotion()) return undefined;
    const rows = [...listRef.current.querySelectorAll(".source-row")].slice(0, 12);
    const animations = rows.map((row, i) => row.animate(
      [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 380, delay: i * 22, easing: EASE.out, fill: "backwards" },
    ));
    return () => animations.forEach(animation => animation.cancel());
  }, [allCount, quality, cachedOnly, fullFrameOnly, showRemoved]);

  const close = () => {
    if (closing) return;
    if (!panelRef.current || reduceMotion()) { onClose(); return; }
    setClosing(true);
    const exit = panelRef.current.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(32px, 0, 0)" }],
      { duration: DURATION.exit, easing: EASE.exit, fill: "forwards" },
    );
    exit.onfinish = onClose;
  };

  const playParams = stream => ({
    type: meta.type, metaId: meta.id, metaType: meta.type, videoId: video.videoId,
    season: video.season ?? null, episode: video.episode ?? null, episodeTitle: video.title || null,
    thumbnail: video.thumbnail || null, title: meta.name, logo: meta.logo || null, poster: meta.poster || null,
    background: meta.background || null, description: meta.description || null, streamKey: stream.key,
  });

  const start = async (stream, subtitle, extra = {}) => {
    setStarting(stream.key);
    try {
      const params = { ...playParams(stream), ...extra };
      await call("play", subtitle === undefined ? params : { ...params, subtitle }, { timeoutMs: 60000 });
    } finally {
      window.setTimeout(() => setStarting(null), 1500);
    }
  };

  // extra: { torbox: true } plays TorBox's cached copy of a torrent sent from this list.
  const play = (stream, extra = {}) => {
    if (askSubtitles.current) { setPicker({ stream, extra }); return; }
    start(stream, undefined, extra).catch(error => toast(error.message, { tone: "error" }));
  };

  // ---- Cache on TorBox ----
  useTorboxCache();
  const [connect, setConnect] = useState(null);
  const cacheable = useMemo(() => (state.groups || []).flatMap(group => (group.streams || [])
    .filter(stream => stream.hash && !parseStream(stream).cached)), [state.groups]);
  const hashKey = cacheable.map(stream => stream.hash).join(",");
  // Once the list is in: which of these TorBox already has (or is downloading).
  useEffect(() => {
    if (state.loading || !cacheable.length || torboxConnected() === false) return;
    refreshCache(cacheable.map(stream => stream.hash)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loading, hashKey]);
  // While something downloads, follow it.
  const downloading = cacheable.filter(stream => { const item = cacheItem(stream.hash); return item && !item.ready; }).map(stream => stream.hash);
  const downloadingKey = downloading.join(",");
  useEffect(() => {
    if (!downloading.length) return undefined;
    const timer = window.setInterval(() => refreshCache(downloading).catch(() => {}), 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadingKey]);
  useEffect(() => onCacheReady(name => toast(`Ready on TorBox: ${name}`)), [toast]);

  const sendCache = async stream => {
    const info = parseStream(stream);
    try {
      await sendToTorbox(stream.hash, info.release || stream.name);
      toast("Sent to TorBox. It plays from here once it's downloaded.");
    } catch (error) {
      if (/connect torbox/i.test(error.message)) setConnect({ retry: () => sendCache(stream) });
      else toast(error.message, { tone: "error" });
    }
  };

  const best = () => {
    const pick = groups.flatMap(group => group.rows)[0];
    if (pick) play(pick.stream);
  };

  return createPortal(
    <>
    <div className={`sources-layer${closing ? " is-closing" : ""}`} data-modal-open onClick={close}>
      <aside ref={panelRef} className="sources glass-dark" onClick={event => event.stopPropagation()} aria-label="Sources">
        <header className="sources-head">
          <div className="sources-titles">
            <span className="sources-kicker">Sources</span>
            <h2 className="sources-title" dir="auto">{meta.name}</h2>
            {video.season != null ? (
              <span className="sources-sub num">{episodeCode(video.season, video.episode)}{video.title ? ` · ${video.title}` : ""}</span>
            ) : null}
          </div>
          <div className="sources-tools">
            <button className="btn btn-ghost btn-sm" onClick={load} aria-label="Reload sources" title="Reload"><LuRefreshCw /></button>
            <button className="btn btn-primary btn-sm" onClick={best} disabled={!total}><LuPlay /> Best</button>
            <button className="btn btn-glass btn-icon btn-sm" onClick={close} aria-label="Close sources"><LuX /></button>
          </div>
        </header>

        <div className="sources-filters">
          <div ref={qualityRef} className="seg glass-flat" role="group" aria-label="Quality">
            {QUALITIES.map(q => (
              <button key={q} aria-pressed={quality === q} onClick={() => setQuality(q)}>{q}</button>
            ))}
          </div>
          <button className="chip" aria-pressed={cachedOnly} onClick={() => setCachedOnly(v => !v)}>
            <LuZap /> Cached
          </button>
          <button
            className="chip"
            aria-pressed={fullFrameOnly}
            title="Put IMAX, IMAX Enhanced and Open Matte releases (taller picture, fewer black bars) at the top"
            onClick={() => setFullFrameOnly(v => { const next = !v; try { localStorage.setItem("nuvio.fullFrame", next ? "1" : "0"); } catch {} return next; })}
          >
            <LuMaximize /> IMAX first{imaxCount ? ` (${imaxCount})` : ""}
          </button>
          {removedCount ? (
            <button className="chip" aria-pressed={showRemoved} onClick={() => setShowRemoved(v => !v)} title="Streams AIOStreams filtered out, listed with the reason">
              Filtered out ({removedCount})
            </button>
          ) : null}
        </div>

        <div className="sources-list" ref={listRef}>
          {groups.map(group => (
            <section key={group.addonId} className="sources-group">
              <header className="sources-group-head">
                <span>{group.addonName}</span>
                {group.loading ? <LuLoaderCircle className="spin" aria-label="Loading" /> : <span className="num t-faint">{group.rows.length}</span>}
              </header>
              {group.error ? <p className="sources-note">{group.error}</p> : null}
              {!group.loading && !group.error && group.rows.length === 0 ? (
                <p className="sources-note">{(group.streams || []).length ? "Nothing matches these filters." : "No sources from this addon."}</p>
              ) : null}
              {group.loading && !group.rows.length ? (
                Array.from({ length: 3 }, (_, i) => <div key={i} className="source-row source-skel"><div className="skel" /><div className="skel" /></div>)
              ) : null}
              {group.rows.map(({ stream, info }) => {
                const canCache = Boolean(stream.hash) && !info.cached;
                const item = canCache ? cacheItem(stream.hash) : null;
                const onTorbox = Boolean(item?.ready);
                return (
                  <div key={stream.key} className={`source-item${canCache ? " has-cache" : ""}`}>
                    <button
                      className="source-row"
                      onClick={() => play(stream, onTorbox ? { torbox: true } : {})}
                      disabled={starting != null}
                      aria-busy={starting === stream.key}
                    >
                      <span className={`source-q q-${(info.quality || "na").toLowerCase()}`}>
                        <strong>{info.quality || "—"}</strong>
                        {info.tags.includes("DV") ? <small>DV</small> : info.tags.find(t => t.startsWith("HDR")) ? <small>HDR</small> : null}
                      </span>
                      <span className="source-body">
                        <span className="source-release" title={info.release}>{info.release || stream.name}</span>
                        <span className="source-tags">
                          {info.cached || onTorbox ? <span className="source-cached"><LuZap /> {onTorbox ? "On TorBox" : "Cached"}</span> : null}
                          {stream.p2p && !onTorbox ? <span className="source-tag">P2P</span> : null}
                          {info.tags.filter(t => t !== "DV" && !t.startsWith("HDR")).map(tag => <span key={tag} className="source-tag">{tag}</span>)}
                          {info.size ? <span className="source-size num">{info.size}</span> : null}
                        </span>
                      </span>
                      {canCache ? <span className="source-cache-slot" aria-hidden="true" /> : null}
                      <span className="source-go" aria-hidden="true">
                        {starting === stream.key ? <LuLoaderCircle className="spin" /> : <LuPlay />}
                      </span>
                    </button>
                    {canCache ? <CacheControl stream={stream} item={item} onSend={() => sendCache(stream)} /> : null}
                  </div>
                );
              })}
            </section>
          ))}
          {!state.loading && !allCount ? (
            <div className="sources-empty">
              <h3>No sources found</h3>
              <p>None of your addons returned a source for this {video.season != null ? "episode" : "movie"}. Check your stream addon (AIOStreams) is installed and TorBox is reachable, then reload.</p>
              <button className="btn btn-glass btn-sm" onClick={load}><LuRefreshCw /> Reload</button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
      {picker ? (
        <SubtitlePicker
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

/** Send an uncached torrent to TorBox, then follow it until it can play from there. */
function CacheControl({ stream, item, onSend }) {
  if (isSending(stream.hash)) {
    return <span className="source-cache is-busy"><LuLoaderCircle className="spin" /> Sending…</span>;
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

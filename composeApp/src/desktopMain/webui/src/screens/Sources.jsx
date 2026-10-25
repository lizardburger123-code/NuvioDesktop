import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { LuLoaderCircle, LuMaximize, LuPlay, LuRefreshCw, LuX, LuZap } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { episodeCode, parseStream, qualityRank } from "../lib/format.js";
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
  const topic = useTopic("streams", { key: null, loading: true, groups: [] });
  const state = topic.key === video.videoId ? topic : { loading: true, groups: [] };

  const load = () => call("streams.load", {
    type: meta.type, videoId: video.videoId, parentMetaId: meta.id, parentMetaType: meta.type,
    season: video.season ?? null, episode: video.episode ?? null,
  }).catch(error => toast(error.message, { tone: "error" }));

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [video.videoId]);

  useEffect(() => {
    const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(panelRef.current, { x: 48, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.55, ease: "expo.out" });
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

  useLayoutEffect(() => {
    if (!listRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rows = listRef.current.querySelectorAll(".source-row");
    if (rows.length) gsap.fromTo(rows, { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: "power3.out", stagger: 0.025, clearProps: "transform,opacity,visibility" });
  }, [allCount, quality, cachedOnly, fullFrameOnly, showRemoved]);

  const close = () => {
    if (!panelRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    gsap.to(panelRef.current, { x: 24, autoAlpha: 0, duration: 0.22, ease: "power2.out", onComplete: onClose });
  };

  const play = async stream => {
    setStarting(stream.key);
    try {
      await call("play", {
        type: meta.type, metaId: meta.id, metaType: meta.type, videoId: video.videoId,
        season: video.season ?? null, episode: video.episode ?? null, episodeTitle: video.title || null,
        thumbnail: video.thumbnail || null, title: meta.name, logo: meta.logo || null, poster: meta.poster || null,
        background: meta.background || null, description: meta.description || null, streamKey: stream.key,
      });
    } catch (error) {
      toast(error.message, { tone: "error" });
    } finally {
      window.setTimeout(() => setStarting(null), 1500);
    }
  };

  const best = () => {
    const pick = groups.flatMap(group => group.rows)[0];
    if (pick) play(pick.stream);
  };

  return createPortal(
    <div className="sources-layer" data-modal-open onClick={close}>
      <aside ref={panelRef} className="sources glass-dark" onClick={event => event.stopPropagation()} aria-label="Sources">
        <header className="sources-head">
          <div className="sources-titles">
            <span className="sources-kicker">Sources</span>
            <h2 className="sources-title" dir="auto">{meta.name}</h2>
            {video.season != null ? (
              <span className="sources-sub num">{episodeCode(video.season, video.episode)}{video.title ? ` · ${video.title}` : ""}</span>
            ) : null}
          </div>
          <button className="btn btn-glass btn-icon btn-sm" onClick={close} aria-label="Close sources"><LuX /></button>
        </header>

        <div className="sources-filters">
          <div className="seg glass-flat" role="group" aria-label="Quality">
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
          <span className="sources-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={load} aria-label="Reload sources" title="Reload"><LuRefreshCw /></button>
          <button className="btn btn-primary btn-sm" onClick={best} disabled={!total}><LuPlay /> Best</button>
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
              {group.rows.map(({ stream, info }) => (
                <button key={stream.key} className="source-row" onClick={() => play(stream)} disabled={starting != null} aria-busy={starting === stream.key}>
                  <span className={`source-q q-${(info.quality || "na").toLowerCase()}`}>
                    <strong>{info.quality || "—"}</strong>
                    {info.tags.includes("DV") ? <small>DV</small> : info.tags.find(t => t.startsWith("HDR")) ? <small>HDR</small> : null}
                  </span>
                  <span className="source-body">
                    <span className="source-release" title={info.release}>{info.release || stream.name}</span>
                    <span className="source-tags">
                      {info.cached ? <span className="source-cached"><LuZap /> Cached</span> : null}
                      {info.tags.filter(t => t !== "DV" && !t.startsWith("HDR")).map(tag => <span key={tag} className="source-tag">{tag}</span>)}
                      {info.size ? <span className="source-size num">{info.size}</span> : null}
                    </span>
                  </span>
                  <span className="source-go" aria-hidden="true">
                    {starting === stream.key ? <LuLoaderCircle className="spin" /> : <LuPlay />}
                  </span>
                </button>
              ))}
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
    </div>,
    document.body,
  );
}

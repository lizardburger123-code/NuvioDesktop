import { useEffect, useLayoutEffect, useRef } from "react";
import { LuFolderOpen, LuPause, LuPlay, LuRotateCw, LuTrash2 } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import { episodeCode } from "../lib/format.js";
import "./Downloads.css";

const bytes = n => (!n ? "0 MB" : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);
const rate = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB/s` : `${Math.round(n / 1e3)} KB/s`);
const eta = s => (!isFinite(s) || s <= 0 ? "" : s < 60 ? "under a minute" : s < 3600 ? `${Math.round(s / 60)} min left` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min left`);
const STATUS = { downloading: "Downloading", paused: "Paused", completed: "Ready", failed: "Failed" };

/** Library › Downloads: what's saved on this PC, live while it downloads. */
export default function Downloads({ onCount }) {
  const { toast } = useApp();
  const items = useTopic("downloads", []);
  const listRef = useRef(null);
  useEffect(() => { call("downloads.subscribe").catch(() => {}); }, []);
  useEffect(() => { onCount?.(items.length); }, [items.length, onCount]);

  // A finished download says so once.
  const seen = useRef(new Map());
  useEffect(() => {
    items.forEach(item => {
      const was = seen.current.get(item.id);
      if (was && was !== "completed" && item.status === "completed") toast(`Downloaded: ${item.title}${item.season != null ? ` ${episodeCode(item.season, item.episode)}` : ""}`);
      seen.current.set(item.id, item.status);
    });
  }, [items, toast]);

  useLayoutEffect(() => {
    if (!listRef.current || reduceMotion()) return;
    [...listRef.current.children].slice(0, 10).forEach((node, i) => node.animate(
      [{ opacity: 0, transform: "translate3d(0, 8px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 320, delay: i * 30, easing: EASE.out, fill: "backwards" },
    ));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (name, item) => call(`downloads.${name}`, { id: item.id }).catch(error => toast(error.message, { tone: "error" }));
  const totalSpeed = items.reduce((sum, item) => sum + (item.status === "downloading" ? item.speed || 0 : 0), 0);

  if (!items.length) {
    return (
      <section className="library-empty">
        <h2 className="t-title">No downloads yet</h2>
        <p className="t-meta">Open a title's sources and press the download button on any source. Torrents download once they're cached on TorBox.</p>
        <button className="btn btn-glass btn-sm" onClick={() => call("downloads.reveal", {})}><LuFolderOpen /> Open the downloads folder</button>
      </section>
    );
  }

  return (
    <section className="dl">
      <div className="dl-bar">
        <span className="t-meta num">{items.length} {items.length === 1 ? "download" : "downloads"}{totalSpeed ? ` · ${rate(totalSpeed)}` : ""}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => call("downloads.reveal", {})}><LuFolderOpen /> Open folder</button>
      </div>
      <ul className="dl-list" ref={listRef}>
        {items.map(item => {
          const pct = item.total ? Math.min(100, (item.done / item.total) * 100) : 0;
          const live = item.status === "downloading";
          return (
            <li key={item.id} className={`dl-item is-${item.status}`}>
              <span className="dl-art">{item.thumbnail || item.poster ? <img src={item.thumbnail || item.poster} alt="" loading="lazy" /> : null}</span>
              <span className="dl-main">
                <strong dir="auto">{item.title}{item.season != null ? <em className="num"> {episodeCode(item.season, item.episode)}</em> : null}</strong>
                <span className="dl-file" title={item.fileName}>{item.fileName}</span>
                {item.status !== "completed" ? (
                  <span className="dl-progress" aria-label={`${Math.round(pct)}%`}><i style={{ width: `${pct}%` }} /></span>
                ) : null}
                <span className="dl-meta num">
                  <b className={`dl-status s-${item.status}`}>{STATUS[item.status] || item.status}</b>
                  {item.status === "completed"
                    ? <span>{bytes(item.total || item.done)}</span>
                    : <span>{bytes(item.done)}{item.total ? ` of ${bytes(item.total)}` : ""}{live && item.speed ? ` · ${rate(item.speed)} · ${eta(((item.total || 0) - item.done) / item.speed)}` : ""}</span>}
                  {item.error ? <span className="dl-error">{item.error}</span> : null}
                </span>
              </span>
              <span className="dl-actions">
                {item.status === "completed" ? <button className="btn btn-primary btn-sm" onClick={() => act("play", item)}><LuPlay /> Play</button> : null}
                {live ? <button className="dl-icon" onClick={() => act("pause", item)} aria-label="Pause" title="Pause"><LuPause /></button> : null}
                {item.status === "paused" ? <button className="dl-icon" onClick={() => act("resume", item)} aria-label="Resume" title="Resume"><LuPlay /></button> : null}
                {item.status === "failed" ? <button className="dl-icon" onClick={() => act("resume", item)} aria-label="Try again" title="Try again"><LuRotateCw /></button> : null}
                {item.status === "completed" ? <button className="dl-icon" onClick={() => act("reveal", item)} aria-label="Show in folder" title="Show in folder"><LuFolderOpen /></button> : null}
                <button className="dl-icon" onClick={() => act("remove", item)} aria-label={item.status === "completed" ? "Delete the file" : "Cancel and delete"} title={item.status === "completed" ? "Delete the file" : "Cancel"}><LuTrash2 /></button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

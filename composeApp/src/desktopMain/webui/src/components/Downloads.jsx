import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuCircleAlert, LuFolderOpen, LuPause, LuPlay, LuRotateCw, LuTrash2 } from "react-icons/lu";
import { call } from "../bridge.js";
import { useTopic } from "../store.js";
import { useApp } from "../AppContext.jsx";
import { EASE, reduceMotion } from "../lib/motion.js";
import { episodeCode } from "../lib/format.js";
import "./Downloads.css";

const NONE = [];
const bytes = n => (!n ? "0 MB" : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);
const rate = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB/s` : `${Math.round(n / 1e3)} KB/s`);
// Whole minutes, rounded up, so the time left only ever steps down.
const eta = s => {
  if (!isFinite(s) || s <= 0) return "";
  if (s < 60) return "less than a minute left";
  const minutes = Math.ceil(s / 60);
  return minutes < 60 ? `${minutes} min left` : `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
};
const STATUS = { downloading: "Downloading", paused: "Paused", completed: "Ready", failed: "Failed" };
const UNDO_MS = 5400; // a little longer than the toast with its Undo stays up
const MIN_BUSY_MS = 1200; // a double click lands on a button that is still busy
const nameOf = item => `${item.title}${item.season != null ? ` ${episodeCode(item.season, item.episode)}` : ""}`;

/**
 * Library › Downloads: what's saved on this PC, live while it downloads. `gone` holds files
 * deleted while their Undo is up (the Library keeps it, so the tab count agrees).
 */
export default function Downloads({ gone, onGone }) {
  const { toast } = useApp();
  const items = useTopic("downloads", NONE);
  const listRef = useRef(null);
  // Per file: the action on its way (its buttons wait), and files deleted but still undoable.
  const [busy, setBusy] = useState({});
  useEffect(() => { call("downloads.subscribe").catch(() => {}); }, []);

  // A finished download says so once.
  const seen = useRef(new Map());
  useEffect(() => {
    items.forEach(item => {
      const was = seen.current.get(item.id);
      if (was && was !== "completed" && item.status === "completed") toast(`Downloaded: ${nameOf(item)}`);
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

  const release = id => setBusy(prev => {
    if (!prev[id]) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  });
  // Pause and resume show their answer in the status; the button waits until it does.
  useEffect(() => {
    Object.entries(busy).forEach(([id, job]) => {
      const item = items.find(entry => entry.id === id);
      if (job.settled && (!item || item.status !== job.status)) release(id);
    });
  }, [items, busy]);

  const act = (action, item) => {
    if (busy[item.id]) return;
    const started = Date.now();
    setBusy(prev => ({ ...prev, [item.id]: { action, status: item.status } }));
    const settle = () => window.setTimeout(() => {
      if (action === "pause" || action === "resume") {
        setBusy(prev => (prev[item.id] ? { ...prev, [item.id]: { ...prev[item.id], settled: true } } : prev));
        window.setTimeout(() => release(item.id), 4000);
      } else release(item.id);
    }, Math.max(0, MIN_BUSY_MS - (Date.now() - started)));
    call(`downloads.${action}`, { id: item.id }).then(settle, error => {
      release(item.id);
      toast(error.message, { tone: "error" });
    });
  };

  // Deleting goes at once and happens once the Undo has passed: these files are large.
  const remove = item => {
    onGone(item.id, true);
    const restore = () => onGone(item.id, false);
    let undone = false;
    const timer = window.setTimeout(() => {
      if (undone) return;
      call("downloads.remove", { id: item.id }).catch(error => { restore(); toast(error.message, { tone: "error" }); });
    }, UNDO_MS);
    toast(item.status === "completed" ? `Deleted ${nameOf(item)}` : `Cancelled ${nameOf(item)}`, {
      action: { label: "Undo", run: () => { undone = true; window.clearTimeout(timer); restore(); } },
    });
  };

  const openFolder = () => call("downloads.reveal", {}).catch(error => toast(error.message, { tone: "error" }));
  const shown = useMemo(() => items.filter(item => !gone.has(item.id)), [items, gone]);
  const totalSpeed = shown.reduce((sum, item) => sum + (item.status === "downloading" ? item.speed || 0 : 0), 0);

  if (!shown.length) {
    return (
      <section className="empty">
        <h2>No downloads yet</h2>
        <p>Open a title's sources and press the download button on any source. Torrents download once they're cached on TorBox.</p>
        <button className="btn btn-glass btn-sm" onClick={openFolder}><LuFolderOpen /> Open the downloads folder</button>
      </section>
    );
  }

  return (
    <section className="dl">
      <div className="dl-bar">
        <span className="t-meta num">{shown.length} {shown.length === 1 ? "download" : "downloads"}{totalSpeed ? ` · ${rate(totalSpeed)}` : ""}</span>
        <button className="btn btn-ghost btn-sm" onClick={openFolder}><LuFolderOpen /> Open folder</button>
      </div>
      <ul className="dl-list" ref={listRef}>
        {shown.map(item => {
          const pct = item.total ? Math.min(100, (item.done / item.total) * 100) : 0;
          const live = item.status === "downloading";
          const job = busy[item.id];
          const wait = Boolean(job);
          const label = nameOf(item);
          return (
            <li key={item.id} className={`dl-item is-${item.status}`} aria-busy={wait || undefined}>
              <span className="dl-art">{item.thumbnail || item.poster ? <img src={item.thumbnail || item.poster} alt="" loading="lazy" decoding="async" /> : null}</span>
              <span className="dl-main">
                <strong dir="auto">{item.title}{item.season != null ? <em className="num"> {episodeCode(item.season, item.episode)}</em> : null}</strong>
                <span className="dl-file" title={item.fileName} dir="auto">{item.fileName}</span>
                {item.status !== "completed" ? (
                  <span className="dl-progress" role="progressbar" aria-label={`${label}: downloaded`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                    <i style={{ transform: `scaleX(${pct / 100})` }} />
                  </span>
                ) : null}
                <span className="dl-meta num">
                  <b className={`dl-status s-${item.status}`}>{item.status === "failed" ? <LuCircleAlert aria-hidden="true" /> : null}{STATUS[item.status] || item.status}</b>
                  {item.status === "completed"
                    ? <span>{bytes(item.total || item.done)}</span>
                    : (
                      <>
                        {item.total ? <span className="dl-pct">{Math.floor(pct)}%</span> : null}
                        <span>{bytes(item.done)}{item.total ? ` of ${bytes(item.total)}` : ""}</span>
                        {live && item.speed ? <span className="dl-speed">{rate(item.speed)}</span> : null}
                        {live && item.speed && item.total ? <span>{eta((item.total - item.done) / item.speed)}</span> : null}
                      </>
                    )}
                  {item.error ? <span className="dl-error" dir="auto">{item.error}</span> : null}
                </span>
              </span>
              <span className="dl-actions">
                {item.status === "completed" ? (
                  <button className="btn btn-primary btn-sm" onClick={() => act("play", item)} disabled={wait} aria-label={`Play ${label}`}><LuPlay /> {job?.action === "play" ? "Opening" : "Play"}</button>
                ) : null}
                {live ? <button className="dl-icon" onClick={() => act("pause", item)} disabled={wait} aria-label={`Pause ${label}`} title="Pause"><LuPause /></button> : null}
                {item.status === "paused" ? <button className="dl-icon" onClick={() => act("resume", item)} disabled={wait} aria-label={`Resume ${label}`} title="Resume"><LuPlay /></button> : null}
                {item.status === "failed" ? <button className="dl-icon" onClick={() => act("resume", item)} disabled={wait} aria-label={`Try ${label} again`} title="Try again"><LuRotateCw /></button> : null}
                {item.status === "completed" ? <button className="dl-icon" onClick={() => act("reveal", item)} disabled={wait} aria-label={`Show ${label} in its folder`} title="Show in folder"><LuFolderOpen /></button> : null}
                <button className="dl-icon" onClick={() => remove(item)} disabled={wait} aria-label={item.status === "completed" ? `Delete ${label}` : `Cancel ${label} and delete it`} title={item.status === "completed" ? "Delete the file" : "Cancel and delete"}><LuTrash2 /></button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

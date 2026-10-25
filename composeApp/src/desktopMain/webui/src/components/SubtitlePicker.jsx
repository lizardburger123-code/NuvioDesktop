import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuCaptions, LuCaptionsOff, LuFileVideo, LuLoaderCircle, LuSearch, LuSparkles, LuX } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { EASE, reduceMotion, useSegmentPill } from "../lib/motion.js";
import "./SubtitlePicker.css";

const downloads = n => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : n > 0 ? String(n) : "");

/** A long file name with its middle elided, so the start (title) and the end (group) both show. */
const middle = (text, max = 64) => (text.length <= max ? text : `${text.slice(0, Math.ceil(max * 0.55))}…${text.slice(-Math.floor(max * 0.4))}`);

/**
 * "Which subtitles?" — after a source is picked: every subtitle from the search sites and the
 * subtitle addons, ranked against the file name of that source. Picking one plays with it.
 */
export default function SubtitlePicker({ request, onPlay, onClose }) {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState("all");
  const [busy, setBusy] = useState(null);
  const dialogRef = useRef(null);
  const listRef = useRef(null);
  const langRef = useRef(null);
  const closing = useRef(false);
  const run = useRef(0);
  useSegmentPill(langRef);

  const search = text => {
    const id = ++run.current;
    setLoading(true);
    call("subtitles.match", { ...request, query: text || null }, { timeoutMs: 40000 })
      .then(result => { if (id === run.current) setData(result); })
      .catch(error => { if (id === run.current) { setData({ results: [], error: error.message }); } })
      .finally(() => { if (id === run.current) setLoading(false); });
  };

  useEffect(() => { search(""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (!dialogRef.current || reduceMotion()) { onClose(); return; }
    dialogRef.current.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(0, 8px, 0) scale(.98)" }],
      { duration: 160, easing: EASE.exit, fill: "forwards" },
    ).onfinish = onClose;
  };

  const choose = async key => {
    if (busy) return;
    setBusy(key);
    try {
      await onPlay(key);
      close();
    } catch (error) {
      toast(error.message, { tone: "error" });
      setBusy(null);
    }
  };

  useLayoutEffect(() => {
    if (!dialogRef.current || reduceMotion()) return;
    dialogRef.current.animate(
      [{ opacity: 0, transform: "translate3d(0, 14px, 0) scale(.97)" }, { opacity: 1, transform: "none" }],
      { duration: 340, easing: EASE.out },
    );
  }, []);

  const results = (data?.results || []).filter(item => lang === "all" || item.language === lang);
  const best = results.find(item => item.best) || results[0];

  // Rows settle in once per search; only the first screenful staggers.
  useLayoutEffect(() => {
    if (loading || !listRef.current || reduceMotion()) return;
    [...listRef.current.querySelectorAll(".sp-row")].slice(0, 10).forEach((row, i) => row.animate(
      [{ opacity: 0, transform: "translate3d(0, 8px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 320, delay: i * 24, easing: EASE.out, fill: "backwards" },
    ));
  }, [loading, data, lang]);

  useEffect(() => {
    const onKey = event => {
      if (event.key === "Escape") { event.stopPropagation(); close(); return; }
      const rows = listRef.current ? [...listRef.current.querySelectorAll(".sp-row:not(:disabled)")] : [];
      const at = rows.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!rows.length) return;
        event.preventDefault();
        const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
        rows[at < 0 ? 0 : next].focus();
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && best) { event.preventDefault(); choose(best.key); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [best, busy]);

  const languages = data?.languages || [];
  const counts = Object.fromEntries(languages.map(l => [l.code, (data?.results || []).filter(r => r.language === l.code).length]));

  return createPortal(
    <div className="sp-layer" data-modal-open onClick={close}>
      <div ref={dialogRef} className="sp glass-dark" role="dialog" aria-label="Choose subtitles" onClick={event => event.stopPropagation()}>
        <header className="sp-head">
          <div className="sp-titles">
            <span className="sp-kicker"><LuCaptions /> Subtitles</span>
            <h2>Pick subtitles for this file</h2>
            {data?.filename ? (
              <span className="sp-file" title={data.filename}><LuFileVideo aria-hidden="true" /> <span dir="ltr">{middle(data.filename)}</span></span>
            ) : null}
          </div>
          <button className="btn btn-glass btn-icon btn-sm" onClick={close} aria-label="Back to sources"><LuX /></button>
        </header>

        <div className="sp-tools">
          <form className="sp-search" onSubmit={event => { event.preventDefault(); search(query.trim()); }}>
            <LuSearch aria-hidden="true" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search by title or release name"
              aria-label="Search subtitles"
              spellCheck={false}
            />
            {query ? <button type="button" className="sp-search-clear" onClick={() => { setQuery(""); search(""); }} aria-label="Clear search"><LuX /></button> : null}
          </form>
          {languages.length > 1 ? (
            <div ref={langRef} className="seg glass-flat" role="group" aria-label="Language">
              <button aria-pressed={lang === "all"} onClick={() => setLang("all")}>All</button>
              {languages.map(l => (
                <button key={l.code} aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>
                  {l.name}{data && !loading ? <span className="sp-count num">{counts[l.code] || 0}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="sp-list" ref={listRef} aria-busy={loading}>
          {loading ? (
            <>
              <p className="sp-status"><LuLoaderCircle className="spin" /> Searching your subtitle sites and addons…</p>
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="sp-skel"><span className="skel" /><span className="skel" /></div>)}
            </>
          ) : results.length ? results.map(item => (
            <button
              key={item.key}
              className={`sp-row${item.best ? " is-best" : ""}`}
              onClick={() => choose(item.key)}
              disabled={Boolean(busy)}
              aria-busy={busy === item.key}
            >
              <span className={`sp-match${item.match >= 65 ? " is-exact" : item.match >= 35 ? " is-close" : ""}`} aria-label={item.match > 0 ? `${item.match}% match` : "Release not matched"}>
                {item.match > 0 ? <><strong className="num">{item.match}</strong><small>%</small></> : <strong>–</strong>}
              </span>
              <span className="sp-body">
                <span className="sp-release" dir="ltr" title={item.release}>{item.release || "Unnamed release"}</span>
                <span className="sp-meta">
                  {item.best ? <span className="sp-best"><LuSparkles /> Best match</span> : item.matchLabel ? <span className="sp-label">{item.matchLabel}</span> : null}
                  <span className="sp-m">{item.languageName}</span>
                  <span className="sp-m">{item.source}{item.addon ? " (addon)" : ""}</span>
                  {item.downloads ? <span className="sp-m num">{downloads(item.downloads)} downloads</span> : null}
                  {item.hi ? <span className="sp-m">Hearing impaired</span> : null}
                </span>
              </span>
              <span className="sp-go" aria-hidden="true">{busy === item.key ? <LuLoaderCircle className="spin" /> : null}</span>
            </button>
          )) : (
            <div className="sp-empty">
              <h3>{data?.error ? "The search didn't work" : "No subtitles found"}</h3>
              <p>
                {data?.error
                  || (query ? "Try the title alone, or a shorter part of the release name."
                    : data?.configured === 0
                      ? "Only Podnapisi and your subtitle addons were searched. Add an OpenSubtitles, SubDL or SubSource key in Settings › Subtitles for many more."
                      : "Try searching by the title or the release name.")}
              </p>
            </div>
          )}
        </div>

        <footer className="sp-foot">
          <button className="btn btn-ghost btn-sm" onClick={() => choose("none")} disabled={Boolean(busy)}>
            {busy === "none" ? <LuLoaderCircle className="spin" /> : <LuCaptionsOff />} No subtitles
          </button>
          <span className="sp-hint">{best && !loading ? <><kbd>Ctrl</kbd> <kbd>Enter</kbd> plays the best match</> : null}</span>
          <button className="btn btn-glass btn-sm" onClick={() => choose("auto")} disabled={Boolean(busy)} title="Play now; the player picks subtitles the way it usually does">
            {busy === "auto" ? <LuLoaderCircle className="spin" /> : null} Let the player choose
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

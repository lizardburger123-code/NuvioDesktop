import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuExternalLink, LuLoaderCircle, LuPlus, LuRefreshCw, LuShieldOff } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { EASE, reduceMotion, useSegmentPill } from "../lib/motion.js";
import "./AddonStore.css";

const ORDER = ["Catalogs", "Anime", "Streams", "Live TV", "Subtitles", "Adult"];
const initials = name => String(name || "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

function Toggle({ checked, onChange, label }) {
  return <button className="switch" role="switch" aria-checked={Boolean(checked)} aria-label={label} onClick={() => onChange(!checked)} />;
}

/**
 * Suggested addons, each checked live when the store opens. One click installs; addons that need
 * settings open their setup page, and the link it gives goes into "Install from a link".
 */
export default function AddonStore({ onChanged }) {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [category, setCategory] = useState("All");
  const [busy, setBusy] = useState(null);
  const segRef = useRef(null);
  const gridRef = useRef(null);
  useSegmentPill(segRef);

  const load = () => call("store.list", {}, { timeoutMs: 30000 }).then(setData, error => { toast(error.message, { tone: "error" }); setData({ items: [], showAdult: true }); });
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const showAdult = data?.showAdult !== false;
  const categories = useMemo(() => ["All", ...ORDER.filter(c => (c !== "Adult" || showAdult) && (data?.items || []).some(i => i.category === c))], [data, showAdult]);
  const items = (data?.items || []).filter(i => (showAdult || !i.adult) && (category === "All" || i.category === category));

  useLayoutEffect(() => {
    if (!gridRef.current || reduceMotion()) return;
    [...gridRef.current.children].slice(0, 12).forEach((node, i) => node.animate(
      [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 360, delay: i * 25, easing: EASE.out, fill: "backwards" },
    ));
  }, [category, Boolean(data)]);

  const install = async item => {
    setBusy(item.key);
    try {
      await call("addons.install", { url: item.manifest }, { timeoutMs: 30000 });
      toast(`${item.name} installed`);
      await load();
      onChanged?.();
    } catch (error) {
      toast(error.message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const setEnabled = async (item, enabled) => {
    try {
      await call("addons.setEnabled", { id: item.installed, enabled });
      toast(enabled ? `${item.name} turned on` : `${item.name} turned off`);
      await load();
      onChanged?.();
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  };

  const toggleAdult = async show => {
    try {
      const result = await call("store.setAdult", { show });
      if (!show && category === "Adult") setCategory("All");
      toast(show
        ? `Adult content is on${result.changed ? `: ${result.changed} adult ${result.changed === 1 ? "addon" : "addons"} turned back on` : ""}`
        : `Adult content is hidden${result.changed ? `: ${result.changed} adult ${result.changed === 1 ? "addon" : "addons"} turned off` : ""}`);
      await load();
      onChanged?.();
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  };

  return (
    <div className="store">
      <div className="store-adult">
        <span>
          <strong>Adult content</strong>
          <small>Off hides the adult section here and turns every adult addon off in one go. On brings them back.</small>
        </span>
        <Toggle checked={showAdult} onChange={toggleAdult} label="Adult content" />
      </div>

      <div className="store-bar">
        <div ref={segRef} className="seg glass-flat" role="tablist" aria-label="Category">
          {categories.map(c => <button key={c} role="tab" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setData(null); load(); }} aria-label="Check again" title="Check again"><LuRefreshCw /></button>
      </div>

      <div ref={gridRef} className="store-grid">
        {!data ? Array.from({ length: 6 }, (_, i) => <div key={i} className="store-card skel" />) : items.map(item => (
          <article key={item.key} className={`store-card${item.available || item.needsSetup ? "" : " is-down"}`}>
            <header className="store-card-head">
              <span className="store-logo">
                {item.logo ? <img src={item.logo} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = "none"; }} /> : null}
                <span>{initials(item.name)}</span>
              </span>
              <span className="store-titles">
                <strong>{item.name}</strong>
                <span className="store-meta">
                  {item.category}{item.version ? ` · v${item.version}` : ""}
                  {item.adult ? <em className="store-18">18+</em> : null}
                </span>
              </span>
            </header>
            <p className="store-blurb">{item.blurb}</p>
            <footer className="store-actions">
              {item.installed ? (
                <>
                  <span className="store-installed"><LuCheck /> Installed</span>
                  <Toggle checked={item.enabled !== false} onChange={value => setEnabled(item, value)} label={`${item.name} on or off`} />
                </>
              ) : item.available && item.manifest ? (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => install(item)} disabled={busy != null}>
                    {busy === item.key ? <LuLoaderCircle className="spin" /> : <LuPlus />} Install
                  </button>
                  {item.configure ? <button className="btn btn-ghost btn-sm" onClick={() => call("app.openUrl", { url: item.configure })}><LuExternalLink /> Set up</button> : null}
                </>
              ) : item.needsSetup ? (
                <button className="btn btn-glass btn-sm" onClick={() => { call("app.openUrl", { url: item.configure }); toast("Finish the setup in your browser, then paste the link it gives you into Install from a link."); }}>
                  <LuExternalLink /> Set up and install
                </button>
              ) : (
                <span className="store-down"><LuShieldOff /> Not responding right now</span>
              )}
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuExternalLink, LuLoaderCircle, LuPlus, LuRefreshCw, LuSearch, LuShieldOff, LuSparkles, LuStore } from "react-icons/lu";
import { call } from "../bridge.js";
import { useApp } from "../AppContext.jsx";
import { EASE, reduceMotion, useSegmentPill } from "../lib/motion.js";
import "./AddonStore.css";

const ORDER = ["Catalogs", "Anime", "Streams", "Live TV", "Subtitles", "Adult"];
const initials = name => String(name || "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

// The community catalogue's own categories (stremio-addons.net).
const BROWSE = [
  ["all", "All"], ["movies", "Movies & Series"], ["anime", "Anime"], ["torrents", "Torrents"], ["debrid support", "Debrid"],
  ["http streams", "HTTP streams"], ["usenet", "Usenet"], ["live tv", "Live TV"], ["subtitles", "Subtitles"], ["metadata", "Metadata"],
  ["asian drama", "Asian drama"], ["bollywood", "Bollywood"], ["music", "Music & Radio"], ["tracking", "Tracking"], ["misc", "Misc"], ["nsfw", "Adult 18+"],
];
const LAST_TAB = "nuvio.store.tab";

function Toggle({ checked, onChange, label, disabled }) {
  return <button className="switch" role="switch" aria-checked={Boolean(checked)} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

function Logo({ src, name }) {
  return (
    <span className="store-logo">
      {src ? <img src={src} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = "none"; }} /> : null}
      <span>{initials(name)}</span>
    </span>
  );
}

const stagger = (node, deps) => {
  if (!node || reduceMotion()) return;
  [...node.children].slice(deps, deps + 12).forEach((child, i) => child.animate(
    [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }],
    { duration: 340, delay: i * 22, easing: EASE.out, fill: "backwards" },
  ));
};

/**
 * The addon store: a featured shelf (checked live) and the whole community catalogue to browse
 * and search. One switch hides adult addons everywhere and turns them off.
 */
export default function AddonStore({ onChanged }) {
  const { toast } = useApp();
  const [tab, setTab] = useState(() => { try { return localStorage.getItem(LAST_TAB) || "featured"; } catch { return "featured"; } });
  const [data, setData] = useState(null);
  const [adultBusy, setAdultBusy] = useState(false);
  const tabRef = useRef(null);
  useSegmentPill(tabRef);

  const load = force => call("store.list", { force: Boolean(force) }, { timeoutMs: 40000 })
    .then(setData, error => { toast(error.message, { tone: "error" }); setData(d => d || { items: [], showAdult: true }); });
  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const showAdult = data?.showAdult !== false;

  const toggleAdult = async show => {
    // Flip at once; the addons follow in the background.
    setData(d => ({ ...(d || { items: [] }), showAdult: show }));
    setAdultBusy(true);
    try {
      const result = await call("store.setAdult", { show });
      toast(show
        ? `Adult content is on${result.changed ? `: ${result.changed} adult ${result.changed === 1 ? "addon" : "addons"} back on` : ""}`
        : `Adult content is hidden${result.changed ? `: ${result.changed} adult ${result.changed === 1 ? "addon" : "addons"} turned off` : ""}`);
      onChanged?.();
      load(false);
    } catch (error) {
      setData(d => ({ ...(d || { items: [] }), showAdult: !show }));
      toast(error.message, { tone: "error" });
    } finally {
      setAdultBusy(false);
    }
  };

  const switchTab = next => {
    setTab(next);
    try { localStorage.setItem(LAST_TAB, next); } catch { /* ignore */ }
  };

  return (
    <div className="store">
      <div className="store-adult">
        <span>
          <strong>Adult content</strong>
          <small>Off hides every adult addon in the store and turns the installed ones off in one go. On brings them back.</small>
        </span>
        <Toggle checked={showAdult} onChange={toggleAdult} label="Adult content" disabled={adultBusy} />
      </div>

      <div ref={tabRef} className="seg glass-flat store-tabs" role="tablist" aria-label="Store">
        <button role="tab" aria-pressed={tab === "featured"} onClick={() => switchTab("featured")}><LuSparkles /> Featured</button>
        <button role="tab" aria-pressed={tab === "browse"} onClick={() => switchTab("browse")}><LuStore /> Browse all</button>
      </div>

      {tab === "featured"
        ? <Featured data={data} showAdult={showAdult} reload={load} onChanged={onChanged} />
        : <Browse showAdult={showAdult} onChanged={onChanged} />}
    </div>
  );
}

function useInstall({ onChanged, after }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(null);
  const install = async (key, name, manifest) => {
    setBusy(key);
    try {
      await call("addons.install", { url: manifest }, { timeoutMs: 30000 });
      toast(`${name} installed`);
      await after?.();
      onChanged?.();
    } catch (error) {
      toast(error.message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const setEnabled = async (id, name, enabled) => {
    try {
      await call("addons.setEnabled", { id, enabled });
      toast(enabled ? `${name} turned on` : `${name} turned off`);
      await after?.();
      onChanged?.();
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  };
  const setup = url => {
    call("app.openUrl", { url });
    toast("Finish the setup in your browser, then paste the link it gives you into Install from a link.");
  };
  return { busy, setBusy, install, setEnabled, setup };
}

/* ---------------------------------------------------------------- Featured */

function Featured({ data, showAdult, reload, onChanged }) {
  const [category, setCategory] = useState("All");
  const segRef = useRef(null);
  const gridRef = useRef(null);
  useSegmentPill(segRef);
  const { busy, install, setEnabled, setup } = useInstall({ onChanged, after: () => reload(false) });

  const categories = useMemo(() => ["All", ...ORDER.filter(c => (c !== "Adult" || showAdult) && (data?.items || []).some(i => i.category === c))], [data, showAdult]);
  const current = categories.includes(category) ? category : "All";
  const items = (data?.items || []).filter(i => (showAdult || !i.adult) && (current === "All" || i.category === current));

  useLayoutEffect(() => stagger(gridRef.current, 0), [current, Boolean(data)]);

  return (
    <>
      <div className="store-bar">
        <div ref={segRef} className="seg glass-flat" role="tablist" aria-label="Category">
          {categories.map(c => <button key={c} role="tab" aria-pressed={current === c} onClick={() => setCategory(c)}>{c}</button>)}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => reload(true)} aria-label="Check again" title="Check again"><LuRefreshCw /></button>
      </div>
      <div ref={gridRef} className="store-grid">
        {!data ? Array.from({ length: 6 }, (_, i) => <div key={i} className="store-card skel" />) : items.map(item => (
          <article key={item.key} className={`store-card${item.available || item.needsSetup ? "" : " is-down"}`}>
            <header className="store-card-head">
              <Logo src={item.logo} name={item.name} />
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
                  <Toggle checked={item.enabled !== false} onChange={value => setEnabled(item.installed, item.name, value)} label={`${item.name} on or off`} />
                </>
              ) : item.available && item.manifest ? (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => install(item.key, item.name, item.manifest)} disabled={busy != null}>
                    {busy === item.key ? <LuLoaderCircle className="spin" /> : <LuPlus />} Install
                  </button>
                  {item.configure ? <button className="btn btn-ghost btn-sm" onClick={() => call("app.openUrl", { url: item.configure })}><LuExternalLink /> Set up</button> : null}
                </>
              ) : item.needsSetup && item.configure ? (
                <button className="btn btn-glass btn-sm" onClick={() => setup(item.configure)}><LuExternalLink /> Set up and install</button>
              ) : (
                <span className="store-down"><LuShieldOff /> Not responding right now</span>
              )}
            </footer>
          </article>
        ))}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Browse (stremio-addons.net) */

const KIND = { movie: "Movies", series: "Series", anime: "Anime", tv: "TV", channel: "Channels", other: "Other" };

function Browse({ showAdult, onChanged }) {
  const { toast } = useApp();
  const [category, setCategory] = useState("all");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState({ items: [], page: 0, pageCount: 1, loading: true });
  const gridRef = useRef(null);
  const seq = useRef(0);
  const { busy, setBusy, install, setEnabled, setup } = useInstall({ onChanged, after: () => reloadKeep() });

  const fetchPage = (page, replace) => {
    const id = ++seq.current;
    setPages(p => ({ ...(replace ? { items: [], pageCount: 1 } : p), page: replace ? 0 : p.page, loading: true }));
    call("store.community", { category, query, page }, { timeoutMs: 30000 }).then(result => {
      if (id !== seq.current) return;
      setPages(p => ({
        items: replace ? result.items : [...p.items, ...result.items.filter(item => !p.items.some(old => old.slug === item.slug))],
        page,
        pageCount: result.pageCount || 1,
        loading: false,
      }));
    }, error => {
      if (id !== seq.current) return;
      setPages(p => ({ ...p, loading: false, error: error.message }));
    });
  };
  const reloadKeep = () => call("store.community", { category, query, page: 1 }, { timeoutMs: 30000 })
    .then(result => setPages(p => ({ ...p, items: p.items.map(item => result.items.find(r => r.slug === item.slug) || item) })), () => {});

  useEffect(() => { fetchPage(1, true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [category, query, showAdult]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 420);
    return () => window.clearTimeout(timer);
  }, [text]);

  const firstNew = useRef(0);
  useLayoutEffect(() => {
    stagger(gridRef.current, firstNew.current);
    firstNew.current = pages.items.length;
  }, [pages.items.length]);

  // Endless list: the next page loads as the end comes into view.
  const sentinel = useRef(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !pages.loading && pages.page < pages.pageCount) fetchPage(pages.page + 1, false);
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.loading, pages.page, pages.pageCount, category, query]);

  const act = async (item, kind) => {
    setBusy(item.slug);
    try {
      const links = await call("store.resolve", { slug: item.slug }, { timeoutMs: 30000 });
      if (kind === "setup") { setBusy(null); setup(links.configure); return; }
      await install(item.slug, item.name, links.manifest);
    } catch (error) {
      toast(error.message, { tone: "error" });
      setBusy(null);
    }
  };

  const categories = BROWSE.filter(([value]) => value !== "nsfw" || showAdult);

  return (
    <>
      <div className="store-browse-top">
        <label className="store-search">
          <LuSearch />
          <input value={text} onChange={event => setText(event.target.value)} placeholder="Search hundreds of addons" spellCheck={false} />
          {pages.loading && pages.page === 0 ? <LuLoaderCircle className="spin" /> : null}
        </label>
        <div className="store-chips" role="tablist" aria-label="Category">
          {categories.map(([value, label]) => (
            <button key={value} className="chip" role="tab" aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>
          ))}
        </div>
      </div>

      <div ref={gridRef} className="store-grid">
        {pages.items.map(item => {
          const kinds = (item.types || []).map(t => KIND[t] || t).slice(0, 3).join(" · ");
          const does = (item.resources || []).filter(r => r !== "meta").map(r => ({ catalog: "Catalogs", stream: "Streams", subtitles: "Subtitles", addon_catalog: "Addons" }[r] || r));
          return (
            <article key={item.slug} className="store-card">
              <header className="store-card-head">
                <Logo src={item.logo} name={item.name} />
                <span className="store-titles">
                  <strong>{item.name}</strong>
                  <span className="store-meta">
                    {kinds || "Addon"}{item.version ? ` · v${item.version}` : ""}
                    {item.adult ? <em className="store-18">18+</em> : null}
                  </span>
                </span>
              </header>
              <p className="store-blurb">{item.blurb || "No description."}</p>
              {does.length ? <div className="store-does">{does.map(d => <span key={d}>{d}</span>)}</div> : null}
              <footer className="store-actions">
                {item.installed ? (
                  <>
                    <span className="store-installed"><LuCheck /> Installed</span>
                    <Toggle checked={item.enabled !== false} onChange={value => setEnabled(item.installed, item.name, value)} label={`${item.name} on or off`} />
                  </>
                ) : item.needsSetup ? (
                  <button className="btn btn-glass btn-sm" onClick={() => act(item, "setup")} disabled={busy != null}>
                    {busy === item.slug ? <LuLoaderCircle className="spin" /> : <LuExternalLink />} Set up and install
                  </button>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => act(item, "install")} disabled={busy != null}>
                      {busy === item.slug ? <LuLoaderCircle className="spin" /> : <LuPlus />} Install
                    </button>
                    {item.configurable ? <button className="btn btn-ghost btn-sm" onClick={() => act(item, "setup")} disabled={busy != null}><LuExternalLink /> Set up</button> : null}
                  </>
                )}
              </footer>
            </article>
          );
        })}
        {pages.loading ? Array.from({ length: pages.page === 0 ? 6 : 3 }, (_, i) => <div key={`s${i}`} className="store-card skel" />) : null}
      </div>
      {!pages.loading && !pages.items.length ? (
        <p className="store-empty">{pages.error ? `The addon site didn't answer: ${pages.error}` : query ? `No addons match “${query}”.` : "Nothing here yet."}</p>
      ) : null}
      <div ref={sentinel} className="store-sentinel" />
      <p className="store-source">From the community list at stremio-addons.net. Addons are made by their own authors; check what an addon does before installing it.</p>
    </>
  );
}

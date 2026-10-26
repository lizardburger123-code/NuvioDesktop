import { useEffect, useMemo, useRef, useState } from "react";
import { LuPuzzle, LuSettings2 } from "react-icons/lu";
import { call } from "../bridge.js";
import { CatalogGrid, SourcePicker, recall, remember } from "../components/Discover.jsx";
import { navigate } from "../lib/router.js";
import { useScreenActive } from "../lib/screen.js";
import "../components/Discover.css";
import "./Addons.css";

const LAST = "nuvio.addons.last";
const KIND = { movie: "Movies", series: "Series", anime: "Anime", tv: "TV", channel: "Channels" };
const typeName = type => KIND[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : "");
const initials = name => String(name || "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

export function AddonLogo({ addon, size = 40 }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="addon-mark" style={{ width: size, height: size }}>
      {addon.logo && !failed ? <img src={addon.logo} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{initials(addon.name)}</span>}
    </span>
  );
}

/**
 * Browse any installed addon, catalog by catalog — including the ones that aren't on Home and
 * the ones search doesn't reach — with each catalog's own filters and search.
 */
export default function Addons({ params }) {
  const active = useScreenActive();
  const [addons, setAddons] = useState(null);
  const [addonId, setAddonId] = useState(params.addon || null);
  const [sourceId, setSourceId] = useState(params.source || null);
  const [filters, setFilters] = useState(params.genre ? { genre: params.genre } : {});
  const stripRef = useRef(null);

  const load = () => call("discover.addons", {}, { timeoutMs: 20000 }).then(list => {
    const all = Array.isArray(list) ? list : [];
    setAddons(all);
    const last = recall(LAST);
    setAddonId(current => (all.some(a => a.id === current) ? current : (all.find(a => a.id === last?.addon) || all[0])?.id || null));
  }, () => setAddons([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // Addons switched on or off elsewhere show up when you come back.
  const seen = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (seen.current) load();
    seen.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const addon = useMemo(() => addons?.find(a => a.id === addonId) || null, [addons, addonId]);
  const catalogs = addon?.catalogs || null;
  const source = useMemo(() => catalogs?.find(c => c.id === sourceId) || null, [catalogs, sourceId]);

  // A catalog from this addon is always selected (the remembered one, else the first).
  useEffect(() => {
    if (!catalogs?.length || catalogs.some(c => c.id === sourceId)) return;
    const last = recall(LAST);
    setSourceId((catalogs.find(c => c.id === last?.source) || catalogs[0]).id);
    setFilters({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogs]);

  useEffect(() => { if (addon && source) remember(LAST, { addon: addon.id, source: source.id }); }, [addon, source]);

  // Keep the chosen addon in view in the strip.
  useEffect(() => {
    stripRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [addonId, addons]);

  const pickAddon = id => {
    if (id === addonId) return;
    setAddonId(id);
    setSourceId(null);
    setFilters({});
  };

  const named = (catalogs || []).map(c => ({ ...c, addon: typeName(c.type) }));

  return (
    <main className="screen addons-browse">
      <section className="addons-head">
        <div className="addons-titles">
          <h1 className="t-page">Your addons</h1>
          <p className="t-meta">Every catalog your addons offer, including the ones that aren't on Home or in search.</p>
        </div>
        <button className="btn btn-glass btn-sm" onClick={() => navigate("settings", { section: "addons" })}><LuSettings2 /> Manage addons</button>
      </section>

      {addons && !addons.length ? (
        <section className="discover-empty">
          <h2 className="t-title">No addon catalogs</h2>
          <p className="t-meta">Install an addon with catalogs from Settings › Addons › Store.</p>
        </section>
      ) : (
        <>
          <div ref={stripRef} className="addons-strip" role="tablist" aria-label="Addon" data-keep-scroll>
            {!addons ? Array.from({ length: 5 }, (_, i) => <span key={i} className="addons-chip skel" />) : addons.map(a => (
              <button key={a.id} role="tab" className="addons-chip" aria-pressed={a.id === addonId} onClick={() => pickAddon(a.id)} title={a.description || a.name}>
                <AddonLogo addon={a} size={36} />
                <span className="addons-chip-text">
                  <strong dir="auto">{a.name}{a.adult ? <em className="addons-18">18+</em> : null}</strong>
                  <small>{a.catalogs.length} {a.catalogs.length === 1 ? "catalog" : "catalogs"}</small>
                </span>
              </button>
            ))}
          </div>
          {catalogs ? (
            <section className="discover addons-catalogs">
              <SourcePicker sources={named} value={sourceId} onChange={id => { setSourceId(id); setFilters({}); }} label={`${addon.name} catalogs`} />
              <CatalogGrid
                key={source?.id || "none"}
                source={source ? { ...source, addon: addon.name } : null}
                filters={filters}
                onFilters={setFilters}
                emptyText={`${addon.name} didn't return anything for this catalog.`}
              />
            </section>
          ) : addons ? null : (
            <div className="addons-wait"><LuPuzzle /> Loading your addons…</div>
          )}
        </>
      )}
      <div className="screen-end" />
    </main>
  );
}

import { useEffect, useRef, useState } from "react";
import { call } from "../bridge.js";
import Row from "./Row.jsx";
import { AddonLogo } from "../screens/Addons.jsx";
import { navigate } from "../lib/router.js";
import { useScreenActive } from "../lib/screen.js";
import "./AddonShelf.css";

const KIND = { movie: "Movies", series: "Series", anime: "Anime", tv: "TV", channel: "Channels" };

/** Home's way into every addon: each one opens with all its catalogs, filters and search. */
export default function AddonShelf() {
  const active = useScreenActive();
  const [addons, setAddons] = useState(null);
  const loaded = useRef(0);
  useEffect(() => {
    if (!active) return;
    // Refresh at most once a minute (addons change rarely; this keeps returning to Home cheap).
    if (Date.now() - loaded.current < 60_000) return;
    loaded.current = Date.now();
    call("discover.addons", {}, { timeoutMs: 20000 }).then(list => setAddons(Array.isArray(list) ? list : []), () => {});
  }, [active]);

  if (!addons?.length) return null;
  return (
    <Row title="Your addons" subtitle="Every catalog, with filters and search" onMore={() => navigate("addons")} moreLabel="Browse all" className="row-addons">
      {addons.map(addon => {
        const kinds = [...new Set(addon.catalogs.map(c => KIND[c.type] || c.type))].slice(0, 3).join(" · ");
        return (
          <button key={addon.id} className="addon-card" onClick={() => navigate("addons", { addon: addon.id })} title={addon.description || addon.name}>
            <AddonLogo addon={addon} size={46} />
            <span className="addon-card-text">
              <strong dir="auto">{addon.name}{addon.adult ? <em className="addons-18">18+</em> : null}</strong>
              <small>{addon.catalogs.length} {addon.catalogs.length === 1 ? "catalog" : "catalogs"}{kinds ? ` · ${kinds}` : ""}</small>
            </span>
          </button>
        );
      })}
    </Row>
  );
}

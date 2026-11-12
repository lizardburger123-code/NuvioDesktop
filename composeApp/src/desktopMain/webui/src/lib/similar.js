// "More like this" for a title whose catalog suggests nothing: asked for once per title.
import { useEffect, useState } from "react";
import { call } from "../bridge.js";

const cache = new Map();

/** The catalog's own suggestions when it has them; otherwise titles that share its genres. */
export const useSimilar = meta => {
  const own = meta?.moreLikeThis?.length ? meta.moreLikeThis : null;
  const key = meta ? `${meta.type}:${meta.id}` : null;
  const [found, setFound] = useState(() => (key && cache.get(key)) || null);
  useEffect(() => {
    if (!key || own) return undefined;
    if (cache.has(key)) { setFound(cache.get(key)); return undefined; }
    setFound(null);
    let alive = true;
    call("details.similar", { type: meta.type, id: meta.id, name: meta.name, genres: meta.genres || [], releaseInfo: meta.releaseInfo || "" }).then(
      items => { const list = Array.isArray(items) ? items : []; cache.set(key, list); if (alive) setFound(list); },
      () => {},
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, Boolean(own)]);
  return { items: own || found || [], byGenre: !own };
};

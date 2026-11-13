import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { LuEyeOff } from "react-icons/lu";
import { useApp } from "../AppContext.jsx";
import { navigate } from "../lib/router.js";
import { hideRow } from "../lib/rows.js";
import Row from "./Row.jsx";
import { PosterCard } from "./Cards.jsx";

/** The catalog a row comes from, opened in full (every page, its filters, its search). */
export const openCatalog = section => {
  if (!section?.source) return;
  const addon = section.source.split("|").slice(0, -2).join("|");
  navigate("addons", { addon, source: section.source, ...(section.genre ? { genre: section.genre } : {}) });
};

/** "Hide" for a catalog row (its title opens the whole catalog). */
export default function RowActions({ section }) {
  const { toast } = useApp();
  return <button className="row-hide" onClick={() => hideRow(section, toast)} aria-label={`Hide ${section.title}`} title="Hide this row"><LuEyeOff /></button>;
}

/**
 * Add to / remove from My list, as a function that never changes. The app's own toggle is
 * remade whenever the list changes, and handed to every poster it would make all of them draw
 * again (hundreds on a long Home) for the one bookmark that changed.
 */
export const useToggleLater = () => {
  const { toggleLater } = useApp();
  const latest = useRef(toggleLater);
  useLayoutEffect(() => { latest.current = toggleLater; });
  return useCallback(item => latest.current(item), []);
};

/**
 * A catalog's row of posters. Drawn again only when its catalog or My list changes, not when
 * anything else on the page does (Continue watching moving on, the look, a toast).
 */
export const CatalogRow = memo(function CatalogRow({ section, laterIds, onOpen, onToggleLater }) {
  return (
    <Row
      title={section.title}
      subtitle={section.addonName}
      action={<RowActions section={section} />}
      onMore={section.source ? () => openCatalog(section) : undefined}
    >
      {section.items.map(item => (
        <PosterCard key={`${item.type}:${item.id}`} item={item} onOpen={onOpen} onToggleLater={onToggleLater} saved={laterIds.has(`${item.type}:${item.id}`)} />
      ))}
    </Row>
  );
});

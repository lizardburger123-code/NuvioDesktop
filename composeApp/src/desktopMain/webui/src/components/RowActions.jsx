import { LuChevronRight, LuEyeOff } from "react-icons/lu";
import { useApp } from "../AppContext.jsx";
import { navigate } from "../lib/router.js";
import { hideRow } from "../lib/rows.js";

/** The catalog a row comes from, opened in full (every page, its filters, its search). */
export const openCatalog = section => {
  if (!section?.source) return;
  const addon = section.source.split("|").slice(0, -2).join("|");
  navigate("addons", { addon, source: section.source, ...(section.genre ? { genre: section.genre } : {}) });
};

/** "See all" and "Hide" for a catalog row. */
export default function RowActions({ section }) {
  const { toast } = useApp();
  return (
    <>
      <button className="row-hide" onClick={() => hideRow(section, toast)} aria-label={`Hide ${section.title}`} title="Hide this row"><LuEyeOff /></button>
      {section.source ? (
        <button className="row-more" onClick={() => openCatalog(section)} aria-label={`See all of ${section.title}`}>
          See all <LuChevronRight />
        </button>
      ) : null}
    </>
  );
}

import { memo } from "react";
import Row from "../components/Row.jsx";
import RowActions, { openCatalog } from "../components/RowActions.jsx";
import "./TopTen.css";

const Rank = memo(function Rank({ item, place, onOpen }) {
  return (
    <div className={`hz-rank${place >= 10 ? " is-wide" : ""}`} data-card>
      {/* The numeral lights up with its poster, so a click on it opens the title as well. */}
      <span className="hz-rank-n num" data-n={place} aria-hidden="true" onClick={() => onOpen(item)}>{place}</span>
      <button className="card-face" data-hero onClick={() => onOpen(item)} aria-label={`${place}. ${item.name}`}>
        {item.poster ? <img src={item.poster} alt="" loading="lazy" decoding="async" /> : <span className="poster-fallback" dir="auto">{item.name}</span>}
      </button>
    </div>
  );
});

/** The first ten of a catalog, counted: a hollow numeral lit in the accent beside each poster. */
export default memo(function TopTen({ section, onOpen }) {
  const items = section.items.slice(0, 10);
  return (
    <Row
      title="Top 10"
      subtitle={[section.title, section.addonName].filter(Boolean).join(" · ")}
      className="hz-top10"
      onMore={section.source ? () => openCatalog(section) : undefined}
      action={<RowActions section={section} />}
    >
      {items.map((item, i) => <Rank key={`${item.type}:${item.id}`} item={item} place={i + 1} onOpen={onOpen} />)}
    </Row>
  );
});

import { useEffect, useState } from "react";

/** A title page's name: its logo, or the name in type when there is no logo or it won't load. */
export default function TitleMark({ meta }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [meta.logo]);
  if (!meta.logo || broken) {
    // Long names step down a size so they stay a title, not a paragraph.
    const length = String(meta.name || "").length;
    const size = length > 60 ? " is-longer" : length > 28 ? " is-long" : "";
    return <h1 className={`details-title${size}`} data-rise dir="auto">{meta.name}</h1>;
  }
  return (
    <>
      {/* App.jsx retries a failed picture first; it marks the element once nothing more can be tried. */}
      <img className="details-logo" data-rise src={meta.logo} alt={meta.name} onError={event => { if (event.currentTarget.dataset.broken) setBroken(true); }} />
      <h1 className="sr-only">{meta.name}</h1>
    </>
  );
}

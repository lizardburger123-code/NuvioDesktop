import { useCallback, useEffect, useRef, useState } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { useScreenActive } from "../lib/screen.js";
import "./Row.css";

/** A titled horizontal shelf. Children render only once the row nears the viewport. */
export default function Row({ title, subtitle, action, children, className = "", empty }) {
  const rowRef = useRef(null);
  const trackRef = useRef(null);
  const [near, setNear] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });
  const active = useScreenActive();

  useEffect(() => {
    const node = rowRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const start = track.scrollLeft < 8;
    const end = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
    // Scroll fires every frame: only re-render when an arrow actually changes state.
    setEdges(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  // Measure when the row (or its content) resizes. Never while the screen is parked: reading
  // layout there would force a hidden screen to render.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !active) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    if (track.firstElementChild) observer.observe(track.firstElementChild);
    return () => observer.disconnect();
  }, [measure, near, active]);

  const page = direction => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(320, track.clientWidth * 0.82), behavior: "smooth" });
  };

  return (
    <section ref={rowRef} className={`row ${className}`}>
      <header className="row-head">
        <div className="row-titles">
          <h2 className="row-title">{title}</h2>
          {subtitle ? <span className="row-sub">{subtitle}</span> : null}
        </div>
        <div className="row-tools">
          {action}
          <button className="row-arrow" onClick={() => page(-1)} disabled={edges.start} aria-label={`Scroll ${title} left`}><LuChevronLeft /></button>
          <button className="row-arrow" onClick={() => page(1)} disabled={edges.end} aria-label={`Scroll ${title} right`}><LuChevronRight /></button>
        </div>
      </header>
      <div className="row-track" ref={trackRef} onScroll={measure}>
        {near ? children : <div className="row-placeholder" />}
        {near && empty ? <p className="row-empty">{empty}</p> : null}
      </div>
    </section>
  );
}

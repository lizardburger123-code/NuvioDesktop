import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuArrowRight, LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { useScreenActive } from "../lib/screen.js";
import { BEFORE_NAV } from "../lib/router.js";
import { scrollMotion, useLite } from "../lib/lite.js";
import "./Row.css";

// Lite draws a row's first cards, and more as it is scrolled (or its keyboard focus moves)
// toward its end: a catalog of a hundred titles costs a dozen cards until someone looks further.
const LITE_FIRST = 12;
const LITE_STEP = 12;

// The card each screen was left from, so coming back puts the keyboard where it was.
const leftFrom = new WeakMap();
if (typeof window !== "undefined") {
  window.addEventListener(BEFORE_NAV, () => {
    const el = document.activeElement;
    const host = el?.closest?.(".row-track") && el.closest(".screen-host");
    if (host) leftFrom.set(host, el);
  });
}

/** What the keyboard lands on in one item of a row: the card's picture, or the item itself. */
const stopOf = item => (item.matches("button, a") ? item : item.querySelector(".card-face, button, a"));
const goTo = target => {
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: scrollMotion() });
};

/**
 * Arrow keys inside a row: left and right step through its cards (Home and End jump to the
 * ends), up and down go to the nearest card of the row above or below. Tab still visits every
 * card and button in order.
 */
const moveWithin = (track, event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const items = [...track.children].filter(item => stopOf(item));
  const at = items.findIndex(item => item.contains(document.activeElement));
  if (at < 0) return;
  let target = null;
  if (event.key === "ArrowLeft") target = items[at - 1];
  else if (event.key === "ArrowRight") target = items[at + 1];
  else if (event.key === "Home") target = items[0];
  else if (event.key === "End") target = items[items.length - 1];
  else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const scope = track.closest(".screen-host") || document;
    const tracks = [...scope.querySelectorAll(".row-track")];
    const step = event.key === "ArrowUp" ? -1 : 1;
    const from = items[at].getBoundingClientRect();
    const middle = from.left + from.width / 2;
    for (let i = tracks.indexOf(track) + step; i >= 0 && i < tracks.length; i += step) {
      const choices = [...tracks[i].children].filter(item => stopOf(item));
      if (!choices.length) continue;
      target = choices.reduce((best, item) => {
        const box = item.getBoundingClientRect();
        const distance = Math.abs(box.left + box.width / 2 - middle);
        return !best || distance < best.distance ? { item, distance } : best;
      }, null).item;
      break;
    }
  } else return;
  if (!target) return;
  event.preventDefault();
  goTo(stopOf(target));
};

/**
 * A titled horizontal shelf. Children render only once the row nears the viewport; in Lite only
 * its first cards do, and the rest as the row is scrolled toward them.
 */
export default function Row({ title, subtitle, action, children, className = "", empty, onMore, moreLabel = "See all" }) {
  const rowRef = useRef(null);
  const trackRef = useRef(null);
  const [near, setNear] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });
  const active = useScreenActive();
  const lite = useLite();
  const [limit, setLimit] = useState(LITE_FIRST);
  const items = lite ? Children.toArray(children) : null;
  const more = lite && items.length > limit;
  // Read by the scroll handler, which stays the same function.
  const moreRef = useRef(more);
  moreRef.current = more && near;
  const grow = useCallback(() => setLimit(n => n + LITE_STEP), []);

  useEffect(() => {
    const node = rowRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: lite ? "300px 0px" : "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
    // Where a row starts drawing is decided once, when it is made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const start = track.scrollLeft < 8;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
    // Lite: within a window's width of the last card drawn, draw the next ones.
    if (moreRef.current && track.scrollLeft + track.clientWidth * 2 >= track.scrollWidth) grow();
    const end = atEnd && !moreRef.current;
    // Scroll fires every frame: only re-render when an arrow actually changes state.
    setEdges(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [grow]);

  // Back on this screen: the card it was left from has the keyboard again.
  useEffect(() => {
    const track = trackRef.current;
    const host = track?.closest(".screen-host");
    const card = host && leftFrom.get(host);
    if (!active || !card || !track.contains(card)) return;
    leftFrom.delete(host);
    if (card.isConnected && (document.activeElement === document.body || !document.activeElement)) card.focus({ preventScroll: true });
  }, [active]);

  // Measure when the row (or its content) resizes, or more of it is drawn. Never while the
  // screen is parked: reading layout there would force a hidden screen to render.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !active) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    if (track.firstElementChild) observer.observe(track.firstElementChild);
    return () => observer.disconnect();
  }, [measure, near, active, limit]);

  // Lite: End asked for the last card before it was drawn; it has the keyboard once it is.
  const endPending = useRef(false);
  useLayoutEffect(() => {
    if (!endPending.current || more) return;
    endPending.current = false;
    const stops = [...(trackRef.current?.children || [])].filter(item => stopOf(item));
    if (stops.length) goTo(stopOf(stops[stops.length - 1]));
  }, [limit, more]);

  const onKeyDown = event => {
    if (more && event.key === "End" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && trackRef.current?.contains(document.activeElement)) {
      event.preventDefault();
      endPending.current = true;
      setLimit(Infinity);
      return;
    }
    moveWithin(trackRef.current, event);
  };
  // Lite: the keyboard nearing the last cards drawn draws the next ones.
  const onFocus = event => {
    if (!moreRef.current) return;
    const at = [...trackRef.current.children].findIndex(item => item.contains(event.target));
    if (at >= limit - 4) grow();
  };

  const page = direction => {
    const track = trackRef.current;
    if (!track || (direction < 0 ? edges.start : edges.end)) return;
    track.scrollBy({ left: direction * Math.max(320, track.clientWidth * 0.82), behavior: lite ? "auto" : "smooth" });
  };

  // At an end the arrow is marked unavailable rather than disabled: a disabled button drops the
  // keyboard focus it had, and paging with Enter would end on nothing. A row that fits has none.
  const fits = edges.start && edges.end;
  return (
    <section ref={rowRef} className={`row ${className}`}>
      <header className="row-head">
        <div className="row-titles">
          {onMore ? (
            <h2 className="row-title"><button className="row-title-link" onClick={onMore} aria-label={`${title}: ${moreLabel.toLowerCase()}`}><span className="row-title-text" dir="auto">{title}</span><LuChevronRight aria-hidden="true" /></button></h2>
          ) : <h2 className="row-title"><span className="row-title-text" dir="auto">{title}</span></h2>}
          {subtitle ? <span className="row-sub" dir="auto">{subtitle}</span> : null}
        </div>
        <div className="row-tools">
          {action}
          {fits ? null : (
            <>
              <button className="row-arrow" onClick={() => page(-1)} aria-disabled={edges.start} aria-label={`Scroll ${title} left`}><LuChevronLeft /></button>
              <button className="row-arrow" onClick={() => page(1)} aria-disabled={edges.end} aria-label={`Scroll ${title} right`}><LuChevronRight /></button>
            </>
          )}
        </div>
      </header>
      <div className="row-track" ref={trackRef} onScroll={measure} onKeyDown={onKeyDown} onFocus={lite ? onFocus : undefined}>
        {!near ? <div className="row-placeholder" /> : lite ? items.slice(0, limit) : children}
        {near && onMore && !more ? (
          <button className="row-end-more" onClick={onMore} aria-label={`${moreLabel}: ${title}`}>
            <span className="row-end-more-icon"><LuArrowRight /></span>
            <span>{moreLabel}</span>
          </button>
        ) : null}
        {near && empty ? <p className="row-empty">{empty}</p> : null}
      </div>
    </section>
  );
}

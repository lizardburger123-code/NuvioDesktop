import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuArrowRight, LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { useScreenActive } from "../lib/screen.js";
import { BEFORE_NAV } from "../lib/router.js";
import { Pictures, scrollMotion, useLite, usePicturesValue, watchNear } from "../lib/lite.js";

// Lite: a card in a row keeps its picture while it is within the row's width of what the row
// shows (scrolled past, or not yet reached, it lets it go).
const ROW_PICTURES = "0px 100%";
import "./Row.css";

// Lite draws a row's first cards, and more as it is scrolled (or its keyboard focus moves)
// toward its end: a catalog of a hundred titles costs a dozen cards until someone looks further.
const LITE_FIRST = 12;
const LITE_STEP = 12;
// Lite also lets a row's cards go once it is a window and a half away (their pictures with them),
// and draws them again as it comes back within a few hundred pixels.
const LITE_ENTER = "300px 0px";
const LITE_LEAVE = "150% 0px";

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
 * its first cards do, the rest as the row is scrolled toward them, and they go again when the
 * row is far from the window.
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
  // One step at a time: scroll events keep coming before the next cards are drawn.
  const growing = useRef(false);
  const grow = useCallback(() => {
    if (growing.current) return;
    growing.current = true;
    setLimit(n => n + LITE_STEP);
  }, []);

  useEffect(() => {
    const node = rowRef.current;
    if (!node || lite) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [lite]);

  // Lite: what an emptied row holds on to, so the page doesn't move and the row comes back where
  // it was scrolled to. Followed only while the screen is on display.
  const held = useRef({ height: 0, left: 0 });
  // One observer for the row's cards, looking through the row itself (made when the first asks).
  const cardWatch = useRef(null);
  const watchCards = useCallback((element, onChange) => {
    const track = trackRef.current;
    if (!track) return () => {};
    if (!cardWatch.current) {
      const callbacks = new Map();
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => callbacks.get(entry.target)?.(entry.isIntersecting));
      }, { root: track, rootMargin: ROW_PICTURES });
      cardWatch.current = { observer, callbacks };
    }
    const { observer, callbacks } = cardWatch.current;
    callbacks.set(element, onChange);
    observer.observe(element);
    return () => { observer.unobserve(element); callbacks.delete(element); };
  }, []);
  useEffect(() => () => cardWatch.current?.observer.disconnect(), []);
  const pictures = usePicturesValue(watchCards);
  useEffect(() => {
    const node = rowRef.current;
    if (!node || !lite || !active) return undefined;
    const offEnter = watchNear(node, LITE_ENTER, inside => { if (inside) setNear(true); });
    const offLeave = watchNear(node, LITE_LEAVE, inside => {
      const track = trackRef.current;
      // A row with the keyboard in it stays as it is.
      if (inside || !track || track.contains(document.activeElement)) return;
      if (!track.querySelector(":scope > .row-placeholder")) held.current = { height: track.offsetHeight, left: track.scrollLeft };
      setNear(false);
    });
    return () => { offEnter(); offLeave(); };
  }, [lite, active]);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!near || !track || !held.current.left) return;
    track.scrollLeft = held.current.left;
    held.current.left = 0;
  }, [near]);

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
    growing.current = false;
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
      <div
        className="row-track"
        ref={trackRef}
        style={!near && held.current.height ? { minHeight: held.current.height } : undefined}
        onScroll={measure}
        onKeyDown={onKeyDown}
        onFocus={lite ? onFocus : undefined}
      >
        {!near ? (held.current.height ? null : <div className="row-placeholder" />) : lite ? <Pictures.Provider value={pictures}>{items.slice(0, limit)}</Pictures.Provider> : children}
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

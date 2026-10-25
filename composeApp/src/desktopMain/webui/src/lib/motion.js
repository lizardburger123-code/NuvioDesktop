import { useLayoutEffect } from "react";
// Motion tokens and helpers shared by the shell.
//
// Thesis: navigation is one continuous space. The previous screen dissolves as a snapshot (View
// Transitions, so glass keeps its real blur), the next screen glides in from the direction you
// moved, and the section pill flows between tabs like liquid. Everything runs on the compositor
// (opacity, transform, clip-path via WAAPI) so a busy main thread never stalls it.

export const EASE = {
  // Confident arrival: fast start, long soft landing.
  out: "cubic-bezier(.16, 1, .3, 1)",
  // Gentler arrival for large surfaces, so the motion is still visible after the dissolve.
  glide: "cubic-bezier(.22, 1, .36, 1)",
  // Quick, front-loaded fade for things leaving.
  exit: "cubic-bezier(.2, 0, 0, 1)",
  // Symmetric, for things that move from one resting place to another.
  inOut: "cubic-bezier(.65, 0, .35, 1)",
};

export const DURATION = { press: 120, quick: 180, exit: 200, enter: 560, pill: 520, sheet: 420 };

export const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A damped spring as a CSS linear() easing, so WAAPI and CSS can use real spring physics.
 * stiffness/damping in the usual units (mass 1). Returns { easing, duration }.
 */
export const spring = ({ stiffness = 260, damping = 24, samples = 48 } = {}) => {
  const dt = 1 / 240;
  let x = 0;
  let v = 0;
  let t = 0;
  const points = [];
  // Simulate until settled (or 2s), then resample to `samples` points.
  const trace = [];
  while (t < 2) {
    const a = -stiffness * (x - 1) - damping * v;
    v += a * dt;
    x += v * dt;
    t += dt;
    trace.push([t, x]);
    if (t > 0.1 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
  }
  const total = trace[trace.length - 1][0];
  for (let i = 0; i <= samples; i += 1) {
    const target = (i / samples) * total;
    const sample = trace.find(([time]) => time >= target) || trace[trace.length - 1];
    points.push(sample[1]);
  }
  points[points.length - 1] = 1;
  return { easing: `linear(${points.map(p => +p.toFixed(4)).join(", ")})`, duration: Math.round(total * 1000) };
};

export const PILL_SPRING = spring({ stiffness: 320, damping: 26 });

/** Cancel running WAAPI animations on a node (keeps whatever inline style is set). */
export const stopAnimations = node => {
  if (!node?.getAnimations) return;
  node.getAnimations().forEach(animation => animation.cancel());
};

/**
 * Entrance for a screen that just became active. Transform only: an opacity change on an
 * ancestor would cut glass surfaces off from the backdrop they blur.
 */
export const playScreenEntrance = (node, nav) => {
  if (!node || !nav || reduceMotion()) return;
  if (nav.kind === "none" || nav.kind === "replace") return;
  stopAnimations(node);
  const centre = window.scrollY + window.innerHeight * 0.42 - node.offsetTop;
  node.style.transformOrigin = `50% ${Math.round(centre)}px`;
  let from;
  if (nav.kind === "section") from = nav.dir ? `translate3d(${nav.dir * 36}px, 0, 0)` : "translate3d(0, 18px, 0)";
  else if (nav.kind === "forward") from = "translate3d(0, 28px, 0) scale(.985)";
  else if (nav.kind === "back") from = "scale(.965)";
  else return;
  node.animate([{ transform: from }, { transform: "none" }], { duration: DURATION.enter, easing: EASE.glide });
};

const SEG_SPRING = spring({ stiffness: 360, damping: 30 });

/**
 * Sliding selection for a `.seg` group: one white pill glides to the pressed button instead of
 * the background jumping. Call with the group's ref and the selected value.
 */
export const useSegmentPill = ref => {
  useLayoutEffect(() => {
    const group = ref.current;
    // Parked screens are skipped by rendering; measuring them would force a hidden layout.
    if (!group || group.closest(".is-parked")) return;
    let pill = group.querySelector(":scope > .seg-pill");
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "seg-pill";
      pill.setAttribute("aria-hidden", "true");
      group.prepend(pill);
      group.classList.add("has-pill");
    }
    const target = group.querySelector('[aria-pressed="true"], [aria-selected="true"]');
    if (!target) {
      pill.style.opacity = "0";
      return;
    }
    const x = target.offsetLeft;
    const width = target.offsetWidth;
    if (pill.dataset.x === String(x) && pill.dataset.w === String(width)) return;
    const placed = pill.dataset.placed === "1";
    // Start from wherever the pill is drawn right now (mid-slide included).
    const now = getComputedStyle(pill);
    const currentX = new DOMMatrixReadOnly(now.transform === "none" ? undefined : now.transform).m41;
    const currentW = parseFloat(now.width) || width;
    stopAnimations(pill);
    pill.dataset.x = String(x);
    pill.dataset.w = String(width);
    pill.dataset.placed = "1";
    pill.style.opacity = "1";
    pill.style.width = `${width}px`;
    pill.style.transform = `translateX(${x}px)`;
    if (!placed || reduceMotion()) return;
    pill.animate(
      [{ transform: `translateX(${currentX}px)`, width: `${currentW}px` }, { transform: `translateX(${x}px)`, width: `${width}px` }],
      { duration: SEG_SPRING.duration, easing: SEG_SPRING.easing },
    );
  });
};

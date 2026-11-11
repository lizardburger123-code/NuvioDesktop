/*
 * Tiny spring engine for things you can push around: each body has values that chase targets,
 * one shared animation frame drives every moving body, and bodies at rest cost nothing. Steps
 * are fixed at 60 per second, so a 144 Hz screen moves things at the same speed as a 60 Hz one.
 */
const bodies = new Set();
let frame = 0;
let last = 0;
const STEP = 1000 / 60;

export function spring(initial, paint, tuning = {}) {
  return { x: { ...initial }, v: {}, t: { ...initial }, tuning, paint, held: new Set(), coast: null, onRest: null };
}

export function wake(body) {
  bodies.add(body);
  if (!frame) {
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
}

export function stop(body) {
  bodies.delete(body);
}

/** Jumps straight to the targets (reduced motion, or a body that has to be somewhere now). */
export function settle(body) {
  Object.keys(body.t).forEach(key => { body.x[key] = body.t[key]; body.v[key] = 0; });
  body.coast = null;
  body.paint(body.x);
  bodies.delete(body);
  body.onRest?.();
}

function advance(body) {
  let moving = false;
  Object.keys(body.t).forEach(key => {
    if (body.held.has(key)) { moving = true; return; }
    if (body.coast && body.coast.key === key) {
      body.x[key] += body.v[key] || 0;
      body.v[key] = (body.v[key] || 0) * body.coast.friction;
      if (Math.abs(body.v[key]) < body.coast.until) {
        body.t[key] = body.coast.land(body.x[key]);
        body.coast = null;
      }
      moving = true;
      return;
    }
    const { k = 0.12, d = 0.72 } = body.tuning[key] || body.tuning.all || {};
    const v = ((body.v[key] || 0) + (body.t[key] - body.x[key]) * k) * d;
    body.v[key] = v;
    body.x[key] += v;
    if (Math.abs(v) > 0.002 || Math.abs(body.t[key] - body.x[key]) > 0.01) moving = true;
    else { body.x[key] = body.t[key]; body.v[key] = 0; }
  });
  return moving;
}

function tick(now) {
  frame = 0;
  const steps = Math.max(1, Math.min(4, Math.round((now - last) / STEP)));
  last = now;
  bodies.forEach(body => {
    let moving = false;
    for (let i = 0; i < steps; i += 1) moving = advance(body) || moving;
    body.paint(body.x);
    if (!moving) {
      bodies.delete(body);
      body.onRest?.();
    }
  });
  if (bodies.size) frame = requestAnimationFrame(tick);
}

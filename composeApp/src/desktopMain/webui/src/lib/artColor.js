// The colour of a picture, for the Haze look: the accent on a title's page is that title's own
// colour, washed in like light through haze. A poster is drawn small, its vivid pixels are
// averaged, and the result is lifted until it reads on the dark ground.
import { useEffect, useState } from "react";

const cache = new Map(); // url -> "r g b" | null
const waiting = new Map(); // url -> Promise

let viaProxy = null;
/** App.jsx hands over the local picture fetcher once it knows it (remote pictures need it to be readable). */
export const setArtProxy = prefix => {
  viaProxy = prefix || null;
  if (viaProxy) [...proxyWaiters].forEach(retry => retry());
};
// Titles on screen before the fetcher was known ask again once it is.
const proxyWaiters = new Set();

const luminance = ([r, g, b]) => {
  const channel = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const toHsl = ([r, g, b]) => {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, Math.min(1, s), l];
};

const fromHsl = ([h, s, l]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map(v => Math.round((v + m) * 255));
};

/** Vivid pixels vote by hue; the winning hue's average becomes the colour. Null for a grey picture. */
export const pickColor = data => {
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, h: 0, s: 0, l: 0, x: 0, y: 0 }));
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const [h, s, l] = toHsl([data[i], data[i + 1], data[i + 2]]);
    total += 1;
    if (s < 0.28 || l < 0.16 || l > 0.86) continue;
    const weight = s * s * (1 - Math.abs(l - 0.52) * 1.4);
    if (weight <= 0) continue;
    const bin = bins[Math.floor(h / 15) % 24];
    const rad = (h * Math.PI) / 180;
    bin.weight += weight; bin.x += Math.cos(rad) * weight; bin.y += Math.sin(rad) * weight; bin.s += s * weight; bin.l += l * weight;
  }
  if (!total) return null;
  // Neighbouring bins count together, so a hue that straddles a boundary still wins.
  let best = -1;
  let bestWeight = 0;
  bins.forEach((bin, i) => {
    const sum = bin.weight + bins[(i + 1) % 24].weight * 0.6 + bins[(i + 23) % 24].weight * 0.6;
    if (sum > bestWeight) { bestWeight = sum; best = i; }
  });
  if (best < 0 || bestWeight / total < 0.012) return null;
  const group = [bins[(best + 23) % 24], bins[best], bins[(best + 1) % 24]];
  const weight = group.reduce((n, bin) => n + bin.weight, 0);
  const hue = (Math.atan2(group.reduce((n, bin) => n + bin.y, 0), group.reduce((n, bin) => n + bin.x, 0)) * 180 / Math.PI + 360) % 360;
  const sat = Math.min(0.92, Math.max(0.58, group.reduce((n, bin) => n + bin.s, 0) / weight));
  let color = fromHsl([hue, sat, 0.64]);
  // Blues and violets are dark at the same lightness: lift until the colour reads on black.
  for (let l = 0.64; luminance(color) < 0.3 && l < 0.84; l += 0.03) color = fromHsl([hue, sat, l]);
  return color.join(" ");
};

const readable = url => {
  if (/^(data:|blob:)/i.test(url)) return url;
  try {
    if (new URL(url, window.location.href).origin === window.location.origin && window.location.protocol !== "file:") return url;
  } catch { /* fall through */ }
  if (viaProxy && /^https?:\/\//i.test(url) && !url.startsWith("http://127.0.0.1")) return viaProxy + encodeURIComponent(url);
  return null;
};

export const artColor = url => {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (waiting.has(url)) return waiting.get(url);
  const src = readable(url);
  // No way to read it yet (the fetcher isn't known): not cached, so a later ask can succeed.
  if (!src) return Promise.resolve(null);
  const job = new Promise(resolve => {
    const img = new Image();
    if (!/^(data:|blob:)/i.test(src)) img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32; canvas.height = 32;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(img, 0, 0, 32, 32);
        resolve(pickColor(context.getImageData(0, 0, 32, 32).data));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  }).then(color => { cache.set(url, color); waiting.delete(url); return color; });
  waiting.set(url, job);
  return job;
};

/** The first of several pictures that has a colour (a grey backdrop falls through to the poster). */
const firstColor = async urls => {
  for (const url of urls) {
    const color = await artColor(url);
    if (color) return color;
  }
  return null;
};
const known = urls => { for (const url of urls) { if (!cache.has(url)) return undefined; if (cache.get(url)) return cache.get(url); } return null; };

/**
 * "r g b" for a title's pictures (pass the one on screen first), or null while unknown, for
 * grey pictures, or when the look doesn't want it. The last colour stays until the next is known,
 * so moving between titles glides from one colour to the other instead of blinking to the accent.
 */
export const useArtColor = (pictures, enabled = true) => {
  const urls = (Array.isArray(pictures) ? pictures : [pictures]).filter(Boolean);
  const key = urls.join("|");
  const [color, setColor] = useState(() => (enabled ? known(urls) ?? null : null));
  useEffect(() => {
    if (!enabled || !urls.length) { setColor(null); return undefined; }
    let alive = true;
    const ready = known(urls);
    if (ready !== undefined) { setColor(ready); return undefined; }
    const ask = () => firstColor(urls).then(value => { if (alive) setColor(value); });
    ask();
    const retry = viaProxy ? null : () => { proxyWaiters.delete(retry); ask(); };
    if (retry) proxyWaiters.add(retry);
    return () => { alive = false; if (retry) proxyWaiters.delete(retry); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return color;
};

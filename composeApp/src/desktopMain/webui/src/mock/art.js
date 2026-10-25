// Stand-in artwork for previews outside the app (no network here). Deterministic per title so
// screenshots are stable. Never used inside the desktop app, which shows real addon artwork.
const hash = text => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const PALETTES = [
  ["#0f2027", "#2c5364", "#e0c3fc"],
  ["#1a0b2e", "#7a1f5c", "#ffb199"],
  ["#0b132b", "#3a506b", "#5bc0be"],
  ["#2b1d0e", "#8a4b08", "#f6d365"],
  ["#10141f", "#4a1c40", "#c94b4b"],
  ["#0d1b2a", "#1b4332", "#95d5b2"],
  ["#1d1a2f", "#5f0f40", "#fb8b24"],
  ["#141414", "#3d3d3d", "#e5e5e5"],
  ["#03045e", "#0077b6", "#90e0ef"],
  ["#2d0a0a", "#9d0208", "#ffba08"],
];

const escapeXml = text => text.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);

const wrap = (title, max) => {
  const words = title.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
};

const svgUri = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const poster = title => {
  const h = hash(title);
  const [a, b, c] = PALETTES[h % PALETTES.length];
  const angle = (h >> 4) % 360;
  const lines = wrap(title.toUpperCase(), 11);
  const text = lines
    .map((line, i) => `<text x="30" y="${520 - (lines.length - 1 - i) * 46}" font-family="Arial Black,Arial" font-weight="900" font-size="40" fill="${c}" letter-spacing="1">${escapeXml(line)}</text>`)
    .join("");
  const cx = 60 + (h % 280);
  const cy = 120 + ((h >> 8) % 220);
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="r" cx="${cx / 400}" cy="${cy / 600}" r=".55"><stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></linearGradient></defs>
<rect width="400" height="600" fill="url(#g)"/><rect width="400" height="600" fill="url(#r)"/>
<circle cx="${cx}" cy="${cy + 60}" r="${70 + (h % 60)}" fill="${a}" opacity=".55"/>
<rect width="400" height="600" fill="url(#f)"/>${text}</svg>`);
};

export const backdrop = title => {
  const h = hash(title + "bg");
  const [a, b, c] = PALETTES[h % PALETTES.length];
  const ridge = Array.from({ length: 9 }, (_, i) => `${i * 200},${560 - ((h >> i) % 220)}`).join(" ");
  const ridge2 = Array.from({ length: 9 }, (_, i) => `${i * 200 + 90},${640 - ((h >> (i + 3)) % 160)}`).join(" ");
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".7" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>
<radialGradient id="m" cx=".7" cy=".25" r=".35"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="1600" height="900" fill="url(#s)"/><rect width="1600" height="900" fill="url(#m)"/>
<polygon points="0,900 ${ridge} 1600,900" fill="${a}" opacity=".85"/>
<polygon points="0,900 ${ridge2} 1600,900" fill="#05050a" opacity=".9"/></svg>`);
};

export const still = (title, n) => backdrop(`${title} ${n}`);

export const person = name => {
  const h = hash(name);
  const [a, b] = PALETTES[h % PALETTES.length];
  const initials = name.split(/\s+/).map(w => w[0]).join("").slice(0, 2);
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><linearGradient id="g"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="100" cy="82" r="36" fill="#fff" opacity=".18"/><rect x="40" y="128" width="120" height="90" rx="60" fill="#fff" opacity=".18"/><text x="100" y="112" text-anchor="middle" font-family="Arial" font-weight="700" font-size="34" fill="#fff" opacity=".0">${escapeXml(initials)}</text></svg>`);
};

export const logoText = title => {
  const text = title.toUpperCase().slice(0, 18);
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200" viewBox="0 0 900 200"><text x="0" y="150" textLength="${Math.min(880, text.length * 70)}" lengthAdjust="spacingAndGlyphs" font-family="Arial Black,Arial" font-weight="900" font-size="130" fill="#fff">${escapeXml(text)}</text></svg>`);
};

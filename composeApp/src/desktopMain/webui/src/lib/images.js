// Smaller pictures in Lite. The film databases serve each picture in several sizes, named in its
// address, and addons often hand over the largest: an original backdrop is about 33 MB once
// decoded. On a computer with 4 GB that is memory the player needs, so Lite asks for the size
// the interface actually draws. Addresses from anywhere else are left exactly as they are.

const TMDB = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)([a-z0-9_]+)(\/.+)$/i;
const METAHUB = /^(https?:\/\/images\.metahub\.space\/)(poster|background)\/(small|medium|large)(\/.+)$/i;

// What each kind of picture is drawn at, and the TMDB sizes that are bigger than that. Only sizes
// TMDB offers for that kind of picture are asked for.
//   poster    a card, 168 px wide
//   backdrop  across the window (a hero, a title's page)
//   still     a 300 px card or an episode's picture (a backdrop drawn that small too)
//   logo      a title's logo, at most about 520 px wide
//   face      a cast photo, 96 px round
const TMDB_SIZES = {
  poster: { to: "w342", from: ["original", "w1280", "w780", "w500"] },
  backdrop: { to: "w780", from: ["original", "w1280"] },
  still: { to: "w300", from: ["original", "w1280", "w780", "w500"] },
  logo: { to: "w500", from: ["original"] },
  face: { to: "w185", from: ["original", "h632"] },
};

// Metahub (Cinemeta's pictures): posters come small, medium or large; backgrounds medium or large.
const METAHUB_SIZES = {
  poster: { poster: "small" },
  backdrop: { background: "medium" },
  still: { background: "medium" },
};

/** The address of a smaller copy of a known picture drawn as [kind], or the address unchanged. */
export function smaller(url, kind) {
  if (typeof url !== "string" || !url) return url;
  const tmdb = TMDB.exec(url);
  if (tmdb) {
    const rule = TMDB_SIZES[kind];
    return rule && rule.from.includes(tmdb[2].toLowerCase()) ? `${tmdb[1]}${rule.to}${tmdb[3]}` : url;
  }
  const metahub = METAHUB.exec(url);
  if (metahub) {
    const to = METAHUB_SIZES[kind]?.[metahub[2].toLowerCase()];
    // Only ever smaller: a small poster stays small.
    return to && metahub[3].toLowerCase() !== "small" && metahub[3].toLowerCase() !== to ? `${metahub[1]}${metahub[2]}/${to}${metahub[4]}` : url;
  }
  return url;
}

/** The picture to load for [kind]: in Lite a smaller copy when one is known, else [url] itself. */
export const sized = (url, kind, lite) => (lite ? smaller(url, kind) : url);

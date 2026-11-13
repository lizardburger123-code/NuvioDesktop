export const minutesLeft = (positionMs, durationMs) => {
  const left = Math.max(0, Math.round((durationMs - positionMs) / 60000));
  if (!durationMs) return "";
  if (left >= 60) return `${Math.floor(left / 60)}h ${left % 60}m left`;
  return `${left}m left`;
};

export const episodeCode = (season, episode) =>
  season != null && episode != null ? `S${season} · E${episode}` : "";

export const clockTime = date =>
  date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const relativeAir = epochMs => {
  const diff = epochMs - Date.now();
  if (diff <= 0) return "Out now";
  const hours = diff / 3600_000;
  if (hours < 1) return `In ${Math.max(1, Math.round(diff / 60000))} min`;
  if (hours < 24) return `In ${Math.round(hours)} h`;
  return new Date(epochMs).toLocaleDateString([], { weekday: "long" });
};

export const year = text => (String(text || "").match(/\d{4}/) || [""])[0];

/**
 * "12.3 GB" in megabytes (0 when there is no size). The app formats sizes with the system's
 * locale, so the decimal separator can be a comma.
 */
export const megabytes = text => {
  const match = String(text || "").match(/(\d+(?:[.,]\d+)?)\s?(TB|GB|MB|TiB|GiB|MiB)\b/i);
  if (!match) return 0;
  const value = parseFloat(match[1].replace(",", "."));
  const unit = match[2][0].toUpperCase();
  return value * (unit === "T" ? 1024 * 1024 : unit === "G" ? 1024 : 1);
};

/** Pulls quality and feature tags out of an addon stream's name/title/description. */
export const parseStream = stream => {
  const text = [stream.name, stream.title, stream.description, stream.filename].filter(Boolean).join(" \n ");
  const has = re => re.test(text);
  const quality = has(/2160p|\b4k\b|uhd/i) ? "4K" : has(/1080p/i) ? "1080p" : has(/720p/i) ? "720p" : has(/480p|\bsd\b/i) ? "SD" : "";
  const tags = [];
  if (has(/\bdv\b|dolby.?vision|\bdovi\b/i)) tags.push("DV");
  if (has(/hdr10\+/i)) tags.push("HDR10+");
  else if (has(/\bhdr(10)?\b/i)) tags.push("HDR");
  if (has(/remux/i)) tags.push("Remux");
  else if (has(/blu-?ray|bdrip|brrip/i)) tags.push("Blu-ray");
  else if (has(/web-?dl|webrip|\bweb\b/i)) tags.push("WEB");
  if (has(/atmos/i)) tags.push("Atmos");
  else if (has(/truehd|dts-?hd|dts:?x/i)) tags.push("Lossless");
  else if (has(/ddp|dd\+|eac3|5\.1|7\.1/i)) tags.push(has(/7\.1/) ? "7.1" : "5.1");
  if (has(/hevc|x265|h\.?265/i)) tags.push("HEVC");
  if (has(/\b(ar|ara|arabic)\b|عربي/i)) tags.push("Arabic");
  // Releases mastered to fill more of a 16:9 screen: IMAX (1.90:1 expanded), IMAX Enhanced
  // (Disney+ Marvel/Pixar web releases), Open Matte and full-frame. Names are the only signal
  // addons give, so this reads every naming variant AIOStreams/Torrentio/Comet pass through.
  const imax = has(/\bimax\b|imax[ ._-]?enhanced|\bexpanded[ ._-]?(aspect|ratio)?\b|\b1[.,]90(:1)?\b|\b1[.,]43(:1)?\b/i);
  const openMatte = has(/open[ ._-]?matte|full[ ._-]?frame|\b16[x:]9\b|\b1[.,]78(:1)?\b/i);
  const fullFrame = imax || openMatte;
  if (imax) tags.unshift(has(/imax[ ._-]?enhanced/i) ? "IMAX Enhanced" : "IMAX");
  else if (openMatte) tags.unshift("Open Matte");
  // The unit must end there: "12 Mbps" is a bitrate, not a size.
  const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s?(TB|GB|MB|TiB|GiB|MiB)\b/i);
  const size = stream.size || (sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase().replace("I", "i")}` : "");
  // The app's own cache check (stream.cached) wins; otherwise the addon's words, where
  // "Uncached" and "not cached" also contain "cached".
  const cached = stream.cached === true
    || (stream.cached !== false && has(/⚡|\[\+\]|cached|\[(TB|RD|AD|PM)\+\]/i) && !has(/uncached|not cached/i));
  const release = (stream.filename || stream.title || stream.name || "").split("\n")[0].replace(/\.(mkv|mp4|avi)$/i, "");
  // In megabytes, from the same figure the row shows (the file's own size when the app knows it).
  const sizeBytes = megabytes(size);
  // AIOStreams can list streams its filters dropped, with a "removal reason"; they aren't playable picks.
  const removed = has(/removal reason|removed:|\bexcluded\b/i);
  return { quality, tags, size, cached, release, sizeBytes, fullFrame, removed };
};

export const qualityRank = quality => ({ "4K": 4, "1080p": 3, "720p": 2, SD: 1 })[quality] || 0;

/**
 * The kinds of release a source can be, in the order a viewer would reach for them. Each has its
 * own colour in the sources sheet; the best file of each kind is lifted to the top.
 */
export const SOURCE_KINDS = [
  { id: "imax", label: "IMAX", test: info => info.tags.includes("IMAX") || info.tags.includes("IMAX Enhanced") },
  { id: "openmatte", label: "Open Matte", test: info => info.tags.includes("Open Matte") },
  { id: "dv", label: "Dolby Vision", test: info => info.tags.includes("DV") },
  { id: "remux", label: "Remux", test: info => info.tags.includes("Remux") },
  { id: "hdr", label: "HDR", test: info => info.tags.includes("HDR") || info.tags.includes("HDR10+") },
  { id: "web", label: "Web", test: info => info.tags.includes("WEB") },
];
export const sourceKind = info => SOURCE_KINDS.find(kind => kind.test(info))?.id || null;
export const TAG_KIND = { IMAX: "imax", "IMAX Enhanced": "imax", "Open Matte": "openmatte", DV: "dv", Remux: "remux", HDR: "hdr", "HDR10+": "hdr", WEB: "web" };

/** How good a file is to watch: picture first, then whether it plays now, then its extras. */
export const sourceScore = (info, ready = info.cached) => {
  const gb = (info.sizeBytes || 0) / 1024;
  return qualityRank(info.quality) * 100
    + (ready ? 40 : 0)
    + (info.tags.includes("DV") ? 8 : 0)
    + (info.tags.includes("HDR10+") ? 6 : info.tags.includes("HDR") ? 5 : 0)
    + (info.tags.includes("Remux") ? 6 : 0)
    + (info.tags.includes("Atmos") ? 4 : info.tags.includes("Lossless") ? 3 : 0)
    + Math.min(12, Math.log2(1 + gb) * 3);
};

// The sources list is pushed again every time an addon answers, with the same files in it, so a
// file's reading is kept by its text instead of being parsed again on every push.
const infoCache = new Map();
const textKey = stream => [stream.name, stream.title, stream.description, stream.filename, stream.size, stream.cached, stream.addonName].join("\u0001");

/** parseStream, remembered (treat the result as read-only: it is shared). */
export const streamInfo = stream => {
  const key = textKey(stream);
  let info = infoCache.get(key);
  if (!info) {
    if (infoCache.size > 5000) infoCache.clear();
    info = parseStream(stream);
    infoCache.set(key, info);
  }
  return info;
};

// ---- Release groups and "the same source" ------------------------------------------------------
// The same reading as SourceFingerprint.kt, which picks the next episode's file in the player: who
// released a file and how it looks, read out of its text. Keep the two in step.
const VIDEO_EXTENSION = /\.(mkv|mp4|avi|m4v|ts|webm)$/i;
const LEADING_GROUP = /^\[([^[\]]{2,32})\]/;
const TRAILING_GROUP = /-\s?([A-Za-z0-9][A-Za-z0-9_]{1,24})(?:\s*[[(][^[\]()]*[\])])*$/;
const GROUP_NAME = /^[a-z0-9][a-z0-9 _.-]{1,31}$/;
const LOOKS_LIKE_RELEASE = /\b(2160p|1080p|720p|480p|web-?dl|webrip|blu-?ray|bdrip|remux|x26[45]|hevc)\b/i;
const NOT_A_GROUP = new Set([
  "dl", "rip", "web", "webdl", "webrip", "bluray", "bdrip", "brrip", "remux", "raw", "hd", "sd", "uhd",
  "x264", "x265", "h264", "h265", "264", "265", "hevc", "avc", "av1", "aac", "ac3", "eac3", "dts", "ma",
  "flac", "opus", "hdr", "hdr10", "dv", "10bit", "8bit", "multi", "dual", "sub", "subs", "dub", "dubbed",
  "1080p", "720p", "2160p", "480p", "4k", "imax", "proper", "repack", "mkv", "mp4",
  "rd", "tb", "ad", "pm", "oc", "ed", "p2p", "cached", "uncached", "torbox", "realdebrid", "instant",
]);

const groupIn = line => {
  const text = String(line || "").trim().replace(/^[^\p{L}\p{Nd}[]+/u, "").replace(VIDEO_EXTENSION, "").trim();
  if (!text) return "";
  const asGroup = value => {
    const group = value.trim().toLowerCase();
    return GROUP_NAME.test(group) && /[a-z]/.test(group) && !NOT_A_GROUP.has(group) ? group : "";
  };
  const leading = text.match(LEADING_GROUP);
  const fromLeading = leading ? asGroup(leading[1]) : "";
  if (fromLeading) return fromLeading;
  const trailing = text.match(TRAILING_GROUP);
  return trailing ? asGroup(trailing[1]) : "";
};

const streamLines = stream => [stream.name, stream.title, stream.description]
  .filter(Boolean).flatMap(text => String(text).split(/\r\n|\r|\n/)).map(line => line.trim()).filter(Boolean);

/** The release group of a file ("[SubsPlease] …" or "…-FLUX"), lower-cased; "" when none is named. */
export const releaseGroup = stream => {
  const fromFile = stream.filename ? groupIn(stream.filename) : "";
  if (fromFile) return fromFile;
  for (const line of streamLines(stream)) {
    if (!VIDEO_EXTENSION.test(line) && !LOOKS_LIKE_RELEASE.test(line)) continue;
    const group = groupIn(line);
    if (group) return group;
  }
  return "";
};

const fingerprintCache = new Map();

/**
 * What another episode's files are compared with: addon, release group, quality, origin (remux,
 * bluray, web), dynamic range (dv, hdr, dv+hdr), codec and size in megabytes.
 */
export const sourceFingerprint = stream => {
  const key = textKey(stream);
  const known = fingerprintCache.get(key);
  if (known) return known;
  const all = [stream.filename, ...streamLines(stream)].filter(Boolean).join(" \n ");
  const has = re => re.test(all);
  const dolbyVision = has(/\bdv\b|dolby.?vision|\bdovi\b/i);
  const hdr = has(/hdr10\+|\bhdr(10)?\b/i);
  const fingerprint = {
    addon: String(stream.addonName || "").trim().toLowerCase(),
    group: releaseGroup(stream),
    quality: has(/2160p|\b4k\b|uhd/i) ? "4K" : has(/1080p/i) ? "1080p" : has(/720p/i) ? "720p" : has(/480p|\bsd\b/i) ? "SD" : "",
    origin: has(/remux/i) ? "remux" : has(/blu-?ray|bdrip|brrip/i) ? "bluray" : has(/web-?dl|webrip|\bweb\b/i) ? "web" : "",
    range: [dolbyVision ? "dv" : "", hdr ? "hdr" : ""].filter(Boolean).join("+"),
    codec: has(/hevc|x265|h\.?265/i) ? "hevc" : has(/\bav1\b/i) ? "av1" : has(/x264|h\.?264|\bavc\b/i) ? "avc" : "",
    // Only the app's own figure for the file, like the player (a description can name a pack's size).
    mb: megabytes(stream.size),
  };
  if (fingerprintCache.size > 5000) fingerprintCache.clear();
  fingerprintCache.set(key, fingerprint);
  return fingerprint;
};

/**
 * "same": the same release group at the same quality and dynamic range. "close": no group to go
 * by, but the same addon offers a file that agrees on everything that is known. Otherwise "".
 */
export const sourceMatch = (was, now) => {
  if (!was || !now || !was.quality || was.quality !== now.quality || was.range !== now.range) return "";
  if (was.group && was.group === now.group) return "same";
  if (was.group && now.group) return "";
  return was.origin === now.origin && was.codec === now.codec && was.addon === now.addon ? "close" : "";
};

/** Among matches of the same level, how near a file is to the one before (higher is nearer). */
export const sourceCloseness = (was, now) => {
  let points = 0;
  if (was.addon === now.addon) points += 4;
  if (was.origin === now.origin) points += 2;
  if (was.codec === now.codec) points += 2;
  if (was.mb > 0 && now.mb > 0) {
    const ratio = now.mb / was.mb;
    if (ratio >= 0.7 && ratio <= 1.4) points += 2;
    else if (ratio >= 0.5 && ratio <= 2) points += 1;
  }
  return points;
};

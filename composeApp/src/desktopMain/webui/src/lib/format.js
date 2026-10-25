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
  // Releases that fill a 16:9 screen (no letterbox bars).
  const fullFrame = has(/imax|open[ ._-]?matte|full[ ._-]?frame|\b1[.,]78\b|\b16[x:]9\b|\b1[.,]90\b/i);
  if (has(/imax/i)) tags.unshift("IMAX");
  else if (has(/open[ ._-]?matte/i)) tags.unshift("Open Matte");
  const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s?(GB|MB|GiB|MiB)/i);
  const size = stream.size || (sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase().replace("I", "i")}` : "");
  const cached = stream.cached === true || has(/⚡|\[\+\]|cached|\[(TB|RD|AD|PM)\+\]/i);
  const release = (stream.filename || stream.title || stream.name || "").split("\n")[0].replace(/\.(mkv|mp4|avi)$/i, "");
  const sizeBytes = sizeMatch ? parseFloat(sizeMatch[1]) * (/g/i.test(sizeMatch[2]) ? 1024 : 1) : 0;
  // AIOStreams can list streams its filters dropped, with a "removal reason"; they aren't playable picks.
  const removed = has(/removal reason|removed:|\bexcluded\b/i);
  return { quality, tags, size, cached, release, sizeBytes, fullFrame, removed };
};

export const qualityRank = quality => ({ "4K": 4, "1080p": 3, "720p": 2, SD: 1 })[quality] || 0;

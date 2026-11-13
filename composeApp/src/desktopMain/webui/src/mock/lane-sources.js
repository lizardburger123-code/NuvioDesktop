// Preview-only backend for the Sources sheet and the subtitle picker.
// Return handlers keyed by method name ("area.verb": params => result or a Promise of it).
// ctx.push(topic, data, delayMs) sends a topic to the interface; ctx.base has the handlers of
// backend.js (to wrap one, define the same name here and call ctx.base[name]); ctx.data has the
// preview's catalog.
//
// Sources answer like the app does: one push with every addon loading, then one more push each
// time an addon answers. A test script can pick a harder case before it opens the sheet:
//   window.__mockSources = { many: true }    about 330 files from three addons
//   window.__mockSources = { slow: true }    one addon takes 14 s to answer
//   window.__mockSources = { fail: true }    one addon fails
//   window.__mockSources = { none: true }    every addon answers with nothing
//   window.__mockSources = { allFail: true } every addon fails
//   window.__mockSources = { broken: true }  the request itself fails
//   window.__mockSources = { noAddons: true } no stream addon installed

// [quality, release (no group), group, size in GB, cached]
const EPISODE_FILES = [
  ["4K", "{t}.{ep}.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265", "FLUX", 9.8, true],
  ["4K", "{t}.{ep}.2160p.ATVP.WEB-DL.DDP5.1.Atmos.HDR10.HEVC", "NTb", 8.9, true],
  ["4K", "{t}.{ep}.2160p.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1", "FraMeSToR", 31.6, false],
  ["4K", "{t}.{ep}.2160p.WEB.h265", "EDITH", 7.2, false],
  ["1080p", "{t}.{ep}.1080p.ATVP.WEB-DL.DDP5.1.H.264", "FLUX", 3.1, true],
  ["1080p", "{t}.{ep}.1080p.WEB.H264", "SuccessfulCrab", 2.6, true],
  ["1080p", "{t}.{ep}.1080p.BluRay.x264", "SHORTBREHD", 4.4, false],
  ["1080p", "{t}.{ep}.1080p.WEB-DL.x265.10bit.HDR.DDP5.1", "MeGusta", 1.1, true],
  ["720p", "{t}.{ep}.720p.WEB.h264", "KOGi", 1.2, false],
  ["720p", "{t}.{ep}.720p.WEB-DL.Arabic.Subbed", "EgyDead", 0.9, true],
];
const MOVIE_FILES = [
  ["4K", "{t}.{y}.IMAX.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1", "FGT", 68.4, true],
  ["4K", "{t}.{y}.2160p.UHD.BluRay.REMUX.HDR.HEVC.DTS-HD.MA.5.1", "EPSiLON", 61.0, true],
  ["4K", "{t}.{y}.Open.Matte.2160p.WEB-DL.DDP5.1.HDR.H.265", "NOGRP", 22.0, false],
  ["1080p", "{t}.{y}.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1", "FraMeSToR", 38.5, true],
  ["1080p", "{t}.{y}.1080p.WEB-DL.DDP5.1.H.264", "FLUX", 6.2, true],
  ["1080p", "{t}.{y}.1080p.BluRay.x264", "SPARKS", 10.9, false],
  ["720p", "{t}.{y}.720p.BluRay.x264", "SPARKS", 4.4, false],
];
const EXTRA_GROUPS = ["CAKES", "playWEB", "TEPES", "GLHF", "ELiTE", "DiRT", "SiGMA", "BLOOM", "HONE", "PSA", "RARBG", "YTS", "TGx", "ION10", "SMURF"];

const pad = n => String(n).padStart(2, "0");
const dotted = name => name.replace(/[^A-Za-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
const hashOf = seed => Array.from({ length: 40 }, (_, i) => "0123456789abcdef"[(seed * 7 + i * 13 + (seed >> 3)) % 16]).join("");

export default ctx => {
  const scenario = () => window.__mockSources || {};

  const file = ({ addon, title, quality, group, gb, cached, index, extra = {} }) => {
    const filename = `${title}-${group}.mkv`;
    const size = `${gb.toFixed(1)} GB`;
    const torrent = !cached && addon !== "SELection";
    return {
      key: `${addon}#${index}#${filename.length}`,
      name: addon === "SELection" ? `SELection ${quality}${cached ? " ⚡" : " ⏳"}` : `${addon}\n${quality}`,
      title: `${title}-${group}`,
      description: `${filename}\n💾 ${size}  👤 ${12 + (index % 40)}  ⚙️ TorBox${cached ? "" : " · Uncached"}`,
      filename, size, addonName: addon,
      ...(cached ? { cached: true } : {}),
      ...(torrent || (!cached && index % 2 === 0) ? { hash: hashOf(index + addon.length * 31), p2p: torrent } : {}),
      ...extra,
    };
  };

  // Files one addon has for one episode or movie. Rows repeat across episodes with the same
  // groups, so "the same source as last time" can be tried episode after episode.
  const filesFor = ({ addon, meta, season, episode, count }) => {
    const series = meta.type === "series";
    const base = dotted(meta.name);
    const ep = series ? `S${pad(season)}E${pad(episode)}` : "";
    const table = series ? EPISODE_FILES : MOVIE_FILES;
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const [quality, release, group, gb, cached] = table[i % table.length];
      const round = Math.floor(i / table.length);
      const title = release.replace("{t}", base).replace("{ep}", ep).replace("{y}", meta.releaseInfo || "2026").replace(/\.\./g, ".");
      rows.push(file({
        addon, title, quality, index: i,
        group: round ? EXTRA_GROUPS[(i + round) % EXTRA_GROUPS.length] : group,
        gb: Math.max(0.3, gb * (1 + ((episode || 1) % 3 - 1) * 0.06) * (round ? 0.6 + (i % 5) * 0.2 : 1)),
        cached: round ? i % 3 === 0 : addon === "Torrentio" ? false : cached,
      }));
    }
    if (addon === "SELection") {
      rows.push(file({ addon, title: series ? "مسلسل.الحلقة.مترجم.عربي.1080p.WEB-DL" : "فيلم.مترجم.عربي.1080p.WEB-DL", quality: "1080p", group: "EgyBest", gb: 1.4, cached: true, index: 900 }));
      rows.push(file({ addon, title: `${base}.${ep || "2026"}.2160p.ATVP.WEB-DL.DDP5.1.Atmos.Dolby.Vision.HDR10.Plus.HEVC.Multi.Subs.Arabic.English.French.German.Italian.Spanish.Portuguese`, quality: "4K", group: "AVeryLongReleaseGroup", gb: 12.6, cached: true, index: 901 }));
      rows.push({ ...file({ addon, title: `${base}.${ep}.HDTS.x264`, quality: "SD", group: "ION10", gb: 0.7, cached: false, index: 902 }), description: `${base}.${ep}.HDTS.x264-ION10\n❌ Removal reason: Excluded quality (TS)` });
      rows.push({ key: "SELection#903#web", name: "Apple TV+", title: "Watch on Apple TV+ (opens in your browser)", addonName: addon, external: true });
    }
    return rows;
  };

  // Like the app, a new request drops the answers still on their way for the previous one.
  let generation = 0;
  const fail = message => new Promise((resolve, reject) => window.setTimeout(() => reject(new Error(message)), 500));
  return {
    // Subtitle window and TorBox dialogs, failing on request:
    //   { subsFail: true }   the subtitle search fails
    //   { signedOut: true }  caching on TorBox asks to connect TorBox first
    //   { torboxDown: true } TorBox can't be reached
    //   { codeFail: true }   TorBox gives no sign-in code
    "subtitles.match": params => (scenario().subsFail ? fail("The subtitle sites didn't answer in time.") : ctx.base["subtitles.match"](params)),
    "torbox.cache": params => (scenario().signedOut ? fail("Connect TorBox first to cache sources.") : ctx.base["torbox.cache"](params)),
    "torbox.summary": params => (scenario().torboxDown ? fail("Unable to resolve host api.torbox.app") : ctx.base["torbox.summary"](params)),
    "torbox.connect.start": params => (scenario().codeFail ? fail("TorBox is busy. Try again in a minute.") : ctx.base["torbox.connect.start"](params)),
    "streams.load": ({ type, videoId, parentMetaId, season, episode }) => {
      generation += 1;
      const run = generation;
      const options = scenario();
      if (options.broken) throw new Error("The app couldn't ask your addons for sources. Try again in a moment.");
      const key = videoId;
      const meta = ctx.data.detailsFor(type, parentMetaId || videoId);
      if (options.noAddons) {
        ctx.push("streams", { key, loading: false, groups: [], empty: "NoAddonsInstalled" }, 300);
        return true;
      }
      const many = Boolean(options.many);
      const addons = [
        { addonId: "aio", addonName: "SELection", after: 700, count: many ? 210 : 10 },
        { addonId: "torrentio", addonName: "Torrentio", after: 1600, count: many ? 80 : 6 },
        { addonId: "comet", addonName: "Comet", after: options.slow ? 14000 : 2300, count: many ? 36 : 4 },
        { addonId: "torbox", addonName: "TorBox library", after: 400, count: 0 },
      ];
      if (options.fail) addons[2].error = "Request timeout has expired [request_timeout=15000 ms]";
      if (options.allFail) addons.forEach(addon => { addon.error = "Unable to resolve host: no address associated with hostname"; });
      const groups = addons.map(addon => ({ addonId: addon.addonId, addonName: addon.addonName, loading: true, streams: [] }));
      const send = () => {
        const loading = groups.some(group => group.loading);
        const empty = loading || groups.some(group => group.streams.length) ? undefined
          : groups.every(group => group.error) ? "StreamFetchFailed" : "NoStreamsFound";
        ctx.push("streams", { key, loading, groups: groups.map(group => ({ ...group })), ...(empty ? { empty } : {}) });
      };
      send();
      addons.forEach((addon, i) => window.setTimeout(() => {
        if (run !== generation) return;
        groups[i] = {
          addonId: addon.addonId, addonName: addon.addonName, loading: false,
          streams: addon.error || options.none ? [] : filesFor({ addon: addon.addonName, meta, season, episode, count: addon.count }),
          ...(addon.error ? { error: addon.error } : {}),
        };
        send();
      }, addon.after));
      return true;
    },
  };
};

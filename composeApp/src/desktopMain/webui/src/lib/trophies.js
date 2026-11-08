/**
 * Trophies: what the shelf of completed titles says about the viewer. Pure functions over the
 * `completed` topic items ({ id, type, name, poster, releaseInfo, completedAt, durationMs,
 * episodes }). Every figure here is computed from the items the shelf shows, so the numbers on
 * screen always agree with the cases on it.
 */

const DAY = 86400e3;
const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const yearOf = item => { const m = /\d{4}/.exec(item.releaseInfo || ""); return m ? Number(m[0]) : null; };
export const hoursOf = ms => Math.round((ms || 0) / 36e5);
export const fmtHours = ms => {
  const h = (ms || 0) / 36e5;
  if (h >= 100) return `${Math.round(h)} h`;
  if (h >= 10) return `${h.toFixed(0)} h`;
  return h > 0 ? `${h.toFixed(1).replace(/\.0$/, "")} h` : "0 h";
};

/** Consecutive days with at least one completion, ending today or yesterday (current) and ever (longest). */
export function streaks(items, now = Date.now()) {
  const days = [...new Set(items.map(i => startOfDay(i.completedAt || 0)).filter(Boolean))].sort((a, b) => a - b);
  let longest = 0, run = 0, prev = null;
  for (const day of days) {
    run = prev != null && day - prev === DAY ? run + 1 : 1;
    prev = day;
    if (run > longest) longest = run;
  }
  const today = startOfDay(now);
  const set = new Set(days);
  let current = 0;
  let cursor = set.has(today) ? today : set.has(today - DAY) ? today - DAY : null;
  while (cursor != null && set.has(cursor)) { current += 1; cursor -= DAY; }
  return { longest, current };
}

/** 52 weeks x 7 days of completion counts, oldest first, for a GitHub-style year grid. */
export function yearGrid(items, now = Date.now()) {
  const counts = new Map();
  items.forEach(i => { const k = startOfDay(i.completedAt || 0); counts.set(k, (counts.get(k) || 0) + 1); });
  const today = startOfDay(now);
  const dow = new Date(today).getDay(); // 0 = Sunday
  const end = today + (6 - dow) * DAY; // end of this week
  const start = end - (52 * 7 - 1) * DAY;
  const weeks = [];
  for (let w = 0; w < 52; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const day = start + (w * 7 + d) * DAY;
      week.push({ day, count: day > today ? -1 : counts.get(day) || 0 });
    }
    weeks.push(week);
  }
  const max = Math.max(1, ...[...counts.values()]);
  return { weeks, max, months: monthMarks(start, end) };
}

function monthMarks(start, end) {
  const marks = [];
  let cursor = new Date(start);
  cursor.setDate(1);
  if (cursor.getTime() < start) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() <= end) {
    const week = Math.floor((startOfDay(cursor.getTime()) - start) / (7 * DAY));
    marks.push({ week, label: cursor.toLocaleDateString([], { month: "short" }) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return marks;
}

export function stats(items, now = Date.now()) {
  const films = items.filter(i => i.type !== "series");
  const series = items.filter(i => i.type === "series");
  const totalMs = items.reduce((sum, i) => sum + (i.durationMs || 0), 0);
  const timed = items.filter(i => i.durationMs > 0).length;
  const month = new Date(now);
  const thisMonth = items.filter(i => { const d = new Date(i.completedAt || 0); return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth(); }).length;
  const thisYear = items.filter(i => new Date(i.completedAt || 0).getFullYear() === month.getFullYear()).length;
  const decades = new Set(items.map(yearOf).filter(Boolean).map(y => Math.floor(y / 10) * 10));
  const byMonth = new Map();
  items.forEach(i => { const d = new Date(i.completedAt || 0); const k = `${d.getFullYear()}-${d.getMonth()}`; byMonth.set(k, (byMonth.get(k) || 0) + 1); });
  let topMonth = null;
  byMonth.forEach((count, key) => { if (!topMonth || count > topMonth.count) topMonth = { key, count }; });
  if (topMonth) {
    const [y, m] = topMonth.key.split("-").map(Number);
    topMonth.label = new Date(y, m, 1).toLocaleDateString([], { month: "long", year: "numeric" });
  }
  const oldest = items.map(yearOf).filter(Boolean).sort((a, b) => a - b)[0] || null;
  return { total: items.length, films: films.length, series: series.length, totalMs, timed, thisMonth, thisYear, decades: decades.size, topMonth, oldest, ...streaks(items, now) };
}

const TIERS = ["bronze", "silver", "gold", "platinum"];
const tiered = (value, steps) => {
  const reached = steps.filter(step => value >= step).length;
  const next = steps[Math.min(reached, steps.length - 1)];
  return { tier: TIERS[Math.max(0, reached - 1)], earned: reached > 0, progress: Math.min(1, value / next), value, next, maxed: reached === steps.length };
};

/**
 * Badges: each is earned from the shelf itself, with tiers for the counting ones. `progress`
 * shows how close the next tier is, so an unearned badge is a goal rather than a blank.
 */
export function badges(items, now = Date.now()) {
  const s = stats(items, now);
  const films = items.filter(i => i.type !== "series");
  const byDay = new Map();
  items.forEach(i => { const k = dayKey(i.completedAt || 0); byDay.set(k, (byDay.get(k) || 0) + 1); });
  const bestDay = Math.max(0, ...byDay.values());
  const nightOwls = items.filter(i => { const h = new Date(i.completedAt || 0).getHours(); return h >= 0 && h < 5; }).length;
  const marathons = films.filter(i => (i.durationMs || 0) >= 150 * 60e3).length;
  const classics = films.filter(i => { const y = yearOf(i); return y && y < 1990; }).length;
  const weekends = items.filter(i => { const d = new Date(i.completedAt || 0).getDay(); return d === 0 || d === 6; }).length;
  const binge = items.filter(i => i.type === "series" && (i.episodes || 0) >= 8).length;

  return [
    { id: "collector", name: "Collector", what: "Titles on the shelf", icon: "shelf", ...tiered(s.total, [1, 10, 50, 200]) },
    { id: "cinephile", name: "Cinephile", what: "Films watched to the end", icon: "film", ...tiered(s.films, [5, 25, 100, 300]) },
    { id: "binge", name: "Binge", what: "Series finished, 8+ episodes", icon: "tv", ...tiered(binge, [1, 5, 15, 40]) },
    { id: "streak", name: "On a roll", what: "Days in a row with a finish", icon: "flame", ...tiered(s.longest, [3, 7, 14, 30]) },
    { id: "double", name: "Double feature", what: "Most finished in one day", icon: "layers", ...tiered(bestDay, [2, 3, 4, 6]) },
    { id: "marathon", name: "Marathon", what: "Films over 2½ hours", icon: "clock", ...tiered(marathons, [1, 5, 15, 30]) },
    { id: "nightowl", name: "Night owl", what: "Finished between midnight and 5", icon: "moon", ...tiered(nightOwls, [1, 5, 20, 50]) },
    { id: "timetravel", name: "Time traveller", what: "Decades on the shelf", icon: "history", ...tiered(s.decades, [3, 5, 7, 9]) },
    { id: "classic", name: "Classics", what: "Films from before 1990", icon: "star", ...tiered(classics, [1, 5, 20, 50]) },
    { id: "weekend", name: "Weekender", what: "Weekend finishes", icon: "sun", ...tiered(weekends, [3, 10, 40, 100]) },
    { id: "hours", name: "Screen time", what: "Hours watched", icon: "hourglass", ...tiered(hoursOf(s.totalMs), [10, 50, 200, 1000]) },
    { id: "month", name: "Full month", what: "Most finishes in a month", icon: "calendar", ...tiered(s.topMonth?.count || 0, [4, 8, 15, 30]) },
  ];
}

/** Which badges a given completion newly earned or raised a tier of: for the end-of-film moment. */
export function newlyEarned(before, after) {
  const prev = new Map(badges(before).map(b => [b.id, b]));
  return badges(after).filter(b => b.earned && (!prev.get(b.id)?.earned || prev.get(b.id).tier !== b.tier));
}

/* daily.js — daily challenge rules: which puzzle a date gets, records,
 * streaks, and the calendar grid.
 *
 * Pure and headless (no DOM, no storage), so tests can run it in node; ui.js
 * does the storage. See board.js for the dual-use (browser <script> + node
 * require) convention — these names become browser globals.
 *
 * Days are LOCAL calendar days, keyed "YYYY-MM-DD". There is no server: the
 * puzzle is generated on the device from the date, so everyone on the same
 * version gets the same board each day.
 *
 * Records: { "2026-10-08": { stars, bestMs, onTime } }. onTime = the attempt
 * was started on the puzzle's own day; only on-time days build a streak.
 */
if (typeof module !== "undefined") {
  Object.assign(global, require("./board.js"));
  Object.assign(global, require("./solver.js"));
  Object.assign(global, require("./generator.js"));
}

const DAILY_EPOCH = "2026-10-08"; // release day: day 0, and the calendar's first day
const DAILY_SIZES = [10, 12, 14]; // rotates by day

const DAY_MS = 86400000;

function pad2(n) { return (n < 10 ? "0" : "") + n; }

/** Local calendar day of a Date, as "YYYY-MM-DD". */
function dateKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/** Local midnight of a key. */
function parseKey(key) {
  const p = key.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/** key shifted by n calendar days (setDate handles months, years, DST). */
function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** Days since DAILY_EPOCH. Rounded, because a DST day is 23 or 25 hours long. */
function dayIndex(key) {
  return Math.round((parseKey(key) - parseKey(DAILY_EPOCH)) / DAY_MS);
}

function dailySize(key) {
  const i = dayIndex(key);
  return DAILY_SIZES[((i % DAILY_SIZES.length) + DAILY_SIZES.length) % DAILY_SIZES.length];
}

/** The day's puzzle: logic-only (the free-play generator), seeded by the date. */
function dailyPuzzle(key) {
  const size = dailySize(key);
  const p = generatePuzzle(size, mulberry32(hashString("daily-" + key)));
  return {
    key: key, size: size,
    clues: p.clues, solution: p.solution,
    maxTier: p.maxTier, label: tierLabel(p.maxTier),
  };
}

/**
 * Merge a solve into the records (returns a new object). Once on time, always
 * on time; replays only raise stars and only lower the best time.
 */
function recordDaily(records, key, onTime, stars, ms) {
  const out = Object.assign({}, records);
  const old = out[key];
  out[key] = old
    ? { stars: Math.max(old.stars || 0, stars), bestMs: old.bestMs ? Math.min(old.bestMs, ms) : ms,
        onTime: !!old.onTime || onTime }
    : { stars: stars, bestMs: ms, onTime: onTime };
  return out;
}

function solvedOnTime(records, key) {
  return !!(records[key] && records[key].onTime);
}

/** On-time days in a row ending today — or yesterday, while today is still open. */
function currentStreak(records, todayKey) {
  let k = solvedOnTime(records, todayKey) ? todayKey : addDays(todayKey, -1);
  let n = 0;
  while (solvedOnTime(records, k)) { n++; k = addDays(k, -1); }
  return n;
}

function bestStreak(records) {
  const keys = Object.keys(records).filter((k) => solvedOnTime(records, k)).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    if (run > best) best = run;
    prev = k;
  }
  return best;
}

/** Monday-first month grid: keys for the month's days, null for blank cells. */
function monthGrid(year, month0) {
  const first = new Date(year, month0, 1);
  const lead = (first.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const days = new Date(year, month0 + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(dateKey(new Date(year, month0, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/* ---- stats screen: everything is derived from the records ---- */

const STREAK_MILESTONES = [3, 7, 30, 100];

/** Totals, streaks, per-size times and the star breakdown. Times are each day's best. */
function dailyStats(records, todayKey) {
  const keys = Object.keys(records);
  const bySize = {};
  DAILY_SIZES.forEach((n) => { bySize[n] = { solved: 0, bestMs: 0, avgMs: 0, sumMs: 0 }; });
  const stars = { 1: 0, 2: 0, 3: 0 };
  let onTime = 0;
  for (const k of keys) {
    const r = records[k];
    if (r.onTime) onTime++;
    stars[r.stars] = (stars[r.stars] || 0) + 1;
    const b = bySize[dailySize(k)];
    b.solved++;
    b.sumMs += r.bestMs;
    if (!b.bestMs || r.bestMs < b.bestMs) b.bestMs = r.bestMs;
  }
  DAILY_SIZES.forEach((n) => {
    const b = bySize[n];
    b.avgMs = b.solved ? Math.round(b.sumMs / b.solved) : 0;
    delete b.sumMs;
  });
  return {
    solved: keys.length,
    onTimePct: keys.length ? Math.round(onTime / keys.length * 100) : 0,
    perfect: stars[3],
    current: currentStreak(records, todayKey),
    best: bestStreak(records),
    bySize: bySize,
    stars: stars,
  };
}

/** Milestones are earned by the best streak; only the next unearned one counts down. */
function streakMilestones(current, best) {
  let nextShown = false;
  return STREAK_MILESTONES.map((days) => {
    const done = best >= days;
    let toGo = done ? 0 : null;
    if (!done && !nextShown) { toGo = days - current; nextShown = true; }
    return { days: days, done: done, toGo: toGo };
  });
}

/**
 * The last `weeks` weeks ending with the current one, column-major (one
 * column per week, Monday first) for a GitHub-style grid. Each cell is
 * { key, status }: "on" | "late" | "missed" | "future" | "before".
 */
function activityGrid(records, todayKey, weeks) {
  const today = parseKey(todayKey);
  const monday = addDays(todayKey, -((today.getDay() + 6) % 7));
  let k = addDays(monday, -(weeks - 1) * 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++, k = addDays(k, 1)) {
    const r = records[k];
    let status;
    if (k > todayKey) status = "future";
    else if (k < DAILY_EPOCH) status = "before";
    else if (r) status = r.onTime ? "on" : "late";
    else status = "missed";
    cells.push({ key: k, status: status });
  }
  return cells;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DAILY_EPOCH, DAILY_SIZES, STREAK_MILESTONES,
    dateKey, parseKey, addDays, dayIndex, dailySize, dailyPuzzle,
    recordDaily, currentStreak, bestStreak, monthGrid,
    dailyStats, streakMilestones, activityGrid,
  };
}

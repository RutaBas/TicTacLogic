/* tests/daily.test.js — daily challenge: dates, puzzle, streaks, calendar.
 * Run: node tests/daily.test.js   (a few seconds)
 */
const B = require("../board.js");
const S = require("../solver.js");
const D = require("../daily.js");

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error("  FAIL: " + msg); } }

/* 1 — date helpers (local calendar days, DST-safe) */
console.log("Daily 1: dates");
{
  ok(D.dateKey(new Date(2026, 9, 8, 23, 59)) === "2026-10-08", "dateKey uses the local calendar day, zero-padded");
  ok(D.dateKey(new Date(2027, 0, 5)) === "2027-01-05", "dateKey pads month and day");
  ok(D.addDays("2026-10-31", 1) === "2026-11-01", "month boundary");
  ok(D.addDays("2026-12-31", 1) === "2027-01-01", "year boundary");
  ok(D.addDays("2028-03-01", -1) === "2028-02-29", "leap day");
  ok(D.addDays("2026-10-25", 1) === "2026-10-26" && D.addDays("2026-03-29", 1) === "2026-03-30", "DST weekends");
  ok(D.dayIndex(D.DAILY_EPOCH) === 0 && D.dayIndex("2026-10-09") === 1 && D.dayIndex("2027-10-08") === 365,
     "dayIndex counts days from the epoch");
  let cross = true;
  for (let i = 0, k = D.DAILY_EPOCH; i < 400; i++, k = D.addDays(k, 1)) if (D.dayIndex(k) !== i) cross = false;
  ok(cross, "dayIndex stays exact across 400 consecutive days (incl. DST changes)");
}

/* 2 — the puzzle */
console.log("Daily 2: puzzle");
{
  ok(D.dailySize("2026-10-08") === 10 && D.dailySize("2026-10-09") === 12 &&
     D.dailySize("2026-10-10") === 14 && D.dailySize("2026-10-11") === 10, "sizes rotate 10, 12, 14 from the epoch");
  const a = D.dailyPuzzle("2026-10-12"), b = D.dailyPuzzle("2026-10-12");
  ok(a.key === "2026-10-12" && a.size === D.dailySize("2026-10-12"), "puzzle carries its key and size");
  ok(B.gridToString(a.clues, a.size) === B.gridToString(b.clues, b.size), "same date -> same puzzle");
  ok(B.gridToString(a.clues, a.size) !== B.gridToString(D.dailyPuzzle("2026-10-15").clues, a.size),
     "different dates (same size) -> different puzzles");
  let logicOnly = true, unique = true, labels = true;
  for (let i = 0, k = D.DAILY_EPOCH; i < 30; i++, k = D.addDays(k, 1)) {
    const p = D.dailyPuzzle(k);
    const r = S.solve(p.clues, p.size, { maxTrialDepth: 0 });
    if (!r.solved || B.gridToString(r.grid, p.size) !== B.gridToString(p.solution, p.size)) logicOnly = false;
    if (S.countSolutions(p.clues, p.size, 2) !== 1) unique = false;
    if (!p.label || p.maxTier > 4) labels = false;
  }
  ok(logicOnly, "30 consecutive dailies are solved by pure logic, to the stored solution");
  ok(unique, "30 consecutive dailies each have exactly one solution");
  ok(labels, "every daily has a technique label and never needs trial and error");
}

/* 3 — records and streaks */
console.log("Daily 3: records and streaks");
{
  let rec = {};
  rec = D.recordDaily(rec, "2026-10-08", true, 3, 90000);
  ok(rec["2026-10-08"].onTime && rec["2026-10-08"].stars === 3, "on-time solve recorded");
  rec = D.recordDaily(rec, "2026-10-08", false, 1, 200000);
  ok(rec["2026-10-08"].onTime && rec["2026-10-08"].stars === 3 && rec["2026-10-08"].bestMs === 90000,
     "a later, worse replay keeps onTime, stars and best time");
  rec = D.recordDaily(rec, "2026-10-08", false, 3, 50000);
  ok(rec["2026-10-08"].bestMs === 50000, "a faster replay lowers the best time");
  const late = D.recordDaily({}, "2026-10-08", false, 2, 1);
  ok(late["2026-10-08"].onTime === false, "a late first solve is not on time");

  const r = {
    "2026-10-08": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-09": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-10": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-12": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-13": { stars: 3, bestMs: 1, onTime: true },
    "2026-10-11": { stars: 3, bestMs: 1, onTime: false }, // played late from the calendar
  };
  ok(D.currentStreak(r, "2026-10-13") === 2, "late solve on 10-11 does not bridge the gap");
  ok(D.currentStreak(r, "2026-10-14") === 2, "today not yet solved does not break the streak");
  ok(D.currentStreak(r, "2026-10-15") === 0, "a fully missed day breaks it");
  ok(D.bestStreak(r) === 3, "best streak is the longest on-time run");
  ok(D.currentStreak({}, "2026-10-13") === 0 && D.bestStreak({}) === 0, "empty records");
  const across = { "2026-10-31": { onTime: true, stars: 1, bestMs: 1 }, "2026-11-01": { onTime: true, stars: 1, bestMs: 1 } };
  ok(D.currentStreak(across, "2026-11-01") === 2 && D.bestStreak(across) === 2, "streaks cross month ends");
}

/* 4 — calendar grid */
console.log("Daily 4: calendar");
{
  const g = D.monthGrid(2026, 9); // October 2026 starts on a Thursday
  ok(g.length % 7 === 0, "grid is whole weeks");
  ok(g[0] === null && g[1] === null && g[2] === null && g[3] === "2026-10-01", "Monday-first: Oct 1 2026 sits under Thu");
  ok(g.filter(Boolean).length === 31 && g.filter(Boolean)[30] === "2026-10-31", "all 31 days, in order");
  const feb = D.monthGrid(2027, 1);
  ok(feb.filter(Boolean).length === 28 && feb[0] === "2027-02-01", "Feb 2027 starts on a Monday, 28 days");
}

console.log("\ndaily.test.js: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);

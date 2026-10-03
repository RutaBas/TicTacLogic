/* tests/levels.test.js — level packs: technique cap, progress rules, level data.
 * Run: node tests/levels.test.js   (fast)
 */
const B = require("../board.js");
const S = require("../solver.js");
const G = require("../generator.js");
const P = require("../progress.js");

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error("  FAIL: " + msg); } }

/* 1 — carving with a technique cap: the result is solvable using only tiers
 *     <= k, never needs more than k, and has the original unique solution. */
console.log("Levels 1: technique cap on carving");
for (let k = 1; k <= 4; k++) {
  let checked = 0;
  for (let s = 0; checked < 6 && s < 40; s++) {
    const rand = G.mulberry32(1000 + s * 7 + k);
    let sol;
    try { sol = G.buildCompleteGrid(6, rand); } catch (e) { if (e === G.BUILD_BUDGET) continue; throw e; }
    const clues = G.carvePuzzle(sol, 6, rand, { maxTier: k });
    const r = S.solve(clues, 6, { maxTrialDepth: 0 });
    ok(G.solvesWithin(clues, 6, k), "k=" + k + " seed " + s + ": solvable with tiers <= " + k);
    ok(r.solved && r.maxTier <= k, "k=" + k + " seed " + s + ": needs at most T" + k + " (got T" + r.maxTier + ")");
    ok(B.gridToString(r.grid, 6) === B.gridToString(sol, 6), "k=" + k + " seed " + s + ": solution preserved");
    checked++;
  }
  ok(checked === 6, "k=" + k + ": checked 6 boards");
}

/* 2 — progress rules */
console.log("Levels 2: progress rules");
{
  ok(P.tierOf(1) === 0 && P.tierOf(10) === 0, "levels 1-10 are tier 0");
  ok(P.tierOf(11) === 1 && P.tierOf(20) === 1, "levels 11-20 are tier 1");
  ok(P.tierOf(21) === 2 && P.tierOf(31) === 3 && P.tierOf(40) === 3, "levels 21-30 tier 2, 31-40 tier 3");
  ok(P.tierName(1) === "Doodle" && P.tierName(15) === "Homework" &&
     P.tierName(25) === "Pop Quiz" && P.tierName(40) === "Final Exam", "tier names");

  ok(P.computeStars(0, 0) === 3, "no hints, no mistakes -> 3 stars");
  ok(P.computeStars(2, 0) === 2, "hints only -> 2 stars");
  ok(P.computeStars(0, 1) === 2, "mistakes only -> 2 stars");
  ok(P.computeStars(1, 3) === 1, "hints and mistakes -> 1 star");

  const first = P.mergeResult(null, 2, 90000);
  ok(first.stars === 2 && first.bestMs === 90000, "first result stored as-is");
  const worse = P.mergeResult(first, 1, 120000);
  ok(worse.stars === 2 && worse.bestMs === 90000, "a worse replay never lowers stars or best time");
  const better = P.mergeResult(first, 3, 60000);
  ok(better.stars === 3 && better.bestMs === 60000, "a better replay raises stars and best time");

  ok(P.isUnlocked(undefined, 1), "level 1 always open");
  ok(!P.isUnlocked(undefined, 2), "level 2 locked on an empty pack");
  const pack = { 1: { stars: 3, bestMs: 1 }, 2: { stars: 1, bestMs: 1 } };
  ok(P.isUnlocked(pack, 3) && !P.isUnlocked(pack, 4), "solving N unlocks exactly N+1");
  const viaJson = JSON.parse(JSON.stringify(pack));
  ok(P.isUnlocked(viaJson, 3), "works with string keys after a localStorage round-trip");

  const sum = P.packSummary(pack);
  ok(sum.solved === 2 && sum.stars === 4, "pack summary counts solved levels and stars");
  ok(P.packSummary(undefined).solved === 0, "empty pack summary");
}

/* 3 — the frozen level data */
console.log("Levels 3: level data");
{
  const { LEVELS } = require("../levels.js");
  const seen = new Set();
  for (const size of [6, 8, 10, 12, 14]) {
    const list = LEVELS[size];
    ok(Array.isArray(list) && list.length === P.LEVELS_PER_PACK, size + "x" + size + ": 40 levels");
    if (!Array.isArray(list)) continue;
    let prevClues = Infinity;
    list.forEach((str, k) => {
      const n = k + 1;
      const parsed = B.gridFromString(str);
      ok(parsed.size === size, size + "x" + size + " L" + n + ": right size");
      const r = S.solve(parsed.grid, size, { maxTrialDepth: 0 });
      ok(r.solved, size + "x" + size + " L" + n + ": solved by pure logic");
      ok(r.maxTier === P.tierOf(n) + 1,
         size + "x" + size + " L" + n + ": needs T" + (P.tierOf(n) + 1) + " (got T" + r.maxTier + ")");
      ok(S.countSolutions(parsed.grid, size, 2) === 1, size + "x" + size + " L" + n + ": exactly one solution");
      ok(!seen.has(str), size + "x" + size + " L" + n + ": not a duplicate");
      seen.add(str);
      const clues = parsed.grid.reduce((a, v) => a + (v ? 1 : 0), 0);
      if ((n - 1) % P.LEVELS_PER_TIER === 0) prevClues = Infinity; // new section
      ok(clues <= prevClues, size + "x" + size + " L" + n + ": clue count does not increase within its section");
      prevClues = clues;
    });
  }
}

console.log("\nlevels.test.js: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);

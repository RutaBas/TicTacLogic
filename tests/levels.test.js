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
  ok(P.LEVELS_PER_TIER === 50 && P.LEVELS_PER_PACK === 200, "50 levels per section, 200 per pack");
  ok(P.tierOf(1) === 0 && P.tierOf(50) === 0, "levels 1-50 are tier 0");
  ok(P.tierOf(51) === 1 && P.tierOf(100) === 1, "levels 51-100 are tier 1");
  ok(P.tierOf(101) === 2 && P.tierOf(151) === 3 && P.tierOf(200) === 3, "levels 101-150 tier 2, 151-200 tier 3");
  ok(P.tierName(1) === "Doodle" && P.tierName(75) === "Homework" &&
     P.tierName(125) === "Pop Quiz" && P.tierName(200) === "Final Exam", "tier names");
  ok(P.sectionStart(1) === 1 && P.sectionStart(99) === 51 && P.sectionStart(150) === 101 && P.sectionStart(151) === 151,
     "sectionStart");

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
  ok([51, 101, 151].every((n) => P.isUnlocked(undefined, n)), "every section's first level is open (independent sections)");
  ok(!P.isUnlocked(undefined, 52), "second level of an untouched section is locked");
  // frontier rule: everything up to one past the furthest solved level in the section is open
  const gappy = { 7: { stars: 2, bestMs: 1 } };
  ok(P.isUnlocked(gappy, 3) && P.isUnlocked(gappy, 8) && !P.isUnlocked(gappy, 9),
     "a solved level 7 opens 1-8 of its section (gaps from migration stay playable)");
  ok(!P.isUnlocked(gappy, 52), "progress in one section does not open another");
  ok(!P.isUnlocked({ 50: { stars: 1, bestMs: 1 } }, 52), "solving the last Doodle level does not reach into Homework");

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
    ok(Array.isArray(list) && list.length === P.LEVELS_PER_PACK, size + "x" + size + ": 200 levels");
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

/* 4 — v1 boards survive, and v1 progress moves to the same boards */
console.log("Levels 4: v1 preservation and migration");
{
  const L = require("../levels.js");
  const V1 = require("../tools/levels-v1.js").LEVELS;
  ok(L.LEVELS_VERSION === 2, "levels.js is version 2");
  for (const size of [6, 8, 10, 12, 14]) {
    const map = L.LEVELS_V1_MAP && L.LEVELS_V1_MAP[size];
    ok(Array.isArray(map) && map.length === 40, size + "x" + size + ": a new number for each of the 40 v1 levels");
    if (!Array.isArray(map)) continue;
    V1[size].forEach((str, k) => {
      const nn = map[k];
      ok(L.LEVELS[size][nn - 1] === str, size + "x" + size + " v1 L" + (k + 1) + " -> L" + nn + ": same board");
      ok(P.tierOf(nn) === Math.floor(k / 10), size + "x" + size + " v1 L" + (k + 1) + ": stays in its section");
    });
    ok(new Set(map).size === 40, size + "x" + size + ": v1 levels map to distinct numbers");
  }

  const oldAll = { 6: { 1: { stars: 3, bestMs: 500 }, 12: { stars: 2, bestMs: 900 } }, 8: { 40: { stars: 1, bestMs: 7 } } };
  const migrated = P.migrateProgressV1(JSON.parse(JSON.stringify(oldAll)), L.LEVELS_V1_MAP);
  ok(migrated.v === 2, "migrated progress is stamped v2");
  ok(JSON.stringify(migrated[6][L.LEVELS_V1_MAP[6][0]]) === JSON.stringify({ stars: 3, bestMs: 500 }), "6x6 v1 L1 result moved with its board");
  ok(JSON.stringify(migrated[6][L.LEVELS_V1_MAP[6][11]]) === JSON.stringify({ stars: 2, bestMs: 900 }), "6x6 v1 L12 result moved with its board");
  ok(JSON.stringify(migrated[8][L.LEVELS_V1_MAP[8][39]]) === JSON.stringify({ stars: 1, bestMs: 7 }), "8x8 v1 L40 result moved with its board");
  ok(Object.keys(migrated[6]).length === 2 && Object.keys(migrated[8]).length === 1, "nothing invented, nothing lost");
  ok(P.isUnlocked(migrated[6], L.LEVELS_V1_MAP[6][0] + 1), "the level after a migrated solve is open");
  ok(P.remapLevelV1(L.LEVELS_V1_MAP, 6, 12) === L.LEVELS_V1_MAP[6][11], "remapLevelV1 for an in-progress v1 save");
}

console.log("\nlevels.test.js: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);

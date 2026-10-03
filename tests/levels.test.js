/* tests/levels.test.js — level packs: technique cap, progress rules, level data.
 * Run: node tests/levels.test.js   (fast)
 */
const B = require("../board.js");
const S = require("../solver.js");
const G = require("../generator.js");

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

console.log("\nlevels.test.js: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);

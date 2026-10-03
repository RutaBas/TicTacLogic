/* tests/noguess.test.js — every generated puzzle is solvable by logic alone.
 * Run: node tests/noguess.test.js   (fast: a few seconds)
 *
 * The generator only removes a clue while pure deduction (T1-T4) can still
 * finish the board, so no puzzle should ever need trial and error (tier 5).
 */
const B = require("../board.js");
const S = require("../solver.js");
const G = require("../generator.js");

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error("  FAIL: " + msg); } }

const PLAN = { 6: 100, 8: 60, 10: 30, 12: 10, 14: 5 };
for (const size of Object.keys(PLAN).map(Number)) {
  let guessy = 0, unsolved = 0;
  for (let id = 0; id < PLAN[size]; id++) {
    const p = G.generatePuzzleById(size, id);
    if (p.maxTier > 4 || p.label === "trial and error") guessy++;
    // independent check: pure deduction (no trials) finishes the board correctly
    const r = S.solve(p.clues, size, { maxTrialDepth: 0 });
    if (!r.solved || B.gridToString(r.grid, size) !== B.gridToString(p.solution, size)) unsolved++;
  }
  ok(guessy === 0, size + "x" + size + ": " + guessy + "/" + PLAN[size] + " puzzles need trial and error");
  ok(unsolved === 0, size + "x" + size + ": " + unsolved + "/" + PLAN[size] + " not solved by pure logic");
  console.log("  " + size + "x" + size + ": " + PLAN[size] + " puzzles, all logic-only");
}

console.log("\nnoguess.test.js: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);

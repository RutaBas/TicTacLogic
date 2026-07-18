/* tests/solver.test.js — Step 2 verification points 1 and 2.
 * Run: node tests/solver.test.js
 */
const B = require("../board.js");
const S = require("../solver.js");
const G = require("../generator.js");

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error("  FAIL: " + msg); } }

// helper: turn a "XXOOXO" string into an array of marks
const row = (s) => s.split("").map(B.charToMark);

/* ================================================================ *
 * VERIFICATION POINT 1 — rule checker
 * ================================================================ */
console.log("Verification point 1: rule checker");
{
  const size = 6;
  ok(S.checkLine(row("XXOOXO"), size).valid === true, "XXOOXO is valid");

  const triple1 = S.checkLine(row("XXXOOO"), size);
  ok(triple1.valid === false && triple1.reason === "triple", "XXXOOO invalid (triple of X)");

  const triple2 = S.checkLine(row("XXOOOX"), size);
  ok(triple2.valid === false && triple2.reason === "triple", "XXOOOX invalid (triple of O)");

  const unequal = S.checkLine(row("XOXOXX"), size);
  ok(unequal.valid === false && unequal.reason === "count", "XOXOXX invalid (unequal counts)");

  // Partial line must NOT be flagged for unequal counts.
  ok(S.checkLine(row("XX...."), size).valid === true, "XX.... partial NOT flagged for count");
  // ...but a partial line with too many of a mark IS a violation.
  ok(S.checkLine(row("XXX..."), size).reason === "triple", "XXX... partial flagged (triple)");
  ok(S.checkLine(row("XX.XX."), size).reason === "count",
     "XX.XX. partial with 4 X (>3) flagged (count)");

  // Only completed lines participate in the uniqueness rule (R3).
  const g = B.createGrid(4);
  // two identical COMPLETE rows -> invalid
  const dup = B.gridFromString("4:XOXOXOXOOXOXOXOX").grid; // rows 0 and 2 are "XOXO"
  ok(S.isValidPartial(dup, 4) === false, "two identical complete rows -> invalid (R3)");
  // a grid with empties in those rows is not yet an R3 violation
  const partialDup = B.gridFromString("4:XOXO............").grid;
  ok(S.isValidPartial(partialDup, 4) === true, "incomplete parallel lines don't trigger R3");
}

/* ================================================================ *
 * VERIFICATION POINT 2 — solver correctness on generated puzzles
 * On a batch of generated puzzles, the tiered solver's solution must equal
 * the generator's original complete grid, every time.
 * ================================================================ */
console.log("Verification point 2: solver vs generated puzzles");
{
  const N = 200;
  // Mixed sizes (heavier per-size batches at every size incl. 14 come in step 3).
  const sizes = [6, 6, 6, 8, 8, 8, 10, 10, 12];
  let correct = 0, solved = 0;
  const tierHist = {};
  const t0 = Date.now();
  for (let k = 0; k < N; k++) {
    const size = sizes[k % sizes.length];
    const rand = G.mulberry32(0x1234 + k * 2654435761);
    const { clues, solution } = G.generatePuzzle(size, rand);
    const res = S.solve(clues, size);
    if (res.solved) {
      solved++;
      tierHist[res.maxTier] = (tierHist[res.maxTier] || 0) + 1;
      if (B.gridToString(res.grid, size) === B.gridToString(solution, size)) correct++;
      else console.error("  mismatch at k=" + k + " size=" + size);
    } else {
      console.error("  solver failed to solve k=" + k + " size=" + size +
        " (stuck=" + !!res.stuck + " contra=" + !!res.contradiction + ")");
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  solved ${solved}/${N}, matches original ${correct}/${N}  (${secs}s)`);
  console.log("  max-tier histogram (informational):", JSON.stringify(tierHist));
  ok(solved === N, `all ${N} puzzles solved by tiered solver (got ${solved})`);
  ok(correct === N, `all ${N} solver solutions equal the original grid (got ${correct})`);
}

console.log(`\nsolver.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

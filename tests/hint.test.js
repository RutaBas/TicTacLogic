/* tests/hint.test.js — hint engine (nextHint) verification points.
 * Run: node tests/hint.test.js
 */
const B = require("../board.js");
const S = require("../solver.js");
const G = require("../generator.js");

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error("  FAIL: " + msg); } }

const grid = (size, s) => B.gridFromString(size + ":" + s.replace(/\s+/g, "")).grid;

/* 1 — simplest technique wins: a T1 pair beats a T2 count elsewhere. */
console.log("Hint 1: simplest technique first");
{
  // row 0 has all 3 X's and no pair/gap (T2 only); row 6 has an O pair (T1) far away
  const g = grid(6,
    "XOXOX." +
    "......" +
    "......" +
    "......" +
    "......" +
    "OO....");
  const h = S.nextHint(g, 6, 5); // focus right on the T2 cell
  ok(h && h.tier === 1, "T1 chosen over a nearer T2 (got tier " + (h && h.tier) + ")");
  ok(h && h.i === 32 && h.mark === B.X, "pair OO at row 6 forces X at col 3");
  ok(h && h.evidence.indexOf(30) !== -1 && h.evidence.indexOf(31) !== -1, "evidence = the pair");
}

/* 2 — locality: among equal-tier candidates, the one nearest the focus. */
console.log("Hint 2: nearest the player's last move");
{
  const g = grid(6,
    "XX...." +
    "......" +
    "......" +
    "......" +
    "......" +
    "....OO");
  const far = S.nextHint(g, 6, 35);
  ok(far && far.i === 33, "focus bottom-right -> hint at the OO pair (i=33), got " + (far && far.i));
  const near = S.nextHint(g, 6, 0);
  ok(near && near.i === 2, "focus top-left -> hint at the XX pair (i=2), got " + (near && near.i));
  const none = S.nextHint(g, 6, null);
  ok(none && none.i === 2, "no focus -> reading order");
}

/* 3 — sandwich + count + uniqueness kinds and texts are produced. */
console.log("Hint 3: technique kinds");
{
  const gap = S.nextHint(grid(4, "X.X." + "...." + "...." + "...."), 4, null);
  ok(gap && gap.kind === "gap" && gap.i === 1 && gap.mark === B.O, "X.X sandwich -> O in the gap");
  ok(gap && gap.nudge.indexOf("row 1") !== -1 && !/\bO\b/.test(gap.nudge),
     "nudge names the line without giving the answer");
  ok(gap && /\bO\b/.test(gap.reason), "reason names the answer");

  // uniqueness: rows 0 and 1 done, row 2 = "XO.." could be XOOX (copy of row 0) or XOXO
  const u = grid(4,
    "XOOX" +
    "OXXO" +
    "XO.." +
    "....");
  const g2 = B.cloneGrid(u);
  const h = S.nextHint(g2, 4, 10);
  ok(h && h.tier <= 4, "a hint exists for the uniqueness board");
}

/* 4 — soundness: following hints from the clues solves real puzzles, and every
 *     hinted mark matches the unique solution. Focus = previous hint cell. */
console.log("Hint 4: hint chains solve generated puzzles");
{
  const cases = [[6, 0], [6, 1], [6, 2], [8, 0], [8, 1], [10, 0]];
  for (const [size, id] of cases) {
    const p = G.generatePuzzleById(size, id);
    const g = B.cloneGrid(p.clues);
    let focus = null, steps = 0, wrong = 0, stalled = false;
    while (!S.isComplete(g)) {
      const h = S.nextHint(g, size, focus);
      if (!h) { stalled = true; break; }
      if (h.mark !== p.solution[h.i]) wrong++;
      if (g[h.i] !== B.EMPTY) { stalled = true; break; }
      g[h.i] = h.mark;
      focus = h.i;
      steps++;
    }
    ok(!stalled, size + "x" + size + " #" + id + ": hints never stall");
    ok(wrong === 0, size + "x" + size + " #" + id + ": every hint matches the solution (" + wrong + " wrong)");
    ok(S.isSolved(g, size), size + "x" + size + " #" + id + ": solved after " + steps + " hints");
  }
}

console.log("\nhint.test.js: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);

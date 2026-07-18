/* tests/board.test.js — data-model smoke test (step 1).
 * Not a rule/solver test (those arrive in step 2). Just proves the
 * representation, helpers, and serialization round-trip cleanly.
 * Run: node tests/board.test.js
 */
const B = require("../board.js");

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + "  (got " + a + ", want " + b + ")"); }

// --- encoding / opposite ---
eq(B.opposite(B.X), B.O, "opposite(X)=O");
eq(B.opposite(B.O), B.X, "opposite(O)=X");
eq(B.markToChar(B.EMPTY), ".", "markToChar EMPTY");
eq(B.charToMark("o"), B.O, "charToMark lowercase o");

// --- index helpers ---
eq(B.idx(2, 3, 6), 15, "idx(2,3,6)");
eq(B.rowOf(15, 6), 2, "rowOf(15,6)");
eq(B.colOf(15, 6), 3, "colOf(15,6)");

// --- grid create / set / get row+col ---
const g = B.createGrid(4);
eq(g.length, 16, "createGrid(4) length");
B.setCell(g, 4, 0, 0, B.X);
B.setCell(g, 4, 0, 1, B.X);
B.setCell(g, 4, 0, 2, B.O);
B.setCell(g, 4, 0, 3, B.O);
eq(B.getRow(g, 4, 0).join(""), [B.X, B.X, B.O, B.O].join(""), "getRow row 0");
eq(B.getCol(g, 4, 0).join(""), [B.X, 0, 0, 0].join(""), "getCol col 0");

// createGrid rejects odd/invalid sizes
let threw = false; try { B.createGrid(5); } catch (e) { threw = true; }
ok(threw, "createGrid(5) rejects odd size");

// --- serialization round-trip ---
const sol = B.gridFromString("4:XXOOOOXXXOOXOXXO");
eq(sol.size, 4, "gridFromString size");
eq(B.gridToString(sol.grid, 4), "4:XXOOOOXXXOOXOXXO", "gridToString round-trip");

// --- GameState: clues immutable, player edits only non-clues ---
const clues = B.createGrid(4);
B.setCell(clues, 4, 0, 0, B.X);      // one fixed clue at (0,0)
const state = B.createGameState(4, clues, sol.grid, { maxTier: 3, id: 7, seed: 123 });
ok(B.isClue(state, 0, 0), "(0,0) is a clue");
ok(!B.isClue(state, 1, 1), "(1,1) is not a clue");
ok(state.cells !== state.clues, "cells is a distinct array from clues");
eq(B.playerSet(state, 0, 0, B.O), false, "playerSet refuses to overwrite a clue");
eq(B.getCell(state.cells, 4, 0, 0), B.X, "clue cell unchanged after refused set");
eq(B.playerSet(state, 1, 1, B.O), true, "playerSet succeeds on empty cell");

// cycle EMPTY->X->O->EMPTY on a non-clue
eq(B.cycleCell(state, 2, 2), B.X, "cycle 1 -> X");
eq(B.cycleCell(state, 2, 2), B.O, "cycle 2 -> O");
eq(B.cycleCell(state, 2, 2), B.EMPTY, "cycle 3 -> EMPTY");
eq(B.cycleCell(state, 0, 0), B.X, "cycle on a clue is a no-op (stays X)");

// meta carried through
eq(state.maxTier, 3, "maxTier stored");
eq(state.seed, 123, "seed stored");

// fill counts + clear
const before = B.fillCounts(state).filled;
ok(before >= 2, "fillCounts sees clue + player marks");
B.clearPlayerMarks(state);
eq(B.fillCounts(state).filled, 1, "clearPlayerMarks leaves only the 1 clue");

console.log(`\nboard.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

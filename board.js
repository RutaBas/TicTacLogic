/* board.js — Tic-Tac-Logic core data model
 *
 * This file is the foundation of the whole game: it defines how a grid, its
 * clue cells, and the player's in-progress state are represented, plus the
 * small pure helpers that every other module (solver, generator, ui) builds on.
 *
 * NO rule-checking, solving, or DOM code lives here — that arrives in later
 * steps. Everything here is pure and headless so it can be unit-tested in node.
 *
 * DUAL-USE NOTE (browser <script> + node require):
 *   All names below are declared once as top-level consts/functions. In the
 *   browser they become ambient globals shared by every later <script> tag, so
 *   downstream files must NOT re-declare them. In node they are exported at the
 *   bottom via a module guard. Downstream files pull dependencies with
 *   `if (typeof module !== "undefined") Object.assign(global, require("./board.js"));`
 *   — never with a top-level `const { ... } = require(...)`, which would be a
 *   duplicate-declaration SyntaxError in the browser.
 */

/* ------------------------------------------------------------------ *
 * Cell encoding
 *
 * A cell holds one of three values. We use small integers (not strings) so the
 * solver and generator can work with fast typed arrays and cheap comparisons.
 * X and O are the two marks; EMPTY means "not yet filled".
 *
 *   EMPTY = 0   (falsy — convenient for "is this cell filled?" checks)
 *   X     = 1
 *   O     = 2
 *
 * The two marks are deliberately 1 and 2 so that `3 - mark` flips X<->O, which
 * the solver will lean on later (X's complement is O and vice-versa).
 * ------------------------------------------------------------------ */
const EMPTY = 0;
const X = 1;
const O = 2;

/** The two real marks, handy for iteration. */
const MARKS = [X, O];

/** Flip X<->O. Passing EMPTY is a programming error and returns EMPTY. */
function opposite(mark) {
  return mark === X ? O : mark === O ? X : EMPTY;
}

/* ------------------------------------------------------------------ *
 * Char <-> mark conversion (for serialization, tests, and debug printing)
 *   X -> "X",  O -> "O",  EMPTY -> "."
 * ------------------------------------------------------------------ */
const MARK_TO_CHAR = { [EMPTY]: ".", [X]: "X", [O]: "O" };
const CHAR_TO_MARK = { ".": EMPTY, X: X, O: O, x: X, o: O };

function markToChar(mark) {
  const ch = MARK_TO_CHAR[mark];
  if (ch === undefined) throw new Error("markToChar: bad mark " + mark);
  return ch;
}

function charToMark(ch) {
  const m = CHAR_TO_MARK[ch];
  if (m === undefined) throw new Error("charToMark: bad char " + JSON.stringify(ch));
  return m;
}

/* ------------------------------------------------------------------ *
 * Index helpers
 *
 * Grids are stored as a single flat Int8Array of length size*size (row-major),
 * not a 2-D array: one allocation, cache-friendly, trivial to clone. Convert
 * between (row, col) and flat index with these.
 * ------------------------------------------------------------------ */
function idx(r, c, size) {
  return r * size + c;
}

function rowOf(i, size) {
  return Math.floor(i / size);
}

function colOf(i, size) {
  return i % size;
}

/* ------------------------------------------------------------------ *
 * Grid = the raw cell array (no metadata). A "grid" is just an Int8Array of
 * marks. The generator produces a fully-filled solution grid; the solver
 * consumes and fills a partially-filled grid. Neither needs to know which
 * cells are player-editable — that distinction is a UI concern (see GameState).
 * ------------------------------------------------------------------ */

/** New size*size grid, every cell EMPTY. */
function createGrid(size) {
  if (size % 2 !== 0 || size < 2) {
    throw new Error("createGrid: size must be a positive even number, got " + size);
  }
  return new Int8Array(size * size); // Int8Array initializes to 0 === EMPTY
}

/** Independent copy of a grid. */
function cloneGrid(grid) {
  return Int8Array.prototype.slice.call(grid);
}

function getCell(grid, size, r, c) {
  return grid[idx(r, c, size)];
}

function setCell(grid, size, r, c, mark) {
  grid[idx(r, c, size)] = mark;
}

/** Values of row r as a plain Array (length size). */
function getRow(grid, size, r) {
  const out = new Array(size);
  const base = r * size;
  for (let c = 0; c < size; c++) out[c] = grid[base + c];
  return out;
}

/** Values of column c as a plain Array (length size). */
function getCol(grid, size, c) {
  const out = new Array(size);
  for (let r = 0; r < size; r++) out[r] = grid[r * size + c];
  return out;
}

/* ------------------------------------------------------------------ *
 * Serialization
 *
 * A grid serializes to "<size>:<chars>", e.g. a solved 4x4:
 *   "4:XXOOOOXXXOOXOXXO"  (row-major, "." for EMPTY)
 * This one string round-trips a puzzle or solution for localStorage and tests.
 * ------------------------------------------------------------------ */
function gridToString(grid, size) {
  let s = size + ":";
  for (let i = 0; i < grid.length; i++) s += markToChar(grid[i]);
  return s;
}

function gridFromString(str) {
  const colon = str.indexOf(":");
  if (colon === -1) throw new Error("gridFromString: missing ':' in " + JSON.stringify(str));
  const size = parseInt(str.slice(0, colon), 10);
  const body = str.slice(colon + 1);
  if (body.length !== size * size) {
    throw new Error(
      "gridFromString: expected " + size * size + " cells, got " + body.length
    );
  }
  const grid = createGrid(size);
  for (let i = 0; i < body.length; i++) grid[i] = charToMark(body[i]);
  return { grid, size };
}

/** Multi-line, human-readable dump for debugging/tests (X O . with spaces). */
function gridToPretty(grid, size) {
  const lines = [];
  for (let r = 0; r < size; r++) {
    lines.push(getRow(grid, size, r).map(markToChar).join(" "));
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * GameState — the UI-facing model of a puzzle in progress.
 *
 * This is what gets built when the player starts a board and what gets
 * auto-saved to localStorage. It separates the immutable puzzle from the
 * mutable player input:
 *
 *   size      : N (even)
 *   clues     : Int8Array — the given cells. clues[i] !== EMPTY marks a fixed
 *               clue; clues[i] === EMPTY marks a cell the player must fill.
 *               This doubles as the "is-a-clue" mask, so no separate mask array.
 *   cells     : Int8Array — current board = clues plus the player's marks.
 *               Clue positions always equal clues[i]; player edits only the
 *               positions where clues[i] === EMPTY.
 *   solution  : Int8Array — the unique complete solution (set by the generator;
 *               used for hints/win-check). May be null until generated.
 *   maxTier   : number|null — highest solver tier the puzzle required, recorded
 *               once at generation time. Drives the HUD "needs: ..." badge.
 *               Populated in the generator step; null here in the data model.
 *   id, seed  : provenance of a generated puzzle (filled in by the generator).
 *
 * Only pure construction/query helpers live here. Rule-checking, win detection,
 * solving, and generation are later steps.
 * ------------------------------------------------------------------ */
function createGameState(size, clues, solution, meta) {
  meta = meta || {};
  const clueArr = clues ? cloneGrid(clues) : createGrid(size);
  return {
    size: size,
    clues: clueArr,
    cells: cloneGrid(clueArr), // player starts from the clues
    solution: solution ? cloneGrid(solution) : null,
    maxTier: meta.maxTier != null ? meta.maxTier : null,
    id: meta.id != null ? meta.id : null,
    seed: meta.seed != null ? meta.seed : null,
  };
}

/** True if (r,c) is a fixed clue and therefore not editable. */
function isClue(state, r, c) {
  return state.clues[idx(r, c, state.size)] !== EMPTY;
}

/** Player-facing cell mutation; refuses to overwrite a clue. Returns success. */
function playerSet(state, r, c, mark) {
  if (isClue(state, r, c)) return false;
  state.cells[idx(r, c, state.size)] = mark;
  return true;
}

/** Cycle a player cell EMPTY -> X -> O -> EMPTY (the tap interaction). No-op on clues. */
function cycleCell(state, r, c) {
  if (isClue(state, r, c)) return state.cells[idx(r, c, state.size)];
  const i = idx(r, c, state.size);
  const next = state.cells[i] === EMPTY ? X : state.cells[i] === X ? O : EMPTY;
  state.cells[i] = next;
  return next;
}

/** Count of filled (non-EMPTY) cells and the total — for the HUD progress counter. */
function fillCounts(state) {
  let filled = 0;
  for (let i = 0; i < state.cells.length; i++) if (state.cells[i] !== EMPTY) filled++;
  return { filled: filled, total: state.cells.length };
}

/** Reset player marks, keeping clues (the "clear board" action). */
function clearPlayerMarks(state) {
  state.cells = cloneGrid(state.clues);
}

/* ------------------------------------------------------------------ *
 * Node export guard (see DUAL-USE NOTE at top).
 * ------------------------------------------------------------------ */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EMPTY, X, O, MARKS,
    opposite,
    markToChar, charToMark,
    idx, rowOf, colOf,
    createGrid, cloneGrid, getCell, setCell, getRow, getCol,
    gridToString, gridFromString, gridToPretty,
    createGameState, isClue, playerSet, cycleCell, fillCounts, clearPlayerMarks,
  };
}

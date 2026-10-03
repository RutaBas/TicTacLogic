/* generator.js — Tic-Tac-Logic puzzle generator (full, step 3).
 *
 * Difficulty is GRID SIZE ONLY. There is NO difficulty retry loop, no minimum
 * tier, no "regenerate if too easy" check. Uniqueness is the sole acceptance
 * criterion for removing a clue. After generating, the tiered solver runs once
 * and the max tier it needed is stored as the puzzle's honest technique label.
 *
 * Pipeline:
 *   seedFor(size,id,attempt) -> mulberry32 -> buildCompleteGrid -> carvePuzzle
 *   -> solve() once for the maxTier label.
 *
 * See board.js for the dual-use (browser <script> + node require) convention.
 */
if (typeof module !== "undefined") {
  Object.assign(global, require("./board.js"));
  Object.assign(global, require("./solver.js"));
}

/* ---- mulberry32: fast, adequately-mixed seeded PRNG ---- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Seed hashing.
 *
 * Puzzles are generated on demand from (size, id, attempt). A djb2-style
 * `h = h*33 + c` is NOT well-mixed for short strings differing only in a
 * trailing digit — consecutive ids would yield near-consecutive seeds and
 * duplicate-looking boards. We use FNV-1a (per-char multiply already avalanches)
 * AND a Murmur-style finalizer applied twice, per the build spec. id and
 * attempt are hashed together as ONE string — never combined by addition — so a
 * collision would require an actual hash collision, not an arithmetic accident.
 * ------------------------------------------------------------------ */
function hashString(str) {
  let h = 0x811c9dc5 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // Murmur3 finalizer, applied twice for extra diffusion.
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic 32-bit seed for a given puzzle coordinate. */
function seedFor(size, id, attempt) {
  return hashString("size-" + size + "-puzzle-" + id + "-attempt-" + (attempt || 0));
}

/** Fisher-Yates in place using rand() in [0,1). */
function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* thrown by buildCompleteGrid when its backtracking budget is exceeded */
const BUILD_BUDGET = "BUILD_BUDGET_EXCEEDED";

/* Trial depth used by the carve uniqueness oracle (see carvePuzzle).
 * 0 = NO GUESSING: a clue is only removed if the board stays solvable by pure
 * deduction (T1-T4: sandwich, line completions, uniqueness rule). Every puzzle
 * is therefore logic-solvable, never needing trial and error. */
const CARVE_TRIAL_DEPTH = 0;

/* --------------------------------------------------------------------
 * buildCompleteGrid — a random COMPLETE valid solution grid.
 *
 * Row-major backtracking: at each cell try the two marks in a random order and
 * keep it only if the partial board stays valid (no triple, neither mark over
 * N/2, no completed row/col duplicating an earlier one). Backtrack on dead ends.
 *
 * Most seeds fill in well under a millisecond, but the R3 uniqueness constraint
 * occasionally sends row-major filling into a catastrophic backtrack. Rather
 * than a cleverer (and buggier) constructor, we cap the number of backtracking
 * steps and throw BUILD_BUDGET; the caller simply retries with the next attempt
 * seed. This is what the "-attempt-" component of the seed exists for.
 * ------------------------------------------------------------------ */
function buildCompleteGrid(size, rand, maxSteps) {
  // A clean build finishes in a few thousand steps; a doomed one backtracks
  // forever. Bail early and let the caller retry with the next attempt seed —
  // a fast failure + reseed beats grinding a hopeless search.
  maxSteps = maxSteps || 40000;
  const grid = createGrid(size);
  let steps = 0;

  function okAfter(i) {
    const r = rowOf(i, size), c = colOf(i, size);
    const row = getRow(grid, size, r);
    if (!checkLine(row, size).valid) return false;
    const col = getCol(grid, size, c);
    if (!checkLine(col, size).valid) return false;
    if (c === size - 1) {
      const key = row.join("");
      for (let rr = 0; rr < r; rr++) if (getRow(grid, size, rr).join("") === key) return false;
    }
    if (r === size - 1) {
      const key = col.join("");
      for (let cc = 0; cc < c; cc++) if (getCol(grid, size, cc).join("") === key) return false;
    }
    return true;
  }

  function bt(i) {
    if (i === grid.length) return true;
    if (++steps > maxSteps) throw BUILD_BUDGET;
    const order = rand() < 0.5 ? [X, O] : [O, X];
    for (const m of order) {
      grid[i] = m;
      if (okAfter(i) && bt(i + 1)) return true;
    }
    grid[i] = EMPTY;
    return false;
  }

  if (!bt(0)) throw new Error("buildCompleteGrid: unsatisfiable at size " + size);
  return grid;
}

/* --------------------------------------------------------------------
 * carvePuzzle — turn a complete solution into a puzzle by removing clues.
 *
 * Remove cells one at a time in random order; keep a removal only if the board
 * remains uniquely solvable, then continue until no further cell can be removed.
 *
 * ORACLE NOTE (deliberate deviation from "countSolutions(board,2)===1"):
 * the acceptance test is `solve(board, depth 0).solved` — pure T1-T4
 * deduction, no trial and error. This is SOUND for uniqueness — every cell
 * solve() fills holds in EVERY solution, so a completed solve proves exactly
 * one solution exists — and it is BOUNDED, whereas countSolutions can explode
 * into minutes proving a hard 14x14 board unique. The trade-offs:
 *   - every puzzle is solvable by logic alone, never by guessing (a cell whose
 *     removal would require trial and error is kept as a clue, so boards carry
 *     a few more clues than the theoretical minimum), and
 *   - because the finished puzzle is deduction-solvable, an independent
 *     countSolutions(board,2) returns 1 essentially instantly.
 * ------------------------------------------------------------------ */
function carvePuzzle(solution, size, rand) {
  const clues = cloneGrid(solution);
  const order = shuffleInPlace(
    Array.from({ length: clues.length }, (_, i) => i),
    rand
  );
  for (const i of order) {
    const saved = clues[i];
    clues[i] = EMPTY;
    if (!solve(clues, size, { maxTrialDepth: CARVE_TRIAL_DEPTH }).solved) {
      clues[i] = saved; // removal broke (provable) uniqueness -> put it back
    }
  }
  return clues;
}

/* ------------------------------------------------------------------ *
 * Technique label (drives the HUD "needs: ..." badge). Wording is confirmed
 * against the real size x tier distribution before the UI step.
 *   T1 -> sandwich logic     (the triple-block deduction)
 *   T2, T3 -> line completions
 *   T4 -> the uniqueness rule
 *   T5 -> trial and error
 * ------------------------------------------------------------------ */
function tierLabel(maxTier) {
  switch (maxTier) {
    case 1: return "sandwich logic";
    case 2:
    case 3: return "line completions";
    case 4: return "the uniqueness rule";
    case 5: return "trial and error";
    default: return "logic";
  }
}

/**
 * Generate one puzzle from an explicit PRNG (used by tests / batch generation).
 * Retries buildCompleteGrid on a budget blow-up by drawing again from the same
 * (already-advanced) PRNG stream. Returns { clues, solution, size, maxTier }.
 */
function generatePuzzle(size, rand, tries) {
  tries = tries || 20;
  for (let a = 0; a < tries; a++) {
    let solution;
    try {
      solution = buildCompleteGrid(size, rand);
    } catch (e) {
      if (e === BUILD_BUDGET) continue;
      throw e;
    }
    const clues = carvePuzzle(solution, size, rand);
    const res = solve(clues, size);
    if (!res.solved) {
      // Carve only accepts provably-unique boards, so this is a solver bug —
      // surface it rather than papering over it.
      throw new Error("generatePuzzle: solver failed on a unique board (size " + size + ")");
    }
    return { size, clues, solution, maxTier: res.maxTier };
  }
  throw new Error("generatePuzzle: exhausted build attempts at size " + size);
}

/**
 * Generate the puzzle for a (size, id) coordinate, on demand and deterministic.
 * Walks attempts 0,1,2,... (fresh seed each) past any build-budget blow-up.
 * Returns { size, id, seed, attempt, clues, solution, maxTier, label }.
 */
function generatePuzzleById(size, id, maxAttempts) {
  maxAttempts = maxAttempts || 64;
  for (let a = 0; a < maxAttempts; a++) {
    const seed = seedFor(size, id, a);
    const rand = mulberry32(seed);
    let solution;
    try {
      solution = buildCompleteGrid(size, rand);
    } catch (e) {
      if (e === BUILD_BUDGET) continue;
      throw e;
    }
    const clues = carvePuzzle(solution, size, rand);
    const res = solve(clues, size);
    if (!res.solved) {
      throw new Error("generatePuzzleById: solver failed on a unique board (size " +
        size + ", id " + id + ")");
    }
    return {
      size, id, seed, attempt: a,
      clues, solution,
      maxTier: res.maxTier, label: tierLabel(res.maxTier),
    };
  }
  throw new Error("generatePuzzleById: exhausted attempts (size " + size + ", id " + id + ")");
}

/* -------------------------------------------------------------------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mulberry32, hashString, seedFor, shuffleInPlace,
    buildCompleteGrid, carvePuzzle, tierLabel,
    generatePuzzle, generatePuzzleById,
    BUILD_BUDGET, CARVE_TRIAL_DEPTH,
  };
}

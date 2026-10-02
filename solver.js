/* solver.js — Tic-Tac-Logic rule checker + tiered human-deduction solver +
 * countSolutions (uniqueness verifier).
 *
 * Written BEFORE the generator and UI. Strictly headless — no DOM. Operates on
 * bare grids (Int8Array of marks), not on GameState: the clue-vs-player
 * distinction is a UI concern; the solver just fills EMPTY cells.
 *
 * See board.js for the dual-use (browser <script> + node require) convention.
 */
if (typeof module !== "undefined") Object.assign(global, require("./board.js"));

/* ==================================================================== *
 * RULE CHECKER
 *
 * The three rules:
 *   R1  no more than two consecutive equal marks in any row or column
 *   R2  each COMPLETED row/column has exactly N/2 X and N/2 O
 *   R3  all completed rows are distinct; all completed columns are distinct
 *
 * Checks must be safe on PARTIAL lines (used live and inside the solver):
 *   - a triple is always a violation, partial or not
 *   - having MORE than N/2 of a mark is always a violation (partial or not)
 *   - but a partial line with fewer than N/2 of a mark is NOT a count
 *     violation — e.g. "XX...." on a 6-wide row is fine. Only when a line is
 *     complete does "exactly N/2 each" become mandatory, and that is caught
 *     automatically: a complete line with neither mark exceeding N/2 must be
 *     balanced.
 * ==================================================================== */

/** True if the line contains 3+ consecutive equal (non-empty) marks. */
function lineHasTriple(vals) {
  let run = 1;
  for (let k = 1; k < vals.length; k++) {
    if (vals[k] !== EMPTY && vals[k] === vals[k - 1]) {
      if (++run >= 3) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

function lineCounts(vals) {
  let x = 0, o = 0, empty = 0;
  for (let k = 0; k < vals.length; k++) {
    if (vals[k] === X) x++;
    else if (vals[k] === O) o++;
    else empty++;
  }
  return { x, o, empty };
}

/**
 * Validity of a single line (row or col), partial or complete.
 * Returns { valid, reason } where reason is "triple" | "count" | null.
 */
function checkLine(vals, size) {
  const half = size / 2;
  if (lineHasTriple(vals)) return { valid: false, reason: "triple" };
  const c = lineCounts(vals);
  if (c.x > half || c.o > half) return { valid: false, reason: "count" };
  return { valid: true, reason: null };
}

/** First EMPTY cell index, or -1 if the grid is full. */
function firstEmpty(grid) {
  for (let i = 0; i < grid.length; i++) if (grid[i] === EMPTY) return i;
  return -1;
}

function isComplete(grid) {
  return firstEmpty(grid) === -1;
}

/**
 * Board-level validity for a partial or complete grid: every row/col passes
 * checkLine, AND no two COMPLETED rows are identical, AND no two COMPLETED
 * columns are identical (R3). Incomplete lines don't participate in R3.
 */
function isValidPartial(grid, size) {
  for (let r = 0; r < size; r++) {
    if (!checkLine(getRow(grid, size, r), size).valid) return false;
  }
  for (let c = 0; c < size; c++) {
    if (!checkLine(getCol(grid, size, c), size).valid) return false;
  }
  // R3: duplicate completed lines
  const seenRows = new Set();
  for (let r = 0; r < size; r++) {
    const row = getRow(grid, size, r);
    if (row.indexOf(EMPTY) !== -1) continue; // incomplete
    const key = row.join("");
    if (seenRows.has(key)) return false;
    seenRows.add(key);
  }
  const seenCols = new Set();
  for (let c = 0; c < size; c++) {
    const col = getCol(grid, size, c);
    if (col.indexOf(EMPTY) !== -1) continue;
    const key = col.join("");
    if (seenCols.has(key)) return false;
    seenCols.add(key);
  }
  return true;
}

/** A grid is solved iff it is completely filled and fully valid. */
function isSolved(grid, size) {
  return isComplete(grid) && isValidPartial(grid, size);
}

/**
 * Cells that participate in a rule violation (for live UI highlighting).
 * Returns a Set of flat indices. Basic version; refined in the UI step.
 */
function findViolations(grid, size) {
  const bad = new Set();
  const markLineTriples = (indices, vals) => {
    let run = 1;
    for (let k = 1; k < vals.length; k++) {
      if (vals[k] !== EMPTY && vals[k] === vals[k - 1]) {
        run++;
        if (run >= 3) for (let t = k - run + 1; t <= k; t++) bad.add(indices[t]);
      } else run = 1;
    }
  };
  const markLineCount = (indices, vals) => {
    const half = size / 2;
    const c = lineCounts(vals);
    for (const m of [X, O]) {
      if ((m === X ? c.x : c.o) > half) {
        for (let k = 0; k < vals.length; k++) if (vals[k] === m) bad.add(indices[k]);
      }
    }
  };
  for (let r = 0; r < size; r++) {
    const idxs = [], vals = [];
    for (let c = 0; c < size; c++) { idxs.push(idx(r, c, size)); vals.push(grid[idx(r, c, size)]); }
    markLineTriples(idxs, vals);
    markLineCount(idxs, vals);
  }
  for (let c = 0; c < size; c++) {
    const idxs = [], vals = [];
    for (let r = 0; r < size; r++) { idxs.push(idx(r, c, size)); vals.push(grid[idx(r, c, size)]); }
    markLineTriples(idxs, vals);
    markLineCount(idxs, vals);
  }
  // duplicate completed lines: flag all cells of each duplicate pair
  const flagDupes = (getLine, toIndex) => {
    const seen = new Map();
    for (let a = 0; a < size; a++) {
      const line = getLine(a);
      if (line.indexOf(EMPTY) !== -1) continue;
      const key = line.join("");
      if (seen.has(key)) {
        for (const b of [seen.get(key), a])
          for (let k = 0; k < size; k++) bad.add(toIndex(b, k));
      } else seen.set(key, a);
    }
  };
  flagDupes((r) => getRow(grid, size, r), (r, c) => idx(r, c, size));
  flagDupes((c) => getCol(grid, size, c), (c, r) => idx(r, c, size));
  return bad;
}

/* ==================================================================== *
 * LINE ANALYSIS — the engine behind T3 and T4.
 *
 * Enumerate the valid completions of one line (respecting R1 no-triple and R2
 * exact counts, and optionally a `forbidden` set of complete parallel-line
 * signatures for R3). Report:
 *   - contradiction: the line has zero valid completions
 *   - forced:        cells that hold the SAME mark in every valid completion
 * A cell forced here is a deduction from this single line alone.
 * ==================================================================== */
function analyzeLine(vals, size, forbidden) {
  const half = size / 2;
  const empties = [];
  let xNow = 0, oNow = 0;
  for (let k = 0; k < vals.length; k++) {
    if (vals[k] === EMPTY) empties.push(k);
    else if (vals[k] === X) xNow++;
    else oNow++;
  }
  if (xNow > half || oNow > half) return { contradiction: true, forced: [] };

  const e = empties.length;
  if (e === 0) {
    if (lineHasTriple(vals)) return { contradiction: true, forced: [] };
    if (forbidden && forbidden.has(vals.join(""))) return { contradiction: true, forced: [] };
    return { contradiction: false, forced: [], completions: 1 };
  }

  const xNeed = half - xNow;
  const oNeed = half - oNow;
  if (xNeed < 0 || oNeed < 0) return { contradiction: true, forced: [] };

  const work = vals.slice();
  const forcedMark = new Array(e).fill(-2); // -2 unknown, -1 conflicting, else the agreed mark
  let completions = 0;
  let allConflict = false;

  function record() {
    completions++;
    for (let t = 0; t < e; t++) {
      const m = work[empties[t]];
      if (forcedMark[t] === -2) forcedMark[t] = m;
      else if (forcedMark[t] !== m) forcedMark[t] = -1;
    }
    allConflict = forcedMark.every((v) => v === -1);
  }

  function rec(pos, xLeft, oLeft) {
    if (allConflict && completions > 0) return; // nothing left to learn
    if (pos === e) {
      if (!lineHasTriple(work) && !(forbidden && forbidden.has(work.join("")))) record();
      return;
    }
    const p = empties[pos];
    if (xLeft > 0) {
      work[p] = X;
      if (!(p >= 2 && work[p - 1] === X && work[p - 2] === X)) rec(pos + 1, xLeft - 1, oLeft);
    }
    if (oLeft > 0 && !(allConflict && completions > 0)) {
      work[p] = O;
      if (!(p >= 2 && work[p - 1] === O && work[p - 2] === O)) rec(pos + 1, xLeft, oLeft - 1);
    }
  }
  rec(0, xNeed, oNeed);

  if (completions === 0) return { contradiction: true, forced: [] };
  const forced = [];
  for (let t = 0; t < e; t++) {
    if (forcedMark[t] >= 0) forced.push({ pos: empties[t], mark: forcedMark[t] });
  }
  return { contradiction: false, forced, completions };
}

/* ==================================================================== *
 * DEDUCTION TIERS (each returns { count, contra }: cells newly filled, and
 * whether a contradiction was hit). All mutate `grid` in place.
 * ==================================================================== */

/** Set grid[i]=mark if empty. Returns "contra" if it conflicts with an existing mark. */
function forceCell(grid, i, mark) {
  if (grid[i] === EMPTY) { grid[i] = mark; return "set"; }
  if (grid[i] === mark) return "same";
  return "contra";
}

// Iterate the flat indices of each row then each col; cb(indices) per line.
function forEachLine(size, cb) {
  for (let r = 0; r < size; r++) {
    const idxs = new Array(size);
    for (let c = 0; c < size; c++) idxs[c] = r * size + c;
    if (cb(idxs) === false) return false;
  }
  for (let c = 0; c < size; c++) {
    const idxs = new Array(size);
    for (let r = 0; r < size; r++) idxs[r] = r * size + c;
    if (cb(idxs) === false) return false;
  }
  return true;
}

/** T1 triple-block: `MM_`->opp, `_MM`->opp, `M_M`->opp (the sandwich). */
function applyT1(grid, size) {
  let count = 0, contra = false;
  forEachLine(size, (idxs) => {
    for (let k = 0; k + 2 < size; k++) {
      const a = grid[idxs[k]], b = grid[idxs[k + 1]], c = grid[idxs[k + 2]];
      let target = -1, mark = EMPTY;
      if (a !== EMPTY && a === b && c === EMPTY) { target = idxs[k + 2]; mark = opposite(a); }
      else if (b !== EMPTY && b === c && a === EMPTY) { target = idxs[k]; mark = opposite(b); }
      else if (a !== EMPTY && a === c && b === EMPTY) { target = idxs[k + 1]; mark = opposite(a); }
      if (target !== -1) {
        const r = forceCell(grid, target, mark);
        if (r === "set") count++;
        else if (r === "contra") { contra = true; return false; }
      }
    }
    return true;
  });
  return { count, contra };
}

/** T2 count completion: a line already holding N/2 of one mark -> rest get the other. */
function applyT2(grid, size) {
  const half = size / 2;
  let count = 0, contra = false;
  forEachLine(size, (idxs) => {
    let x = 0, o = 0;
    for (let k = 0; k < size; k++) { const v = grid[idxs[k]]; if (v === X) x++; else if (v === O) o++; }
    let fill = EMPTY;
    if (x === half && o < half) fill = O;
    else if (o === half && x < half) fill = X;
    if (fill !== EMPTY) {
      for (let k = 0; k < size; k++) {
        if (grid[idxs[k]] === EMPTY) {
          const r = forceCell(grid, idxs[k], fill);
          if (r === "set") count++;
          else if (r === "contra") { contra = true; return false; }
        }
      }
    }
    return true;
  });
  return { count, contra };
}

// Shared driver for T3/T4: analyze each line, optionally with per-line forbidden set.
function applyLineAnalysis(grid, size, useUniqueness) {
  let count = 0, contra = false;
  // Precompute completed-line signatures for uniqueness (R3).
  let completeRows = null, completeCols = null;
  if (useUniqueness) {
    completeRows = new Set();
    completeCols = new Set();
    for (let r = 0; r < size; r++) { const l = getRow(grid, size, r); if (l.indexOf(EMPTY) === -1) completeRows.add(l.join("")); }
    for (let c = 0; c < size; c++) { const l = getCol(grid, size, c); if (l.indexOf(EMPTY) === -1) completeCols.add(l.join("")); }
  }
  const runLine = (idxs, forbidden) => {
    const vals = idxs.map((i) => grid[i]);
    // A complete line has nothing to force, and with uniqueness its own
    // signature would be in `forbidden` (a false self-collision). Skip it.
    if (vals.indexOf(EMPTY) === -1) return true;
    const res = analyzeLine(vals, size, forbidden);
    if (res.contradiction) { contra = true; return false; }
    for (const f of res.forced) {
      const r = forceCell(grid, idxs[f.pos], f.mark);
      if (r === "set") count++;
      else if (r === "contra") { contra = true; return false; }
    }
    return true;
  };
  for (let r = 0; r < size && !contra; r++) {
    const idxs = new Array(size);
    for (let c = 0; c < size; c++) idxs[c] = r * size + c;
    if (!runLine(idxs, completeRows)) break;
  }
  for (let c = 0; c < size && !contra; c++) {
    const idxs = new Array(size);
    for (let r = 0; r < size; r++) idxs[r] = r * size + c;
    if (!runLine(idxs, completeCols)) break;
  }
  return { count, contra };
}

function applyT3(grid, size) { return applyLineAnalysis(grid, size, false); }
function applyT4(grid, size) { return applyLineAnalysis(grid, size, true); }

/**
 * Propagate deductions using tiers 1..maxTier to a fixpoint. Always tries the
 * cheapest tier first and restarts after any progress, so the highest tier
 * actually needed is recorded truthfully.
 * Returns { changed, contradiction, tierUsed }.
 */
function propagate(grid, size, maxTier) {
  let tierUsed = 0, changed = false;
  for (;;) {
    let r = applyT1(grid, size);
    if (r.contra) return { changed, contradiction: true, tierUsed };
    if (r.count > 0) { tierUsed = Math.max(tierUsed, 1); changed = true; continue; }

    if (maxTier >= 2) {
      r = applyT2(grid, size);
      if (r.contra) return { changed, contradiction: true, tierUsed };
      if (r.count > 0) { tierUsed = Math.max(tierUsed, 2); changed = true; continue; }
    }
    if (maxTier >= 3) {
      r = applyT3(grid, size);
      if (r.contra) return { changed, contradiction: true, tierUsed };
      if (r.count > 0) { tierUsed = Math.max(tierUsed, 3); changed = true; continue; }
    }
    if (maxTier >= 4) {
      r = applyT4(grid, size);
      if (r.contra) return { changed, contradiction: true, tierUsed };
      if (r.count > 0) { tierUsed = Math.max(tierUsed, 4); changed = true; continue; }
    }
    break;
  }
  if (!isValidPartial(grid, size)) return { changed, contradiction: true, tierUsed };
  return { changed, contradiction: false, tierUsed };
}

/**
 * trialSolve — propagate T1-T4 to a fixpoint, and when stuck apply
 * trial-and-error up to `depth` levels of nesting: tentatively assign an empty
 * cell, recursively solve with `depth-1`; if that reaches a contradiction, the
 * opposite mark is forced. depth 0 means "T1-T4 only, no trials".
 *
 * Mutates `grid`. Returns { contradiction, tierUsed } (tierUsed is the highest
 * DEDUCTION tier this call itself needed; any trial that fires bumps it to 5).
 */
function trialSolve(grid, size, depth) {
  let tierUsed = 0;
  for (;;) {
    const r = propagate(grid, size, 4);
    if (r.contradiction) return { contradiction: true, tierUsed };
    tierUsed = Math.max(tierUsed, r.tierUsed);
    if (isComplete(grid)) return { contradiction: false, tierUsed };
    if (depth <= 0) return { contradiction: false, tierUsed }; // stuck, trials not allowed here

    let made = false;
    for (let i = 0; i < grid.length && !made; i++) {
      if (grid[i] !== EMPTY) continue;
      for (const mark of MARKS) {
        const trial = cloneGrid(grid);
        trial[i] = mark;
        const sub = trialSolve(trial, size, depth - 1);
        if (sub.contradiction) {
          grid[i] = opposite(mark); // `mark` here is impossible -> opposite forced
          tierUsed = Math.max(tierUsed, 5);
          made = true;
          break;
        }
      }
    }
    if (!made) return { contradiction: false, tierUsed }; // stuck at this depth
  }
}

/**
 * Full tiered solver.
 *
 * Grades honestly via iterative deepening: first try pure deduction (T1-T4,
 * depth 0). If that stalls, allow depth-1 trial-and-error, then depth-2, etc.
 * The SHALLOWEST depth that solves the board determines the label — a board is
 * tier 4 if T1-T4 alone finish it, tier 5 the moment any trial is needed,
 * regardless of how deep the trial had to go. Depth is only a completeness
 * mechanism (some uniquely-solvable boards need depth-2 lookahead); the "needs:
 * trial and error" badge is the same for all of them.
 *
 * Returns { solved, grid, maxTier, stuck?, contradiction? }.
 */
function solve(grid, size, opts) {
  const maxDepth = opts && opts.maxTrialDepth != null ? opts.maxTrialDepth : 3;
  let lastGrid = cloneGrid(grid);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const work = cloneGrid(grid);
    const r = trialSolve(work, size, depth);
    if (r.contradiction) return { solved: false, contradiction: true, grid: work, maxTier: r.tierUsed };
    if (isComplete(work)) return { solved: isSolved(work, size), grid: work, maxTier: r.tierUsed };
    lastGrid = work; // stuck at this depth; deepen
  }
  // Exhausted the depth cap on a board we couldn't finish. For our
  // uniquely-solvable puzzles this shouldn't happen — report it, never guess.
  return { solved: false, stuck: true, grid: lastGrid, maxTier: 5 };
}

/* ==================================================================== *
 * countSolutions — full backtracking search, used ONLY to verify uniqueness.
 * Prunes with the sound T1-T4 forced-fill propagation (never trials), then
 * branches on the MOST-CONSTRAINED empty cell (MRV): the cell whose row+column
 * have the fewest empties left, so each guess cascades through propagation and
 * the "no second solution" proof stays shallow. Without MRV, proving a hard
 * 14x14 board unique can blow up into minutes. Counts up to `cap` and stops.
 * ==================================================================== */
function propagateSafe(grid, size) {
  // Every fill trialSolve makes — T1-T4 forced cells AND depth-1 failed-literal
  // deductions (if cell=X yields a T1-T4 contradiction, cell=O holds in every
  // solution) — is sound: true in EVERY valid solution. So using it to prune
  // the count never drops a solution, it only skips branches that must fail. The
  // depth-1 failed-literal pass is what tames adversarial 14x14 uniqueness
  // proofs that pure T1-T4 (or plain backtracking) blow up on.
  const r = trialSolve(grid, size, 1);
  return !r.contradiction;
}

/** Most-constrained empty cell (min row-empties + col-empties), or -1 if full. */
function pickBranchCell(grid, size) {
  const rowE = new Int16Array(size), colE = new Int16Array(size);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (grid[r * size + c] === EMPTY) { rowE[r]++; colE[c]++; }
  let best = -1, bestScore = Infinity;
  for (let r = 0; r < size; r++) {
    if (rowE[r] === 0) continue;
    for (let c = 0; c < size; c++) {
      if (grid[r * size + c] !== EMPTY) continue;
      const score = rowE[r] + colE[c];
      if (score < bestScore) { bestScore = score; best = r * size + c; }
    }
  }
  return best;
}

/** Thrown by countSolutions when the node budget is exceeded before finishing. */
const BUDGET_EXCEEDED = "COUNT_BUDGET_EXCEEDED";

/**
 * Count solutions up to `cap`, pruning with sound forced-fill propagation and
 * MRV branching. If `budget` (max search nodes) is provided and the search
 * exceeds it before terminating, throws BUDGET_EXCEEDED — a rare adversarial
 * board can make the "no second solution" proof explode, and callers that only
 * need a decision (carving, verification) bound it and treat "unknown" safely.
 */
function countSolutions(grid, size, cap, budget) {
  if (cap == null) cap = 2;
  if (budget == null) budget = Infinity;
  const counter = { n: 0, nodes: 0 };

  function rec(g) {
    if (counter.n >= cap) return;
    if (++counter.nodes > budget) throw BUDGET_EXCEEDED;
    const work = cloneGrid(g);
    if (!propagateSafe(work, size)) return; // dead branch
    const i = pickBranchCell(work, size);
    if (i === -1) {
      if (isSolved(work, size)) counter.n++;
      return;
    }
    const r = rowOf(i, size), c = colOf(i, size);
    for (const mark of MARKS) {
      const g2 = cloneGrid(work);
      g2[i] = mark;
      // cheap local prune: row/col of i must stay valid
      if (!checkLine(getRow(g2, size, r), size).valid) continue;
      if (!checkLine(getCol(g2, size, c), size).valid) continue;
      rec(g2);
      if (counter.n >= cap) return;
    }
  }
  rec(grid);
  return counter.n;
}

/**
 * Uniqueness decision with a bounded effort budget. Returns true only if the
 * board is PROVEN to have exactly one solution within `budget` search nodes;
 * returns false if it has 0 or >=2 solutions, OR if the proof exceeded the
 * budget (unknown -> treated as "not provably unique"). Sound for carving: a
 * true result always means genuinely unique.
 */
function isUniqueBounded(grid, size, budget) {
  try {
    return countSolutions(grid, size, 2, budget) === 1;
  } catch (e) {
    if (e === BUDGET_EXCEEDED) return false;
    throw e;
  }
}

/* ==================================================================== *
 * nextHint — the EASIEST next forced cell from the current board, packaged
 * for a three-stage hint (nudge -> point -> place). Powers the Hint button: it
 * reveals the next logical deduction, never a random answer.
 *
 * Consistency rules (what makes hints feel like "the next step"):
 *   1. Always the simplest technique available: tiers are scanned in order and
 *      the first tier with ANY candidate wins.
 *   2. Within that tier, prefer the candidate nearest `focus` (the player's
 *      last move), so the hint continues where they are working instead of
 *      jumping to the top-left corner. Ties fall back to reading order.
 *
 * Every hint carries `evidence` (the cells that justify it) and `line` (the
 * cells of the row/column it lives in), so the UI can show WHY, plus two texts:
 *   nudge  — where to look, without giving the answer
 *   reason — the full explanation naming the cell and mark
 *
 * Assumes the filled cells are consistent with the solution (the UI checks for
 * player mistakes separately). Returns
 *   { i, mark, tier, kind, line, evidence, nudge, reason }  or null.
 * ==================================================================== */
function nextHint(grid, size, focus) {
  const half = size / 2;
  const nameOf = (m) => (m === X ? "X" : "O");
  const plural = (m) => nameOf(m) + "'s";
  const hasFocus = focus != null && focus >= 0;
  const fr = hasFocus ? rowOf(focus, size) : 0, fc = hasFocus ? colOf(focus, size) : 0;
  const dist = (i) => (hasFocus ? Math.abs(rowOf(i, size) - fr) + Math.abs(colOf(i, size) - fc) : 0);
  // pick the best candidate: nearest the focus, then reading order (lowest index)
  const best = (cands) => {
    let b = null;
    for (const h of cands) {
      if (!b || dist(h.i) < dist(b.i) || (dist(h.i) === dist(b.i) && h.i < b.i)) b = h;
    }
    return b;
  };

  // build the row/col line list once
  const lines = [];
  for (let r = 0; r < size; r++) {
    const a = new Array(size);
    for (let c = 0; c < size; c++) a[c] = r * size + c;
    lines.push({ kind: "row", idx: r, cells: a });
  }
  for (let c = 0; c < size; c++) {
    const a = new Array(size);
    for (let r = 0; r < size; r++) a[r] = r * size + c;
    lines.push({ kind: "col", idx: c, cells: a });
  }
  const label = (ln) => (ln.kind === "row" ? "row " : "column ") + (ln.idx + 1);
  const Label = (ln) => (ln.kind === "row" ? "Row " : "Column ") + (ln.idx + 1);
  const mk = (i, mark, tier, kind, ln, evidence, nudge, reason) =>
    ({ i, mark, tier, kind, line: ln.cells.slice(), evidence, nudge, reason });

  let cands = [];

  // T1 — triple-block: a pair (or a sandwiched gap) forces the opposite mark.
  for (const ln of lines) {
    const v = ln.cells.map((i) => grid[i]);
    for (let k = 0; k + 2 < size; k++) {
      const a = v[k], b = v[k + 1], c = v[k + 2];
      const C = ln.cells;
      if (a !== EMPTY && a === b && c === EMPTY) {
        cands.push(mk(C[k + 2], opposite(a), 1, "pair", ln, [C[k], C[k + 1]],
          "Look at " + label(ln) + ": two " + plural(a) + " sit side by side.",
          "Two " + plural(a) + " side by side — a third would make three in a row, so this cell is " + nameOf(opposite(a)) + "."));
      }
      if (b !== EMPTY && b === c && a === EMPTY) {
        cands.push(mk(C[k], opposite(b), 1, "pair", ln, [C[k + 1], C[k + 2]],
          "Look at " + label(ln) + ": two " + plural(b) + " sit side by side.",
          "Two " + plural(b) + " side by side — a third would make three in a row, so this cell is " + nameOf(opposite(b)) + "."));
      }
      if (a !== EMPTY && a === c && b === EMPTY) {
        cands.push(mk(C[k + 1], opposite(a), 1, "gap", ln, [C[k], C[k + 2]],
          "Look at " + label(ln) + ": a gap is sandwiched between two " + plural(a) + ".",
          "This gap sits between two " + plural(a) + " — filling it with " + nameOf(a) +
          " would make three in a row, so it's " + nameOf(opposite(a)) + "."));
      }
    }
  }
  if (cands.length) return best(cands);

  // T2 — count completion: a line already holds all N/2 of one mark.
  for (const ln of lines) {
    let x = 0, o = 0;
    const empties = [];
    for (const i of ln.cells) { const vv = grid[i]; if (vv === X) x++; else if (vv === O) o++; else empties.push(i); }
    if (!empties.length) continue;
    let full = EMPTY;
    if (x === half) full = X; else if (o === half) full = O;
    if (full === EMPTY) continue;
    const ev = ln.cells.filter((i) => grid[i] === full);
    for (const i of empties) {
      cands.push(mk(i, opposite(full), 2, "count", ln, ev,
        Label(ln) + " already has all " + half + " of its " + plural(full) + ".",
        Label(ln) + " already has all " + half + " " + plural(full) + " — every remaining cell is " + nameOf(opposite(full)) + "."));
    }
  }
  if (cands.length) return best(cands);

  // T3 — single-line completion: only one mark fits this cell in every
  // valid way to finish the line.
  for (const ln of lines) {
    const v = ln.cells.map((i) => grid[i]);
    if (v.indexOf(EMPTY) === -1) continue;
    const res = analyzeLine(v, size, null);
    if (res.contradiction || !res.forced.length) continue;
    const c = lineCounts(v);
    const needs = Label(ln) + " still needs " + (half - c.x) + " X and " + (half - c.o) + " O";
    const ev = ln.cells.filter((i) => grid[i] !== EMPTY);
    for (const f of res.forced) {
      cands.push(mk(ln.cells[f.pos], f.mark, 3, "line", ln, ev,
        needs + ". Try fitting them in without making three in a row.",
        needs + ". Every way to fit them without three in a row puts " + nameOf(f.mark) + " in this cell."));
    }
  }
  if (cands.length) return best(cands);

  // T4 — uniqueness rule: the other mark would complete a copy of a finished line.
  const complete = { row: [], col: [] };
  for (const ln of lines) {
    const v = ln.cells.map((i) => grid[i]);
    if (v.indexOf(EMPTY) === -1) complete[ln.kind].push({ ln, key: v.join("") });
  }
  for (const ln of lines) {
    const v = ln.cells.map((i) => grid[i]);
    if (v.indexOf(EMPTY) === -1) continue;
    const done = complete[ln.kind];
    if (!done.length) continue;
    const res = analyzeLine(v, size, new Set(done.map((d) => d.key)));
    if (res.contradiction || !res.forced.length) continue;
    for (const f of res.forced) {
      // the finished twin: agrees with every filled cell here, has the other mark at f.pos
      const twin = done.find((d) => {
        if (+d.key[f.pos] !== opposite(f.mark)) return false;
        for (let k = 0; k < size; k++) if (v[k] !== EMPTY && +d.key[k] !== v[k]) return false;
        return true;
      });
      const twinName = twin ? label(twin.ln) : "a finished " + (ln.kind === "row" ? "row" : "column");
      const ev = twin ? twin.ln.cells.slice() : [];
      cands.push(mk(ln.cells[f.pos], f.mark, 4, "unique", ln, ev,
        "Compare " + label(ln) + " with " + twinName + " — no two " + (ln.kind === "row" ? "rows" : "columns") + " may be identical.",
        "Putting " + nameOf(opposite(f.mark)) + " here would make " + label(ln) + " an exact copy of " +
        twinName + " — so it's " + nameOf(f.mark) + "."));
    }
  }
  if (cands.length) return best(cands);

  // T5 — trial-and-error (depth 1): one choice hits a dead end. Expensive, so
  // test cells nearest the focus first and stop at the first success.
  const empties = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === EMPTY) empties.push(i);
  empties.sort((a, b) => dist(a) - dist(b) || a - b);
  for (const i of empties) {
    for (const m of MARKS) {
      const trial = cloneGrid(grid);
      trial[i] = m;
      if (propagate(trial, size, 4).contradiction) {
        const ln = lines[rowOf(i, size)];
        return mk(i, opposite(m), 5, "trial", ln, [],
          "No simple rule applies right now. Pick the highlighted cell, imagine an " + nameOf(m) + " there, and follow the consequences.",
          "Imagine " + nameOf(m) + " here: following the rules soon breaks one — so this cell must be " + nameOf(opposite(m)) + ".");
      }
    }
  }

  return null;
}

/** Back-compat wrapper: the simplest next deduction in reading order. */
function hintDeduction(grid, size) {
  return nextHint(grid, size, null);
}

/* -------------------------------------------------------------------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    lineHasTriple, lineCounts, checkLine,
    firstEmpty, isComplete, isValidPartial, isSolved, findViolations,
    analyzeLine,
    applyT1, applyT2, applyT3, applyT4, propagate,
    trialSolve, solve, propagateSafe, pickBranchCell,
    countSolutions, isUniqueBounded, BUDGET_EXCEEDED,
    hintDeduction, nextHint,
  };
}

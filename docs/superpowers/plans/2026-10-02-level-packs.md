# Level Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 40 fixed, star-rated levels per grid size (Doodle → Homework → Pop Quiz → Final Exam), alongside today's free play.

**Architecture:** A one-off node script (`tools/build-levels.js`) uses the existing generator, with a new technique cap, to produce a frozen `levels.js` data file of clue strings. A pure `progress.js` module holds the star, unlock and merge rules. `ui.js` gains Levels and Pack screens plus a "level" play mode that reuses the existing board, hints and win animation. It tracks hints and mistakes for stars and keeps level games out of free-play stats.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework, no build step), plain node test scripts, localStorage, service-worker PWA.

**Spec:** `docs/superpowers/specs/2026-10-02-level-packs-design.md`

## Global Constraints

- Vanilla JS only; no dependencies, no bundler. Tests are plain node scripts run with `node tests/<name>.test.js`.
- Dual-use module convention (see the header of `board.js`): top-level `const`/`function` names become browser globals shared by later `<script>` tags. Never re-declare an earlier file's name. Node export via `if (typeof module !== "undefined" && module.exports) module.exports = {...}`. Pull dependencies with `Object.assign(global, require("./x.js"))`, never a top-level `const {..} = require(..)`.
- `ui.js` is ES5-style (`var`, `function`), inside one IIFE. Match it.
- localStorage keys are namespaced `tictaclogic.*`; every read/write goes through `lsGet`/`lsSet` (they swallow storage errors).
- Mobile-first: tap targets ≥ 44px; test at 375px width.
- Tier names, exactly: `Doodle`, `Homework`, `Pop Quiz`, `Final Exam`. Levels 1–10, 11–20, 21–30, 31–40; required technique tier = 1, 2, 3, 4.
- 40 levels per size for sizes 6, 8, 10, 12, 14. No level may need trial and error (tier 5).
- Stars: 1 for solving, +1 if no hints (any Hint press counts), +1 if no mistakes. Replays never lower stars or raise the best time.
- Level games never call `recordPlayed`, `recordAbandon` or `recordWin`.
- Service worker `CACHE_NAME` becomes `"tictaclogic-v6"`; `progress.js` and `levels.js` are added to `SHELL`.
- `tests/generator.test.js` takes minutes; run it in the background only if `generator.js` changes. The quick suites are board, solver, hint, noguess and levels.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit locally; push only when the user says so.

## File Structure

| File | Responsibility |
|------|----------------|
| `generator.js` (modify) | `solvesWithin()` + `{ maxTier }` option on `carvePuzzle` |
| `progress.js` (create) | pure level rules: tiers, stars, merge, unlock, summary |
| `tools/build-levels.js` (create) | builds `levels.js` deterministically |
| `levels.js` (create, generated) | `LEVELS` = 40 clue strings per size |
| `tests/levels.test.js` (create) | cap, progress helpers, level data |
| `index.html` (modify) | two new screens; load `progress.js` + `levels.js` |
| `sw.js` (modify) | cache the new files; v6 |
| `ui.js` (modify) | Levels/Pack screens, level mode, stars, level win card |
| `style.css` (modify) | levels card, pack grid, stars |

---

### Task 1: Technique cap on carving

**Files:**
- Modify: `generator.js` (the `carvePuzzle` function, about lines 149–163, plus the exports at the bottom)
- Create: `tests/levels.test.js`

**Interfaces:**
- Produces: `solvesWithin(clues: Int8Array, size: number, maxTier: 1..4) -> boolean` and `carvePuzzle(solution, size, rand, opts?)`, where `opts.maxTier` (1–4) limits which techniques the carve may rely on. Both are exported from `generator.js`. With no `opts`, behaviour is byte-for-byte unchanged (free play must not change).

- [ ] **Step 1: Write the failing test**

Create `tests/levels.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/levels.test.js`
Expected: FAIL. It crashes with `TypeError: G.solvesWithin is not a function`, or reports "needs at most T1 (got T4)"-style failures.

- [ ] **Step 3: Implement the cap in `generator.js`**

Replace the whole `carvePuzzle` function (keep the ORACLE NOTE comment block above it as-is) with:

```js
/** True if deduction limited to tiers 1..maxTier alone completes the board. */
function solvesWithin(clues, size, maxTier) {
  const w = cloneGrid(clues);
  const r = propagate(w, size, maxTier);
  return !r.contradiction && isComplete(w);
}

/**
 * opts.maxTier (1-4, optional): only remove a clue if deduction using tiers
 * <= maxTier still finishes the board. Used by tools/build-levels.js to make
 * e.g. "Doodle" levels that need nothing but the sandwich rule. Without opts
 * the free-play behaviour is unchanged (pure T1-T4, CARVE_TRIAL_DEPTH).
 */
function carvePuzzle(solution, size, rand, opts) {
  const maxTier = opts && opts.maxTier ? opts.maxTier : 0;
  const clues = cloneGrid(solution);
  const order = shuffleInPlace(
    Array.from({ length: clues.length }, (_, i) => i),
    rand
  );
  for (const i of order) {
    const saved = clues[i];
    clues[i] = EMPTY;
    const stillSolvable = maxTier
      ? solvesWithin(clues, size, maxTier)
      : solve(clues, size, { maxTrialDepth: CARVE_TRIAL_DEPTH }).solved;
    if (!stillSolvable) {
      clues[i] = saved; // removal broke (provable) uniqueness -> put it back
    }
  }
  return clues;
}
```

In the `module.exports` block at the bottom of `generator.js`, change `buildCompleteGrid, carvePuzzle, tierLabel,` to:

```js
    buildCompleteGrid, carvePuzzle, solvesWithin, tierLabel,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/levels.test.js`
Expected: `levels.test.js: 76 passed, 0 failed` (4 tiers × 6 boards × 3 checks + 4 count checks).

Run: `node tests/noguess.test.js`
Expected: `noguess.test.js: 10 passed, 0 failed` (free play unchanged).

- [ ] **Step 5: Commit**

```bash
git add generator.js tests/levels.test.js
git commit -m "Add technique cap option to carvePuzzle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure progress rules (`progress.js`)

**Files:**
- Create: `progress.js`
- Modify: `tests/levels.test.js` (add a section before the final summary `console.log`)

**Interfaces:**
- Produces (top-level globals in the browser; exported in node):
  - `TIER_NAMES: string[]` = `["Doodle", "Homework", "Pop Quiz", "Final Exam"]`
  - `LEVELS_PER_TIER = 10`, `LEVELS_PER_PACK = 40`
  - `tierOf(n: 1..40) -> 0..3`
  - `tierName(n) -> string`
  - `computeStars(hintsUsed: number, mistakes: number) -> 1..3`
  - `mergeResult(old: {stars, bestMs}|null, stars: number, ms: number) -> {stars, bestMs}`
  - `isUnlocked(pack: {[n]: result}|undefined, n) -> boolean`
  - `packSummary(pack) -> {solved: number, stars: number}`
- A "pack" is `{ "1": {stars, bestMs}, "2": {...}, ... }` (keys are level numbers; JSON makes them strings, and numeric indexing works on both).

- [ ] **Step 1: Write the failing test**

In `tests/levels.test.js`, add after the `require("../generator.js")` line:

```js
const P = require("../progress.js");
```

and insert this section just before the final `console.log("\nlevels.test.js: " ...)` line:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/levels.test.js`
Expected: FAIL with `Error: Cannot find module '../progress.js'`.

- [ ] **Step 3: Create `progress.js`**

```js
/* progress.js — level-pack rules: tiers, stars, unlocking, merging results.
 *
 * Pure and headless (no DOM, no storage), so tests can run it in node; ui.js
 * does the storage. See board.js for the dual-use (browser <script> + node
 * require) convention — these names become browser globals.
 *
 * A "pack" is one grid size's progress: { "1": {stars, bestMs}, ... }. A level
 * is solved iff it has an entry.
 */

const TIER_NAMES = ["Doodle", "Homework", "Pop Quiz", "Final Exam"];
const LEVELS_PER_TIER = 10;
const LEVELS_PER_PACK = TIER_NAMES.length * LEVELS_PER_TIER; // 40

/** Tier index 0..3 of level n (1-based). Level n needs technique tier tierOf(n) + 1. */
function tierOf(n) {
  return Math.floor((n - 1) / LEVELS_PER_TIER);
}

function tierName(n) {
  return TIER_NAMES[tierOf(n)];
}

/** ★ solved, ★ no hints, ★ no mistakes. */
function computeStars(hintsUsed, mistakes) {
  return 1 + (hintsUsed === 0 ? 1 : 0) + (mistakes === 0 ? 1 : 0);
}

/** Combine a new result with the stored one; replays never make things worse. */
function mergeResult(old, stars, ms) {
  if (!old) return { stars: stars, bestMs: ms };
  return {
    stars: Math.max(old.stars || 0, stars),
    bestMs: old.bestMs ? Math.min(old.bestMs, ms) : ms,
  };
}

/** Level 1 is always open; level n opens once level n-1 is solved. */
function isUnlocked(pack, n) {
  return n === 1 || !!(pack && pack[n - 1]);
}

function packSummary(pack) {
  let solved = 0, stars = 0;
  if (pack) {
    for (let n = 1; n <= LEVELS_PER_PACK; n++) {
      if (pack[n]) { solved++; stars += pack[n].stars || 0; }
    }
  }
  return { solved: solved, stars: stars };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TIER_NAMES, LEVELS_PER_TIER, LEVELS_PER_PACK,
    tierOf, tierName, computeStars, mergeResult, isUnlocked, packSummary,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/levels.test.js`
Expected: `levels.test.js: 93 passed, 0 failed` (76 + 17).

- [ ] **Step 5: Commit**

```bash
git add progress.js tests/levels.test.js
git commit -m "Add pure level progress rules (stars, unlocking, tiers)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Build the frozen levels (`tools/build-levels.js` → `levels.js`)

**Files:**
- Create: `tools/build-levels.js`
- Create (generated): `levels.js`
- Modify: `tests/levels.test.js` (add a data section)

**Interfaces:**
- Consumes: `G.carvePuzzle(sol, size, rand, { maxTier })`, `G.buildCompleteGrid`, `G.mulberry32`, `G.hashString`, `G.BUILD_BUDGET`, `S.solve`, `B.gridToString`, and `P.tierOf` / `P.LEVELS_PER_PACK` / `P.LEVELS_PER_TIER`.
- Produces: `levels.js` defining globals `LEVELS_VERSION = 1` and `LEVELS = { 6: string[40], 8: [...], 10: [...], 12: [...], 14: [...] }`. Each string is a `gridToString` clue grid, level 1 first. Node export: `{ LEVELS, LEVELS_VERSION }`.

- [ ] **Step 1: Write the failing data test**

In `tests/levels.test.js`, insert just before the final summary `console.log`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/levels.test.js`
Expected: FAIL with `Error: Cannot find module '../levels.js'`.

- [ ] **Step 3: Create `tools/build-levels.js`**

```js
/* tools/build-levels.js — builds levels.js, the frozen level packs.
 *
 * Run from the project root:  node tools/build-levels.js
 *
 * For every grid size and tier k (1 Doodle .. 4 Final Exam) it carves candidate
 * puzzles allowed to rely only on techniques <= k, keeps those that genuinely
 * NEED tier k (so each section really teaches its technique), drops
 * duplicates, sorts by clue count (most clues = easiest first) and takes 10
 * evenly spaced, so each section ramps from easier to harder.
 *
 * Fully deterministic: seeds come from fixed strings, ties sort by clue string.
 * Running it twice produces a byte-identical levels.js. The game never
 * generates levels itself; re-running this script is the ONLY way levels
 * change, so do it deliberately (it would re-shuffle players' stars).
 */
const fs = require("fs");
const path = require("path");
const B = require("../board.js");
const S = require("../solver.js");
const G = require("../generator.js");
const P = require("../progress.js");

const SIZES = [6, 8, 10, 12, 14];
const POOL = 25;            // accepted candidates collected per size/tier
const MAX_CANDIDATES = 600; // give up (loudly) after this many tries

function clueCount(str) {
  let n = 0;
  for (const ch of str.slice(str.indexOf(":") + 1)) if (ch !== ".") n++;
  return n;
}

function buildTier(size, k) {
  const pool = new Set();
  let tried = 0;
  for (let c = 0; c < MAX_CANDIDATES && pool.size < POOL; c++) {
    tried++;
    const rand = G.mulberry32(G.hashString("level-" + size + "-tier-" + k + "-cand-" + c));
    let sol;
    try { sol = G.buildCompleteGrid(size, rand); }
    catch (e) { if (e === G.BUILD_BUDGET) continue; throw e; }
    const clues = G.carvePuzzle(sol, size, rand, { maxTier: k });
    const r = S.solve(clues, size, { maxTrialDepth: 0 });
    if (!r.solved || r.maxTier !== k) continue;
    pool.add(B.gridToString(clues, size));
  }
  if (pool.size < P.LEVELS_PER_TIER) {
    throw new Error("build-levels: only " + pool.size + " puzzles for " + size + "x" + size +
      " tier " + k + " after " + tried + " candidates");
  }
  const sorted = [...pool].sort((a, b) => clueCount(b) - clueCount(a) || (a < b ? -1 : a > b ? 1 : 0));
  const picks = [];
  for (let j = 0; j < P.LEVELS_PER_TIER; j++) {
    picks.push(sorted[Math.round(j * (sorted.length - 1) / (P.LEVELS_PER_TIER - 1))]);
  }
  console.log("  " + size + "x" + size + " " + P.TIER_NAMES[k - 1] + ": " + pool.size + " candidates from " +
    tried + " tries, clues " + clueCount(picks[0]) + " -> " + clueCount(picks[picks.length - 1]));
  return picks;
}

const lines = [
  "/* levels.js — GENERATED by tools/build-levels.js. Do not edit by hand.",
  " *",
  " * 40 fixed levels per grid size, as clue strings (gridToString). Levels",
  " * 1-10 Doodle, 11-20 Homework, 21-30 Pop Quiz, 31-40 Final Exam (see",
  " * progress.js). The solution is recomputed by the solver when a level opens.",
  " */",
  "const LEVELS_VERSION = 1;",
  "const LEVELS = {",
];
for (const size of SIZES) {
  const levels = [];
  for (let k = 1; k <= 4; k++) levels.push(...buildTier(size, k));
  lines.push("  " + size + ": [");
  for (const str of levels) lines.push('    "' + str + '",');
  lines.push("  ],");
}
lines.push("};");
lines.push("");
lines.push('if (typeof module !== "undefined" && module.exports) {');
lines.push("  module.exports = { LEVELS, LEVELS_VERSION };");
lines.push("}");
lines.push("");

const out = path.join(__dirname, "..", "levels.js");
fs.writeFileSync(out, lines.join("\n"));
console.log("wrote " + out + " (" + fs.statSync(out).size + " bytes)");
```

- [ ] **Step 4: Generate the levels**

Run: `node tools/build-levels.js`
Expected: 20 progress lines (5 sizes × 4 tiers), each like `6x6 Doodle: 25 candidates from 25 tries, clues 16 -> 13`, then `wrote …levels.js (≈25000 bytes)`.
If it throws `build-levels: only N puzzles for …`, **stop and report to the user**. Don't lower the requirements on your own.

- [ ] **Step 5: Check determinism**

Run:
```bash
cp levels.js "$TEMP/levels.first.js" && node tools/build-levels.js > /dev/null && cmp levels.js "$TEMP/levels.first.js" && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node tests/levels.test.js`
Expected: `levels.test.js: 1298 passed, 0 failed` (93 + 5 sizes × (1 + 40 × 6)).

- [ ] **Step 7: Commit**

```bash
git add tools/build-levels.js levels.js tests/levels.test.js
git commit -m "Build 200 frozen levels (40 per size, four technique tiers)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Levels and Pack screens, starting and resuming a level

**Files:**
- Modify: `index.html` (screens + script tags)
- Modify: `sw.js` (SHELL + `CACHE_NAME`)
- Modify: `ui.js` (navigation, `startLevel`, save/continue, HUD badge)
- Modify: `style.css` (levels card, pack grid)

**Interfaces:**
- Consumes: browser globals `LEVELS` (levels.js) and `TIER_NAMES`, `LEVELS_PER_PACK`, `LEVELS_PER_TIER`, `tierName`, `isUnlocked`, `packSummary` (progress.js).
- Produces (inside the ui.js IIFE, used by Task 5): `KEY_LEVELS`, `packOf(size)`, `hasLevels(size)`, `openLevels()`, `openPack(size)`, `startLevel(size, n)`, `starString(k)`. The `game` object gains `mode: "free" | "level"`, `level: number | null` and `mistakes: number`.

- [ ] **Step 1: Load the new files**

In `index.html`, after `<section id="tutorial-screen" class="screen"></section>` add:

```html
    <section id="levels-screen" class="screen"></section>
    <section id="pack-screen" class="screen"></section>
```

and change the script block so it reads:

```html
  <script src="board.js"></script>
  <script src="solver.js"></script>
  <script src="generator.js"></script>
  <script src="progress.js"></script>
  <script src="levels.js"></script>
  <script src="ui.js"></script>
```

In `sw.js`, set `const CACHE_NAME = "tictaclogic-v6";`, and in `SHELL` add `"progress.js",` and `"levels.js",` right after `"generator.js",`.

- [ ] **Step 2: Add storage helpers and screens to `ui.js`**

After `var KEY_SETTINGS = "tictaclogic.settings";` add:

```js
  var KEY_LEVELS = "tictaclogic.levels"; // { "6": { "12": {stars, bestMs} } }
```

After the `nextId` function add:

```js
  /* ---- level packs (rules live in progress.js; data in levels.js) ---- */
  function getLevelProgress() { return lsGet(KEY_LEVELS, {}); }
  function packOf(size) { return getLevelProgress()[size] || {}; }
  function hasLevels(size) {
    return typeof LEVELS !== "undefined" && !!LEVELS && Array.isArray(LEVELS[size]) &&
      LEVELS[size].length === LEVELS_PER_PACK;
  }
  function starString(k) {
    var s = "";
    for (var i = 0; i < 3; i++) s += i < k ? "★" : "☆";
    return s;
  }
```

In `showScreen`, change the id list to:

```js
    ["start-screen", "game-screen", "tutorial-screen", "levels-screen", "pack-screen"].forEach(function (id) {
```

- [ ] **Step 3: Start screen: Levels card and level-aware Continue card**

In `renderStart`, replace the Continue-card `if (save && save.cells) { ... }` block with:

```js
    if (save && save.cells) {
      var mins = Math.floor((save.elapsedMs || 0) / 60000);
      var secs = Math.floor(((save.elapsedMs || 0) % 60000) / 1000);
      var t = mins + ":" + (secs < 10 ? "0" : "") + secs;
      var what = save.mode === "level"
        ? "Level " + save.level + " · " + tierName(save.level)
        : "needs: " + (save.label || "logic");
      html += '<div class="continue-card" id="continue-card">' +
        '<div><div class="cc-main">Continue</div>' +
        '<div class="cc-sub">' + save.size + " × " + save.size + " · " + what + " · " + t + '</div></div>' +
        '<div class="cc-arrow">→</div></div>';
    }
```

Right after the learn-card `if (!lsGet(KEY_TUTORIAL, false)) { ... }` block, add:

```js
    var packs = SIZES.filter(hasLevels);
    if (packs.length) {
      var totSolved = 0, totStars = 0;
      packs.forEach(function (n) {
        var s = packSummary(packOf(n)); totSolved += s.solved; totStars += s.stars;
      });
      html += '<div class="levels-card" id="levels-card">' +
        '<div><div class="lc-main">Levels</div>' +
        '<div class="lc-sub">' + totSolved + " / " + packs.length * LEVELS_PER_PACK +
        " solved · ★ " + totStars + '</div></div>' +
        '<div class="cc-arrow">→</div></div>';
    }
```

In the wiring part of `renderStart`, after the learn-card listener line add:

```js
    var lv = document.getElementById("levels-card");
    if (lv) lv.addEventListener("click", openLevels);
```

- [ ] **Step 4: Levels screen, Pack screen, `startLevel`**

Insert this block right before the `/* === ... TUTORIAL` section comment:

```js
  /* ======================================================================= *
   * LEVEL PACKS — 40 fixed levels per size (levels.js), 4 tiers of 10.
   * ======================================================================= */
  function leaveGameScreen() {
    hideOverlay();
    clearTimeout(violationTimer);
    saveGame(); // no-op once won
    stopTimer();
  }

  function openLevels() {
    leaveGameScreen();
    renderLevels();
    showScreen("levels");
  }

  function renderLevels() {
    var el = document.getElementById("levels-screen");
    var html = '<div class="screen-top">' +
      '<button class="home-btn" id="lv-home">‹ Home</button>' +
      '<h2 class="screen-title">Levels</h2><span></span></div>';
    html += '<div class="size-list">';
    SIZES.filter(hasLevels).forEach(function (n) {
      var s = packSummary(packOf(n));
      html += '<div class="size-btn pack-btn" data-size="' + n + '">' +
        '<span class="sb-size">' + n + " × " + n + '</span>' +
        '<span class="sb-flavor">' + s.solved + " / " + LEVELS_PER_PACK + " · ★ " + s.stars +
        " / " + LEVELS_PER_PACK * 3 + '</span></div>';
    });
    html += '</div>';
    el.innerHTML = html;
    document.getElementById("lv-home").addEventListener("click", function () {
      renderStart(); showScreen("start");
    });
    Array.prototype.forEach.call(el.querySelectorAll(".pack-btn"), function (b) {
      b.addEventListener("click", function () { openPack(parseInt(b.dataset.size, 10)); });
    });
  }

  function openPack(size) {
    leaveGameScreen();
    renderPack(size);
    showScreen("pack");
  }

  function renderPack(size) {
    var pack = packOf(size);
    var el = document.getElementById("pack-screen");
    var nextUp = -1;
    for (var k = 1; k <= LEVELS_PER_PACK; k++) {
      if (!pack[k] && isUnlocked(pack, k)) { nextUp = k; break; }
    }
    var html = '<div class="screen-top">' +
      '<button class="home-btn" id="pk-back">‹ Levels</button>' +
      '<h2 class="screen-title">' + size + " × " + size + '</h2><span></span></div>';
    for (var t = 0; t < TIER_NAMES.length; t++) {
      html += '<div class="section-label on-paper">' + TIER_NAMES[t] + '</div><div class="level-grid">';
      for (var n = t * LEVELS_PER_TIER + 1; n <= (t + 1) * LEVELS_PER_TIER; n++) {
        var res = pack[n];
        var open = isUnlocked(pack, n);
        html += '<button class="level-btn' + (res ? " solved" : "") + (n === nextUp ? " next" : "") +
          (open ? "" : " locked") + '" data-n="' + n + '"' + (open ? "" : " disabled") +
          ' aria-label="Level ' + n + (open ? "" : ", locked") + '">' +
          '<span class="lv-num">' + n + '</span>' +
          (res ? '<span class="lv-stars">' + starString(res.stars) + '</span>'
               : open ? "" : '<span class="lv-lock">locked</span>') +
          '</button>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
    document.getElementById("pk-back").addEventListener("click", function () { renderLevels(); showScreen("levels"); });
    Array.prototype.forEach.call(el.querySelectorAll(".level-btn:not(.locked)"), function (b) {
      b.addEventListener("click", function () { startLevel(size, parseInt(b.dataset.n, 10)); });
    });
  }

  function startLevel(size, n) {
    // like startNewGame: leaving an unfinished FREE game breaks its streak
    var prev = lsGet(KEY_SAVE, null);
    if (prev && prev.cells && prev.mode !== "level") recordAbandon(prev.size);
    var parsed = null, r = null;
    try {
      parsed = gridFromString(LEVELS[size][n - 1]);
      r = solve(parsed.grid, size, { maxTrialDepth: 0 });
    } catch (e) { r = null; }
    if (!r || !r.solved) {
      showOverlay('<h2>Hmm.</h2><p>Level ' + n + ' could not be loaded.</p>' +
        '<button class="btn" id="ov-dismiss">Back</button>');
      document.getElementById("ov-dismiss").addEventListener("click", function () { openPack(size); });
      return;
    }
    hideOverlay();
    loadPuzzle({
      size: size, clues: parsed.grid, solution: r.grid,
      maxTier: r.maxTier, label: tierName(n), id: null, seed: null,
      mode: "level", level: n,
    });
    showScreen("game");
  }
```

- [ ] **Step 5: Carry mode/level/mistakes through load, save and continue**

In `startNewGame`, change `if (prev && prev.cells) recordAbandon(prev.size);` to:

```js
    if (prev && prev.cells && prev.mode !== "level") recordAbandon(prev.size);
```

In `loadPuzzle`, replace the `game = { ... };` object with:

```js
    game = {
      state: state,
      size: puzzle.size,
      label: puzzle.label,
      maxTier: puzzle.maxTier,
      mode: puzzle.mode || "free",
      level: puzzle.level || null,
      moves: [],
      hintsUsed: 0,
      mistakes: 0,
      startTime: Date.now(),
      finalElapsedMs: 0,
      over: false,
    };
```

In `saveGame`, add these three properties to the saved object, after `hintsUsed: game.hintsUsed || 0,`:

```js
      mode: game.mode, level: game.level, mistakes: game.mistakes || 0,
```

In `continueSaved`, replace the `game = { ... };` object with:

```js
    game = {
      state: state, size: save.size, label: save.label, maxTier: save.maxTier,
      mode: save.mode || "free", level: save.level || null,
      moves: [], hintsUsed: save.hintsUsed || 0, mistakes: save.mistakes || 0,
      startTime: Date.now() - (save.elapsedMs || 0), // resume the clock
      finalElapsedMs: 0, over: false,
    };
```

- [ ] **Step 6: HUD badge for levels**

In `renderGame`, replace the `hud-badge` line with:

```js
    var badge = game.mode === "level"
      ? game.size + " × " + game.size + " · Level " + game.level + " · " + game.label
      : game.size + " × " + game.size + " · needs: " + game.label;
    html += '<div class="hud-badge">' + badge + '</div>';
```

- [ ] **Step 7: Styles**

Append to `style.css`, just before the `/* === DARK THEME` section comment:

```css
/* ========================================================================= *
 * LEVEL PACKS
 * ========================================================================= */
.levels-card {
  width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  background: var(--cell-fill);
  border: 1px solid var(--red-pencil);
  border-radius: 8px;
  box-shadow: 0 1px 0 var(--red-pencil);
  padding: 13px 18px;
  cursor: pointer;
  transition: transform var(--ease);
}
.levels-card:active { transform: translateY(1px); box-shadow: none; }
.levels-card .lc-main { font-family: 'Karla'; font-weight: 500; font-size: 15px; color: var(--graphite); }
.levels-card .lc-sub { font-family: 'Karla'; font-size: 11px; color: var(--text-2nd); margin-top: 2px; }
.levels-card .cc-arrow { color: var(--red-pencil); }

#levels-screen, #pack-screen {
  justify-content: flex-start; gap: var(--s3);
  width: 100%; max-width: 460px; margin: 0 auto;
}
.screen-top { width: 100%; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
.screen-title {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 30px;
  color: var(--graphite); margin: 0; text-align: center;
}

.level-grid { width: 100%; display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--s2); }
.level-btn {
  min-height: 56px; padding: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  background: var(--cell-fill);
  border: 1px solid var(--rule-line); border-radius: 6px;
  box-shadow: 0 1px 0 var(--rule-line);
  font-family: 'Karla'; color: var(--graphite);
  cursor: pointer;
  transition: transform var(--ease);
}
.level-btn:active { transform: translateY(1px); box-shadow: none; }
.level-btn .lv-num { font-family: 'Caveat', cursive; font-weight: 700; font-size: 22px; line-height: 1; }
.level-btn .lv-stars { font-size: 11px; letter-spacing: 1px; color: var(--amber); }
.level-btn .lv-lock { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--label-muted); }
.level-btn.next { border: 2px solid var(--red-pencil); }
.level-btn.locked { opacity: 0.4; cursor: default; box-shadow: none; }
```

- [ ] **Step 8: Verify in the browser**

Start the preview (`.claude/launch.json` config `tictaclogic`, port 8765), set the mobile viewport (375×812), and clear the old service worker so the new files load:

```js
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
location.reload();
```

Then run this (after the page reloads):

```js
document.getElementById('levels-card').click();
const packs = [...document.querySelectorAll('.pack-btn')].map(b => b.innerText.replace(/\n/g, ' '));
document.querySelector('.pack-btn[data-size="6"]').click();
const btns = [...document.querySelectorAll('.level-btn')];
const state = { count: btns.length, next: btns.filter(b => b.classList.contains('next')).map(b => b.dataset.n),
  locked: btns.filter(b => b.disabled).length, sections: [...document.querySelectorAll('#pack-screen .section-label')].map(s => s.textContent) };
btns[0].click();
await new Promise(r => setTimeout(r, 200));
[packs, JSON.stringify(state), document.querySelector('.hud-badge').textContent]
```

Expected:
- five packs, each "0 / 40 · ★ 0 / 120";
- `{"count":40,"next":["1"],"locked":39,"sections":["Doodle","Homework","Pop Quiz","Final Exam"]}`;
- badge `6 × 6 · Level 1 · Doodle`.

Then tap one empty cell, press **‹ Home**, and confirm the Continue card reads `6 × 6 · Level 1 · Doodle · 0:0x`. Tap it and confirm the badge is unchanged and the mark is still there. Take a screenshot of the pack screen to check the layout at 375px: 5 columns, nothing cut off.

Also run: `node tests/levels.test.js` → `1298 passed, 0 failed`.

- [ ] **Step 9: Commit**

```bash
git add index.html sw.js ui.js style.css
git commit -m "Add Levels and Pack screens; start and resume levels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Stars, mistakes, level win card, unlocking

**Files:**
- Modify: `ui.js` (`updateViolations`, `scheduleViolations`, `giveHint`, `fillHint`, `restartGame`, `checkWin`, `renderGame`, new `showLevelWinOverlay`)
- Modify: `style.css` (win stars)

**Interfaces:**
- Consumes: `computeStars`, `mergeResult`, `LEVELS_PER_PACK` (progress.js); `KEY_LEVELS`, `getLevelProgress`, `openPack`, `startLevel`, `starString` (Task 4).
- Produces: a level win writes `tictaclogic.levels[size][n] = mergeResult(old, stars, ms)`.

- [ ] **Step 1: Count mistakes when the red flag actually fires**

Change the `updateViolations` signature and body. It becomes `function updateViolations(countMistakes) {`, and the `bad.forEach` block plus the line after it become:

```js
    // mark offending cells; newly-offending ones shake once
    var fresh = false;
    bad.forEach(function (i) {
      var n = board.querySelector('[data-i="' + i + '"]');
      if (!n) return;
      n.classList.add("bad");
      if (!prevBad.has(i)) {
        fresh = true;
        n.classList.add("shake");
        (function (node) { setTimeout(function () { node.classList.remove("shake"); }, 320); })(n);
      }
    });
    prevBad = bad;
    // a rule break the player actually SAW costs the "no mistakes" star. Only
    // real flag events count (deferred tap check, hint/fill) — not board
    // rebuilds on Continue/Clear, and not undo.
    if (countMistakes && fresh && !game.over) game.mistakes = (game.mistakes || 0) + 1;
  }
```

Then update the callers that represent a flag the player sees:
- In `scheduleViolations`, change `if (game && document.getElementById("board")) updateViolations();` to `if (game && document.getElementById("board")) updateViolations(true);`
- In `giveHint`, change `updateViolations(); // a hint should never wait on the deferred mistake flag` to `updateViolations(true); // a hint should never wait on the deferred mistake flag`
- In `fillHint`, change `if (!checkWin()) updateViolations();` to `if (!checkWin()) updateViolations(true);`

Leave `buildBoard`'s and `undoMove`'s `updateViolations()` calls as they are (no argument means no counting).

- [ ] **Step 2: Hint-caught wrong marks count as mistakes; Restart resets**

In `giveHint`, inside `if (w !== -1) {`, after `game.hintsUsed = (game.hintsUsed || 0) + 1;` add:

```js
      game.mistakes = (game.mistakes || 0) + 1; // a wrong mark the player left in
```

In `restartGame`, after `game.hintsUsed = 0;` add:

```js
    game.mistakes = 0;
```

- [ ] **Step 3: Record the result on a level win**

In `checkWin`, replace from `var settings = getSettings();` to the end of the function with:

```js
    var settings = getSettings();
    if (settings.haptics && navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch (e) {} }
    if (settings.sound) playRustle();
    drawWinStroke();   // a red-pencil stroke sweeps across the finished grid
    bounceTitle();     // the title gives one happy bounce

    if (game.mode === "level") {
      // levels keep their own progress and never touch free-play stats
      var stars = computeStars(game.hintsUsed || 0, game.mistakes || 0);
      var all = getLevelProgress();
      var pack = all[game.size] || {};
      var before = pack[game.level] || null;
      pack[game.level] = mergeResult(before, stars, game.finalElapsedMs);
      all[game.size] = pack;
      lsSet(KEY_LEVELS, all);
      setTimeout(function () { if (game && game.over) showLevelWinOverlay(stars, before); }, 720);
      return true;
    }

    var ss = recordWin(game.size, game.label, game.finalElapsedMs);
    setTimeout(function () { if (game && game.over) showWinOverlay(ss); }, 720); // let the stroke land first
    return true;
  }
```

- [ ] **Step 4: Level win card**

Add after the `showWinOverlay` function:

```js
  function showLevelWinOverlay(stars, before) {
    var n = game.level, size = game.size;
    var row = "";
    for (var i = 0; i < 3; i++) {
      row += '<span class="win-star' + (i < stars ? " on" : "") +
        '" style="animation-delay:' + (0.1 + i * 0.25) + 's">★</span>';
    }
    var newBest = before && before.bestMs && game.finalElapsedMs < before.bestMs;
    var moreStars = before && stars > before.stars;
    showOverlay('<h2>Level ' + n + ' done!</h2>' +
      '<div class="win-stars" aria-label="' + stars + ' of 3 stars">' + row + '</div>' +
      '<p>' + size + " × " + size + " · " + game.label + " · <strong>" + fmtTime(game.finalElapsedMs) + "</strong>" +
      (newBest ? " · a new best!" : "") +
      "<br>" + (game.hintsUsed ? "★ for no hints — you used " + game.hintsUsed : "★ no hints") +
      "<br>" + (game.mistakes ? "★ for no mistakes — " + game.mistakes + " flagged" : "★ no mistakes") +
      (moreStars ? "<br>more stars than last time!" : "") +
      (n === LEVELS_PER_PACK ? "<br><strong>That's the whole pack — well done!</strong>" : "") + '</p>' +
      '<div class="share-row">' +
      '<button class="btn" id="ov-replay">Replay</button>' +
      '<button class="btn" id="ov-levels">Levels</button>' +
      (n < LEVELS_PER_PACK ? '<button class="btn primary" id="ov-next-level">Next level</button>' : '') +
      '</div>' +
      '<button class="link-btn" id="ov-look">admire the board</button>');
    document.getElementById("ov-replay").addEventListener("click", function () { startLevel(size, n); });
    document.getElementById("ov-levels").addEventListener("click", function () { openPack(size); });
    var nx = document.getElementById("ov-next-level");
    if (nx) nx.addEventListener("click", function () { startLevel(size, n + 1); });
    document.getElementById("ov-look").addEventListener("click", hideOverlay);
  }
```

- [ ] **Step 5: In-game "won" controls for levels**

In `renderGame`, replace the two lines

```js
    document.getElementById("btn-won-home").addEventListener("click", goHome);
    document.getElementById("btn-won-next").addEventListener("click", function () { startNewGame(game.size); });
```

with:

```js
    var wonHome = document.getElementById("btn-won-home"), wonNext = document.getElementById("btn-won-next");
    if (game.mode === "level") {
      var lvSize = game.size, lvN = game.level;
      wonHome.textContent = "Levels";
      wonHome.addEventListener("click", function () { openPack(lvSize); });
      wonNext.textContent = "Next level";
      wonNext.hidden = lvN >= LEVELS_PER_PACK;
      wonNext.addEventListener("click", function () { startLevel(lvSize, lvN + 1); });
    } else {
      wonHome.addEventListener("click", goHome);
      wonNext.addEventListener("click", function () { startNewGame(game.size); });
    }
```

- [ ] **Step 6: Star styles**

Append to the LEVEL PACKS block in `style.css`:

```css
.win-stars { display: flex; justify-content: center; gap: var(--s2); font-size: 40px; line-height: 1; margin: var(--s1) 0 var(--s2); }
.win-star { color: var(--rule-line); }
.win-star.on { color: var(--amber); animation: starPop 0.45s ease both; }
@keyframes starPop {
  0%   { transform: scale(0) rotate(-30deg); opacity: 0; }
  70%  { transform: scale(1.25) rotate(8deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}
```

- [ ] **Step 7: Verify in the browser**

With the preview running at 375×812, clear the service worker and caches and reload, as in Task 4 Step 8. Then check three scenarios.

**A — clean solve = 3 stars, unlocks level 2, no free-play stats:**

```js
const statsBefore = localStorage.getItem('tictaclogic.stats');
document.getElementById('levels-card').click();
document.querySelector('.pack-btn[data-size="6"]').click();
document.querySelector('.level-btn[data-n="1"]').click();
await new Promise(r => setTimeout(r, 200));
// fill every empty cell with the solver's answer by tapping (1 tap = X, 2 = O)
const n = 6, cells = [...document.querySelectorAll('#board .cell')];
const g = Int8Array.from(cells.map(c => c.textContent === 'X' ? 1 : c.textContent === 'O' ? 2 : 0));
const sol = solve(g, n, { maxTrialDepth: 0 }).grid;
cells.forEach((c, i) => { if (!g[i]) { c.click(); if (sol[i] === 2) c.click(); } });
await new Promise(r => setTimeout(r, 1500));
[document.getElementById('overlay-panel').innerText.replace(/\n+/g, ' | '),
 localStorage.getItem('tictaclogic.levels'),
 'stats unchanged: ' + (localStorage.getItem('tictaclogic.stats') === statsBefore)]
```

Expected: the overlay shows `Level 1 done!` with 3 lit stars, "★ no hints" and "★ no mistakes"; storage holds `{"6":{"1":{"stars":3,"bestMs":…}}}`; `stats unchanged: true`. Screenshot the win card to check the star animation looks right.

**B — a hint costs a star; a replay never lowers it:**

```js
document.getElementById('ov-replay').click();
await new Promise(r => setTimeout(r, 200));
document.getElementById('btn-hint').click(); // stage 1 counts as a hint
const n = 6, cells = [...document.querySelectorAll('#board .cell')];
const g = Int8Array.from(cells.map(c => c.querySelector('.ghost') ? 0 : c.textContent === 'X' ? 1 : c.textContent === 'O' ? 2 : 0));
const sol = solve(g, n, { maxTrialDepth: 0 }).grid;
cells.forEach((c, i) => { if (!g[i]) { c.click(); if (sol[i] === 2) c.click(); } });
await new Promise(r => setTimeout(r, 1500));
[document.querySelectorAll('#overlay-panel .win-star.on').length, JSON.parse(localStorage.getItem('tictaclogic.levels'))['6']['1'].stars]
```

Expected: `[2, 3]` (2 stars this time, stored best stays 3).

**C — a seen rule break costs a star; the quick X-on-the-way-to-O doesn't:**

```js
document.getElementById('ov-next-level').click(); // level 2 (unlocked by level 1)
await new Promise(r => setTimeout(r, 200));
const n = 6, cells = [...document.querySelectorAll('#board .cell')];
const g = Int8Array.from(cells.map(c => c.textContent === 'X' ? 1 : c.textContent === 'O' ? 2 : 0));
const sol = solve(g, n, { maxTrialDepth: 0 }).grid;
// a quick double-tap to O on a cell whose answer is O (passes through X) — must NOT count
const quick = cells.findIndex((c, i) => !g[i] && sol[i] === 2);
cells[quick].click(); cells[quick].click();
await new Promise(r => setTimeout(r, 900));
// now leave a WRONG mark long enough for the flag to fire, if that breaks a rule
const wrong = cells.findIndex((c, i) => { if (g[i] || i === quick) return false; const t = Int8Array.from(g); t[quick] = 2; t[i] = 3 - sol[i]; return findViolations(t, n).has(i); });
if (wrong >= 0) { cells[wrong].click(); if (sol[wrong] === 1) cells[wrong].click(); await new Promise(r => setTimeout(r, 900)); /* clear it: a wrong X (sol O) needs 2 taps, a wrong O needs 1 */ cells[wrong].click(); if (sol[wrong] === 2) cells[wrong].click(); }
// clear `wrong` back to empty, then finish correctly
const now = Int8Array.from(cells.map(c => c.textContent === 'X' ? 1 : c.textContent === 'O' ? 2 : 0));
cells.forEach((c, i) => { if (!now[i]) { c.click(); if (sol[i] === 2) c.click(); } });
await new Promise(r => setTimeout(r, 1500));
['wrong cell used: ' + wrong, document.querySelectorAll('#overlay-panel .win-star.on').length, document.getElementById('overlay-panel').innerText.includes('flagged')]
```

Expected: if `wrong >= 0`, then `[…, 2, true]` (a flag was seen); if `wrong === -1`, then `[…, 3, false]`. Either way the quick double-tap did not cost a star. Then click **Levels** and confirm level 1 shows ★★★, level 2 shows its stars, and level 3 is highlighted as next.

Also run: `node tests/levels.test.js` → `1298 passed, 0 failed`; `node tests/hint.test.js` → `28 passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add ui.js style.css
git commit -m "Award gold stars on levels; unlock next level; level win card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final check

**Files:** none new (fixes only if something fails).

- [ ] **Step 1: Run every quick suite**

Run: `node tests/board.test.js; node tests/solver.test.js; node tests/hint.test.js; node tests/noguess.test.js; node tests/levels.test.js`
Expected: each ends with `0 failed`.

Run `node tests/generator.test.js` with `run_in_background` (it takes minutes), and wait for `generator.test.js: 11 passed, 0 failed`.

- [ ] **Step 2: Offline and version check in the browser**

With the preview at 375×812, after the reload that activates v6:

```js
[await caches.keys(), !!(await caches.match('levels.js')), !!(await caches.match('progress.js'))]
```

Expected: `[["tictaclogic-v6"], true, true]`. Then open **Settings** and confirm Version shows `v6`.

- [ ] **Step 3: Regression pass on free play**

Start a free-play 6×6 from the home screen. Confirm the badge says `needs: …` (not "Level"), one tap places one X, and Hint still works. Press ‹ Home and confirm the Continue card shows the free-play text. Then check dark mode (Settings → Dark mode) on the pack screen and the level win card; take a screenshot.

- [ ] **Step 4: Clean up and report**

Stop the preview server and reset the viewport. Confirm no `node tests/*` processes are still running. Report the results to the user and ask whether to push to `main`. Do not push without a yes.

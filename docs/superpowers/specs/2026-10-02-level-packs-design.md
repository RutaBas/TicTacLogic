# Level Packs — Design

**Date:** 2026-10-02
**Status:** Approved in brainstorming, awaiting spec review

## Files

| File | Change |
|------|--------|
| `generator.js` | add `{ maxTier }` technique-cap option to `carvePuzzle` |
| `tools/build-levels.js` | new: builds `levels.js` once, deterministically |
| `levels.js` | new, generated: 200 clue strings |
| `progress.js` | new: pure star/unlock/merge helpers |
| `ui.js` | Levels + Pack screens, level play mode, star tracking, win card |
| `style.css` | level grid, star, lock styles |
| `index.html`, `sw.js` | load and cache the new files; cache v6 |
| `tests/levels.test.js` | new: level data + progress helper checks |

## Goal

Make Tic-Tac-Logic more engaging with a progression of fixed, numbered levels
(like Bullpen / Angry Bulls level packs), while keeping today's free play.

## Summary

- Free play is unchanged: the five grid sizes (6×6, 8×8, 10×10, 12×12, 14×14),
  each a freshly generated, logic-only puzzle.
- New: one **level pack per grid size**, 40 fixed levels each (200 total).
- Each pack ramps through four themed tiers, 10 levels each:

  | Levels | Tier        | Techniques allowed (and required)                    |
  |--------|-------------|------------------------------------------------------|
  | 1–10   | Doodle      | T1 sandwich / pair only                              |
  | 11–20  | Homework    | T1–T2; needs T2 (a full row/column count)            |
  | 21–30  | Pop Quiz    | T1–T3; needs T3 (line completions)                   |
  | 31–40  | Final Exam  | T1–T4; needs T4 (the uniqueness rule)                |

- No level ever needs trial and error (T5).
- Within a pack, levels unlock sequentially: solving level N unlocks N+1.
  All five packs are open from the start.
- Each level awards up to 3 gold stars: ★ solved, ★ no hints, ★ no mistakes.

## 1. Screens and flow

**Start screen** (top to bottom): Continue card (when a save exists) →
**Levels** card → "New puzzle" free-play size list (unchanged) → footer.
The first-run "Learn to play" card stays where it is.

**Levels screen:** five pack cards, one per size. Each shows the size, stars
earned out of 120, and levels solved out of 40. Has a ‹ Home button.

**Pack screen:** title "6 × 6 levels", ‹ Levels back button, then four labelled
sections (Doodle, Homework, Pop Quiz, Final Exam), each a grid of 10 numbered
level buttons (tap targets ≥ 44px):
- solved: number + its stars (filled/empty)
- next playable: highlighted
- locked: greyed, lock glyph, not tappable

**Playing a level:** same board, controls, hints and deferred mistake flags as
free play. The HUD badge reads `6 × 6 · Level 12 · Homework` instead of
`needs: …`. ‹ Home returns to the start screen (saving the level in progress).

**Winning a level:** the existing win animation, then a win card with a
gold-star reveal (the 3 stars, earned ones lit), the time, and buttons
**Next level** (primary; hidden on level 40), **Replay**, **Levels**, plus the
"admire the board" link. After closing the card, the in-game "won" controls
offer **Levels** and **Next level**.

## 2. Building the levels (frozen data)

**`tools/build-levels.js`** (run manually with `node tools/build-levels.js`)
writes **`levels.js`**. The game never generates levels at runtime.

For each size and tier k (1–4):
1. Deterministic seeds: `seedFor` over the string
   `"level-" + size + "-tier-" + k + "-cand-" + c` (via `hashString`).
2. Build a complete grid (`buildCompleteGrid`), then carve with a technique cap:
   a clue is removed only if pure deduction limited to tiers ≤ k still
   completes the board (`propagate(grid, size, k)` reaches a complete,
   valid grid). This keeps the board uniquely solvable.
3. Accept the candidate only if the full solver at depth 0 reports
   `maxTier === k`, so the level genuinely needs that tier's top technique.
4. Collect accepted candidates until there are at least 25 (cap the attempts
   and fail loudly if a size/tier can't reach 10). Drop duplicates (same clue
   string).
5. Pick 10: sort by clue count, descending (more clues = easier), and take an
   evenly spaced selection so the section ramps from easier to harder. Ties
   are broken by clue string, so the output is deterministic.

The generator gains a technique-cap option on carving
(`carvePuzzle(solution, size, rand, { maxTier })`). The default stays logic-only
T1–T4, so free play is unchanged.

**`levels.js` format** (dual-use like the other modules):

```js
const LEVELS_VERSION = 1;
const LEVELS = {
  6:  ["6:X..O....", /* … 40 clue strings, level 1 first … */],
  8:  [ /* 40 */ ],
  // 10, 12, 14
};
```

It stores only clue strings (`gridToString`, about 30 KB in total). At level
start the solution comes from `solve(clues, size, { maxTrialDepth: 0 })`,
which takes milliseconds. The tier of level n is `TIERS[Math.floor((n - 1) / 10)]`.

## 3. Progress, stars, saving

**Storage key `tictaclogic.levels`:**

```js
{ "6": { "12": { stars: 2, bestMs: 81234 }, ... }, "8": { ... } }
```

- A level is solved iff it has an entry. Level n is unlocked iff n === 1 or
  level n−1 is solved.
- On a win, the new entry is `stars = max(old, new)` and
  `bestMs = min(old, new)`; replays never lower anything.

**Per-attempt tracking** (on the game object, saved with the in-progress game):
- `hintsUsed` (already exists): any Hint press, including the stage-1 nudge,
  costs the "no hints" star.
- `mistakes`: incremented when the rule-violation flag actually fires (the
  deferred `updateViolations` adds a newly bad cell), or when Hint points out
  a wrong mark. The quick X on the way to O does not count, because the flag
  is deferred until the player pauses.
- Restart resets both counters (a fresh attempt). Clear does not.

**Stars:** 1 for solving, +1 if `hintsUsed === 0`, +1 if `mistakes === 0`.

**In-progress save:** the existing `tictaclogic.saveState` gains
`mode: "level" | "free"`, plus `level` (n) and `mistakes`. The Continue card
shows `6 × 6 · Level 12 · Homework · 1:04` for levels. Starting another game
abandons the save as today.

**Stats separation:** level games do not call `recordPlayed`, `recordAbandon`
or `recordWin`, so free-play stats, streaks and best times only reflect free
play.

**Offline / update:** add `levels.js` and `progress.js` to the service-worker
`SHELL` and to `index.html` (after `generator.js`, before `ui.js`); bump
`CACHE_NAME` to `tictaclogic-v6`.

**Error handling:** if `LEVELS` is missing or a size has fewer than 40 entries,
hide the Levels card (and that pack) instead of crashing. If a level's clues
fail to solve at start (corrupt data), show the existing "Hmm." overlay with
a Back button.

## 4. Testing

New **`tests/levels.test.js`** (fast; no generation):
- `LEVELS` has 40 entries for each of 6, 8, 10, 12, 14.
- Every level: `solve(depth 0)` solves it (logic-only, unique), and its
  `maxTier` equals the tier of its section.
- No duplicate clue strings across all 200 levels.
- Within each 10-level section, clue counts never increase.

Determinism check: running `tools/build-levels.js` twice produces a
byte-identical `levels.js` (done when building; documented in the script
header).

Existing suites (board, solver, hint, noguess, generator) must keep passing.

The star/progress logic lives in a new pure, headless module **`progress.js`**
(dual-use like `board.js`; it is not in `ui.js`, because `ui.js` exits early
without a DOM). It exports `tierOf(n)`, `computeStars(hintsUsed, mistakes)`,
`mergeResult(old, stars, ms)` and `isUnlocked(packProgress, n)`, all
unit-tested in `tests/levels.test.js`.

## Out of scope

- Daily challenge, extra packs beyond 40, pack-level unlocking, time-based
  stars, cloud sync.

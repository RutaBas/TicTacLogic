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

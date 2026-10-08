/* progress.js — level-pack rules: tiers, stars, unlocking, merging results.
 *
 * Pure and headless (no DOM, no storage), so tests can run it in node; ui.js
 * does the storage. See board.js for the dual-use (browser <script> + node
 * require) convention — these names become browser globals.
 *
 * A "pack" is one grid size's progress: { "1": {stars, bestMs}, ... }. A level
 * is solved iff it has an entry. The four sections of a pack are independent.
 *
 * Stored progress is { v: 2, "6": pack, "8": pack, ... }. Progress saved before
 * v2 (40 levels per pack) has no `v`; migrateProgressV1 moves each result to
 * the new number of the same board (levels.js LEVELS_V1_MAP).
 */

const TIER_NAMES = ["Doodle", "Homework", "Pop Quiz", "Final Exam"];
const LEVELS_PER_TIER = 50;
const LEVELS_PER_PACK = TIER_NAMES.length * LEVELS_PER_TIER; // 200

/** Tier index 0..3 of level n (1-based). Level n needs technique tier tierOf(n) + 1. */
function tierOf(n) {
  return Math.floor((n - 1) / LEVELS_PER_TIER);
}

function tierName(n) {
  return TIER_NAMES[tierOf(n)];
}

/** First level number of level n's section (1, 51, 101, 151). */
function sectionStart(n) {
  return tierOf(n) * LEVELS_PER_TIER + 1;
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

/**
 * Sections are independent: each one's first level is always open. Within a
 * section, every level up to one past the furthest solved level is open, so
 * levels skipped over (e.g. gaps left by migrating v1 progress) stay playable.
 */
function isUnlocked(pack, n) {
  const start = sectionStart(n);
  if (n === start) return true;
  if (!pack) return false;
  for (let m = n - 1; m < start + LEVELS_PER_TIER; m++) {
    if (pack[m]) return true;
  }
  return false;
}

/**
 * v1 -> v2 progress. map[size][k] is the v2 number of v1 level k+1 (same
 * board). Results for sizes or levels the map doesn't know are dropped.
 */
function migrateProgressV1(all, map) {
  const out = { v: 2 };
  for (const size of Object.keys(all || {})) {
    if (size === "v" || !map[size]) continue;
    const oldPack = all[size] || {}, pack = {};
    for (const k of Object.keys(oldPack)) {
      const nn = map[size][k - 1];
      if (nn) pack[nn] = oldPack[k];
    }
    out[size] = pack;
  }
  return out;
}

/** v2 number of a v1 level (for a game saved mid-level before the update). */
function remapLevelV1(map, size, n) {
  return (map[size] && map[size][n - 1]) || n;
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
    tierOf, tierName, sectionStart, computeStars, mergeResult, isUnlocked, packSummary,
    migrateProgressV1, remapLevelV1,
  };
}

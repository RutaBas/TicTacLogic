/* tests/generator.test.js — Step 3 verification points 3, 4, 5.
 * Run: node tests/generator.test.js
 *
 * Generates one batch of 200 puzzles per size and reuses it: the first 100 feed
 * the uniqueness check (point 3), all 200 feed the label/distribution check
 * (point 4). Seeding (point 5) is checked separately.
 */
const B = require("../board.js");
const S = require("../solver.js");
const G = require("../generator.js");

const SIZES = [6, 8, 10, 12, 14];
const N = 200;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error("  FAIL: " + msg); } }

// Generate the batches once (deterministic, on-demand by id).
console.log(`Generating ${N} puzzles per size (${SIZES.join(", ")})...`);
const batches = {};
const genStart = Date.now();
for (const size of SIZES) {
  const t = Date.now();
  const arr = [];
  for (let id = 0; id < N; id++) arr.push(G.generatePuzzleById(size, id));
  batches[size] = arr;
  console.log(`  size ${size}: ${N} puzzles in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
console.log(`  (total generation ${((Date.now() - genStart) / 1000).toFixed(1)}s)\n`);

/* ================================================================ *
 * POINT 3 — uniqueness: countSolutions(puzzle, 2) === 1 for 100/size.
 * ================================================================ */
console.log("Verification point 3: uniqueness (countSolutions == 1), 100 per size");
for (const size of SIZES) {
  let uniq = 0;
  for (let id = 0; id < 100; id++) {
    if (S.countSolutions(batches[size][id].clues, size, 2) === 1) uniq++;
  }
  console.log(`  size ${size}: ${uniq}/100 unique  (${100 - uniq} non-unique)`);
  ok(uniq === 100, `size ${size}: all 100 puzzles uniquely solvable`);
}

/* ================================================================ *
 * POINT 4 — label accuracy + distribution (200 per size).
 *   (a) deterministic label: solving the same puzzle twice => same maxTier
 *   (b) every puzzle gets a label: solver completes 200/200 at every size
 *   + informational size x tier distribution table
 * ================================================================ */
console.log("\nVerification point 4: labels + distribution (200 per size)");
const TIERS = [1, 2, 3, 4, 5];
const dist = {};
let labeledAll = true, deterministicAll = true;
for (const size of SIZES) {
  dist[size] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const p of batches[size]) {
    const a = S.solve(p.clues, size);
    const b = S.solve(p.clues, size);
    if (!a.solved) labeledAll = false;
    if (a.maxTier !== b.maxTier || a.maxTier !== p.maxTier) deterministicAll = false;
    if (a.solved) dist[size][a.maxTier]++;
  }
}
ok(labeledAll, "every puzzle solved & labeled (solver completes 200/200 at every size)");
ok(deterministicAll, "labels are deterministic (same puzzle -> same maxTier, twice)");

// distribution table
const pad = (s, w) => String(s).padStart(w);
console.log("\n  size x max-tier distribution (informational — nothing regenerated on it):");
console.log("   size |" + TIERS.map((t) => pad("T" + t, 6)).join("") + pad("total", 8));
console.log("   -----+" + "-".repeat(6 * TIERS.length + 8));
for (const size of SIZES) {
  const row = TIERS.map((t) => pad(dist[size][t], 6)).join("");
  const total = TIERS.reduce((s, t) => s + dist[size][t], 0);
  console.log("   " + pad(size, 4) + " |" + row + pad(total, 8));
}

/* ================================================================ *
 * POINT 5 — seeding: non-linear seedFor + distinct boards.
 * ================================================================ */
console.log("\nVerification point 5: seeding");
{
  const seeds = [];
  for (let id = 1; id <= 20; id++) seeds.push(G.seedFor(10, id, 0));
  // consecutive differences must not all be equal (i.e. not an arithmetic seq)
  const diffs = [];
  for (let i = 1; i < seeds.length; i++) diffs.push(seeds[i] - seeds[i - 1]);
  const allEqual = diffs.every((d) => d === diffs[0]);
  ok(!allEqual, "seedFor(1..20) consecutive differences are NOT all equal (non-linear)");
  // values spread across the 32-bit range: cover multiple high-bit buckets
  const buckets = new Set(seeds.map((s) => Math.floor((s >>> 0) / (2 ** 32 / 8))));
  console.log(`  seedFor(1..20): ${buckets.size}/8 32-bit octiles covered`);
  ok(buckets.size >= 5, "seeds spread across the 32-bit range (>=5 of 8 octiles)");

  // 200 puzzles at one size from different ids -> 200 distinct boards
  const size = 10;
  const sigs = new Set(batches[size].map((p) => B.gridToString(p.clues, size)));
  console.log(`  size ${size}: ${sigs.size}/${N} distinct clue-boards`);
  ok(sigs.size === N, `all ${N} boards distinct at size ${size}`);
  // also distinct solutions
  const solSigs = new Set(batches[size].map((p) => B.gridToString(p.solution, size)));
  ok(solSigs.size === N, `all ${N} solutions distinct at size ${size}`);
}

console.log(`\ngenerator.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

# Daily Challenge — Design

**Date:** 2026-10-08 · **Status:** approved by the user in chat

## Puzzle
- One daily puzzle per local calendar day. The size rotates by day index from the epoch `2026-10-08`: 10×10, 12×12, 14×14, then repeats.
- Generated on the device, deterministically: `generatePuzzle(size, mulberry32(hashString("daily-" + key)))`, where `key` is `YYYY-MM-DD`. The puzzle is logic-only (the free-play generator) and the same for everyone on the same version.
- The day rolls over at local midnight. A game started on a day stays that day's puzzle.
- Known trade-off: if a future update changes the generator, a day's daily puzzle may change for someone who updates mid-day.

## Records and streak (`tictaclogic.daily`)
- Records are stored as `{ "2026-10-08": { stars, bestMs, onTime } }`.
- `onTime` is true when the attempt was started on the puzzle's own day. Once true, it stays true. Replays only raise `stars` and only lower `bestMs`.
- **Current streak:** consecutive `onTime` days ending today. If today is not yet solved, the streak ends yesterday.
- **Best streak:** the longest run of consecutive `onTime` days.
- Past days can be played from the calendar, but they never repair a streak. No days before the epoch exist, and future days cannot be played.
- Stars use `computeStars(hintsUsed, mistakes)`. Dailies never touch free-play or level stats.

## UI
- **Home:** a Daily card under Continue. It shows the date, the size and the streak. When today's puzzle is solved, it shows "Solved ✓ · new puzzle tomorrow" instead.
- **Daily screen:**
  - today's button and the current and best streak;
  - a Monday-first month calendar with month paging, which cannot go before the epoch month or after the current month.
  - Day cells: a red ✓ for a day solved on the day, a light ✓ for a day solved later, a playable blank for a missed day, and a greyed cell for a future day.
- **Game:** mode `"daily"`. The badge reads `Daily · Thu 8 Oct · 12 × 12`. Save and Continue carry `dailyKey` and `startedKey`.
- **Win card:** stars, time and streak. Share copies `Tic-Tac-Logic Daily · Thu 8 Oct · 12×12 · 3:41 · ★★★ 🔥4` plus the emoji grid. Buttons: Calendar, Home, and "admire the board".

## Code
- A new pure, dual-use module `daily.js`:
  - `DAILY_EPOCH`, `DAILY_SIZES`;
  - date helpers `dateKey`, `parseKey`, `addDays`, `dayIndex`;
  - `dailySize`, `dailyPuzzle`;
  - `recordDaily`, `currentStreak`, `bestStreak`, `monthGrid`.
- It is loaded after `generator.js`. `ui.js` adds the screen, the mode and the win card. Service worker cache becomes **v8**.

## Tests (`tests/daily.test.js`)
- The same date always gives the same puzzle.
- Sizes rotate 10/12/14 from the epoch.
- 30 consecutive dailies are logic-only and uniquely solvable.
- Date math holds across month, year and DST boundaries.
- Streaks: gaps break them, late solves don't count, today unsolved doesn't break them, and best streak is correct.
- `recordDaily` merging keeps the best result.
- `monthGrid` uses a Monday-first layout.

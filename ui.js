/* ui.js — Tic-Tac-Logic UI: start screen, board rendering, tap interaction.
 *
 * Runs only in the browser. Uses the ambient globals from board.js / solver.js /
 * generator.js (earlier <script> tags), so there is no require() here.
 *
 * STEP 4 scope: start screen + size selection + board UI + tap-to-cycle + HUD +
 * timer + core controls. Live violation highlighting and rich hint reasons come
 * in step 5; the full celebratory win flow, auto-save, and stats come in step 6.
 * Hooks for those are marked below.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return; // headless (node tests) — nothing to do

  /* ---- namespaced storage ---- */
  var KEY_COUNTERS = "tictaclogic.counters";
  var KEY_SAVE = "tictaclogic.saveState";
  var KEY_STATS = "tictaclogic.stats";
  var KEY_SETTINGS = "tictaclogic.settings";
  var KEY_LEVELS = "tictaclogic.levels"; // { "6": { "12": {stars, bestMs} } }

  function lsGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

  /* settings (full Settings UI is step 8; sensible defaults honored now) */
  function getSettings() {
    var s = lsGet(KEY_SETTINGS, {});
    return {
      sound: s.sound !== false,
      haptics: s.haptics !== false,
      dark: s.dark === true,
    };
  }

  /* ---- stats: per size (played/completed/best/avg/streak) + per technique ---- */
  function getStats() {
    var s = lsGet(KEY_STATS, null);
    if (!s) s = { bySize: {}, byLabel: {} };
    if (!s.bySize) s.bySize = {};
    if (!s.byLabel) s.byLabel = {};
    return s;
  }
  function sizeStat(s, size) {
    if (!s.bySize[size]) s.bySize[size] = { played: 0, completed: 0, bestMs: 0, sumMs: 0, streak: 0 };
    return s.bySize[size];
  }
  function labelStat(s, label) {
    if (!s.byLabel[label]) s.byLabel[label] = { completed: 0, bestMs: 0, sumMs: 0 };
    return s.byLabel[label];
  }
  function recordPlayed(size) {
    var s = getStats(); sizeStat(s, size).played += 1; lsSet(KEY_STATS, s);
  }
  function recordAbandon(size) {
    var s = getStats(); sizeStat(s, size).streak = 0; lsSet(KEY_STATS, s);
  }
  function recordWin(size, label, ms) {
    var s = getStats();
    var ss = sizeStat(s, size);
    ss.completed += 1; ss.sumMs += ms; ss.streak += 1;
    if (!ss.bestMs || ms < ss.bestMs) ss.bestMs = ms;
    var ls = labelStat(s, label);
    ls.completed += 1; ls.sumMs += ms;
    if (!ls.bestMs || ms < ls.bestMs) ls.bestMs = ms;
    lsSet(KEY_STATS, s);
    return ss; // for the win screen (best time etc.)
  }

  /** Per-size rolling puzzle id, so "new puzzle" keeps serving fresh boards. */
  function nextId(size) {
    var c = lsGet(KEY_COUNTERS, {});
    var id = (c[size] || 0);
    c[size] = id + 1;
    lsSet(KEY_COUNTERS, c);
    return id;
  }

  /* ---- level packs (rules live in progress.js; data in levels.js) ---- */
  function getLevelProgress() {
    var all = lsGet(KEY_LEVELS, {});
    // saved before levels v2 (40 per pack): move each result to the new number
    // of the same board, once, and stamp it so this never runs again
    if (!all.v && typeof LEVELS_V1_MAP !== "undefined") {
      all = migrateProgressV1(all, LEVELS_V1_MAP);
      lsSet(KEY_LEVELS, all);
    }
    return all;
  }
  /** A level game saved mid-play before levels v2 carries a v1 level number. */
  function migrateSave(save) {
    if (save && save.mode === "level" && !save.levelsV && typeof LEVELS_V1_MAP !== "undefined") {
      save.level = remapLevelV1(LEVELS_V1_MAP, save.size, save.level);
      save.levelsV = LEVELS_VERSION;
      lsSet(KEY_SAVE, save);
    }
    return save;
  }
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

  var SIZES = [6, 8, 10, 12, 14];
  var FLAVOR = {
    6: "a coffee break",
    8: "a bus ride",
    10: "a lunch hour",
    12: "an evening",
    14: "a rainy Sunday",
  };

  /* ======================================================================= *
   * Current game state
   * ======================================================================= */
  var game = null;

  /* ======================================================================= *
   * Screens + overlay
   * ======================================================================= */
  function showScreen(name) {
    ["start-screen", "game-screen", "tutorial-screen", "levels-screen", "pack-screen", "daily-screen"].forEach(function (id) {
      document.getElementById(id).classList.toggle("active", id === name + "-screen");
    });
  }
  function showOverlay(html) {
    document.getElementById("overlay-panel").innerHTML = html;
    document.getElementById("overlay").classList.add("active");
  }
  function hideOverlay() {
    document.getElementById("overlay").classList.remove("active");
  }

  /* ======================================================================= *
   * START SCREEN
   * ======================================================================= */
  function renderStart() {
    var save = migrateSave(lsGet(KEY_SAVE, null));
    var el = document.getElementById("start-screen");
    var html = "";
    html += '<h1 class="title">Tic-Tac-Logic</h1>';
    html += '<p class="tagline">two marks, one answer</p>';

    // decorative X O O X strip (also demonstrates the no-triple rule)
    html += '<div class="deco-strip">' +
      '<div class="cell x"><span class="mark">X</span></div>' +
      '<div class="cell o"><span class="mark">O</span></div>' +
      '<div class="cell o"><span class="mark">O</span></div>' +
      '<div class="cell x"><span class="mark">X</span></div>' +
      '</div>';

    // Continue card — only when a save exists (populated in step 6)
    if (save && save.cells) {
      var mins = Math.floor((save.elapsedMs || 0) / 60000);
      var secs = Math.floor(((save.elapsedMs || 0) % 60000) / 1000);
      var t = mins + ":" + (secs < 10 ? "0" : "") + secs;
      var what = save.mode === "level"
        ? "Level " + save.level + " · " + tierName(save.level)
        : save.mode === "daily" ? "Daily · " + fmtDay(save.dailyKey)
        : "needs: " + (save.label || "logic");
      html += '<div class="continue-card" id="continue-card">' +
        '<div><div class="cc-main">Continue</div>' +
        '<div class="cc-sub">' + save.size + " × " + save.size + " · " + what + " · " + t + '</div></div>' +
        '<div class="cc-arrow">→</div></div>';
    }

    if (hasDaily()) {
      var today = dateKey(new Date()), drec = getDaily();
      var dStreak = currentStreak(drec, today), dSize = dailySize(today);
      var tday = parseKey(today);
      // a tear-off calendar tile gives the daily its own look on the home screen
      html += '<div class="daily-card" id="daily-card">' +
        '<div class="dc-tile" aria-hidden="true">' +
        '<span class="dc-mon">' + tday.toLocaleDateString("en-GB", { month: "short" }) + '</span>' +
        '<span class="dc-day">' + tday.getDate() + '</span></div>' +
        '<div class="card-text"><div class="lc-main">Daily puzzle</div>' +
        '<div class="lc-sub">' + fmtDay(today) + " · " +
        (drec[today] ? "solved ✓ · new one tomorrow" : dSize + " × " + dSize) +
        (dStreak ? " · 🔥 " + dStreak : "") + '</div></div>' +
        '<div class="cc-arrow">→</div></div>';
    }

    // first-timers get a friendly way into the tutorial
    if (!lsGet(KEY_TUTORIAL, false)) {
      // a pencilled sticky note — deliberately unlike the gold Daily card
      html += '<div class="learn-card" id="learn-card">' +
        '<div class="lc-badge" aria-hidden="true">?</div>' +
        '<div class="card-text"><div class="lc-main">New here? Learn to play</div>' +
        '<div class="lc-sub">a 2-minute walkthrough of the three rules</div></div>' +
        '<div class="cc-arrow">→</div></div>';
    }

    var packs = SIZES.filter(hasLevels);
    if (packs.length) {
      var totSolved = 0, totStars = 0;
      packs.forEach(function (n) {
        var s = packSummary(packOf(n)); totSolved += s.solved; totStars += s.stars;
      });
      var totLevels = packs.length * LEVELS_PER_PACK;
      var pct = totSolved ? Math.max(2, Math.round(totSolved / totLevels * 100)) : 0;
      // solid red "campaign" card: star badge + progress through all levels
      html += '<div class="levels-card" id="levels-card">' +
        '<div class="lv-badge" aria-hidden="true">★</div>' +
        '<div class="card-text"><div class="lc-main">Levels</div>' +
        '<div class="lc-sub">' + totSolved + " / " + totLevels + " solved · ★ " + totStars + '</div>' +
        '<div class="lv-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div></div>' +
        '<div class="cc-arrow">→</div></div>';
    }

    html += '<div class="section-label on-paper">New puzzle</div>';
    html += '<div class="size-list">';
    SIZES.forEach(function (n) {
      html += '<div class="size-btn" data-size="' + n + '">' +
        '<span class="sb-size">' + n + " × " + n + '</span>' +
        '<span class="sb-flavor">' + FLAVOR[n] + '</span></div>';
    });
    html += '</div>';

    html += '<div class="footer">' +
      '<a data-modal="tutorial">How to play</a>' +
      '<a data-modal="rules">Rules</a>' +
      '<a data-modal="stats">Stats</a>' +
      '<a data-modal="settings">Settings</a></div>';

    el.innerHTML = html;

    // wire size buttons
    Array.prototype.forEach.call(el.querySelectorAll(".size-btn"), function (btn) {
      btn.addEventListener("click", function () { startNewGame(parseInt(btn.dataset.size, 10)); });
    });
    // continue
    var cc = document.getElementById("continue-card");
    if (cc) cc.addEventListener("click", continueSaved);
    var lc = document.getElementById("learn-card");
    if (lc) lc.addEventListener("click", function () { openTutorial(0); });
    var dc = document.getElementById("daily-card");
    if (dc) dc.addEventListener("click", openDaily);
    var lv = document.getElementById("levels-card");
    if (lv) lv.addEventListener("click", openLevels);
    // footer modals
    Array.prototype.forEach.call(el.querySelectorAll(".footer a"), function (a) {
      a.addEventListener("click", function () { openModal(a.dataset.modal); });
    });
  }

  /* ======================================================================= *
   * GENERATION + game load
   * ======================================================================= */
  function startNewGame(size) {
    // starting a fresh puzzle abandons any unfinished saved game (breaks its streak)
    var prev = lsGet(KEY_SAVE, null);
    if (prev && prev.cells && (prev.mode || "free") === "free") recordAbandon(prev.size);

    showOverlay('<div class="spinner">generating<span class="dot">.</span>' +
      '<span class="dot">.</span><span class="dot">.</span></div>' +
      '<p>drawing a fresh ' + size + " × " + size + ' grid</p>');
    // yield so the overlay paints before the (blocking) generation runs
    setTimeout(function () {
      var id = nextId(size);
      var puzzle;
      try {
        puzzle = generatePuzzleById(size, id);
      } catch (e) {
        showOverlay('<h2>Hmm.</h2><p>Could not generate a puzzle: ' + e +
          '</p><button class="btn" id="ov-dismiss">Back</button>');
        document.getElementById("ov-dismiss").addEventListener("click", function () {
          hideOverlay(); showScreen("start");
        });
        return;
      }
      recordPlayed(size);
      loadPuzzle(puzzle);
      hideOverlay();
      showScreen("game");
    }, 40);
  }

  function loadPuzzle(puzzle) {
    var state = createGameState(puzzle.size, puzzle.clues, puzzle.solution, {
      maxTier: puzzle.maxTier, id: puzzle.id, seed: puzzle.seed,
    });
    game = {
      state: state,
      size: puzzle.size,
      label: puzzle.label,
      maxTier: puzzle.maxTier,
      mode: puzzle.mode || "free",
      level: puzzle.level || null,
      dailyKey: puzzle.dailyKey || null,     // which day's puzzle (daily mode)
      startedKey: puzzle.startedKey || null, // the day the attempt began (streaks)
      moves: [],
      hintsUsed: 0,
      mistakes: 0,
      startTime: Date.now(),
      finalElapsedMs: 0,
      over: false,
    };
    startTimer();
    renderGame();
    saveGame(); // persist immediately so Continue works before the first move
  }

  /* ---- auto-save / restore ---- */
  function saveGame() {
    if (!game || game.over) return;
    lsSet(KEY_SAVE, {
      size: game.size, id: game.state.id, seed: game.state.seed,
      maxTier: game.maxTier, label: game.label,
      clues: gridToString(game.state.clues, game.size),
      cells: gridToString(game.state.cells, game.size),
      solution: gridToString(game.state.solution, game.size),
      elapsedMs: elapsedMs(),
      hintsUsed: game.hintsUsed || 0,
      mode: game.mode, level: game.level, mistakes: game.mistakes || 0,
      levelsV: typeof LEVELS_VERSION !== "undefined" ? LEVELS_VERSION : null,
      dailyKey: game.dailyKey, startedKey: game.startedKey,
      savedAt: Date.now(),
    });
  }
  function clearSave() { lsDel(KEY_SAVE); }

  /** Save only when the game is actually on screen. From a menu it was already
   *  saved on the way out, and re-saving would add menu time to its clock. */
  function saveIfPlaying() {
    if (document.getElementById("game-screen").classList.contains("active")) saveGame();
  }

  function continueSaved() {
    var save = migrateSave(lsGet(KEY_SAVE, null));
    if (!save || !save.cells) return;
    var clues = gridFromString(save.clues).grid;
    var solution = gridFromString(save.solution).grid;
    var state = createGameState(save.size, clues, solution,
      { maxTier: save.maxTier, id: save.id, seed: save.seed });
    state.cells = gridFromString(save.cells).grid;
    game = {
      state: state, size: save.size, label: save.label, maxTier: save.maxTier,
      mode: save.mode || "free", level: save.level || null,
      dailyKey: save.dailyKey || null, startedKey: save.startedKey || null,
      moves: [], hintsUsed: save.hintsUsed || 0, mistakes: save.mistakes || 0,
      startTime: Date.now() - (save.elapsedMs || 0), // resume the clock
      finalElapsedMs: 0, over: false,
    };
    startTimer();
    renderGame();
    showScreen("game");
  }

  /* ======================================================================= *
   * TIMER  (capture final elapsed BEFORE flipping `over`, per the known bug)
   * ======================================================================= */
  var timerHandle = null;
  function startTimer() {
    stopTimer();
    timerHandle = setInterval(updateTimerLabel, 500);
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }
  function elapsedMs() { return game.over ? game.finalElapsedMs : (Date.now() - game.startTime); }
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function updateTimerLabel() {
    var t = document.getElementById("hud-timer");
    if (t) t.textContent = fmtTime(elapsedMs());
  }

  /* ======================================================================= *
   * BOARD SIZING (responsive: fit the viewport, cap the cell size)
   * ======================================================================= */
  function applyBoardSizing(n) {
    var gutter = 24;
    var avail = Math.min(window.innerWidth - gutter * 2, 480);
    var gap = n <= 10 ? 3 : 2;
    var cell = Math.floor((avail - gap * (n + 1)) / n);
    cell = Math.max(18, Math.min(cell, 46));
    var root = document.documentElement.style;
    root.setProperty("--n", n);
    root.setProperty("--cell", cell + "px");
    root.setProperty("--gap", gap + "px");
    root.setProperty("--mark-font", Math.round(cell * 0.66) + "px");
  }
  window.addEventListener("resize", function () { if (game) applyBoardSizing(game.size); });

  /* ======================================================================= *
   * GAME SCREEN RENDER
   * ======================================================================= */
  function renderGame() {
    applyBoardSizing(game.size);
    var el = document.getElementById("game-screen");
    var counts = fillCounts(game.state);
    var html = "";

    html += '<div class="hud">';
    html += '<div class="hud-row">' +
      '<button class="home-btn" id="btn-home" aria-label="Home">‹ Home</button>' +
      '<span class="hud-title">Tic-Tac-Logic</span>' +
      '<span class="hud-timer" id="hud-timer">0:00</span></div>';
    var badge = game.mode === "level"
      ? game.size + " × " + game.size + " · Level " + game.level + " · " + game.label
      : game.mode === "daily"
      ? "Daily · " + fmtDay(game.dailyKey) + " · " + game.size + " × " + game.size
      : game.size + " × " + game.size + " · needs: " + game.label;
    html += '<div class="hud-badge">' + badge + '</div>';
    html += '<div class="hud-progress" id="hud-progress">' + counts.filled + " / " + counts.total + '</div>';
    html += '</div>';

    html += '<div class="board-wrap"><div class="board" id="board"></div></div>';
    html += '<div class="hint-reason" id="hint-reason"></div>';

    html += '<div class="controls" id="controls">' +
      '<button class="btn" id="btn-undo">Undo</button>' +
      '<button class="btn" id="btn-clear">Clear</button>' +
      '<button class="btn primary" id="btn-hint">Hint</button>' +
      '<button class="btn" id="btn-restart">Restart</button>' +
      '</div>';
    html += '<div class="controls" id="controls-won" hidden>' +
      '<button class="btn" id="btn-won-home">Home</button>' +
      '<button class="btn primary" id="btn-won-next">Next puzzle</button>' +
      '</div>';

    el.innerHTML = html;
    // The board element is created fresh above, so this is its ONE click
    // listener. (buildBoard() must never add one — Clear/Restart call it on the
    // same element, and stacked listeners made one tap cycle a cell 2-3 times.)
    document.getElementById("board").addEventListener("click", onBoardClick);
    buildBoard();
    updateTimerLabel();

    document.getElementById("btn-home").addEventListener("click", goHome);
    document.getElementById("btn-undo").addEventListener("click", undoMove);
    document.getElementById("btn-clear").addEventListener("click", clearBoard);
    document.getElementById("btn-hint").addEventListener("click", giveHint);
    document.getElementById("btn-restart").addEventListener("click", restartGame);
    var wonHome = document.getElementById("btn-won-home"), wonNext = document.getElementById("btn-won-next");
    if (game.mode === "level") {
      var lvSize = game.size, lvN = game.level;
      wonHome.textContent = "Levels";
      wonHome.addEventListener("click", function () { openPack(lvSize, tierOf(lvN)); });
      wonNext.textContent = "Next level";
      wonNext.hidden = lvN % LEVELS_PER_TIER === 0; // last level of its section
      wonNext.addEventListener("click", function () { startLevel(lvSize, lvN + 1); });
    } else if (game.mode === "daily") {
      wonHome.textContent = "Calendar";
      wonHome.addEventListener("click", openDaily);
      wonNext.hidden = true; // one puzzle a day
    } else {
      wonHome.addEventListener("click", goHome);
      wonNext.addEventListener("click", function () { startNewGame(game.size); });
    }
    refreshControls();
  }

  function goHome() {
    hideOverlay();
    clearTimeout(violationTimer);
    saveGame(); // no-op once the puzzle is won
    stopTimer();
    renderStart();
    showScreen("start");
  }

  function markSpan(v, animate) {
    if (v === EMPTY) return "";
    return '<span class="mark' + (animate ? " draw" : "") + '">' + (v === X ? "X" : "O") + "</span>";
  }
  function cellClass(i) {
    var v = game.state.cells[i];
    var cls = "cell";
    if (v === X) cls += " x";
    else if (v === O) cls += " o";
    if (game.state.clues[i] !== EMPTY) cls += " clue";
    return cls;
  }

  function buildBoard() {
    var board = document.getElementById("board");
    var n = game.size;
    var html = "";
    for (var i = 0; i < n * n; i++) {
      html += '<div class="' + cellClass(i) + '" data-i="' + i + '">' +
        markSpan(game.state.cells[i], false) + "</div>";
    }
    board.innerHTML = html;
    clearTimeout(violationTimer);
    prevBad = new Set();
    updateViolations();
  }

  /* ---- live rule-violation highlighting (never blocks input) ----
   * Tapping cycles EMPTY -> X -> O, so a player who wants O passes through X.
   * If that transient X broke a rule it used to flash as a mistake instantly.
   * Now, after a tap, newly-broken rules are only flagged once the player pauses
   * (VIOLATION_DELAY); rules that get FIXED clear immediately. */
  var VIOLATION_DELAY = 650;
  var violationTimer = null;
  function scheduleViolations() {
    clearTimeout(violationTimer);
    var bad = findViolations(game.state.cells, game.size);
    var board = document.getElementById("board");
    prevBad.forEach(function (i) {
      if (!bad.has(i)) {
        var n = board.querySelector('[data-i="' + i + '"]');
        if (n) n.classList.remove("bad");
        prevBad.delete(i);
      }
    });
    violationTimer = setTimeout(function () {
      if (game && document.getElementById("board")) updateViolations(true);
    }, VIOLATION_DELAY);
  }

  var prevBad = new Set();
  function updateViolations(countMistakes) {
    clearTimeout(violationTimer);
    var bad = findViolations(game.state.cells, game.size);
    var board = document.getElementById("board");
    // clear cells that are no longer offending
    prevBad.forEach(function (i) {
      if (!bad.has(i)) {
        var n = board.querySelector('[data-i="' + i + '"]');
        if (n) n.classList.remove("bad");
      }
    });
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

  function renderCell(i, animate) {
    var board = document.getElementById("board");
    var node = board.querySelector('[data-i="' + i + '"]');
    if (!node) return;
    node.className = cellClass(i);
    node.innerHTML = markSpan(game.state.cells[i], animate);
    prevBad.delete(i); // className reset dropped "bad"; let the next check re-flag it
  }

  /* ======================================================================= *
   * TAP INTERACTION — cycle EMPTY -> X -> O -> EMPTY (clues are locked)
   * ======================================================================= */
  function onBoardClick(e) {
    if (game.over) return;
    var node = e.target.closest(".cell");
    if (!node) return;
    var i = parseInt(node.dataset.i, 10);
    var r = rowOf(i, game.size), c = colOf(i, game.size);
    if (isClue(game.state, r, c)) return; // locked

    var prev = game.state.cells[i];
    // clear any prior hint highlight once the player acts (before re-rendering
    // the cell, so a ghost hint mark can't linger on it)
    clearHint();
    var next = cycleCell(game.state, r, c);
    game.moves.push({ i: i, prev: prev });
    renderCell(i, next !== EMPTY);

    updateProgress();
    refreshControls();
    saveGame();
    if (!checkWin()) scheduleViolations();
  }

  function updateProgress() {
    var counts = fillCounts(game.state);
    var p = document.getElementById("hud-progress");
    if (p) p.textContent = counts.filled + " / " + counts.total;
  }

  function refreshControls() {
    var u = document.getElementById("btn-undo");
    if (u) u.disabled = game.moves.length === 0 || game.over;
    var play = document.getElementById("controls"), won = document.getElementById("controls-won");
    if (play) play.hidden = game.over;
    if (won) won.hidden = !game.over;
    var h = document.getElementById("btn-hint");
    if (h) h.textContent = !hint ? "Hint" : hint.stage === 1 ? "Show cell" : hint.fix ? "Clear it" : "Fill it";
  }

  /* ======================================================================= *
   * CONTROLS
   * ======================================================================= */
  function undoMove() {
    if (game.over || game.moves.length === 0) return;
    clearHint();
    var m = game.moves.pop();
    game.state.cells[m.i] = m.prev;
    renderCell(m.i, false);
    updateProgress();
    refreshControls();
    updateViolations();
    saveGame();
  }

  function clearBoard() {
    if (game.over) return;
    clearHint();
    clearPlayerMarks(game.state);
    game.moves = [];
    buildBoard();
    updateProgress();
    refreshControls();
    saveGame();
  }

  function restartGame() {
    clearHint();
    clearPlayerMarks(game.state);
    game.moves = [];
    game.hintsUsed = 0;
    game.mistakes = 0;
    game.over = false;
    game.startTime = Date.now();
    startTimer();
    buildBoard();
    updateProgress();
    updateTimerLabel();
    refreshControls();
    saveGame();
  }

  /* ======================================================================= *
   * HINT — three presses, always about the SAME next logical step:
   *   1st  "nudge": highlight the clue cells / line and say where to look
   *   2nd  "show":  also mark the target cell with a faint ghost of the answer
   *   3rd  "fill":  write the mark in (an ordinary, undoable move)
   * Any tap on the board, Undo, Clear or Restart resets the sequence.
   * The step comes from solver.js nextHint(): simplest technique first, and
   * nearest the player's last move, so hints follow where they're working.
   * ======================================================================= */
  var hint = null; // { stage, i, mark, cells: [indices with hint classes], fix? }
  var HINT_CLASSES = ["hint", "hint-ev", "hint-line"];

  function cellNode(i) {
    var board = document.getElementById("board");
    return board && board.querySelector('[data-i="' + i + '"]');
  }
  function setHintText(t) {
    var hr = document.getElementById("hint-reason");
    if (hr) hr.textContent = t || "";
  }
  function clearHint() {
    if (hint) {
      hint.cells.forEach(function (i) {
        var n = cellNode(i);
        if (n) HINT_CLASSES.forEach(function (c) { n.classList.remove(c); });
      });
      var ghostAt = hint.ghost ? hint.i : -1;
      hint = null;
      // remove the ghost answer mark (and its x/o colour class), if one was drawn
      if (ghostAt !== -1) renderCell(ghostAt, false);
    }
    setHintText("");
    refreshControls();
  }
  function addHintClass(i, cls) {
    var n = cellNode(i);
    if (!n) return;
    if (cls === "hint") { n.classList.remove("hint"); void n.offsetWidth; } // restart the pulse
    n.classList.add(cls);
    if (hint.cells.indexOf(i) === -1) hint.cells.push(i);
  }

  /** Most recently placed player mark that disagrees with the solution, or -1. */
  function findWrongMark() {
    var cells = game.state.cells, sol = game.state.solution;
    for (var k = game.moves.length - 1; k >= 0; k--) {
      var i = game.moves[k].i;
      if (cells[i] !== EMPTY && cells[i] !== sol[i]) return i;
    }
    for (var j = 0; j < cells.length; j++) {
      if (game.state.clues[j] === EMPTY && cells[j] !== EMPTY && cells[j] !== sol[j]) return j;
    }
    return -1;
  }
  function lastMoveCell() {
    for (var k = game.moves.length - 1; k >= 0; k--) {
      if (game.state.cells[game.moves[k].i] !== EMPTY) return game.moves[k].i;
    }
    return null;
  }
  function cellName(i) {
    return "row " + (rowOf(i, game.size) + 1) + ", column " + (colOf(i, game.size) + 1);
  }

  function giveHint() {
    if (game.over) return;

    // continuing an active hint: escalate one stage
    if (hint) {
      if (hint.stage === 1) { showHintStage2(); return; }
      if (hint.stage === 2) { fillHint(); return; }
    }
    clearHint();
    updateViolations(true); // a hint should never wait on the deferred mistake flag

    // a mistake comes first: no deduction is trustworthy on top of a wrong mark
    var w = findWrongMark();
    if (w !== -1) {
      hint = { stage: 2, i: w, mark: EMPTY, cells: [], fix: true };
      game.hintsUsed = (game.hintsUsed || 0) + 1;
      game.mistakes = (game.mistakes || 0) + 1; // a wrong mark the player left in
      addHintClass(w, "hint");
      setHintText("The " + (game.state.cells[w] === X ? "X" : "O") + " at " + cellName(w) +
        " doesn't fit the solution. Press again to clear it.");
      refreshControls();
      return;
    }

    var h = nextHint(game.state.cells, game.size, lastMoveCell());
    if (!h) { setHintText("Nothing left to deduce."); return; }
    game.hintsUsed = (game.hintsUsed || 0) + 1;
    hint = { stage: 1, i: h.i, mark: h.mark, h: h, cells: [] };
    h.line.forEach(function (i) { addHintClass(i, "hint-line"); });
    h.evidence.forEach(function (i) { addHintClass(i, "hint-ev"); });
    if (h.kind === "trial") addHintClass(h.i, "hint-ev"); // the nudge says "the highlighted cell"
    setHintText(h.nudge);
    refreshControls();
    saveGame();
  }

  function showHintStage2() {
    hint.stage = 2;
    addHintClass(hint.i, "hint");
    var n = cellNode(hint.i);
    if (n && game.state.cells[hint.i] === EMPTY) {
      n.innerHTML = '<span class="mark ghost">' + (hint.mark === X ? "X" : "O") + "</span>";
      n.classList.add(hint.mark === X ? "x" : "o");
      hint.ghost = true;
    }
    setHintText(hint.h.reason);
    refreshControls();
  }

  function fillHint() {
    var i = hint.i, mark = hint.mark;
    clearHint();
    game.moves.push({ i: i, prev: game.state.cells[i] });
    game.state.cells[i] = mark; // EMPTY when clearing a mistake
    renderCell(i, mark !== EMPTY);
    updateProgress();
    refreshControls();
    saveGame();
    if (!checkWin()) updateViolations(true);
  }

  /* ======================================================================= *
   * WIN — minimal detection now; full celebration + stats land in step 6.
   * ======================================================================= */
  /** Returns true if this move won the game. */
  function checkWin() {
    if (!isComplete(game.state.cells)) return false;
    if (!isSolved(game.state.cells, game.size)) return false; // complete but with violations
    // capture final time BEFORE flipping `over` (getter returns frozen value after)
    game.finalElapsedMs = Date.now() - game.startTime;
    game.over = true;
    clearHint();
    clearTimeout(violationTimer);
    stopTimer();
    updateTimerLabel();
    refreshControls();
    clearSave();

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

    if (game.mode === "daily") {
      // dailies keep their own records and never touch free-play stats
      var dStars = computeStars(game.hintsUsed || 0, game.mistakes || 0);
      var onTime = game.startedKey === game.dailyKey;
      var recs = getDaily();
      var dBefore = recs[game.dailyKey] || null;
      lsSet(KEY_DAILY, recordDaily(recs, game.dailyKey, onTime, dStars, game.finalElapsedMs));
      setTimeout(function () { if (game && game.over) showDailyWinOverlay(dStars, onTime, dBefore); }, 720);
      return true;
    }

    var ss = recordWin(game.size, game.label, game.finalElapsedMs);
    setTimeout(function () { if (game && game.over) showWinOverlay(ss); }, 720); // let the stroke land first
    return true;
  }

  /* the biggest moment: a red-pencil slash animates across the completed grid */
  function drawWinStroke() {
    var board = document.getElementById("board");
    if (!board) return;
    var w = board.clientWidth, h = board.clientHeight;
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "win-stroke");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    var path = document.createElementNS(NS, "path");
    path.setAttribute("class", "win-path");
    path.setAttribute("d", "M " + (w * 0.05) + " " + (h * 0.84) +
      " C " + (w * 0.3) + " " + (h * 0.6) + ", " + (w * 0.58) + " " + (h * 0.56) +
      ", " + (w * 0.95) + " " + (h * 0.14));
    svg.appendChild(path);
    board.appendChild(svg);
    var len = path.getTotalLength();
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    void path.getBoundingClientRect(); // reflow
    path.style.transition = "stroke-dashoffset 0.6s ease-out";
    path.style.strokeDashoffset = "0";
  }

  function bounceTitle() {
    var t = document.querySelector(".hud-title");
    if (!t) return;
    t.classList.remove("bounce"); void t.offsetWidth; t.classList.add("bounce");
  }

  /* a soft paper "rustle" synthesized with WebAudio (no asset needed) */
  var audioCtx = null;
  function playRustle() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      var ctx = audioCtx;
      var dur = 0.35;
      var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < data.length; i++) {
        var env = Math.pow(1 - i / data.length, 2); // quick decay
        data[i] = (Math.random() * 2 - 1) * env * 0.5;
      }
      var src = ctx.createBufferSource(); src.buffer = buf;
      var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.7;
      var gain = ctx.createGain(); gain.gain.value = 0.28;
      src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
      src.start();
    } catch (e) {}
  }

  /* Wordle-style emoji summary of the finished grid, copied to the clipboard. */
  function buildShareText() {
    var n = game.size, cells = game.state.cells;
    var head = "Tic-Tac-Logic " + n + "×" + n + " · " + fmtTime(game.finalElapsedMs) +
      " · needs: " + game.label;
    if (game.mode === "daily") {
      var streak = game.startedKey === game.dailyKey ? currentStreak(getDaily(), dateKey(new Date())) : 0;
      head = "Tic-Tac-Logic Daily · " + fmtDay(game.dailyKey) + " · " + n + "×" + n + " · " +
        fmtTime(game.finalElapsedMs) + " · " + starString(computeStars(game.hintsUsed || 0, game.mistakes || 0)) +
        (streak ? " 🔥" + streak : "");
    }
    var rows = [];
    for (var r = 0; r < n; r++) {
      var line = "";
      for (var c = 0; c < n; c++) {
        var v = cells[r * n + c];
        line += v === X ? "🟥" : v === O ? "🟦" : "⬜";
      }
      rows.push(line);
    }
    return head + "\n\n" + rows.join("\n");
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }
  function copyShare(btn) {
    var text = buildShareText();
    var done = function () { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Share"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }

  function showWinOverlay(ss) {
    var best = ss && ss.bestMs ? fmtTime(ss.bestMs) : fmtTime(game.finalElapsedMs);
    var isBest = ss && ss.bestMs === game.finalElapsedMs && ss.completed > 1;
    var streak = ss ? ss.streak : 1;
    showOverlay('<h2>Solved!</h2>' +
      '<p>' + game.size + " × " + game.size + " · <strong>" + fmtTime(game.finalElapsedMs) + "</strong>" +
      (isBest ? " · a new best!" : " · best " + best) +
      "<br>needs: " + game.label +
      (game.hintsUsed ? "<br>hints used: " + game.hintsUsed : "<br>no hints — all you!") +
      (streak > 1 ? "<br>streak: " + streak + " in a row" : "") + '</p>' +
      '<div class="share-row">' +
      '<button class="btn" id="ov-share">Share</button>' +
      '<button class="btn" id="ov-home">Home</button>' +
      '<button class="btn primary" id="ov-next">Next ' + game.size + " × " + game.size + '</button></div>' +
      '<button class="link-btn" id="ov-look">admire the board</button>');
    document.getElementById("ov-share").addEventListener("click", function () { copyShare(this); });
    document.getElementById("ov-home").addEventListener("click", goHome);
    document.getElementById("ov-next").addEventListener("click", function () { startNewGame(game.size); });
    document.getElementById("ov-look").addEventListener("click", hideOverlay);
  }

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
      "<br>" + (game.hintsUsed ? "☆ no-hints star — you used " + game.hintsUsed : "★ no hints") +
      "<br>" + (game.mistakes ? "☆ no-mistakes star — " + game.mistakes + " flagged" : "★ no mistakes") +
      (moreStars ? "<br>more stars than last time!" : "") +
      (n % LEVELS_PER_TIER === 0 ? "<br><strong>That's the whole " + game.label + " section — well done!</strong>" : "") + '</p>' +
      '<div class="share-row">' +
      '<button class="btn" id="ov-replay">Replay</button>' +
      '<button class="btn" id="ov-levels">Levels</button>' +
      (n % LEVELS_PER_TIER !== 0 ? '<button class="btn primary" id="ov-next-level">Next level</button>' : '') +
      '</div>' +
      '<button class="link-btn" id="ov-look">admire the board</button>');
    document.getElementById("ov-replay").addEventListener("click", function () { startLevel(size, n); });
    document.getElementById("ov-levels").addEventListener("click", function () { openPack(size, tierOf(n)); });
    var nx = document.getElementById("ov-next-level");
    if (nx) nx.addEventListener("click", function () { startLevel(size, n + 1); });
    document.getElementById("ov-look").addEventListener("click", hideOverlay);
  }

  /* ======================================================================= *
   * DAILY CHALLENGE — one puzzle per local day, generated from the date
   * (daily.js). Its own records + streak; never touches free-play stats.
   * ======================================================================= */
  var KEY_DAILY = "tictaclogic.daily"; // { "2026-10-08": {stars, bestMs, onTime} }
  var dailyMonth = null;               // { y, m } shown in the calendar

  function hasDaily() { return typeof dailyPuzzle === "function"; }
  function getDaily() { return lsGet(KEY_DAILY, {}); }
  function fmtDay(key) {
    return parseKey(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  function openDaily() {
    leaveGameScreen();
    dailyMonth = null; // back to the current month
    renderDaily();
    showScreen("daily");
  }

  function renderDaily() {
    var today = dateKey(new Date()), rec = getDaily();
    var now = parseKey(today), epoch = parseKey(DAILY_EPOCH);
    if (!dailyMonth) dailyMonth = { y: now.getFullYear(), m: now.getMonth() };
    var shown = dailyMonth.y * 12 + dailyMonth.m;
    var canPrev = shown > epoch.getFullYear() * 12 + epoch.getMonth();
    var canNext = shown < now.getFullYear() * 12 + now.getMonth();
    var tr = rec[today], size = dailySize(today);
    var solvedCount = Object.keys(rec).length;

    var html = '<div class="screen-top">' +
      '<button class="home-btn" id="dl-home">‹ Home</button>' +
      '<h2 class="screen-title">Daily</h2><span></span></div>';
    html += '<button class="daily-today" id="dl-today">' +
      '<span class="dt-main">' + (tr ? "Today’s puzzle ✓" : "Play today’s puzzle") + '</span>' +
      '<span class="dt-sub">' + fmtDay(today) + " · " + size + " × " + size +
      (tr ? " · " + starString(tr.stars) + " · " + fmtTime(tr.bestMs) : "") + '</span></button>';
    html += '<div class="daily-stats">' +
      '<div><b>' + currentStreak(rec, today) + '</b><span>streak</span></div>' +
      '<div><b>' + bestStreak(rec) + '</b><span>best streak</span></div>' +
      '<div><b>' + solvedCount + '</b><span>solved</span></div></div>';
    html += '<div class="cal-nav">' +
      '<button class="cal-arrow" id="cal-prev" aria-label="Previous month"' + (canPrev ? "" : " disabled") + '>‹</button>' +
      '<span class="cal-title">' + new Date(dailyMonth.y, dailyMonth.m, 1)
        .toLocaleDateString("en-GB", { month: "long", year: "numeric" }) + '</span>' +
      '<button class="cal-arrow" id="cal-next" aria-label="Next month"' + (canNext ? "" : " disabled") + '>›</button></div>';
    html += '<div class="cal-grid">';
    ["M", "T", "W", "T", "F", "S", "S"].forEach(function (d) { html += '<span class="cal-head">' + d + '</span>'; });
    monthGrid(dailyMonth.y, dailyMonth.m).forEach(function (k) {
      if (!k) { html += '<span class="cal-cell blank"></span>'; return; }
      var day = +k.slice(8);
      if (k < DAILY_EPOCH || k > today) { html += '<span class="cal-cell off">' + day + '</span>'; return; }
      var r = rec[k];
      html += '<button class="cal-cell' + (r ? (r.onTime ? " ontime" : " late") : "") + (k === today ? " today" : "") +
        '" data-k="' + k + '" aria-label="' + fmtDay(k) + (r ? ", solved" : "") + '">' + day +
        (r ? '<span class="cal-mark">✓</span>' : "") + '</button>';
    });
    html += '</div>';
    html += '<p class="cal-legend"><span class="ontime">✓</span> solved on the day · ' +
      '<span class="late">✓</span> solved later · tap any past day to play it</p>';

    var el = document.getElementById("daily-screen");
    el.innerHTML = html;
    document.getElementById("dl-home").addEventListener("click", function () { renderStart(); showScreen("start"); });
    document.getElementById("dl-today").addEventListener("click", function () { startDaily(today); });
    document.getElementById("cal-prev").addEventListener("click", function () { stepMonth(-1); });
    document.getElementById("cal-next").addEventListener("click", function () { stepMonth(1); });
    Array.prototype.forEach.call(el.querySelectorAll("button.cal-cell"), function (b) {
      b.addEventListener("click", function () { startDaily(b.dataset.k); });
    });
  }
  function stepMonth(delta) {
    var d = new Date(dailyMonth.y, dailyMonth.m + delta, 1);
    dailyMonth = { y: d.getFullYear(), m: d.getMonth() };
    renderDaily();
  }

  function startDaily(key) {
    showOverlay('<div class="spinner">generating<span class="dot">.</span>' +
      '<span class="dot">.</span><span class="dot">.</span></div>' +
      '<p>fetching the ' + fmtDay(key) + ' daily</p>');
    setTimeout(function () { // let the overlay paint before the (blocking) generation
      var p;
      try { p = dailyPuzzle(key); } catch (e) {
        showOverlay('<h2>Hmm.</h2><p>That daily could not be made: ' + e +
          '</p><button class="btn" id="ov-dismiss">Back</button>');
        document.getElementById("ov-dismiss").addEventListener("click", openDaily);
        return;
      }
      // like startNewGame: leaving an unfinished FREE game breaks its streak
      var prev = lsGet(KEY_SAVE, null);
      if (prev && prev.cells && (prev.mode || "free") === "free") recordAbandon(prev.size);
      hideOverlay();
      loadPuzzle({
        size: p.size, clues: p.clues, solution: p.solution,
        maxTier: p.maxTier, label: p.label, id: null, seed: null,
        mode: "daily", dailyKey: key, startedKey: dateKey(new Date()),
      });
      showScreen("game");
    }, 40);
  }

  function showDailyWinOverlay(stars, onTime, before) {
    var recs = getDaily(), streak = currentStreak(recs, dateKey(new Date()));
    var row = "";
    for (var i = 0; i < 3; i++) {
      row += '<span class="win-star' + (i < stars ? " on" : "") +
        '" style="animation-delay:' + (0.1 + i * 0.25) + 's">★</span>';
    }
    var newBest = before && before.bestMs && game.finalElapsedMs < before.bestMs;
    var streakLine = !onTime ? "played late — doesn’t count toward your streak"
      : "🔥 " + streak + "-day streak" + (streak > 1 && streak === bestStreak(recs) ? " — your best!" : "");
    showOverlay('<h2>Daily solved!</h2>' +
      '<div class="win-stars" aria-label="' + stars + ' of 3 stars">' + row + '</div>' +
      '<p>' + fmtDay(game.dailyKey) + " · " + game.size + " × " + game.size +
      " · <strong>" + fmtTime(game.finalElapsedMs) + "</strong>" + (newBest ? " · a new best!" : "") +
      "<br>" + (game.hintsUsed ? "☆ no-hints star — you used " + game.hintsUsed : "★ no hints") +
      "<br>" + (game.mistakes ? "☆ no-mistakes star — " + game.mistakes + " flagged" : "★ no mistakes") +
      "<br><strong>" + streakLine + "</strong></p>" +
      '<div class="share-row">' +
      '<button class="btn" id="ov-share">Share</button>' +
      '<button class="btn" id="ov-home">Home</button>' +
      '<button class="btn primary" id="ov-cal">Calendar</button></div>' +
      '<button class="link-btn" id="ov-look">admire the board</button>');
    document.getElementById("ov-share").addEventListener("click", function () { copyShare(this); });
    document.getElementById("ov-home").addEventListener("click", goHome);
    document.getElementById("ov-cal").addEventListener("click", openDaily);
    document.getElementById("ov-look").addEventListener("click", hideOverlay);
  }

  /* ======================================================================= *
   * LEVEL PACKS — 200 fixed levels per size (levels.js): 4 independent
   * sections of 50, shown one at a time behind section tabs.
   * ======================================================================= */
  function leaveGameScreen() {
    hideOverlay();
    clearTimeout(violationTimer);
    saveIfPlaying();
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

  var KEY_PACK_TAB = "tictaclogic.packTab"; // { "6": sectionIndex } — last tab viewed

  function openPack(size, tab) {
    leaveGameScreen();
    renderPack(size, tab);
    showScreen("pack");
  }

  function renderPack(size, tab) {
    var pack = packOf(size);
    var tabs = lsGet(KEY_PACK_TAB, {});
    if (tab == null) tab = tabs[size] || 0;
    tabs[size] = tab;
    lsSet(KEY_PACK_TAB, tabs);

    var el = document.getElementById("pack-screen");
    var html = '<div class="screen-top">' +
      '<button class="home-btn" id="pk-back">‹ Levels</button>' +
      '<h2 class="screen-title">' + size + " × " + size + '</h2><span></span></div>';

    html += '<div class="pack-tabs" role="tablist">';
    for (var t = 0; t < TIER_NAMES.length; t++) {
      var done = 0;
      for (var m = t * LEVELS_PER_TIER + 1; m <= (t + 1) * LEVELS_PER_TIER; m++) if (pack[m]) done++;
      html += '<button class="tab-btn' + (t === tab ? " on" : "") + '" role="tab" aria-selected="' + (t === tab) +
        '" data-t="' + t + '">' + TIER_NAMES[t] +
        '<span class="tab-sub">' + done + " / " + LEVELS_PER_TIER + '</span></button>';
    }
    html += '</div>';

    var first = tab * LEVELS_PER_TIER + 1, last = first + LEVELS_PER_TIER - 1;
    var nextUp = -1;
    for (var k = first; k <= last; k++) {
      if (!pack[k] && isUnlocked(pack, k)) { nextUp = k; break; }
    }
    html += '<div class="level-grid">';
    for (var n = first; n <= last; n++) {
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
    el.innerHTML = html;
    document.getElementById("pk-back").addEventListener("click", function () { renderLevels(); showScreen("levels"); });
    Array.prototype.forEach.call(el.querySelectorAll(".tab-btn"), function (b) {
      b.addEventListener("click", function () { renderPack(size, parseInt(b.dataset.t, 10)); });
    });
    Array.prototype.forEach.call(el.querySelectorAll(".level-btn:not(.locked)"), function (b) {
      b.addEventListener("click", function () { startLevel(size, parseInt(b.dataset.n, 10)); });
    });
  }

  function startLevel(size, n) {
    var parsed = null, r = null;
    try {
      parsed = gridFromString(LEVELS[size][n - 1]);
      r = solve(parsed.grid, size, { maxTrialDepth: 0 });
    } catch (e) { r = null; }
    if (!r || !r.solved) {
      showOverlay('<h2>Hmm.</h2><p>Level ' + n + ' could not be loaded.</p>' +
        '<button class="btn" id="ov-dismiss">Back</button>');
      document.getElementById("ov-dismiss").addEventListener("click", function () { openPack(size, tierOf(n)); });
      return;
    }
    // like startNewGame: leaving an unfinished FREE game breaks its streak
    var prev = lsGet(KEY_SAVE, null);
    if (prev && prev.cells && (prev.mode || "free") === "free") recordAbandon(prev.size);
    hideOverlay();
    loadPuzzle({
      size: size, clues: parsed.grid, solution: r.grid,
      maxTier: r.maxTier, label: tierName(n), id: null, seed: null,
      mode: "level", level: n,
    });
    showScreen("game");
  }

  /* ======================================================================= *
   * TUTORIAL — short interactive lessons, one rule each. Each lesson is a tiny
   * board: graphite givens, a few "your turn" cells the player must fill
   * correctly to move on, and every other cell locked. Uses the same tap cycle
   * (and the same deferred mistake feedback) as the real game.
   * ======================================================================= */
  var KEY_TUTORIAL = "tictaclogic.tutorialDone";
  var LESSONS = [
    {
      title: "Tap to write",
      text: "Every cell gets an <b>X</b> or an <b>O</b>. Tap an empty cell once for X, " +
        "twice for O, and a third time to clear it.",
      task: "Write X in the first cell and O in the second.",
      rows: 1, cols: 4, givens: "....", answer: "XO..",
      wrong: "Keep tapping — the cell cycles X → O → empty.",
    },
    {
      title: "Rule 1 · No three in a row",
      text: "Never put three of the same mark next to each other — across <i>or</i> down. " +
        "Two X’s side by side? The next cell must be O.",
      task: "Fill the gap after the two X’s.",
      rows: 1, cols: 6, givens: "XX.OXO", answer: "XXOOXO",
      wrong: "That makes three X’s in a row. Try O.",
    },
    {
      title: "Rule 1 · Mind the gap",
      text: "It works down columns too. A gap squeezed between two O’s can’t be O " +
        "(that would make three) — so it must be X.",
      task: "Fill the sandwiched cell.",
      rows: 6, cols: 1, givens: "O.OXXO", answer: "OXOXXO",
      wrong: "O-O-O would be three in a row. Try X.",
    },
    {
      title: "Rule 2 · Keep it balanced",
      text: "Every row and column holds the same number of X’s and O’s — three of each " +
        "in a 6-wide row. This row already has all three of its X’s…",
      task: "…so finish it with O’s.",
      rows: 1, cols: 6, givens: "XOX.X.", answer: "XOXOXO",
      wrong: "This row already has its three X’s — the rest are O.",
    },
    {
      title: "Rule 3 · No twins",
      text: "No two rows may be identical, and no two columns either. Row 3 could end " +
        "<b>X O O X</b> — but that’s an exact copy of row 1.",
      task: "Finish row 3 the only other way.",
      rows: 3, cols: 4, givens: "XOOXOXXOXO..", answer: "XOOXOXXOXOXO",
      wrong: "X O O X would copy row 1. Try the other order.",
    },
    {
      title: "You’re ready",
      text: "Every puzzle has exactly one answer, and you can always reach it with these " +
        "three rules — no guessing needed.<br><br>" +
        "<b>Stuck?</b> Press <b>Hint</b>: first it shows where to look, press again to see " +
        "the cell, and once more to fill it in.<br>" +
        "<b>Underlined marks</b> break a rule. <b>Undo</b> takes back your last move.",
      rows: 0,
    },
  ];
  var tut = null; // { k: lesson index, cells: [marks], done: bool }

  function openTutorial(k) {
    clearTimeout(violationTimer);
    stopTimer();
    saveIfPlaying();
    hideOverlay();
    tut = { k: k || 0 };
    renderTutorial();
    showScreen("tutorial");
  }
  function finishTutorial() { lsSet(KEY_TUTORIAL, true); }

  function renderTutorial() {
    var L = LESSONS[tut.k];
    var el = document.getElementById("tutorial-screen");
    tut.cells = L.rows ? L.givens.split("").map(charToMark) : [];
    tut.done = !L.rows;
    var html = '<div class="tut-top">' +
      '<button class="home-btn" id="tut-exit">‹ Home</button>' +
      '<div class="tut-dots">';
    for (var d = 0; d < LESSONS.length; d++) {
      html += '<span class="tut-dot' + (d === tut.k ? " on" : d < tut.k ? " past" : "") + '"></span>';
    }
    html += '</div><span class="tut-spacer"></span></div>';
    html += '<h2 class="tut-title">' + L.title + '</h2>';
    html += '<p class="tut-text">' + L.text + '</p>';
    if (L.rows) {
      html += '<div class="tut-board" id="tut-board" style="grid-template-columns: repeat(' + L.cols + ', 44px)">';
      for (var i = 0; i < tut.cells.length; i++) {
        var given = L.givens[i] !== ".";
        var target = !given && L.answer[i] !== ".";
        var v = tut.cells[i];
        html += '<div class="cell' + (v === X ? " x" : v === O ? " o" : "") +
          (given ? " clue" : target ? " target" : " locked") + '" data-i="' + i + '">' +
          markSpan(v, false) + '</div>';
      }
      html += '</div>';
      html += '<p class="tut-task" id="tut-task">' + L.task + '</p>';
    }
    var last = tut.k === LESSONS.length - 1;
    html += '<div class="controls">' +
      (tut.k > 0 ? '<button class="btn" id="tut-back">Back</button>' : '') +
      (last
        ? '<button class="btn primary" id="tut-play">Play a 6 × 6</button>'
        : '<button class="btn primary" id="tut-next"' + (tut.done ? "" : " disabled") + '>Next</button>') +
      '</div>';
    if (!last) html += '<button class="link-btn" id="tut-skip">skip tutorial</button>';
    el.innerHTML = html;

    var board = document.getElementById("tut-board");
    if (board) board.addEventListener("click", onTutorialTap);
    document.getElementById("tut-exit").addEventListener("click", function () {
      tut = null; renderStart(); showScreen("start");
    });
    var b = document.getElementById("tut-back");
    if (b) b.addEventListener("click", function () { tut.k--; renderTutorial(); });
    var n = document.getElementById("tut-next");
    if (n) n.addEventListener("click", function () { tut.k++; renderTutorial(); });
    var s = document.getElementById("tut-skip");
    if (s) s.addEventListener("click", function () { finishTutorial(); tut = null; renderStart(); showScreen("start"); });
    var p = document.getElementById("tut-play");
    if (p) p.addEventListener("click", function () { finishTutorial(); tut = null; startNewGame(6); });
    if (last) finishTutorial();
  }

  var tutTimer = null;
  function onTutorialTap(e) {
    var node = e.target.closest(".cell");
    if (!node || tut.done || !node.classList.contains("target")) return;
    var L = LESSONS[tut.k];
    var i = parseInt(node.dataset.i, 10);
    var v = tut.cells[i];
    var next = v === EMPTY ? X : v === X ? O : EMPTY;
    tut.cells[i] = next;
    node.className = "cell target" + (next === X ? " x" : next === O ? " o" : "");
    node.innerHTML = markSpan(next, next !== EMPTY);

    var task = document.getElementById("tut-task");
    clearTimeout(tutTimer);
    var solved = true, wrongAt = -1;
    for (var k = 0; k < tut.cells.length; k++) {
      var want = L.answer[k] === "." ? EMPTY : charToMark(L.answer[k]);
      if (tut.cells[k] !== want) solved = false;
      if (tut.cells[k] !== EMPTY && tut.cells[k] !== want) wrongAt = k;
    }
    task.classList.remove("good", "oops");
    task.textContent = L.task;
    if (solved) {
      tut.done = true;
      task.textContent = "Nice — that’s it!";
      task.classList.add("good");
      document.getElementById("tut-next").disabled = false;
      return;
    }
    // same patience as the real board: only complain once the player pauses
    if (wrongAt !== -1) {
      tutTimer = setTimeout(function () {
        if (!tut || !document.getElementById("tut-task")) return;
        task.textContent = L.wrong;
        task.classList.add("oops");
      }, VIOLATION_DELAY);
    }
  }

  /* ======================================================================= *
   * MODALS (Rules now; Stats/Settings are placeholders until steps 6/8)
   * ======================================================================= */
  function fmtOrDash(ms) { return ms ? fmtTime(ms) : "—"; }
  function renderStatsHtml() {
    var s = getStats();
    var html = '<h2>Stats</h2>';
    var any = false;
    html += '<table class="stats-table"><thead><tr><th>size</th><th>played</th>' +
      '<th>done</th><th>best</th><th>avg</th><th>streak</th></tr></thead><tbody>';
    SIZES.forEach(function (n) {
      var d = s.bySize[n];
      if (!d) return;
      any = true;
      var avg = d.completed ? Math.round(d.sumMs / d.completed) : 0;
      html += "<tr><td>" + n + "×" + n + "</td><td>" + d.played + "</td><td>" + d.completed +
        "</td><td>" + fmtOrDash(d.bestMs) + "</td><td>" + fmtOrDash(avg) + "</td><td>" + d.streak + "</td></tr>";
    });
    html += "</tbody></table>";
    var labels = Object.keys(s.byLabel);
    if (labels.length) {
      html += '<div class="stats-sub">by technique</div>';
      html += '<table class="stats-table"><tbody>';
      labels.forEach(function (l) {
        var d = s.byLabel[l];
        var avg = d.completed ? Math.round(d.sumMs / d.completed) : 0;
        html += '<tr><td style="text-align:left">' + l + "</td><td>×" + d.completed +
          "</td><td>best " + fmtOrDash(d.bestMs) + "</td><td>avg " + fmtOrDash(avg) + "</td></tr>";
      });
      html += "</tbody></table>";
    }
    if (!any) html += "<p>No puzzles yet — pick a size to start.</p>";
    html += '<button class="btn" id="ov-close">Close</button>';
    return html;
  }

  function setSetting(key, val) {
    var s = lsGet(KEY_SETTINGS, {});
    s[key] = val;
    lsSet(KEY_SETTINGS, s);
  }
  function renderSettingsHtml() {
    var s = getSettings();
    var row = function (key, label, on) {
      return '<div class="setting-row"><span>' + label + "</span>" +
        '<button class="toggle' + (on ? " on" : "") + '" data-set="' + key +
        '" role="switch" aria-checked="' + on + '"><span class="knob"></span></button></div>';
    };
    return "<h2>Settings</h2>" +
      row("dark", "Dark mode", s.dark) +
      row("sound", "Sound", s.sound) +
      row("haptics", "Haptics", s.haptics) +
      '<div class="setting-row"><span>Version</span>' +
      '<span class="setting-value" id="app-version">…</span></div>' +
      '<button class="btn" id="ov-close">Close</button>';
  }

  /* The installed version = the service worker's cache name (sw.js CACHE_NAME,
   * e.g. "tictaclogic-v4"). sw.js deletes older caches on activate, so the
   * newest one present is the version this device is running. Read from there
   * so the number lives in exactly one place. */
  function showAppVersion() {
    var el = document.getElementById("app-version");
    if (!el) return;
    if (!window.caches) { el.textContent = "not installed"; return; }
    caches.keys().then(function (keys) {
      var nums = keys.map(function (k) { var m = /^tictaclogic-v(\d+)$/.exec(k); return m ? +m[1] : 0; })
        .filter(Boolean);
      el.textContent = nums.length ? "v" + Math.max.apply(null, nums) : "not installed";
    }, function () { el.textContent = "unknown"; });
  }

  function openModal(which) {
    if (which === "tutorial") { openTutorial(0); return; }
    if (which === "rules") {
      showOverlay('<h2>The rules</h2><ul class="rules-list">' +
        '<li>Fill every cell with X or O.</li>' +
        '<li>No more than two of the same mark in a row — across or down.</li>' +
        '<li>Each row and column holds equal X’s and O’s.</li>' +
        '<li>No two rows are identical, and no two columns are identical.</li>' +
        '<li>Every puzzle has one answer, reachable by logic alone.</li>' +
        '</ul><div class="share-row">' +
        '<button class="btn" id="ov-tutorial">Tutorial</button>' +
        '<button class="btn primary" id="ov-close">Got it</button></div>');
      document.getElementById("ov-tutorial").addEventListener("click", function () { openTutorial(0); });
    } else if (which === "stats") {
      showOverlay(renderStatsHtml());
    } else {
      showOverlay(renderSettingsHtml());
      showAppVersion();
      Array.prototype.forEach.call(document.querySelectorAll("#overlay-panel .toggle"), function (t) {
        t.addEventListener("click", function () {
          var key = t.dataset.set;
          var nv = !getSettings()[key];
          setSetting(key, nv);
          t.classList.toggle("on", nv);
          t.setAttribute("aria-checked", nv);
          if (key === "dark") applyTheme();
        });
      });
    }
    document.getElementById("ov-close").addEventListener("click", hideOverlay);
  }

  /* ======================================================================= *
   * boot
   * ======================================================================= */
  // persist across tab close / backgrounding
  window.addEventListener("pagehide", saveIfPlaying);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveIfPlaying(); });

  function applyTheme() {
    document.body.classList.toggle("dark", getSettings().dark);
  }

  function boot() {
    applyTheme();
    renderStart();
    showScreen("start");
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

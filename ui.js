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
    ["start-screen", "game-screen"].forEach(function (id) {
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
    var save = lsGet(KEY_SAVE, null);
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
      html += '<div class="continue-card" id="continue-card">' +
        '<div><div class="cc-main">Continue</div>' +
        '<div class="cc-sub">' + save.size + " × " + save.size + " · " + t +
        " · needs: " + (save.label || "logic") + '</div></div>' +
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
    if (prev && prev.cells) recordAbandon(prev.size);

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
      moves: [],
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
      savedAt: Date.now(),
    });
  }
  function clearSave() { lsDel(KEY_SAVE); }

  function continueSaved() {
    var save = lsGet(KEY_SAVE, null);
    if (!save || !save.cells) return;
    var clues = gridFromString(save.clues).grid;
    var solution = gridFromString(save.solution).grid;
    var state = createGameState(save.size, clues, solution,
      { maxTier: save.maxTier, id: save.id, seed: save.seed });
    state.cells = gridFromString(save.cells).grid;
    game = {
      state: state, size: save.size, label: save.label, maxTier: save.maxTier,
      moves: [],
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
      '<span class="hud-size">' + game.size + " × " + game.size + '</span>' +
      '<span class="hud-title">Tic-Tac-Logic</span>' +
      '<span class="hud-timer" id="hud-timer">0:00</span></div>';
    html += '<div class="hud-badge">needs: ' + game.label + '</div>';
    html += '<div class="hud-progress" id="hud-progress">' + counts.filled + " / " + counts.total + '</div>';
    html += '</div>';

    html += '<div class="board-wrap"><div class="board" id="board"></div></div>';
    html += '<div class="hint-reason" id="hint-reason"></div>';

    html += '<div class="controls">' +
      '<button class="btn" id="btn-undo">Undo</button>' +
      '<button class="btn" id="btn-clear">Clear</button>' +
      '<button class="btn primary" id="btn-hint">Hint</button>' +
      '<button class="btn" id="btn-restart">Restart</button>' +
      '<button class="btn" id="btn-new">New</button>' +
      '</div>';

    el.innerHTML = html;
    buildBoard();
    updateTimerLabel();

    document.getElementById("btn-undo").addEventListener("click", undoMove);
    document.getElementById("btn-clear").addEventListener("click", clearBoard);
    document.getElementById("btn-hint").addEventListener("click", giveHint);
    document.getElementById("btn-restart").addEventListener("click", restartGame);
    document.getElementById("btn-new").addEventListener("click", function () {
      saveGame(); stopTimer(); showScreen("start"); renderStart();
    });
    refreshControls();
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
    board.addEventListener("click", onBoardClick);
    prevBad = new Set();
    updateViolations();
  }

  /* ---- live rule-violation highlighting (never blocks input) ---- */
  var prevBad = new Set();
  function updateViolations() {
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
    bad.forEach(function (i) {
      var n = board.querySelector('[data-i="' + i + '"]');
      if (!n) return;
      n.classList.add("bad");
      if (!prevBad.has(i)) {
        n.classList.add("shake");
        (function (node) { setTimeout(function () { node.classList.remove("shake"); }, 320); })(n);
      }
    });
    prevBad = bad;
  }

  function renderCell(i, animate) {
    var board = document.getElementById("board");
    var node = board.querySelector('[data-i="' + i + '"]');
    if (!node) return;
    node.className = cellClass(i);
    node.innerHTML = markSpan(game.state.cells[i], animate);
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
    var next = cycleCell(game.state, r, c);
    game.moves.push({ i: i, prev: prev });
    renderCell(i, next !== EMPTY);

    // clear any prior hint highlight once the player acts
    clearHint();
    updateProgress();
    refreshControls();
    updateViolations();
    saveGame();
    checkWin();
  }

  function updateProgress() {
    var counts = fillCounts(game.state);
    var p = document.getElementById("hud-progress");
    if (p) p.textContent = counts.filled + " / " + counts.total;
  }

  function refreshControls() {
    var u = document.getElementById("btn-undo");
    if (u) u.disabled = game.moves.length === 0 || game.over;
  }

  /* ======================================================================= *
   * CONTROLS
   * ======================================================================= */
  function undoMove() {
    if (game.over || game.moves.length === 0) return;
    var m = game.moves.pop();
    game.state.cells[m.i] = m.prev;
    renderCell(m.i, false);
    clearHint();
    updateProgress();
    refreshControls();
    updateViolations();
    saveGame();
  }

  function clearBoard() {
    if (game.over) return;
    clearPlayerMarks(game.state);
    game.moves = [];
    clearHint();
    buildBoard();
    updateProgress();
    refreshControls();
    saveGame();
  }

  function restartGame() {
    clearPlayerMarks(game.state);
    game.moves = [];
    game.over = false;
    game.startTime = Date.now();
    clearHint();
    startTimer();
    buildBoard();
    updateProgress();
    updateTimerLabel();
    refreshControls();
    saveGame();
  }

  /* ======================================================================= *
   * HINT — basic version (reveal the next logical cell). Rich reasons + the
   * exact solver deduction wording arrive in step 5.
   * ======================================================================= */
  var hintCell = -1;
  function clearHint() {
    if (hintCell === -1) return;
    var board = document.getElementById("board");
    var node = board && board.querySelector('[data-i="' + hintCell + '"]');
    if (node) node.classList.remove("hint");
    hintCell = -1;
    var hr = document.getElementById("hint-reason");
    if (hr) hr.textContent = "";
  }
  function flashHint(i, reason) {
    clearHint();
    hintCell = i;
    var node = document.getElementById("board").querySelector('[data-i="' + i + '"]');
    if (node) { node.classList.remove("hint"); void node.offsetWidth; node.classList.add("hint"); }
    document.getElementById("hint-reason").textContent = reason;
  }

  function giveHint() {
    if (game.over) return;
    var cells = game.state.cells, sol = game.state.solution, clues = game.state.clues;

    // 1) if the player has placed something that contradicts the solution, say so
    for (var i = 0; i < cells.length; i++) {
      if (clues[i] === EMPTY && cells[i] !== EMPTY && cells[i] !== sol[i]) {
        flashHint(i, "The mark at row " + (rowOf(i, game.size) + 1) + ", column " +
          (colOf(i, game.size) + 1) + " leads to a dead end — try clearing it.");
        return;
      }
    }

    // 2) otherwise reveal the next real deduction, with the solver's reason
    var h = hintDeduction(cells, game.size);
    if (!h) {
      document.getElementById("hint-reason").textContent =
        isComplete(cells) ? "All filled in — nothing left to deduce." : "No simple next step here.";
      return;
    }
    flashHint(h.i, h.reason);
  }

  /* ======================================================================= *
   * WIN — minimal detection now; full celebration + stats land in step 6.
   * ======================================================================= */
  function checkWin() {
    if (!isComplete(game.state.cells)) return;
    if (!isSolved(game.state.cells, game.size)) return; // complete but with violations
    // capture final time BEFORE flipping `over` (getter returns frozen value after)
    game.finalElapsedMs = Date.now() - game.startTime;
    game.over = true;
    stopTimer();
    updateTimerLabel();
    refreshControls();
    clearSave();

    var settings = getSettings();
    var ss = recordWin(game.size, game.label, game.finalElapsedMs);
    if (settings.haptics && navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch (e) {} }
    if (settings.sound) playRustle();

    drawWinStroke();   // a red-pencil stroke sweeps across the finished grid
    bounceTitle();     // the title gives one happy bounce
    setTimeout(function () { showWinOverlay(ss); }, 720); // let the stroke land first
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
      (streak > 1 ? "<br>streak: " + streak + " in a row" : "") + '</p>' +
      '<div class="share-row">' +
      '<button class="btn" id="ov-share">Share</button>' +
      '<button class="btn primary" id="ov-new">New puzzle</button></div>');
    document.getElementById("ov-share").addEventListener("click", function () { copyShare(this); });
    document.getElementById("ov-new").addEventListener("click", function () {
      hideOverlay(); showScreen("start"); renderStart();
    });
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
      '<button class="btn" id="ov-close">Close</button>';
  }

  function openModal(which) {
    if (which === "rules") {
      showOverlay('<h2>How to play</h2><ul class="rules-list">' +
        '<li>Fill every cell with X or O.</li>' +
        '<li>No more than two of the same mark in a row — across or down.</li>' +
        '<li>Each row and column holds equal X’s and O’s.</li>' +
        '<li>No two rows are identical, and no two columns are identical.</li>' +
        '<li>Every puzzle has one answer, reachable by logic alone.</li>' +
        '</ul><button class="btn" id="ov-close">Got it</button>');
    } else if (which === "stats") {
      showOverlay(renderStatsHtml());
    } else {
      showOverlay(renderSettingsHtml());
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
  window.addEventListener("pagehide", saveGame);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveGame(); });

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

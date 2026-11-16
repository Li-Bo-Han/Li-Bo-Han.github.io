(() => {
  "use strict";

  const GAME_KEY = "static-2048-game-v1";
  const BEST_KEY = "static-2048-best-v1";
  const DEFAULT_SIZE = 5;
  const MIN_SIZE = 3;
  const MAX_SIZE = 8;
  const TARGET_VALUE = 2048;
  const MOVE_DURATION = 132;

  const elements = {
    board: document.getElementById("board"),
    boardGrid: document.getElementById("boardGrid"),
    tileLayer: document.getElementById("tileLayer"),
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    sizeLabel: document.getElementById("sizeLabel"),
    statusLabel: document.getElementById("statusLabel"),
    settingsButton: document.getElementById("settingsButton"),
    settingsDialog: document.getElementById("settingsDialog"),
    closeSettingsButton: document.getElementById("closeSettingsButton"),
    cancelSettingsButton: document.getElementById("cancelSettingsButton"),
    applySizeButton: document.getElementById("applySizeButton"),
    sizeOptions: document.getElementById("sizeOptions"),
    newGameButton: document.getElementById("newGameButton"),
    gameOverOverlay: document.getElementById("gameOverOverlay"),
    finalScore: document.getElementById("finalScore"),
    gameOverNewButton: document.getElementById("gameOverNewButton"),
  };

  const directionKeys = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    W: "up",
    s: "down",
    S: "down",
    a: "left",
    A: "left",
    d: "right",
    D: "right",
  };

  let tileId = 1;
  let selectedSize = DEFAULT_SIZE;
  let bestScores = loadBestScores();
  let state = null;
  let isAnimating = false;
  let pendingDirection = null;
  let animationTimer = null;
  let animationToken = 0;
  let dragStart = null;

  function emptyBoard(size) {
    return Array.from({ length: size }, () => Array(size).fill(null));
  }

  function validSize(value) {
    return Number.isInteger(value)
      && value >= MIN_SIZE
      && value <= MAX_SIZE;
  }

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // The game still works when storage is unavailable or full.
    }
  }

  function loadBestScores() {
    const stored = readJSON(BEST_KEY);
    const scores = {};

    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return scores;
    }

    for (let size = MIN_SIZE; size <= MAX_SIZE; size += 1) {
      const value = Number(stored[size]);
      if (Number.isFinite(value) && value >= 0) {
        scores[size] = Math.floor(value);
      }
    }

    return scores;
  }

  function loadSavedGame() {
    const saved = readJSON(GAME_KEY);
    if (!saved || !validSize(saved.size)) {
      return null;
    }

    if (!Array.isArray(saved.board) || saved.board.length !== saved.size) {
      return null;
    }

    const board = emptyBoard(saved.size);
    let hasTile = false;

    for (let row = 0; row < saved.size; row += 1) {
      const savedRow = saved.board[row];
      if (!Array.isArray(savedRow) || savedRow.length !== saved.size) {
        return null;
      }

      for (let column = 0; column < saved.size; column += 1) {
        const value = savedRow[column];
        if (value === null) {
          continue;
        }

        if (
          !Number.isInteger(value)
          || value < 2
          || (value & (value - 1)) !== 0
        ) {
          return null;
        }

        board[row][column] = {
          id: tileId,
          value,
          row,
          column,
        };
        tileId += 1;
        hasTile = true;
      }
    }

    if (!hasTile) {
      return null;
    }

    const score = Number.isFinite(saved.score)
      ? Math.max(0, Math.floor(saved.score))
      : 0;

    return {
      size: saved.size,
      board,
      score,
      won: Boolean(saved.won),
      over: false,
    };
  }

  function saveGame() {
    if (!state) {
      return;
    }

    const board = state.board.map((row) => (
      row.map((tile) => (tile ? tile.value : null))
    ));

    writeJSON(GAME_KEY, {
      version: 1,
      size: state.size,
      board,
      score: state.score,
      won: state.won,
      over: state.over,
    });
  }

  function saveBestScores() {
    writeJSON(BEST_KEY, bestScores);
  }

  function currentBest() {
    return bestScores[state.size] || 0;
  }

  function updateBestScore() {
    if (state.score > currentBest()) {
      bestScores[state.size] = state.score;
      saveBestScores();
    }
  }

  function newTile(value, row, column) {
    const tile = {
      id: tileId,
      value,
      row,
      column,
    };
    tileId += 1;
    return tile;
  }

  function addRandomTile() {
    const emptyCells = [];

    for (let row = 0; row < state.size; row += 1) {
      for (let column = 0; column < state.size; column += 1) {
        if (!state.board[row][column]) {
          emptyCells.push({ row, column });
        }
      }
    }

    if (emptyCells.length === 0) {
      return null;
    }

    const cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    const tile = newTile(value, cell.row, cell.column);
    state.board[cell.row][cell.column] = tile;
    return tile;
  }

  function setupGrid() {
    elements.boardGrid.replaceChildren();
    elements.board.style.setProperty("--board-size", state.size);

    const fragment = document.createDocumentFragment();
    const cellCount = state.size * state.size;

    for (let index = 0; index < cellCount; index += 1) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      fragment.append(cell);
    }

    elements.boardGrid.append(fragment);
    elements.sizeLabel.textContent = `${state.size} × ${state.size}`;
  }

  function tileFontSize(cellSize, value) {
    const digits = String(value).length;
    let factor = 0.42;

    if (digits === 3) {
      factor = 0.35;
    } else if (digits === 4) {
      factor = 0.29;
    } else if (digits >= 5) {
      factor = 0.24;
    }

    return Math.max(11, Math.min(52, cellSize * factor));
  }

  function tileGeometry() {
    const layerWidth = elements.tileLayer.clientWidth;
    const boardStyles = getComputedStyle(elements.board);
    const gap = Number.parseFloat(boardStyles.getPropertyValue("--board-gap"))
      || 8;
    const cellSize = (
      layerWidth - gap * (state.size - 1)
    ) / state.size;

    return {
      gap,
      cellSize: Math.max(1, cellSize),
    };
  }

  function positionTile(tileElement, row, column, geometry) {
    const offset = geometry.cellSize + geometry.gap;
    const x = column * offset;
    const y = row * offset;

    tileElement.style.width = `${geometry.cellSize}px`;
    tileElement.style.height = `${geometry.cellSize}px`;
    tileElement.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function layoutTiles(instant = false) {
    if (!state) {
      return;
    }

    if (instant) {
      elements.tileLayer.classList.add("tile-layer--instant");
    }

    const geometry = tileGeometry();
    const tiles = elements.tileLayer.querySelectorAll(".tile");

    tiles.forEach((tileElement) => {
      const row = Number(tileElement.dataset.row);
      const column = Number(tileElement.dataset.column);
      const value = Number(tileElement.dataset.value);
      positionTile(tileElement, row, column, geometry);

      const valueElement = tileElement.querySelector(".tile__value");
      if (valueElement) {
        valueElement.style.fontSize = `${tileFontSize(
          geometry.cellSize,
          value,
        )}px`;
      }
    });

    if (instant) {
      void elements.tileLayer.offsetWidth;
      requestAnimationFrame(() => {
        elements.tileLayer.classList.remove("tile-layer--instant");
      });
    }
  }

  function createTileElement(tile, options) {
    const tileElement = document.createElement("div");
    tileElement.className = "tile";
    tileElement.dataset.id = String(tile.id);
    tileElement.dataset.row = String(tile.row);
    tileElement.dataset.column = String(tile.column);
    tileElement.dataset.value = String(tile.value);

    if (tile.value >= 4096) {
      tileElement.dataset.tier = "high";
    }

    if (options.mergedIds && options.mergedIds.has(tile.id)) {
      tileElement.classList.add("tile--merged");
    }

    if (options.spawnedId === tile.id) {
      tileElement.classList.add("tile--spawned");
    }

    const surface = document.createElement("div");
    surface.className = "tile__surface";

    const valueElement = document.createElement("span");
    valueElement.className = "tile__value";
    valueElement.textContent = String(tile.value);

    surface.append(valueElement);
    tileElement.append(surface);
    return tileElement;
  }

  function renderBoard(options = {}) {
    const fragment = document.createDocumentFragment();

    for (const row of state.board) {
      for (const tile of row) {
        if (tile) {
          fragment.append(createTileElement(tile, options));
        }
      }
    }

    elements.tileLayer.replaceChildren(fragment);
    layoutTiles(true);
  }

  function bumpScoreCard() {
    const card = elements.score.closest(".score-card");
    card.classList.remove("is-bumping");
    void card.offsetWidth;
    card.classList.add("is-bumping");
  }

  function renderScore(animate = false) {
    elements.score.textContent = String(state.score);
    elements.best.textContent = String(currentBest());

    if (animate) {
      bumpScoreCard();
    }
  }

  function hasAvailableMove() {
    for (let row = 0; row < state.size; row += 1) {
      for (let column = 0; column < state.size; column += 1) {
        const tile = state.board[row][column];
        if (!tile) {
          return true;
        }

        if (
          column + 1 < state.size
          && state.board[row][column + 1]
          && state.board[row][column + 1].value === tile.value
        ) {
          return true;
        }

        if (
          row + 1 < state.size
          && state.board[row + 1][column]
          && state.board[row + 1][column].value === tile.value
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function updateStatus() {
    elements.statusLabel.classList.toggle("is-won", state.won && !state.over);

    if (state.over) {
      elements.statusLabel.textContent = "没有可移动的方块了";
    } else if (state.won) {
      elements.statusLabel.textContent = "已合成 2048，继续挑战更高分";
    } else {
      elements.statusLabel.textContent = "滑动方块，或使用方向键 / WASD";
    }
  }

  function renderGameOver() {
    elements.gameOverOverlay.hidden = !state.over;
    elements.finalScore.textContent = `${state.score} 分`;
    updateStatus();
  }

  function lineCoordinates(direction) {
    const lines = [];

    if (direction === "left" || direction === "right") {
      for (let row = 0; row < state.size; row += 1) {
        const line = [];
        for (let index = 0; index < state.size; index += 1) {
          const column = direction === "left"
            ? index
            : state.size - 1 - index;
          line.push({ row, column });
        }
        lines.push(line);
      }
    } else {
      for (let column = 0; column < state.size; column += 1) {
        const line = [];
        for (let index = 0; index < state.size; index += 1) {
          const row = direction === "up"
            ? index
            : state.size - 1 - index;
          line.push({ row, column });
        }
        lines.push(line);
      }
    }

    return lines;
  }

  function calculateMove(direction) {
    const nextBoard = emptyBoard(state.size);
    const transitions = new Map();
    const mergedIds = new Set();
    let moved = false;
    let gained = 0;

    for (const line of lineCoordinates(direction)) {
      const tiles = line
        .map(({ row, column }) => state.board[row][column])
        .filter(Boolean)
        .map((tile) => ({ ...tile, merged: false }));

      let outputIndex = 0;
      let previous = null;

      for (const tile of tiles) {
        if (
          previous
          && !previous.merged
          && previous.value === tile.value
        ) {
          previous.value *= 2;
          previous.merged = true;
          mergedIds.add(previous.id);
          transitions.set(tile.id, {
            row: previous.row,
            column: previous.column,
          });
          gained += previous.value;
          moved = true;
          continue;
        }

        const destination = line[outputIndex];
        outputIndex += 1;
        const placedTile = {
          ...tile,
          row: destination.row,
          column: destination.column,
          merged: false,
        };

        nextBoard[destination.row][destination.column] = placedTile;
        transitions.set(tile.id, destination);
        previous = placedTile;

        if (
          tile.row !== destination.row
          || tile.column !== destination.column
        ) {
          moved = true;
        }
      }
    }

    return {
      board: nextBoard,
      transitions,
      mergedIds,
      gained,
      moved,
    };
  }

  function cancelMoveAnimation() {
    animationToken += 1;
    window.clearTimeout(animationTimer);
    animationTimer = null;
    isAnimating = false;
    pendingDirection = null;
    elements.tileLayer.classList.remove("tile-layer--instant");
  }

  function finishMove(move) {
    state.board = move.board;
    state.score += move.gained;
    state.won = state.won || move.board.some((row) => (
      row.some((tile) => tile && tile.value >= TARGET_VALUE)
    ));

    updateBestScore();
    const spawnedTile = addRandomTile();
    state.over = !hasAvailableMove();

    renderBoard({
      mergedIds: move.mergedIds,
      spawnedId: spawnedTile ? spawnedTile.id : null,
    });
    renderScore(move.gained > 0);
    renderGameOver();
    saveGame();

    isAnimating = false;

    if (pendingDirection && !state.over) {
      const direction = pendingDirection;
      pendingDirection = null;
      requestMove(direction);
    }
  }

  function animateMove(move) {
    isAnimating = true;
    const token = ++animationToken;
    const geometry = tileGeometry();
    const movingTiles = [];

    for (const row of state.board) {
      for (const tile of row) {
        if (!tile) {
          continue;
        }

        const tileElement = elements.tileLayer.querySelector(
          `.tile[data-id="${tile.id}"]`,
        );
        const destination = move.transitions.get(tile.id);

        if (tileElement && destination) {
          tileElement.classList.add("tile--moving");
          movingTiles.push({ tileElement, destination });
        }
      }
    }

    requestAnimationFrame(() => {
      if (token !== animationToken) {
        return;
      }

      movingTiles.forEach(({ tileElement, destination }) => {
        positionTile(
          tileElement,
          destination.row,
          destination.column,
          geometry,
        );
      });

      animationTimer = window.setTimeout(() => {
        if (token === animationToken) {
          finishMove(move);
        }
      }, MOVE_DURATION);
    });
  }

  function requestMove(direction) {
    if (!state || state.over || !direction) {
      return;
    }

    if (isAnimating) {
      pendingDirection = direction;
      return;
    }

    const move = calculateMove(direction);
    if (!move.moved) {
      return;
    }

    animateMove(move);
  }

  function startNewGame(size = state ? state.size : DEFAULT_SIZE) {
    cancelMoveAnimation();
    const nextSize = validSize(size) ? size : DEFAULT_SIZE;

    state = {
      size: nextSize,
      board: emptyBoard(nextSize),
      score: 0,
      won: false,
      over: false,
    };

    addRandomTile();
    addRandomTile();
    setupGrid();
    renderBoard();
    renderScore();
    renderGameOver();
    saveGame();
  }

  function closeSettings() {
    if (typeof elements.settingsDialog.close === "function") {
      elements.settingsDialog.close();
    } else {
      elements.settingsDialog.removeAttribute("open");
    }
  }

  function updateSizeOptions() {
    const buttons = elements.sizeOptions.querySelectorAll(".size-option");
    buttons.forEach((button) => {
      const size = Number(button.dataset.size);
      const isSelected = size === selectedSize;
      button.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function buildSizeOptions() {
    const fragment = document.createDocumentFragment();

    for (let size = MIN_SIZE; size <= MAX_SIZE; size += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "size-option";
      button.dataset.size = String(size);
      button.setAttribute("role", "button");

      const label = document.createElement("span");
      label.textContent = `${size} × ${size}`;

      const note = document.createElement("small");
      if (size === DEFAULT_SIZE) {
        note.textContent = "默认";
      } else if (size <= 4) {
        note.textContent = "紧凑";
      } else if (size >= 7) {
        note.textContent = "挑战";
      } else {
        note.textContent = "经典";
      }

      button.append(label, note);
      fragment.append(button);
    }

    elements.sizeOptions.append(fragment);
  }

  function openSettings() {
    selectedSize = state.size;
    updateSizeOptions();

    if (typeof elements.settingsDialog.showModal === "function") {
      elements.settingsDialog.showModal();
    } else {
      elements.settingsDialog.setAttribute("open", "");
    }
  }

  function applySelectedSize() {
    closeSettings();
    startNewGame(selectedSize);
  }

  function handleKeydown(event) {
    if (elements.settingsDialog.open) {
      if (event.key === "Escape") {
        closeSettings();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const direction = directionKeys[event.key];
    if (!direction) {
      return;
    }

    event.preventDefault();
    requestMove(direction);
  }

  function handlePointerDown(event) {
    if (
      event.button !== 0
      || (event.target instanceof Element
        && event.target.closest("button"))
    ) {
      return;
    }

    dragStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };

    if (elements.board.setPointerCapture) {
      elements.board.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerUp(event) {
    if (!dragStart || dragStart.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    const threshold = Math.max(
      20,
      Math.min(34, elements.board.clientWidth * 0.06),
    );
    dragStart = null;

    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) {
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      requestMove(deltaX > 0 ? "right" : "left");
    } else {
      requestMove(deltaY > 0 ? "down" : "up");
    }
  }

  function handlePointerCancel(event) {
    if (dragStart && dragStart.id === event.pointerId) {
      dragStart = null;
    }
  }

  function bindEvents() {
    document.addEventListener("keydown", handleKeydown);
    elements.board.addEventListener("pointerdown", handlePointerDown);
    elements.board.addEventListener("pointerup", handlePointerUp);
    elements.board.addEventListener("pointercancel", handlePointerCancel);

    elements.newGameButton.addEventListener("click", () => {
      startNewGame();
    });
    elements.gameOverNewButton.addEventListener("click", () => {
      startNewGame();
    });

    elements.settingsButton.addEventListener("click", openSettings);
    elements.closeSettingsButton.addEventListener("click", closeSettings);
    elements.cancelSettingsButton.addEventListener("click", closeSettings);
    elements.applySizeButton.addEventListener("click", applySelectedSize);

    elements.sizeOptions.addEventListener("click", (event) => {
      const button = event.target.closest(".size-option");
      if (!button) {
        return;
      }

      selectedSize = Number(button.dataset.size);
      updateSizeOptions();
    });

    elements.settingsDialog.addEventListener("click", (event) => {
      if (event.target === elements.settingsDialog) {
        closeSettings();
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      layoutTiles(true);
    });
    resizeObserver.observe(elements.board);
  }

  function initialize() {
    buildSizeOptions();
    bindEvents();

    const savedGame = loadSavedGame();

    if (savedGame) {
      state = savedGame;
      state.over = !hasAvailableMove();
      state.won = state.won || state.board.some((row) => (
        row.some((tile) => tile && tile.value >= TARGET_VALUE)
      ));
      updateBestScore();
      setupGrid();
      renderBoard();
      renderScore();
      renderGameOver();
      saveGame();
    } else {
      startNewGame(DEFAULT_SIZE);
    }

    requestAnimationFrame(() => {
      layoutTiles(true);
      elements.board.focus({ preventScroll: true });
    });
  }

  initialize();
})();

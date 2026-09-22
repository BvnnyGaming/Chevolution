// ---- Config ----

const GAMES_FILE = 'games/games.jsonl';

const MOVE_DELAY_MS = 5000;
const END_OF_GAME_PAUSE_MS = 3000;
const POLL_GAMES_MS = 60000;        // how often to check for newly pushed games
const POLL_WHEN_EMPTY_MS = 5000;    // faster retry while nothing has loaded yet
const TICK_MS = 250;                // how often the display re-checks the clock

// Everyone shares this fixed start point, so every visitor sees the same
// moment of the same game. Changing it (or MOVE_DELAY_MS) shifts the schedule
// for everybody.
const EPOCH_MS = Date.UTC(2026, 0, 1);

// Only the newest N games are cycled through (0 = every game ever logged).
const MAX_GAMES_IN_ROTATION = 50;

// ---- Board state ----

const PIECES = {
  white: { k: 'images/bk.png', q: 'images/bq.png', r: 'images/br.png', b: 'images/bb.png', n: 'images/bn.png', p: 'images/bp.png' },
  black: { k: 'images/wk.png', q: 'images/wq.png', r: 'images/wr.png', b: 'images/wb.png', n: 'images/wn.png', p: 'images/wp.png' },
};

let boardState = null;
let squareEls = [];

function freshBoard() {
  // row 0 = rank 8 (black back rank) ... row 7 = rank 1 (white back rank)
  const back = ['r', 'n', 'b', 'k', 'q', 'b', 'n', 'r'];
  const board = [];
  board.push(back.map(t => ({ type: t, color: 'black' })));
  board.push(Array(8).fill(null).map(() => ({ type: 'p', color: 'black' })));
  for (let r = 2; r <= 5; r++) board.push(Array(8).fill(null));
  board.push(Array(8).fill(null).map(() => ({ type: 'p', color: 'white' })));
  board.push(back.map(t => ({ type: t, color: 'white' })));
  return board;
}

function buildBoardDom() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  squareEls = [];
  for (let row = 0; row < 8; row++) {
    const rowEls = [];
    for (let col = 0; col < 8; col++) {
      const sq = document.createElement('div');
      const isLight = (row + col) % 2 === 0;
      sq.className = 'square ' + (isLight ? 'light' : 'dark');
      boardEl.appendChild(sq);
      rowEls.push(sq);
    }
    squareEls.push(rowEls);
  }
}

function renderBoard(highlight) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = boardState[row][col];
      const sq = squareEls[row][col];
      sq.classList.remove('piece-white', 'piece-black', 'last-move');
      sq.textContent = '';
      if (piece) {
        sq.classList.add(piece.color === 'white' ? 'piece-white' : 'piece-black');
        sq.style.backgroundImage = `url(${PIECES[piece.color][piece.type]})` 
      } else {
        sq.style.backgroundImage = ''
      }
    }
  }
  if (highlight) {
    squareEls[highlight.from[1]][highlight.from[0]].classList.add('last-move');
    squareEls[highlight.to[1]][highlight.to[0]].classList.add('last-move');
  }
}

function applyMove(move) {
  const [fx, fy] = move.from;
  const [tx, ty] = move.to;
  const piece = boardState[fy][fx];
  boardState[ty][tx] = piece;
  boardState[fy][fx] = null;
}

// ---- Formatting helpers ----

function shortId(id) {
  return id ? id.slice(0, 8) : '—';
}

function resultLabel(result) {
  if (result === 0.5) return { text: 'draw', cls: 'draw' };
  if (result === 1.0) return { text: 'white wins', cls: 'win' };
  if (result === 0.0) return { text: 'black wins', cls: 'loss' };
  return { text: String(result), cls: '' };
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return '—';
  const secs = Math.max(0, finishedAt - startedAt);
  return secs < 60 ? `${secs.toFixed(1)}s` : `${(secs / 60).toFixed(1)}m`;
}

function setStatus(text) {
  document.getElementById('statusLine').textContent = text;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---- Data loading ----

// Reads the whole log and returns an array of game objects, oldest first.
// Accepts JSON Lines (one game per line) or a plain JSON array of games.
async function loadGames() {
  const res = await fetch(GAMES_FILE, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${GAMES_FILE} -> ${res.status}`);
  const text = (await res.text()).trim();
  if (!text) return [];

  if (text.startsWith('[')) return JSON.parse(text);

  const games = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      games.push(JSON.parse(trimmed));
    } catch (e) {
      console.warn('Skipping unparseable line:', trimmed.slice(0, 80));
    }
  }
  return games;
}

// ---- Schedule ----
//
// There is no server running the games, so the "broadcast" is computed from
// the clock instead: the rotation of games is laid end to end on a timeline
// starting at EPOCH_MS and repeating forever. Whoever opens the page at any
// moment lands on the same game and the same move as everyone else, and
// reloading just puts you back at the current point.

let rotation = [];   // [{ game, number, startMs, durationMs }], oldest first
let cycleMs = 0;
let loadedCount = -1;

function gameDurationMs(game) {
  return (game.moves ? game.moves.length : 0) * MOVE_DELAY_MS + END_OF_GAME_PAUSE_MS;
}

function buildRotation(all) {
  const first = MAX_GAMES_IN_ROTATION > 0
    ? Math.max(0, all.length - MAX_GAMES_IN_ROTATION)
    : 0;
  let t = 0;
  rotation = all.slice(first).map((game, i) => {
    const durationMs = gameDurationMs(game);
    const entry = { game, number: first + i, startMs: t, durationMs };
    t += durationMs;
    return entry;
  });
  cycleMs = t;
}

function currentPosition() {
  const t = (((Date.now() - EPOCH_MS) % cycleMs) + cycleMs) % cycleMs;

  let idx = 0;
  for (let i = 0; i < rotation.length; i++) {
    if (rotation[i].startMs <= t) idx = i;
    else break;
  }

  const entry = rotation[idx];
  const moveCount = entry.game.moves ? entry.game.moves.length : 0;
  const elapsed = t - entry.startMs;

  return {
    idx,
    entry,
    ply: Math.min(moveCount, Math.floor(elapsed / MOVE_DELAY_MS) + 1),
    finished: elapsed >= moveCount * MOVE_DELAY_MS,
  };
}

// ---- Display ----

let shownKey = null;
let shownGameKey = null;

// ---- View mode: live broadcast vs reviewing past game ----

let viewMode = 'live';
let reviewEntry = null; //entry rotation
let reviewPly = 0;

function enterReview(entry, ply = 0) {
  viewMode = 'review';
  reviewEntry = entry;
  reviewPly = Math.Max(0, Math.min(ply, (entry.game.moves || []).length));
  document.getElementById('liveBtn').style.display = 'inline-block';
  renderReview()
}

function exitReview(){
  viewmode = 'live';
  reviewEntry = null;
  shownKey = null;
  shownGameKey = null;
  document.getElementById('liveBtn').style.display = 'none';
  render();
}

function stepReview(delta){
  if (viewMode !== 'review') return;
  const moves = reviewEntry.game.moves || [];
  reviewPly = Math.max(0, Math.min(moves.length, reviewPly + delta));
  renderReview();
}

function renderReview(){
  const { game, number } = reviewEntry;
  const moves = game.moves || [];
  const ply = reviewPly;
  const  finished = ply >= moves.length;

  document.getElementById('gameId').textContent = shortId(game.id);
  document.getElementById('gameNumber').textContent = `Game #${number} (review)`;
  document.getElementById('modelStep').textContent = game.model_step ?? '-';

  if (finished) {
    const { text, cls } = resultLabel(game.result);
    document.getElementById('result').textContent = text;
    document.getElementById('result').className = `v ${cls}`;
  } else {
    document.getElementById('result').textContent = '-';
    document.getElementById('result').className = 'v';
  }
  setStatus(`Reviewing game #${number} - Left and right arrow to navigate, space or "Back to live" to return.`);
}

function renderRecent(idx) {
  const list = document.getElementById('recentList');
  list.innerHTML = '';
  const n = rotation.length;
  for (let k = 1; k <= Math.min(8, n - 1); k++) {
    const prev = rotation[(idx - k + n) % n];
    const { text, cls } = resultLabel(prev.game.result);
    const row = document.createElement('div');
    row.className = 'recent-row';
    row.innerHTML = `<span>#${prev.number}</span><span class="res ${cls}">${text}</span>`;
    row.addEventListener('click', () => enterReview(prev, 0))
    list.appendChild(row);
  }
}

function render() {
  if (viewMode !== 'live') return;
  if (rotation.length === 0) return;

  const { idx, entry, ply, finished } = currentPosition();
  const { game, number } = entry;
  const moves = game.moves || [];

  const gameKey = `${number}:${game.id}`;
  const key = `${gameKey}:${ply}:${finished}`;
  if (key === shownKey) return;
  const gameChanged = gameKey !== shownGameKey;
  shownKey = key;
  shownGameKey = gameKey;

  if (gameChanged) {
    document.getElementById('gameId').textContent = shortId(game.id);
    document.getElementById('gameNumber').textContent = `Game #${number}`;
    document.getElementById('modelStep').textContent = game.model_step ?? '—';
    renderRecent(idx);
  }

  // Rebuild the position from the start; cheap, and it means joining or
  // reloading mid-game shows exactly the right board.
  boardState = freshBoard();
  for (let i = 0; i < ply; i++) applyMove(moves[i]);
  renderBoard(ply > 0 ? moves[ply - 1] : null);
  document.getElementById('moves').textContent = `${ply}`;

  if (finished) {
    const { text, cls } = resultLabel(game.result);
    document.getElementById('result').textContent = text;
    document.getElementById('result').className = `v ${cls}`;
    document.getElementById('duration').textContent = formatDuration(game.started_at, game.finished_at);
    setStatus('Game finished.');
  } else {
    document.getElementById('result').textContent = '—';
    document.getElementById('result').className = 'v';
    document.getElementById('duration').textContent = '—';
    setStatus('Playing…');
  }
}

// ---- Main ----

async function refreshGames() {
  try {
    const all = await loadGames();
    if (all.length !== loadedCount) {
      loadedCount = all.length;
      buildRotation(all);
    }
    if (rotation.length === 0) setStatus(`${GAMES_FILE} has no games yet.`);
  } catch (e) {
    console.error(e);
    // Once something has loaded, keep broadcasting it and retry quietly.
    if (rotation.length === 0) {
      setStatus(`Can't load ${GAMES_FILE} — check the file name and that it's pushed.`);
    }
  }
}

async function pollGames() {
  while (true) {
    await refreshGames();
    await sleep(rotation.length ? POLL_GAMES_MS : POLL_WHEN_EMPTY_MS);
  }
}

function main() {
  buildBoardDom();
  boardState = freshBoard();
  renderBoard(null);

  document.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (viewMode === 'live') {
        const { entry, ply } = currentPosition();
        enterReview(entry, Math.max(0, ply - 1));
      } else {
        stepReview(-1);
      }
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (viewMode === 'live') {
        const { entry, ply} = currentPosition();
        enterReview(entry, Math.min((entry.game.moves || []).length, ply + 1));
      } else {
        stepReview(1);
      }
    } else if (e.code === 'Space') {
      e.preventDefault();
      exitReview();
    }
  });

  document.getElementById('liveBtn').addEventListener('click', exitReview);

  pollGames();
  setInterval(render, TICK_MS);
}

main();

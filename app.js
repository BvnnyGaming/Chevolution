const TYPE_BY_VALUE = { 1: 'p', 2: 'r', 3: 'n', 4: 'b', 5: 'q', 6: 'k' };

const DATA_URL = 'data/games.jsonl';
const MOVE_DELAY_MS = 5000;
const START_DELAY_MS = 1000;
const END_PAUSE_MS = 3000;
const RELOAD_MS = 60000;
const RETRY_MS = 5000;

// ---- Game logic ----

function freshBoard() {
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const row = (type, color) => Array.from({ length: 8 }, () => ({ type, color }));
  return [
    back.map(type => ({ type, color: 'black' })),
    row('p', 'black'),
    ...Array.from({ length: 4 }, () => Array(8).fill(null)),
    row('p', 'white'),
    back.map(type => ({ type, color: 'white' })),
  ];
}

function applyMove(board, move) {
  const [fx, fy] = move.from;
  const [tx, ty] = move.to;
  const piece = board[fy][fx];
  if (!piece) return false;

  if (piece.type === 'p' && fx !== tx && !board[ty][tx]) {
    board[fy][tx] = null;
  }

  if (piece.type === 'k' && Math.abs(tx - fx) === 2) {
    const rookFrom = tx > fx ? 7 : 0;
    const rookTo = tx > fx ? 5 : 3;
    if (board[ty][rookFrom]?.type === 'r') {
      board[ty][rookTo] = board[ty][rookFrom];
      board[ty][rookFrom] = null;
    }
  }

  let landing = piece;
  if (move.promotion) {
    landing = {
      type: TYPE_BY_VALUE[Math.abs(move.promotion)],
      color: move.promotion > 0 ? 'white' : 'black',
    };
  }

  board[ty][tx] = landing;
  board[fy][fx] = null;
  return true;
}

function boardAt(moves, ply) {
  const board = freshBoard();
  for (let i = 0; i < ply; i++) applyMove(board, moves[i]);
  return board;
}

function parseGames(text) {
  const games = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      games.push(JSON.parse(line));
    } catch (e) {}
  }
  return games;
}

// ---- Labels ----

function resultLabel(result) {
  if (result == null) return { text: '—', cls: '' };
  if (result === 0.5) return { text: 'draw', cls: 'draw' };
  if (result === 1) return { text: 'white wins', cls: 'win' };
  if (result === 0) return { text: 'black wins', cls: 'loss' };
  return { text: String(result), cls: '' };
}

// ---- Page ----

const $ = id => document.getElementById(id);
const setStatus = text => { $('statusLine').textContent = text; };

let board = null;
let squares = [];
let games = [];
let current = -1;
let ply = 0;
let playing = false;
let timer = null;
let query = '';

const moveList = () => games[current]?.moves || [];
const isLive = () => playing && current === games.length - 1;

function buildBoard() {
  const el = $('board');
  el.innerHTML = '';
  squares = [];
  for (let y = 0; y < 8; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      const sq = document.createElement('div');
      sq.className = 'square ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.hidden = true;
      sq.appendChild(img);
      el.appendChild(sq);
      row.push(sq);
    }
    squares.push(row);
  }
}

function preloadPieces() {
  for (const color of 'wb') {
    for (const type of 'prnbqk') new Image().src = `images/${color}${type}.png`;
  }
}

function drawBoard(lastMove) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const piece = board[y][x];
      const sq = squares[y][x];
      const img = sq.firstChild;
      sq.classList.remove('last-move');
      if (piece) {
        const file = `images/${piece.color[0]}${piece.type}.png`;
        if (img.getAttribute('src') !== file) img.src = file;
        img.hidden = false;
      } else {
        img.hidden = true;
      }
    }
  }
  if (lastMove) {
    for (const [x, y] of [lastMove.from, lastMove.to]) {
      squares[y][x].classList.add('last-move');
    }
  }
}

function drawList() {
  const list = $('gameList');
  const scroll = list.scrollTop;
  list.innerHTML = '';

  for (let i = games.length - 1; i >= 0; i--) {
    if (query && !String(i).startsWith(query)) continue;
    const { text, cls } = resultLabel(games[i].result);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'game-row' + (i === current ? ' current' : '');
    row.dataset.index = i;
    row.innerHTML = `<span>#${i}</span><span class="res ${cls}">${text}</span>`;
    list.appendChild(row);
  }

  if (!list.children.length) {
    const empty = document.createElement('div');
    empty.className = 'game-empty';
    empty.textContent = 'No game with that number.';
    list.appendChild(empty);
  }
  list.scrollTop = scroll;
}

function scrollToCurrent() {
  const list = $('gameList');
  const row = list.querySelector('.current');
  if (row) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
}

function matches() {
  const found = [];
  for (let i = games.length - 1; i >= 0; i--) {
    if (String(i).startsWith(query)) found.push(i);
  }
  return found;
}

function statusText() {
  if (!playing) return 'Paused. Step with ← and →.';
  if (ply >= moveList().length) {
    return current + 1 < games.length ? 'Game finished.' : 'Game finished. Waiting for the next game…';
  }
  return isLive() ? 'Live' : 'Playing…';
}

function updateControls() {
  $('prevBtn').disabled = current < 0 || ply === 0;
  $('nextBtn').disabled = current < 0 || ply >= moveList().length;
  $('playBtn').textContent = playing ? 'Pause' : 'Play';
  $('liveBtn').hidden = isLive();
  setStatus(statusText());
}

function updateView() {
  const moves = moveList();
  board = boardAt(moves, ply);
  drawBoard(ply > 0 ? moves[ply - 1] : null);
  $('plyProgress').textContent = `${ply} / ${moves.length}`;
  updateControls();
}

// ---- Playback ----

function schedule(ms) {
  clearTimeout(timer);
  if (playing) timer = setTimeout(advance, ms);
}

function advance() {
  if (ply < moveList().length) {
    ply++;
    updateView();
    schedule(ply === moveList().length ? END_PAUSE_MS : MOVE_DELAY_MS);
  } else if (current + 1 < games.length) {
    openGame(current + 1, true);
  } else {
    schedule(RETRY_MS);
  }
}

function openGame(index, autoplay) {
  const game = games[index];
  current = index;
  ply = 0;
  playing = autoplay;

  const { text, cls } = resultLabel(game.result);
  $('gameId').textContent = game.id ? game.id.slice(0, 8) : '—';
  $('gameNumber').textContent = `Game #${index}`;
  $('modelStep').textContent = game.model_step ?? '—';
  $('mctsIters').textContent = game.mcts_iterations ?? '—';
  $('result').textContent = text;
  $('result').className = 'v ' + cls;

  drawList();
  scrollToCurrent();
  updateView();
  schedule(START_DELAY_MS);
}

function step(delta) {
  if (current < 0) return;
  playing = false;
  clearTimeout(timer);
  ply = Math.min(Math.max(ply + delta, 0), moveList().length);
  updateView();
}

function togglePlay() {
  if (current < 0) return;
  playing = !playing;
  updateControls();
  schedule(ply >= moveList().length ? START_DELAY_MS : MOVE_DELAY_MS);
}

function goLive() {
  if (games.length) openGame(games.length - 1, true);
}

// ---- Loading and events ----

async function reloadGames() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${DATA_URL} -> ${res.status}`);
  games = parseGames(await res.text());
  $('gamesLogged').textContent = games.length;
}

async function refresh() {
  try {
    await reloadGames();
    drawList();
    updateControls();
  } catch (e) {
    console.error(e);
  }
}

function wireEvents() {
  $('gameList').addEventListener('click', e => {
    const row = e.target.closest('.game-row');
    if (row) openGame(Number(row.dataset.index), true);
  });

  $('gameSearch').addEventListener('input', e => {
    const digits = e.target.value.replace(/\D/g, '');
    query = digits === '' ? '' : String(Number(digits));
    drawList();
    $('gameList').scrollTop = 0;
  });

  $('gameSearch').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !query) return;
    const exact = Number(query);
    const target = exact < games.length ? exact : matches()[0];
    if (target !== undefined) openGame(target, true);
  });

  $('prevBtn').addEventListener('click', () => step(-1));
  $('nextBtn').addEventListener('click', () => step(1));
  $('playBtn').addEventListener('click', togglePlay);
  $('liveBtn').addEventListener('click', goLive);

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    }
  });
}

async function main() {
  preloadPieces();
  buildBoard();
  board = freshBoard();
  drawBoard(null);
  wireEvents();
  updateControls();

  while (games.length === 0) {
    try {
      await reloadGames();
      if (games.length === 0) setStatus('No games logged yet…');
    } catch (e) {
      console.error(e);
      setStatus(`Couldn't load ${DATA_URL}. If you opened the file directly, serve it with python -m http.server.`);
    }
    if (games.length === 0) await new Promise(r => setTimeout(r, RETRY_MS));
  }

  const param = parseInt(new URLSearchParams(location.search).get('game'), 10);
  openGame(param >= 0 && param < games.length ? param : games.length - 1, true);
  setInterval(refresh, RELOAD_MS);
}

if (typeof module !== 'undefined') {
  module.exports = { freshBoard, applyMove, boardAt, parseGames };
} else {
  main();
}

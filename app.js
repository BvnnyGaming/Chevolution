const PIECES = {
  white: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  black: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const TYPE_BY_VALUE = { 1: 'p', 2: 'r', 3: 'n', 4: 'b', 5: 'q', 6: 'k' };

const DATA_URL = 'data/games.jsonl';
const MOVE_DELAY_MS = 5000;
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
  if (result === 0.5) return { text: 'draw', cls: 'draw' };
  if (result === 1) return { text: 'white wins', cls: 'win' };
  if (result === 0) return { text: 'black wins', cls: 'loss' };
  return { text: String(result), cls: '' };
}

function formatDuration(start, end) {
  if (!start || !end) return '—';
  const secs = Math.max(0, end - start);
  return secs < 60 ? `${secs.toFixed(1)}s` : `${(secs / 60).toFixed(1)}m`;
}

// ---- Page ----

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const setStatus = text => { $('statusLine').textContent = text; };

let board = null;
let squares = [];
let games = [];
let current = -1;
let currentDone = false;
let runId = 0;
let query = '';

function buildBoard() {
  const el = $('board');
  el.innerHTML = '';
  squares = [];
  for (let y = 0; y < 8; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      const sq = document.createElement('div');
      sq.className = 'square ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
      el.appendChild(sq);
      row.push(sq);
    }
    squares.push(row);
  }
}

function drawBoard(lastMove) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const piece = board[y][x];
      const sq = squares[y][x];
      sq.classList.remove('piece-white', 'piece-black', 'last-move');
      sq.textContent = piece ? PIECES[piece.color][piece.type] : '';
      if (piece) sq.classList.add('piece-' + piece.color);
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
    const playingNow = i === current && !currentDone;
    const { text, cls } = playingNow ? { text: 'playing…', cls: '' } : resultLabel(games[i].result);
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

async function reloadGames() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${DATA_URL} -> ${res.status}`);
  games = parseGames(await res.text());
  $('gamesLogged').textContent = games.length;
}

async function play(index) {
  const id = ++runId;
  const game = games[index];
  current = index;
  currentDone = false;
  board = freshBoard();
  buildBoard();
  drawBoard(null);
  drawList();
  scrollToCurrent();

  $('gameId').textContent = game.id ? game.id.slice(0, 8) : '—';
  $('gameNumber').textContent = `Game #${index}`;
  $('modelStep').textContent = game.model_step ?? '—';
  $('mctsIters').textContent = game.mcts_iterations ?? '—';
  $('duration').textContent = '—';
  $('result').textContent = '—';
  $('result').className = 'v';
  setStatus('Playing…');

  const moves = game.moves || [];
  for (let i = 0; i < moves.length; i++) {
    if (!applyMove(board, moves[i])) {
      console.warn(`Game #${index}, ply ${i + 1}: nothing on the from-square`, moves[i]);
    }
    drawBoard(moves[i]);
    $('plyProgress').textContent = `${i + 1} / ${moves.length}`;
    await sleep(MOVE_DELAY_MS);
    if (id !== runId) return;
  }

  const { text, cls } = resultLabel(game.result);
  $('result').textContent = text;
  $('result').className = 'v ' + cls;
  $('duration').textContent = formatDuration(game.started_at, game.finished_at);
  setStatus('Game finished.');
  currentDone = true;
  drawList();

  await sleep(END_PAUSE_MS);
  while (id === runId && index + 1 >= games.length) {
    setStatus('Waiting for the next game…');
    await sleep(RETRY_MS);
  }
  if (id === runId) play(index + 1);
}

async function refresh() {
  try {
    await reloadGames();
    drawList();
  } catch (e) {
    console.error(e);
  }
}

function wireEvents() {
  $('gameList').addEventListener('click', e => {
    const row = e.target.closest('.game-row');
    if (row) play(Number(row.dataset.index));
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
    if (target !== undefined) play(target);
  });
}

async function main() {
  buildBoard();
  board = freshBoard();
  drawBoard(null);
  wireEvents();

  while (games.length === 0) {
    try {
      await reloadGames();
      if (games.length === 0) setStatus('No games logged yet…');
    } catch (e) {
      console.error(e);
      setStatus(`Couldn't load ${DATA_URL}. If you opened the file directly, serve it with python -m http.server.`);
    }
    if (games.length === 0) await sleep(RETRY_MS);
  }

  const param = parseInt(new URLSearchParams(location.search).get('game'), 10);
  play(param >= 0 && param < games.length ? param : games.length - 1);
  setInterval(refresh, RELOAD_MS);
}

if (typeof module !== 'undefined') {
  module.exports = { freshBoard, applyMove, parseGames };
} else {
  main();
}

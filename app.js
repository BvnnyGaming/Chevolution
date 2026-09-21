// ---- Config ----

const GAMES_FILE = 'games/games.jsonl';

const MOVE_DELAY_MS = 5000;
const END_OF_GAME_PAUSE_MS = 3000;
const POLL_WHEN_WAITING_MS = 30000;

// ---- Board state ----

const PIECES = {
  white: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  black: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

let boardState = null;
let squareEls = [];

function freshBoard() {
  // row 0 = rank 8 (black back rank) ... row 7 = rank 1 (white back rank)
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
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
      sq.textContent = piece ? PIECES[piece.color][piece.type] : '';
      if (piece) sq.classList.add(piece.color === 'white' ? 'piece-white' : 'piece-black');
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

// ---- Recent games list ----

const recentGames = [];

function pushRecent(gameIndex, game) {
  const { text, cls } = resultLabel(game.result);
  recentGames.unshift({ label: `#${gameIndex}`, text, cls });
  if (recentGames.length > 8) recentGames.pop();
  const list = document.getElementById('recentList');
  list.innerHTML = '';
  for (const g of recentGames) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    row.innerHTML = `<span>${g.label}</span><span class="res ${g.cls}">${g.text}</span>`;
    list.appendChild(row);
  }
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

// ---- Playback ----

async function playGame(gameIndex, game) {
  boardState = freshBoard();
  buildBoardDom();
  renderBoard(null);

  document.getElementById('gameId').textContent = shortId(game.id);
  document.getElementById('gameNumber').textContent = `Game #${gameIndex}`;
  document.getElementById('modelStep').textContent = game.model_step ?? '—';
  document.getElementById('mctsIters').textContent = game.mcts_iterations ?? '—';
  document.getElementById('result').textContent = '—';
  document.getElementById('result').className = 'v';
  setStatus('Playing…');

  const moves = game.moves || [];
  for (let i = 0; i < moves.length; i++) {
    applyMove(moves[i]);
    renderBoard(moves[i]);
    document.getElementById('plyProgress').textContent = `${i + 1} / ${moves.length}`;
    await sleep(MOVE_DELAY_MS);
  }

  const { text, cls } = resultLabel(game.result);
  document.getElementById('result').textContent = text;
  document.getElementById('result').className = `v ${cls}`;
  document.getElementById('duration').textContent = formatDuration(game.started_at, game.finished_at);
  setStatus('Game finished.');
  pushRecent(gameIndex, game);

  await sleep(END_OF_GAME_PAUSE_MS);
}

async function main() {
  let index = 0;
  buildBoardDom();
  boardState = freshBoard();
  renderBoard(null);

  while (true) {
    let games;
    try {
      games = await loadGames();
    } catch (e) {
      console.error(e);
      setStatus(`Can't load ${GAMES_FILE} — check the file name and that it's pushed.`);
      await sleep(POLL_WHEN_WAITING_MS);
      continue;
    }

    if (index >= games.length) {
      setStatus(games.length === 0
        ? `${GAMES_FILE} has no games yet.`
        : 'Waiting for the next game…');
      await sleep(POLL_WHEN_WAITING_MS);
      continue;
    }

    await playGame(index, games[index]);
    index++;
  }
}

main();

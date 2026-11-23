// Game rules shared by the server (authoritative) and the browser (score preview).

export const SIZE = 15;
export const CENTER = 7;
export const RACK_SIZE = 7;
export const BINGO = 50; // bonus for using all 7 tiles in one move
export const MAX_PLAYERS = 4;

// Tile sets: letter -> [count, points]. Two blanks (jokers) each, worth 0.
export const TILESETS = {
  en: {
    E: [12, 1], A: [8, 1], I: [8, 1], O: [7, 1], N: [6, 1], R: [6, 1], T: [6, 1], S: [6, 1],
    L: [4, 1], U: [4, 1], D: [4, 2], G: [3, 2], C: [3, 3], M: [3, 3], P: [2, 3], B: [2, 3],
    F: [2, 4], H: [2, 4], W: [2, 4], Y: [2, 4], K: [1, 5], V: [1, 5], X: [1, 8],
    J: [1, 10], Q: [1, 10], Z: [1, 10],
  },
  de: {
    E: [15, 1], N: [8, 1], S: [7, 1], R: [6, 1], T: [6, 1], I: [6, 1], A: [6, 1], U: [5, 1],
    D: [4, 1], H: [4, 2], M: [3, 2], L: [3, 2], G: [3, 2], O: [3, 2], C: [2, 3], B: [2, 3],
    K: [2, 3], F: [2, 3], W: [1, 3], Z: [1, 3], P: [1, 4], V: [1, 5], Ä: [1, 6], Ü: [1, 6],
    J: [1, 6], Ö: [1, 8], X: [1, 8], Q: [1, 10], Y: [1, 10],
  },
};
export const BLANKS = 2;
export const LANGS = Object.keys(TILESETS);
export const alphabet = (lang) => Object.keys(TILESETS[lang]).sort((a, b) => a.localeCompare(b, lang));

// Bonus squares, defined for one eighth of the board and mirrored.
const OCTANT = {
  '3W': [[0, 3]],
  '2W': [[1, 1], [2, 6], [4, 4]],
  '3L': [[0, 7], [3, 5], [6, 6]],
  '2L': [[1, 4], [2, 2], [4, 7], [5, 6]],
};
const PREMIUM = Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
for (const [kind, cells] of Object.entries(OCTANT)) {
  for (const [r, c] of cells) {
    for (const [a, b] of [[r, c], [c, r]]) {
      for (const rr of [a, SIZE - 1 - a]) for (const cc of [b, SIZE - 1 - b]) PREMIUM[rr][cc] = kind;
    }
  }
}
export const premiumAt = (r, c) => PREMIUM[r][c];

export const inBounds = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;
export const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
export const tilePoints = (t) => (t.b ? 0 : t.v);

/**
 * Checks where tiles were placed and scores the move (no dictionary check here).
 * board: SIZE x SIZE array of null | { l, v, b }
 * placed: [{ r, c, l, v, b }]
 * returns { error } or { words: [{ word, score, cells }], score, bingo }
 */
export function analyzeMove(board, placed) {
  if (!placed.length) return { error: 'noTiles' };
  const key = (r, c) => r * SIZE + c;
  const fresh = new Map();
  for (const p of placed) {
    if (!inBounds(p.r, p.c)) return { error: 'bounds' };
    if (board[p.r][p.c] || fresh.has(key(p.r, p.c))) return { error: 'occupied' };
    fresh.set(key(p.r, p.c), p);
  }
  const at = (r, c) => (inBounds(r, c) ? fresh.get(key(r, c)) || board[r][c] : null);

  const rows = new Set(placed.map((p) => p.r));
  const cols = new Set(placed.map((p) => p.c));
  let horizontal = null; // null = single tile
  if (placed.length > 1) {
    if (rows.size === 1) horizontal = true;
    else if (cols.size === 1) horizontal = false;
    else return { error: 'line' };
    const idx = placed.map((p) => (horizontal ? p.c : p.r));
    const { r, c } = placed[0];
    for (let i = Math.min(...idx); i <= Math.max(...idx); i++) {
      if (!(horizontal ? at(r, i) : at(i, c))) return { error: 'gap' };
    }
  }

  const boardEmpty = board.every((row) => row.every((x) => !x));
  if (boardEmpty) {
    if (!fresh.has(key(CENTER, CENTER))) return { error: 'center' };
  } else {
    const touches = placed.some((p) =>
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => inBounds(p.r + dr, p.c + dc) && board[p.r + dr][p.c + dc])
    );
    if (!touches) return { error: 'connect' };
  }

  const wordThrough = (r, c, dr, dc) => {
    while (at(r - dr, c - dc)) { r -= dr; c -= dc; }
    const cells = [];
    while (at(r, c)) { cells.push([r, c]); r += dr; c += dc; }
    return cells;
  };
  const found = [];
  const mainDirs = horizontal === null ? [[0, 1], [1, 0]] : horizontal ? [[0, 1]] : [[1, 0]];
  for (const [dr, dc] of mainDirs) found.push(wordThrough(placed[0].r, placed[0].c, dr, dc));
  if (horizontal !== null) {
    const [dr, dc] = horizontal ? [1, 0] : [0, 1];
    for (const p of placed) found.push(wordThrough(p.r, p.c, dr, dc));
  }
  const wordCells = found.filter((cells) => cells.length >= 2);
  if (!wordCells.length) return { error: 'short' };

  let score = 0;
  const words = wordCells.map((cells) => {
    let sum = 0, mult = 1, word = '';
    for (const [r, c] of cells) {
      const t = at(r, c);
      word += t.l;
      let v = tilePoints(t);
      if (fresh.has(key(r, c))) {
        const p = PREMIUM[r][c];
        if (p === '2L') v *= 2;
        else if (p === '3L') v *= 3;
        else if (p === '2W') mult *= 2;
        else if (p === '3W') mult *= 3;
      }
      sum += v;
    }
    score += sum * mult;
    return { word, score: sum * mult, cells };
  });
  const bingo = placed.length === RACK_SIZE;
  if (bingo) score += BINGO;
  return { words, score, bingo };
}

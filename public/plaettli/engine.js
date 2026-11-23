// Game state and moves. Runs on the Node server and, without a server, in the browser.
// A room is plain JSON, so it can be sent over the network as it is.
import {
  RACK_SIZE, MAX_PLAYERS, TILESETS, BLANKS, LANGS, alphabet, analyzeMove, emptyBoard, tilePoints,
} from './rules.js';

export class GameError extends Error {
  constructor(code, extra) { super(code); this.code = code; this.extra = extra; }
}
export const fail = (code, extra) => { throw new GameError(code, extra); };

// ctx = { randInt(n), dict(lang) -> Set | null, online(playerId) -> boolean }
export function shuffle(a, randInt) {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function newCode(randInt, taken = () => false) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[randInt(A.length)];
    if (!taken(c)) return c;
  }
}
export const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

export function newRoom(code, lang) {
  return {
    code, lang: LANGS.includes(lang) ? lang : 'de', check: true, status: 'lobby',
    players: [], board: emptyBoard(), bag: [], turn: 0, scoreless: 0, last: null, undoable: null, log: [],
  };
}

/** Returns the seat of a returning player (same name, currently offline), or null if a new seat may be added. */
export function pickSeat(room, name, isOnline) {
  const seat = room.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (seat) {
    if (isOnline(seat.id)) fail('nameTaken');
    return seat;
  }
  if (room.status === 'playing') fail('started');
  if (room.players.length >= MAX_PLAYERS) fail('roomFull');
  return null;
}
export const newPlayer = (id, name) => ({ id, name, rack: [], score: 0 });

function newBag(lang, randInt) {
  const bag = [];
  let n = 0;
  for (const [l, [count, v]] of Object.entries(TILESETS[lang])) {
    for (let i = 0; i < count; i++) bag.push({ id: `t${n++}`, l, v, b: false });
  }
  for (let i = 0; i < BLANKS; i++) bag.push({ id: `t${n++}`, l: '', v: 0, b: true });
  return shuffle(bag, randInt);
}
function draw(room, p) {
  const drawn = [];
  while (p.rack.length < RACK_SIZE && room.bag.length) { const t = room.bag.pop(); p.rack.push(t); drawn.push(t); }
  return drawn;
}
function nextTurn(room) { room.turn = (room.turn + 1) % room.players.length; }
function scorelessTurn(room) {
  room.scoreless++;
  nextTurn(room);
  if (room.scoreless >= room.players.length * 2) endGame(room, null);
}
function endGame(room, outPlayer) {
  let bonus = 0;
  for (const p of room.players) {
    const left = p.rack.reduce((s, t) => s + tilePoints(t), 0);
    p.score -= left;
    bonus += left;
  }
  if (outPlayer) outPlayer.score += bonus;
  room.status = 'ended';
  room.undoable = null;
  room.log.push({ t: 'end', pid: outPlayer?.id });
}
function requireTurn(room, player) {
  if (room.status !== 'playing') fail('notPlaying');
  if (room.players[room.turn]?.id !== player.id) fail('notYourTurn');
}

/** Moves. Each changes the room in place or throws a GameError. */
export const actions = {
  settings(room, player, body) {
    if (room.status === 'playing') fail('started');
    if (LANGS.includes(body.lang)) room.lang = body.lang;
    if (typeof body.check === 'boolean') room.check = body.check;
  },

  start(room, player, body, ctx) {
    if (room.status === 'playing') fail('started');
    room.status = 'playing';
    room.board = emptyBoard();
    room.bag = newBag(room.lang, ctx.randInt);
    room.turn = 0;
    room.scoreless = 0;
    room.last = room.undoable = null;
    room.log = [{ t: 'start' }];
    shuffle(room.players, ctx.randInt);
    for (const p of room.players) { p.score = 0; p.rack = []; draw(room, p); }
  },

  play(room, player, body, ctx) {
    requireTurn(room, player);
    player = room.players[room.turn];
    const list = Array.isArray(body.tiles) ? body.tiles : [];
    if (!list.length || list.length > RACK_SIZE) fail('noTiles');
    const letters = alphabet(room.lang);
    const used = new Set();
    const placed = list.map((x) => {
      const t = player.rack.find((t) => t.id === x?.id);
      if (!t || used.has(t.id)) fail('badTile');
      used.add(t.id);
      const r = Number(x.r), c = Number(x.c);
      if (!Number.isInteger(r) || !Number.isInteger(c)) fail('bounds');
      let l = t.l;
      if (t.b) { l = String(x.l || '').toUpperCase(); if (!letters.includes(l)) fail('blank'); }
      return { id: t.id, r, c, l, v: t.v, b: t.b };
    });
    const result = analyzeMove(room.board, placed);
    if (result.error) fail(result.error);
    if (room.check) {
      const words = ctx.dict(room.lang) || fail('dictLoading');
      const bad = result.words.map((w) => w.word).filter((w) => !words.has(w));
      if (bad.length) fail('words', { words: [...new Set(bad)] });
    }
    for (const p of placed) room.board[p.r][p.c] = { l: p.l, v: p.v, b: p.b };
    player.rack = player.rack.filter((t) => !used.has(t.id));
    const drawn = draw(room, player);
    player.score += result.score;
    room.undoable = { pid: player.id, placed, drawn, score: result.score, scoreless: room.scoreless };
    room.scoreless = 0;
    room.last = { pid: player.id, cells: placed.map((p) => [p.r, p.c]), words: result.words.map((w) => w.word), score: result.score };
    room.log.push({ t: 'play', pid: player.id, words: room.last.words, score: result.score, bingo: result.bingo });
    if (!player.rack.length && !room.bag.length) endGame(room, player);
    else nextTurn(room);
    return { score: result.score };
  },

  swap(room, player, body, ctx) {
    requireTurn(room, player);
    player = room.players[room.turn];
    const ids = [...new Set(Array.isArray(body.ids) ? body.ids : [])];
    if (!ids.length) fail('noTiles');
    if (room.bag.length < RACK_SIZE) fail('bagLow');
    const out = ids.map((id) => player.rack.find((t) => t.id === id) || fail('badTile'));
    player.rack = player.rack.filter((t) => !out.includes(t));
    draw(room, player);
    room.bag.push(...out);
    shuffle(room.bag, ctx.randInt);
    room.undoable = null;
    room.log.push({ t: 'swap', pid: player.id, n: out.length });
    scorelessTurn(room);
  },

  pass(room, player) {
    requireTurn(room, player);
    room.undoable = null;
    room.log.push({ t: 'pass', pid: player.id });
    scorelessTurn(room);
  },

  // Without the dictionary check, other players can reject the last word: tiles go back, the turn is lost.
  undo(room, player, body, ctx) {
    const u = room.undoable;
    if (room.status !== 'playing' || room.check || !u || u.pid === player.id) fail('noUndo');
    const target = room.players.find((p) => p.id === u.pid);
    for (const p of u.placed) room.board[p.r][p.c] = null;
    const drawnIds = new Set(u.drawn.map((t) => t.id));
    target.rack = target.rack.filter((t) => !drawnIds.has(t.id));
    target.rack.push(...u.placed.map((p) => ({ id: p.id, l: p.b ? '' : p.l, v: p.v, b: p.b })));
    room.bag.push(...u.drawn);
    shuffle(room.bag, ctx.randInt);
    target.score -= u.score;
    room.scoreless = u.scoreless + 1;
    room.undoable = room.last = null;
    room.log.push({ t: 'undo', pid: player.id, target: target.id });
    if (room.scoreless >= room.players.length * 2) endGame(room, null);
  },

  // Skip a player who went offline, so the game doesn't get stuck.
  skip(room, player, body, ctx) {
    if (room.status !== 'playing') fail('notPlaying');
    const current = room.players[room.turn];
    if (ctx.online(current.id)) fail('isOnline');
    room.undoable = null;
    room.log.push({ t: 'skip', pid: current.id });
    scorelessTurn(room);
  },
};

/** What one player gets to see: their own rack only. */
export function viewFor(room, pid, isOnline) {
  const me = room.players.find((p) => p.id === pid);
  const current = room.players[room.turn];
  return {
    code: room.code, lang: room.lang, check: room.check, status: room.status, you: pid,
    players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, tiles: p.rack.length, online: isOnline(p.id) })),
    rack: me ? me.rack : [],
    board: room.board, bag: room.bag.length,
    turn: room.status === 'playing' ? current?.id : null,
    last: room.last,
    canUndo: Boolean(room.undoable && !room.check && room.undoable.pid !== pid),
    log: room.log.slice(-30),
  };
}

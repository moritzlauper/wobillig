// Game state and moves. Runs on the Node server and, without a server, in the browser.
// A room is plain JSON, so it can be sent over the network as it is.
import {
  RACK_SIZE, MAX_PLAYERS, LANGS, BAG_OPTIONS, bagCounts, alphabet, analyzeMove, emptyBoard, tilePoints,
} from './rules.js';

export class GameError extends Error {
  constructor(code, extra) { super(code); this.code = code; this.extra = extra; }
}
export const fail = (code, extra) => { throw new GameError(code, extra); };

/** Seconds per turn a game can have; 0 = no limit. */
export const TIME_OPTIONS = [0, 60, 120, 300];
/** Chess clock: each player's time for the whole game in seconds, used up only on their own turns; 0 = no limit. */
export const GAME_TIME_OPTIONS = [0, 300, 600, 900, 1800];

// ctx = { randInt(n), dict(lang) -> Set | null, online(playerId) -> boolean, now() -> ms }
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
    code, lang: LANGS.includes(lang) ? lang : 'de', check: true, time: 120, gameTime: 0, bagSize: 100, public: true, status: 'lobby',
    players: [], board: emptyBoard(), bag: [], turn: 0, turnStarted: null, turnEnds: null, scoreless: 0, last: null, undoable: null, log: [],
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

function newBag(lang, randInt, size) {
  const { letters, blanks } = bagCounts(lang, size);
  const bag = [];
  let n = 0;
  for (const [l, [count, v]] of Object.entries(letters)) {
    for (let i = 0; i < count; i++) bag.push({ id: `t${n++}`, l, v, b: false });
  }
  for (let i = 0; i < blanks; i++) bag.push({ id: `t${n++}`, l: '', v: 0, b: true });
  return shuffle(bag, randInt);
}
function draw(room, p) {
  const drawn = [];
  while (p.rack.length < RACK_SIZE && room.bag.length) { const t = room.bag.pop(); p.rack.push(t); drawn.push(t); }
  return drawn;
}
// Clocks: `time` limits one turn; a player's `bank` (ms, null = no limit) is their time for the whole
// game and only runs on their own turns. The turn ends at whichever runs out first.
export const hasTime = (p) => p.bank == null || p.bank > 0;
function startClock(room, ctx) {
  room.turnStarted = room.status === 'playing' ? ctx.now() : null;
  const p = room.players[room.turn];
  const limits = [];
  if (room.time) limits.push(room.time * 1000);
  if (p?.bank != null) limits.push(p.bank);
  room.turnEnds = room.turnStarted && limits.length ? room.turnStarted + Math.min(...limits) : null;
}
function chargeClock(room, ctx) {
  const p = room.players[room.turn];
  if (p?.bank != null && room.turnStarted) {
    p.bank = Math.max(0, p.bank - (ctx.now() - room.turnStarted));
    if (p.bank < 3000) p.bank = 0; // a few seconds left can't be played anyway
  }
  room.turnStarted = ctx.now();
}
/** Next player who still has time; when nobody has any left, the game is over. */
function nextTurn(room, ctx) {
  chargeClock(room, ctx);
  for (let i = 1; i <= room.players.length; i++) {
    const j = (room.turn + i) % room.players.length;
    if (hasTime(room.players[j])) { room.turn = j; startClock(room, ctx); return; }
  }
  room.log.push({ t: 'timeover' });
  endGame(room, null);
}
/** Turns in a row without points that end the game: two rounds, or one once the bag is empty
 *  (then nobody can swap, so another round would change nothing). */
export const scorelessLimit = (room) => Math.max(1, room.players.filter(hasTime).length) * (room.bag.length ? 2 : 1);
function scorelessTurn(room, ctx) {
  room.scoreless++;
  nextTurn(room, ctx);
  if (room.status === 'playing' && room.scoreless >= scorelessLimit(room)) endGame(room, null);
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
  room.turnEnds = null;
  room.turnStarted = null;
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
    if (TIME_OPTIONS.includes(body.time)) room.time = body.time;
    if (GAME_TIME_OPTIONS.includes(body.gameTime)) room.gameTime = body.gameTime;
    if (BAG_OPTIONS.includes(body.bagSize)) room.bagSize = body.bagSize;
    if (typeof body.public === 'boolean') room.public = body.public;
  },

  start(room, player, body, ctx) {
    if (room.status === 'playing') fail('started');
    room.status = 'playing';
    room.board = emptyBoard();
    room.bag = newBag(room.lang, ctx.randInt, BAG_OPTIONS.includes(room.bagSize) ? room.bagSize : 100);
    room.turn = 0;
    room.scoreless = 0;
    room.last = room.undoable = null;
    room.log = [{ t: 'start' }];
    shuffle(room.players, ctx.randInt);
    for (const p of room.players) { p.score = 0; p.rack = []; p.bank = room.gameTime ? room.gameTime * 1000 : null; draw(room, p); }
    startClock(room, ctx);
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
    else nextTurn(room, ctx);
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
    scorelessTurn(room, ctx);
  },

  pass(room, player, body, ctx) {
    requireTurn(room, player);
    room.undoable = null;
    room.log.push({ t: 'pass', pid: player.id });
    scorelessTurn(room, ctx);
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
    if (room.scoreless >= scorelessLimit(room)) endGame(room, null);
  },

  // Skip a player who went offline, so the game doesn't get stuck.
  skip(room, player, body, ctx) {
    if (room.status !== 'playing') fail('notPlaying');
    const current = room.players[room.turn];
    if (ctx.online(current.id)) fail('isOnline');
    room.undoable = null;
    room.log.push({ t: 'skip', pid: current.id });
    scorelessTurn(room, ctx);
  },

  // The player's time is up: counts as a pass. Anyone may trigger it once the clock has run out.
  timeout(room, player, body, ctx) {
    if (room.status !== 'playing') fail('notPlaying');
    const current = room.players[room.turn];
    if (body.pid && body.pid !== current.id) fail('stale');
    if (!room.turnEnds || ctx.now() < room.turnEnds - 3000) fail('notYet');
    chargeClock(room, ctx);
    room.undoable = null;
    if (current.bank === 0) { // out of time: sits out from now on; that alone doesn't bring the end closer
      room.log.push({ t: 'outoftime', pid: current.id });
      nextTurn(room, ctx);
      if (room.status === 'playing' && room.scoreless >= scorelessLimit(room)) endGame(room, null);
    } else {
      room.log.push({ t: 'timeout', pid: current.id });
      scorelessTurn(room, ctx);
    }
  },
};

/** What one player gets to see: their own rack only. */
export function viewFor(room, pid, isOnline) {
  const me = room.players.find((p) => p.id === pid);
  const current = room.players[room.turn];
  return {
    code: room.code, lang: room.lang, check: room.check, time: room.time, gameTime: room.gameTime ?? 0, bagSize: room.bagSize ?? 100, public: room.public, status: room.status, you: pid,
    players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, tiles: p.rack.length, online: isOnline(p.id), bank: p.bank ?? null })),
    rack: me ? me.rack : [],
    board: room.board, bag: room.bag.length,
    turn: room.status === 'playing' ? current?.id : null,
    turnEnds: room.status === 'playing' ? room.turnEnds : null,
    turnStarted: room.status === 'playing' ? room.turnStarted ?? null : null,
    endIn: room.status === 'playing' ? Math.max(1, scorelessLimit(room) - room.scoreless) : null,
    last: room.last,
    canUndo: Boolean(room.undoable && !room.check && room.undoable.pid !== pid),
    log: room.log.slice(-30),
  };
}

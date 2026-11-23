// How the browser talks to the other players.
// - serverTransport: the Node server (server.js) is the referee; live updates over Server-Sent Events.
// - mqttTransport: no server at all (any static host). The game state is a retained message on a
//   public MQTT broker; the player making a move checks it with the shared engine and publishes it.
import { LANGS, SIZE, MAX_PLAYERS, emptyBoard } from './rules.js';
import { fail, actions, viewFor, newRoom, newCode, newPlayer, pickSeat, cleanName } from './engine.js';
import { Mqtt } from './mqtt.js';

export const BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const ROOT = 'plaettli/v1/';

export async function pickTransport() {
  // ?broker=ws://localhost:1234 forces the serverless mode against a local broker (for testing)
  const forced = new URLSearchParams(location.search).get('broker');
  if (forced && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(forced)) return mqttTransport(forced);
  try {
    const r = await fetch('health', { cache: 'no-store' });
    if (r.ok && (await r.json()).ok === true) return serverTransport();
  } catch { /* no server here */ }
  return mqttTransport(BROKER);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* full or blocked */ } },
};

// ---------- word lists in the browser ----------
const dicts = {};
const loading = {};
export function loadDict(lang) {
  loading[lang] ||= (async () => {
    const res = await fetch(`dict/${lang}.txt.gz`);
    if (!res.ok) throw new Error('dict');
    const buf = new Uint8Array(await res.arrayBuffer());
    const gz = buf[0] === 0x1f && buf[1] === 0x8b; // some hosts already unzip it
    const text = gz
      ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(buf);
    dicts[lang] = new Set(text.split('\n'));
    return dicts[lang];
  })().catch((e) => { loading[lang] = null; throw e; });
  return loading[lang];
}

// ---------- with server ----------
export function serverTransport() {
  let es = null, session = null, h = null;
  async function post(action, body) {
    let r;
    try {
      r = await fetch(`api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { fail('network'); }
    const data = await r.json().catch(() => ({ error: 'server' }));
    if (!r.ok) fail(data.error || 'server', data);
    return data;
  }
  function connect() {
    es?.close();
    es = new EventSource(`api/events?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`);
    es.onopen = () => h.onConn(true);
    es.onmessage = (e) => h.onState(JSON.parse(e.data));
    es.onerror = () => {
      h.onConn(false);
      if (es.readyState === EventSource.CLOSED) setTimeout(recheck, 1500);
    };
  }
  async function recheck() {
    if (!session) return;
    try { await post('hello', session); connect(); } catch (e) {
      if (e.code === 'noRoom' || e.code === 'noPlayer') h.onGone(e);
      else setTimeout(recheck, 3000);
    }
  }
  return {
    kind: 'server',
    link: (code) => `${location.origin}/${code}`,
    async create(name, lang) { const r = await post('create', { name, lang }); return { code: r.code, me: r.token }; },
    async join(code, name) { const r = await post('join', { code, name }); return { code: r.code, me: r.token }; },
    open(code, me, handlers) { session = { code, token: me }; h = handlers; connect(); },
    act: (action, body = {}) => post(action, { ...session, ...body }),
    resume() { if (session && es?.readyState === EventSource.CLOSED) recheck(); },
    close() { es?.close(); es = null; session = null; },
  };
}

// ---------- without server ----------
export function randInt(n) {
  const a = new Uint32Array(1);
  const limit = Math.floor(2 ** 32 / n) * n;
  do crypto.getRandomValues(a); while (a[0] >= limit);
  return a[0] % n;
}
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');

// Everything from the broker is untrusted (anyone can publish there): rebuild it from checked parts.
const int = (x, lo, hi) => { const n = Math.trunc(Number(x)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
const pid = (x) => (typeof x === 'string' && /^[a-z0-9]{1,16}$/.test(x) ? x : undefined);
const letter = (x) => (typeof x === 'string' && /^[A-ZÄÖÜ]$/.test(x) ? x : '');
const tileId = (x) => typeof x === 'string' && /^t\d{1,3}$/.test(x);
const tile = (t) => (t && tileId(t.id) ? { id: t.id, l: letter(t.l), v: int(t.v, 0, 10), b: t.b === true } : null);
const list = (a, max, fn) => (Array.isArray(a) ? a.slice(-max).map(fn).filter(Boolean) : []);
const word = (w) => (typeof w === 'string' && /^[A-ZÄÖÜ?]{2,15}$/.test(w) ? w : null);
const cell = (rc) => (Array.isArray(rc) ? [int(rc[0], 0, SIZE - 1), int(rc[1], 0, SIZE - 1)] : null);
const LOG_TYPES = ['start', 'play', 'swap', 'pass', 'undo', 'skip', 'end'];

export function cleanGame(g, code) {
  if (!g || typeof g !== 'object') return null;
  const players = list(g.players, MAX_PLAYERS, (p) => p && pid(p.id) && {
    id: p.id, name: cleanName(p.name) || '?', score: int(p.score, -9999, 9999), rack: list(p.rack, 7, tile),
  });
  if (!players.length) return null;
  const board = emptyBoard();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const x = Array.isArray(g.board?.[r]) ? g.board[r][c] : null;
      if (x && letter(x.l)) board[r][c] = { l: x.l, v: int(x.v, 0, 10), b: x.b === true };
    }
  }
  const last = g.last && typeof g.last === 'object' ? {
    pid: pid(g.last.pid), cells: list(g.last.cells, 7, cell), words: list(g.last.words, 10, word), score: int(g.last.score, 0, 9999),
  } : null;
  const u = g.undoable && typeof g.undoable === 'object' ? g.undoable : null;
  const undoable = u ? {
    pid: pid(u.pid),
    placed: list(u.placed, 7, (p) => p && tileId(p.id) && { id: p.id, r: int(p.r, 0, SIZE - 1), c: int(p.c, 0, SIZE - 1), l: letter(p.l), v: int(p.v, 0, 10), b: p.b === true }),
    drawn: list(u.drawn, 7, tile), score: int(u.score, 0, 9999), scoreless: int(u.scoreless, 0, 99),
  } : null;
  const log = list(g.log, 30, (e) => e && LOG_TYPES.includes(e.t) && {
    t: e.t, pid: pid(e.pid), target: pid(e.target), words: list(e.words, 10, word), score: int(e.score, 0, 9999), n: int(e.n, 0, 7), bingo: e.bingo === true,
  });
  return {
    code, lang: LANGS.includes(g.lang) ? g.lang : 'de', check: g.check !== false,
    status: g.status === 'ended' ? 'ended' : 'playing',
    players, board, bag: list(g.bag, 100, tile),
    turn: int(g.turn, 0, players.length - 1), scoreless: int(g.scoreless, 0, 99), last, undoable, log,
    v: int(g.v, 0, 1e9), w: typeof g.w === 'string' ? g.w.slice(0, 16) : '',
  };
}

/** What we know about one room, built from its retained messages:
 *  s = settings, p/<id> = who joined, g = the game, o/<id> = who is online (cleared by a last will). */
function roomState(code) {
  const prefix = `${ROOT}${code}/`;
  const st = { settings: null, game: null, members: new Map(), online: new Set() };
  st.apply = (topic, text) => {
    const key = topic.slice(prefix.length);
    let data = null;
    if (text && key !== 'o' && !key.startsWith('o/')) { try { data = JSON.parse(text); } catch { return false; } }
    if (key === 's') {
      st.settings = data && typeof data === 'object' ? { lang: LANGS.includes(data.lang) ? data.lang : 'de', check: data.check !== false, t: int(data.t, 0, 1e13) } : null;
    } else if (key === 'g') {
      const g = cleanGame(data, code);
      if (!g || (st.game && g.v < st.game.v)) return false; // older than what we have
      st.game = g;
    } else if (key.startsWith('p/') && pid(key.slice(2))) {
      if (data && typeof data === 'object') st.members.set(key.slice(2), { name: cleanName(data.name) || '?', t: int(data.t, 0, 1e13) });
      else st.members.delete(key.slice(2));
    } else if (key.startsWith('o/') && pid(key.slice(2))) {
      if (text === '1') st.online.add(key.slice(2)); else st.online.delete(key.slice(2));
    } else return false;
    return true;
  };
  st.memberList = () => [...st.members.entries()].sort((a, b) => a[1].t - b[1].t).map(([id, m]) => newPlayer(id, m.name));
  st.lobby = () => ({ ...newRoom(code, st.settings?.lang), check: st.settings?.check ?? true, players: st.memberList() });
  st.room = () => {
    if (!st.game) return st.lobby();
    const room = structuredClone(st.game);
    if (room.status === 'ended') { // settings for the next game, and people who joined since
      if (st.settings) { room.lang = st.settings.lang; room.check = st.settings.check; }
      for (const m of st.memberList()) if (!room.players.some((p) => p.id === m.id)) room.players.push(m);
    }
    return room;
  };
  return st;
}

export function mqttTransport(url) {
  const topic = (code, key) => `${ROOT}${code}/${key}`;
  let cli = null, st = null, code = null, me = null, h = null, synced = false, pending = null;
  const ctx = { randInt, dict: (l) => dicts[l] || null, online: (id) => st?.online.has(id) };

  // Reads a room's retained messages once (to create or join it).
  async function probe(c) {
    const s = roomState(c);
    const m = new Mqtt(url, { onMessage: s.apply });
    try {
      await Promise.race([m.subscribe([topic(c, '#')]), sleep(8000).then(() => { throw new Error('timeout'); })]);
      await sleep(900); // retained messages arrive right after the subscription
    } catch { m.close(); fail('network'); }
    return { s, m };
  }

  const copyKey = () => `plaettli:copy:${code}`;
  function saveCopy() {
    store.set(copyKey(), JSON.stringify({ settings: st.settings, members: [...st.members], game: st.game }));
  }
  const emit = () => h?.onState(viewFor(st.room(), me, (id) => st.online.has(id)));
  const send = (key, value) => cli.publish(topic(code, key), value === '' ? '' : JSON.stringify(value), { retain: true, qos: 1 }).catch(() => {});

  // After (re)connecting: if the broker lost the room, or missed our last move, put back our copy.
  function afterSync() {
    let copy = null;
    try { copy = JSON.parse(store.get(copyKey()) || 'null'); } catch { /* ignore */ }
    if (copy && typeof copy === 'object') {
      if (!st.settings && copy.settings) {
        st.apply(topic(code, 's'), JSON.stringify(copy.settings)) && send('s', st.settings);
        for (const [id, m] of Array.isArray(copy.members) ? copy.members : []) {
          if (pid(id) && !st.members.has(id) && st.apply(topic(code, `p/${id}`), JSON.stringify(m))) send(`p/${id}`, st.members.get(id));
        }
      }
      const g = cleanGame(copy.game, code);
      if (g && (!st.game || g.v > st.game.v)) { st.game = g; send('g', g); }
    }
    if (pending && st.game?.w === pending) send('g', st.game);
    if (!st.settings) return h.onGone({ code: 'noRoom' });
    if (!st.room().players.some((p) => p.id === me)) return h.onGone({ code: 'noPlayer' });
    saveCopy();
    emit();
  }

  return {
    kind: 'mqtt',
    link: (c) => `${location.origin}${location.pathname}${location.search}#${c}`,

    async create(name, lang) {
      name = cleanName(name) || fail('name');
      const id = rid();
      for (let i = 0; i < 5; i++) {
        const c = newCode(randInt);
        const { s, m } = await probe(c);
        if (s.settings) { m.close(); continue; } // code taken
        const t = Date.now();
        try {
          await m.publish(topic(c, 's'), JSON.stringify({ lang: LANGS.includes(lang) ? lang : 'de', check: true, t }), { retain: true, qos: 1 });
          await m.publish(topic(c, `p/${id}`), JSON.stringify({ name, t }), { retain: true, qos: 1 });
        } catch { fail('network'); } finally { m.close(); }
        return { code: c, me: id };
      }
      return fail('server');
    },

    async join(c, name) {
      name = cleanName(name) || fail('name');
      const { s, m } = await probe(c);
      try {
        if (!s.settings) fail('noRoom');
        const seat = pickSeat(s.room(), name, (id) => s.online.has(id));
        if (seat) return { code: c, me: seat.id };
        const id = rid();
        try { await m.publish(topic(c, `p/${id}`), JSON.stringify({ name, t: Date.now() }), { retain: true, qos: 1 }); } catch { fail('network'); }
        return { code: c, me: id };
      } finally { m.close(); }
    },

    open(c, id, handlers) {
      code = c; me = id; h = handlers; synced = false; st = roomState(c);
      cli = new Mqtt(url, {
        will: { topic: topic(c, `o/${id}`), payload: '', retain: true },
        onMessage: (t, text) => {
          if (!st.apply(t, text)) return;
          if (t.endsWith('/g')) { if (st.game.w === pending) pending = null; saveCopy(); }
          if (synced) emit();
        },
        onStatus: (up) => {
          h.onConn(up);
          if (!up) return;
          cli.publish(topic(c, `o/${id}`), '1', { retain: true }).catch(() => {});
          cli.subAck.then(() => sleep(900)).then(() => { synced = true; afterSync(); }).catch(() => {});
        },
      });
      cli.subs.push(topic(c, '#'));
      cli.connect().catch(() => {});
    },

    async act(name, body = {}) {
      if (!synced) fail('network');
      if (name === 'hello') return {};
      if (name === 'leave' || name === 'settings') {
        if (st.game?.status === 'playing') fail('started');
        if (name === 'leave') { await cli.publish(topic(code, `p/${me}`), '', { retain: true, qos: 1 }).catch(() => fail('network')); return {}; }
        const s = { ...(st.settings || { lang: 'de', check: true }), t: Date.now() };
        if (LANGS.includes(body.lang)) s.lang = body.lang;
        if (typeof body.check === 'boolean') s.check = body.check;
        st.settings = s;
        emit();
        send('s', s);
        return {};
      }
      let room;
      if (name === 'start') {
        if (st.game?.status === 'playing') fail('started');
        room = st.lobby();
      } else {
        if (!st.game || !Object.hasOwn(actions, name)) fail('notPlaying');
        room = structuredClone(st.game);
      }
      const player = room.players.find((p) => p.id === me) || fail('noPlayer');
      if (name === 'play' && room.check && !dicts[room.lang]) {
        try { await loadDict(room.lang); } catch { fail('dictLoading'); }
      }
      const res = actions[name](room, player, body, ctx);
      room.log = room.log.slice(-30);
      room.v = (st.game?.v || 0) + 1;
      room.w = rid();
      pending = room.w;
      st.game = room;
      saveCopy();
      emit();
      send('g', room); // retried after a reconnect if it doesn't come back
      return res || {};
    },

    preload(lang) { loadDict(lang).catch(() => {}); },
    resume() { if (cli && !cli.online) cli.connect().catch(() => {}); },
    close() {
      if (!cli) return;
      cli.publish(topic(code, `o/${me}`), '', { retain: true }).catch(() => {}); // sent at once while connected
      cli.close();
      cli = null; h = null;
    },
  };
}

import { SIZE, CENTER, MAX_PLAYERS, BINGO, alphabet, premiumAt, analyzeMove } from './rules.js';
import { pickTransport } from './net.js';

// ---------- texts ----------
const TEXT = {
  de: {
    tagline: 'Wortspiel mit Buchstabenplättli für 1–4 Personen. Link teilen, losspielen.',
    yourName: 'Dein Name', create: 'Neues Spiel erstellen', join: 'Beitreten', joinGame: 'Spiel {code} beitreten',
    or: 'oder mit Code beitreten', orNew: 'Stattdessen neues Spiel erstellen', codePh: 'CODE',
    howTo: 'So wird gespielt',
    rules: [
      'Lege Wörter aus deinen 7 Plättli: in einer Reihe oder Spalte, verbunden mit Wörtern auf dem Brett.',
      'Das erste Wort geht über den Stern in der Mitte.',
      'Punkte = Summe der Buchstabenwerte. 2B/3B verdoppelt/verdreifacht einen Buchstaben, 2W/3W das ganze Wort.',
      `Alle 7 Plättli in einem Zug: +${BINGO} Punkte. Die leeren Plättli sind Joker (0 Punkte).`,
      'Das Spiel endet, wenn der Beutel leer ist und jemand alle Plättli gelegt hat. Restpunkte werden abgezogen.',
      'Antippen und dann aufs Feld tippen, oder einfach ziehen.',
    ],
    code: 'Spielcode', copyLink: 'Link kopieren', share: 'Teilen', copied: 'Link kopiert',
    shareHint: 'Schick den Link deinen Freunden. Bis zu 4 Personen.', shareText: 'Spiel mit mir Plättli!',
    players: 'Mitspielende', you: '(du)', language: 'Sprache', checkWords: 'Wörter prüfen',
    checkOn: 'Nur Wörter aus dem Wörterbuch sind erlaubt.',
    checkOff: 'Alle Wörter erlaubt. Mitspielende können ein Wort ablehnen.',
    start: 'Spiel starten', leave: 'Spiel verlassen', bag: 'Beutel',
    yourTurn: 'Du bist dran', waiting: '{name} ist dran', offline: 'offline', skip: 'Überspringen',
    reject: 'Ablehnen', play: 'Legen', recall: 'Zurück', shuffle: 'Mischen', swap: 'Tauschen', pass: 'Passen',
    cancel: 'Abbrechen', swapN: '{n} tauschen', swapHint: 'Wähle die Plättli, die du tauschen willst.',
    passConfirm: 'Wirklich passen?', pickLetter: 'Welcher Buchstabe soll der Joker sein?',
    gameOver: 'Spiel vorbei', wins: '{name} gewinnt!', tie: 'Unentschieden!', again: 'Nochmals spielen',
    results: 'Resultat', home: 'Startseite', reconnecting: 'Verbindung wird wiederhergestellt …',
    empty: 'Keine Plättli mehr', points: 'Pkt.',
    l2L: '2B = Buchstabe ×2', l3L: '3B = Buchstabe ×3', l2W: '2W = Wort ×2', l3W: '3W = Wort ×3',
    log_start: 'Spiel gestartet', log_play: '{name}: {words} +{score}', log_bingo: ' (alle 7!)',
    log_swap: '{name} hat {n} getauscht', log_pass: '{name} hat gepasst', log_undo: '{name} hat den Zug von {target} abgelehnt',
    log_skip: '{name} wurde übersprungen', log_end: 'Spiel vorbei',
    err_noRoom: 'Spiel nicht gefunden. Wurde der Server neu gestartet?', err_noPlayer: 'Du bist nicht in diesem Spiel.',
    err_name: 'Bitte gib einen Namen ein.', err_full: 'Server ist voll, versuch es später.',
    err_nameTaken: 'Dieser Name ist schon im Spiel.', err_started: 'Das Spiel läuft schon.', err_roomFull: 'Das Spiel ist voll (max. 4).',
    err_notPlaying: 'Das Spiel läuft nicht.', err_notYourTurn: 'Du bist nicht dran.', err_noTiles: 'Lege zuerst Plättli aufs Brett.',
    err_badTile: 'Ungültiges Plättli.', err_bounds: 'Ausserhalb des Bretts.', err_blank: 'Wähle einen Buchstaben für den Joker.',
    err_occupied: 'Das Feld ist besetzt.', err_line: 'Alle Plättli in eine Reihe oder Spalte.', err_gap: 'Das Wort hat eine Lücke.',
    err_center: 'Das erste Wort muss über den Stern.', err_connect: 'Das Wort muss an ein bestehendes anschliessen.',
    err_short: 'Ein Wort braucht mindestens 2 Buchstaben.', err_words: 'Nicht im Wörterbuch: {words}',
    err_bagLow: 'Tauschen geht nur mit mindestens 7 Plättli im Beutel.', err_noUndo: 'Dieser Zug kann nicht abgelehnt werden.',
    err_isOnline: 'Diese Person ist online.', err_server: 'Serverfehler.', err_network: 'Keine Verbindung. Bitte nochmals versuchen.',
    err_dictLoading: 'Das Wörterbuch konnte nicht geladen werden. Bitte nochmals versuchen.',
  },
  en: {
    tagline: 'A word-tile game for 1–4 players. Share the link and play.',
    yourName: 'Your name', create: 'Create new game', join: 'Join', joinGame: 'Join game {code}',
    or: 'or join with a code', orNew: 'Create a new game instead', codePh: 'CODE',
    howTo: 'How to play',
    rules: [
      'Build words from your 7 tiles: in one row or column, connected to words on the board.',
      'The first word must cover the star in the middle.',
      'Score = sum of letter values. 2L/3L doubles/triples one letter, 2W/3W the whole word.',
      `All 7 tiles in one move: +${BINGO} points. The empty tiles are jokers (0 points).`,
      'The game ends when the bag is empty and someone has used all tiles. Leftover points are subtracted.',
      'Tap a tile, then tap a square, or just drag it.',
    ],
    code: 'Game code', copyLink: 'Copy link', share: 'Share', copied: 'Link copied',
    shareHint: 'Send the link to your friends. Up to 4 players.', shareText: 'Play Plättli with me!',
    players: 'Players', you: '(you)', language: 'Language', checkWords: 'Check words',
    checkOn: 'Only dictionary words are allowed.',
    checkOff: 'Any word goes. Other players can reject a word.',
    start: 'Start game', leave: 'Leave game', bag: 'Bag',
    yourTurn: 'Your turn', waiting: "{name}'s turn", offline: 'offline', skip: 'Skip',
    reject: 'Reject', play: 'Play', recall: 'Recall', shuffle: 'Shuffle', swap: 'Swap', pass: 'Pass',
    cancel: 'Cancel', swapN: 'Swap {n}', swapHint: 'Pick the tiles you want to swap.',
    passConfirm: 'Really pass?', pickLetter: 'Which letter should the joker be?',
    gameOver: 'Game over', wins: '{name} wins!', tie: "It's a tie!", again: 'Play again',
    results: 'Results', home: 'Home', reconnecting: 'Reconnecting …',
    empty: 'No tiles left', points: 'pts',
    l2L: '2L = letter ×2', l3L: '3L = letter ×3', l2W: '2W = word ×2', l3W: '3W = word ×3',
    log_start: 'Game started', log_play: '{name}: {words} +{score}', log_bingo: ' (all 7!)',
    log_swap: '{name} swapped {n}', log_pass: '{name} passed', log_undo: "{name} rejected {target}'s move",
    log_skip: '{name} was skipped', log_end: 'Game over',
    err_noRoom: 'Game not found. Maybe the server restarted?', err_noPlayer: "You're not in this game.",
    err_name: 'Please enter a name.', err_full: 'Server is full, try again later.',
    err_nameTaken: 'That name is already in the game.', err_started: 'The game has already started.', err_roomFull: 'The game is full (max 4).',
    err_notPlaying: 'The game is not running.', err_notYourTurn: "It's not your turn.", err_noTiles: 'Place some tiles first.',
    err_badTile: 'Invalid tile.', err_bounds: 'Outside the board.', err_blank: 'Pick a letter for the joker.',
    err_occupied: 'That square is taken.', err_line: 'Put all tiles in one row or column.', err_gap: 'The word has a gap.',
    err_center: 'The first word must cover the star.', err_connect: 'The word must connect to an existing word.',
    err_short: 'A word needs at least 2 letters.', err_words: 'Not in the dictionary: {words}',
    err_bagLow: 'You can only swap while 7 or more tiles are in the bag.', err_noUndo: "This move can't be rejected.",
    err_isOnline: 'That player is online.', err_server: 'Server error.', err_network: 'No connection. Please try again.',
    err_dictLoading: "The dictionary couldn't be loaded. Please try again.",
  },
};
const PREMIUM_LABEL = { de: { '2L': '2B', '3L': '3B', '2W': '2W', '3W': '3W' }, en: { '2L': '2L', '3L': '3L', '2W': '2W', '3W': '3W' } };

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
let ui = store.get('plaettli:ui') || ((navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en');
const t = (k, vars = {}) => String(TEXT[ui][k] ?? TEXT.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- state ----------
const app = document.getElementById('app');
let session = null;        // { code, me }
let S = null;              // latest game state as this player sees it
let connected = true;
let pending = [];          // tiles placed on the board this turn: { id, r, c, l }
let order = [];            // rack order (tile ids)
let selected = null;       // tile id picked by tap
let swapMode = false;
const swapSel = new Set();
let drag = null;
let busy = false;
let showResults = true;
let picker = null;         // { id } while choosing a joker letter
let homeCode = null;
let zoom = false;          // board zoomed in (phones)
const ZOOM = 1.9;
let lastBoardTap = null;   // for double-tap zoom
let prevTurn;

// ---------- connection (server or serverless, see net.js) ----------
const T = await pickTransport();
function errText(e) {
  const code = e.code || 'server';
  return t(`err_${code}`, { words: (e.extra?.words || e.data?.words || []).join(', ') });
}
async function guard(fn) {
  if (busy) return null;
  busy = true;
  try { return await fn(); } catch (e) { toast(errText(e)); return null; } finally { busy = false; }
}
const run = (action, body) => guard(() => T.act(action, body));
const homeUrl = () => (T.kind === 'server' ? '/' : location.pathname + location.search);
const gameUrl = (code) => (T.kind === 'server' ? `/${code}` : `${location.pathname}${location.search}#${code}`);

function enter(code, me) {
  session = { code, me };
  store.set(`plaettli:${code}`, me);
  if (location.pathname + location.hash !== gameUrl(code)) history.replaceState(null, '', gameUrl(code));
  T.open(code, me, {
    onState: (view) => { S = view; onState(); },
    onConn: setConnected,
    onGone: (e) => { toast(errText(e)); goHome(); },
  });
}
function setConnected(v) {
  connected = v;
  document.querySelector('.conn')?.remove();
  if (!v && session) app.insertAdjacentHTML('beforeend', `<div class="conn">${t('reconnecting')}</div>`);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session) T.resume();
});
window.addEventListener('pagehide', () => { if (session) T.close(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
function leaveGame() {
  T.close();
  session = null; S = null; pending = []; order = [];
  document.title = 'Plättli';
}
function goHome() {
  if (session) store.del(`plaettli:${session.code}`);
  leaveGame();
  history.replaceState(null, '', homeUrl());
  renderHome(null);
}

function onState() {
  if (!S.players.some((p) => p.id === S.you)) return goHome();
  const ids = S.rack.map((x) => x.id);
  order = order.filter((id) => ids.includes(id)).concat(ids.filter((id) => !order.includes(id)));
  pending = pending.filter((p) => ids.includes(p.id) && !S.board[p.r][p.c]);
  if (S.status !== 'playing') { pending = []; swapMode = false; swapSel.clear(); }
  for (const id of [...swapSel]) if (!ids.includes(id)) swapSel.delete(id);
  if (!ids.includes(selected)) selected = null;
  const mine = S.status === 'playing' && S.turn === S.you;
  document.title = mine ? `● ${t('yourTurn')} · Plättli` : 'Plättli';
  if (mine && prevTurn !== undefined && prevTurn !== S.you && document.visibilityState === 'visible') navigator.vibrate?.(120);
  prevTurn = S.turn;
  if (S.status === 'playing' && S.check) T.preload?.(S.lang);
  if (drag) return; // re-rendered when the drag ends
  render();
}

// ---------- helpers ----------
const rackTile = (id) => S.rack.find((x) => x.id === id);
const pendingAt = (r, c) => pending.find((p) => p.r === r && p.c === c);
const playerName = (id) => S.players.find((p) => p.id === id)?.name ?? '?';
const isMyTurn = () => S?.status === 'playing' && S.turn === S.you;
const shareUrl = () => T.link(session.code);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function preview() {
  if (!pending.length) return null;
  const placed = pending.map((p) => {
    const tile = rackTile(p.id);
    return { r: p.r, c: p.c, l: tile.b ? p.l || '?' : tile.l, v: tile.v, b: tile.b };
  });
  return analyzeMove(S.board, placed);
}

function header(extra = '', right = '') {
  return `<header class="top">
    <a class="brand" href="/" data-act="home"><i>P</i><span>Plättli</span></a>
    ${extra}
    <span class="spacer"></span>
    ${right}
    <button class="chip" data-act="ui">${ui === 'de' ? 'EN' : 'DE'}</button>
  </header>`;
}
function langSeg(current, act) {
  return `<div class="seg">${['de', 'en'].map((l) => `<button data-act="${act}" data-v="${l}" class="${current === l ? 'on' : ''}">${l === 'de' ? 'Deutsch' : 'English'}</button>`).join('')}</div>`;
}
function settingsBlock() {
  return `<div class="setting"><span>${t('language')}</span>${langSeg(S.lang, 'lang')}</div>
    <label class="setting"><span>${t('checkWords')}</span><input type="checkbox" class="switch" data-act="check" ${S.check ? 'checked' : ''}></label>
    <p class="muted small" style="margin:-6px 0 0">${S.check ? t('checkOn') : t('checkOff')}</p>`;
}

// ---------- screens ----------
function render() {
  document.body.classList.toggle('in-game', Boolean(S && S.status !== 'lobby'));
  if (!S) return renderHome();
  if (S.status === 'lobby') renderLobby();
  else renderGame();
  setConnected(connected);
}

function renderHome(code = homeCode) {
  homeCode = code;
  document.body.classList.remove('in-game');
  const name = esc(store.get('plaettli:name') || '');
  const gameLang = store.get('plaettli:lang') || ui;
  app.innerHTML = `${header()}
  <section class="card">
    <p class="tagline">${t('tagline')}</p>
    <label>${t('yourName')}<input type="text" id="name" maxlength="20" value="${name}" autocomplete="nickname" autocapitalize="words" enterkeyhint="go"></label>
    ${code ? `
      <button class="primary big" data-act="join" data-code="${code}">${t('joinGame', { code })}</button>
      <button class="link" data-act="forget">${t('orNew')}</button>
    ` : `
      ${langSeg(gameLang, 'newlang')}
      <button class="primary big" data-act="create">${t('create')}</button>
      <div class="or">${t('or')}</div>
      <div class="row">
        <input type="text" id="code" class="code-input" maxlength="4" placeholder="${t('codePh')}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go">
        <button data-act="join">${t('join')}</button>
      </div>
    `}
  </section>
  <details class="help"><summary>${t('howTo')}</summary><ul>${TEXT[ui].rules.map((r) => `<li>${r}</li>`).join('')}</ul></details>`;
  const input = document.getElementById(!name || code ? 'name' : 'code');
  if (input && !matchMedia('(pointer: coarse)').matches) input.focus();
}

function renderLobby() {
  const me = S.you;
  app.innerHTML = `${header()}
  <section class="card">
    <div class="center muted small">${t('code')}</div>
    <div class="bigcode">${esc(S.code)}</div>
    <div class="row">
      <button style="flex:1" data-act="copy">${t('copyLink')}</button>
      ${navigator.share ? `<button style="flex:1" data-act="share">${t('share')}</button>` : ''}
    </div>
    <p class="muted small center" style="margin:-4px 0 0">${t('shareHint')}</p>
    <h3>${t('players')} (${S.players.length}/${MAX_PLAYERS})</h3>
    <ul class="plist">${S.players.map((p) => `<li class="${p.online ? '' : 'off'}"><span class="dot"></span>${esc(p.name)} ${p.id === me ? `<span class="you">${t('you')}</span>` : ''}</li>`).join('')}</ul>
    ${settingsBlock()}
    <button class="primary big" data-act="start">${t('start')}</button>
    <button class="link" data-act="leave">${t('leave')}</button>
  </section>
  <details class="help"><summary>${t('howTo')}</summary><ul>${TEXT[ui].rules.map((r) => `<li>${r}</li>`).join('')}</ul></details>`;
}

function renderGame() {
  const prev = preview();
  const lastCells = new Set((S.last?.cells || []).map(([r, c]) => `${r},${c}`));
  const labels = PREMIUM_LABEL[ui];
  let cells = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const tile = S.board[r][c];
      const p = pendingAt(r, c);
      const prem = premiumAt(r, c);
      if (tile) {
        cells += `<div class="cell"><div class="tile ${tile.b ? 'blank' : ''} ${lastCells.has(`${r},${c}`) ? 'last' : ''}">${esc(tile.l)}${tile.b ? '' : `<sub>${tile.v}</sub>`}</div></div>`;
      } else if (p) {
        const rt = rackTile(p.id);
        cells += `<div class="cell" data-r="${r}" data-c="${c}"><div class="tile new ${rt.b ? 'blank' : ''}" data-id="${p.id}">${esc(rt.b ? p.l || '?' : rt.l)}${rt.b ? '' : `<sub>${rt.v}</sub>`}</div></div>`;
      } else {
        const star = r === CENTER && c === CENTER;
        cells += `<div class="cell ${prem ? `p${prem}` : ''} ${star ? 'star' : ''}" data-r="${r}" data-c="${c}"><span class="lbl">${star ? '★' : prem ? labels[prem] : ''}</span></div>`;
      }
    }
  }

  const players = S.players.map((p) => `<div class="pchip ${p.id === S.turn ? 'active' : ''} ${p.online ? '' : 'off'}" title="${esc(p.name)}">
      <span class="dot"></span><b>${esc(p.name)}</b><span class="sc">${p.score}</span></div>`).join('')
;

  const rackIds = order.filter((id) => !pending.some((p) => p.id === id));
  const rack = rackIds.length
    ? rackIds.map((id) => {
      const x = rackTile(id);
      const cls = [x.b ? 'blank' : '', selected === id ? 'sel' : '', swapSel.has(id) ? 'swap' : ''].join(' ');
      return `<div class="tile ${cls}" data-id="${id}">${x.b ? '' : esc(x.l)}${x.b ? '' : `<sub>${x.v}</sub>`}</div>`;
    }).join('')
    : `<span class="empty">${t('empty')}</span>`;

  // status
  let status = '';
  if (S.status === 'ended') {
    status += `<div class="line"><span class="turn">${t('gameOver')}</span><button data-act="results">${t('results')}</button></div>`;
  } else if (isMyTurn()) {
    status += `<div class="turn mine">${t('yourTurn')}</div>`;
  } else {
    const cur = S.players.find((p) => p.id === S.turn);
    status += `<div class="line"><span class="turn">${t('waiting', { name: esc(cur?.name ?? '') })}</span>${cur && !cur.online ? `<span class="muted">(${t('offline')})</span><button data-act="skip">${t('skip')}</button>` : ''}</div>`;
  }
  if (S.last) {
    status += `<div class="line muted"><span><b>${esc(playerName(S.last.pid))}</b>: ${esc(S.last.words.join(', '))} +${S.last.score}</span>${S.canUndo ? `<button data-act="undo">${t('reject')}</button>` : ''}</div>`;
  }
  if (swapMode) status += `<div class="preview">${t('swapHint')}</div>`;
  else if (prev) {
    status += prev.error
      ? `<div class="preview bad">${t(`err_${prev.error}`)}</div>`
      : `<div class="preview">${esc(prev.words.map((w) => w.word).join(', '))} = <b>${prev.score}</b> ${t('points')}${prev.bingo ? t('log_bingo') : ''}</div>`;
  }

  // controls
  let controls = '';
  if (S.status === 'playing') {
    const mine = isMyTurn();
    controls = swapMode
      ? `<div class="controls two"><button data-act="swapCancel">${t('cancel')}</button>
         <button class="primary" data-act="swapGo" ${swapSel.size && mine ? '' : 'disabled'}>${t('swapN', { n: swapSel.size })}</button></div>`
      : `<div class="controls">
          ${pending.length ? `<button data-act="recall">${t('recall')}</button>` : `<button data-act="shuffle">${t('shuffle')}</button>`}
          <button data-act="swap" ${mine && S.bag >= 7 ? '' : 'disabled'}>${t('swap')}</button>
          <button data-act="pass" ${mine ? '' : 'disabled'}>${t('pass')}</button>
          <button class="primary" data-act="play" ${mine && prev && !prev.error ? '' : 'disabled'}>${t('play')}${prev && !prev.error ? ` +${prev.score}` : ''}</button>
        </div>`;
  }

  const log = S.log.slice(-8).reverse().map((e) => {
    const vars = { name: `<b>${esc(playerName(e.pid))}</b>`, target: `<b>${esc(playerName(e.target))}</b>`, words: esc((e.words || []).join(', ')), score: e.score, n: e.n };
    return `<li>${t(`log_${e.t}`, vars)}${e.bingo ? t('log_bingo') : ''}</li>`;
  }).join('');

  const legend = ['2L', '3L', '2W', '3W'].map((k) => `<span class="l${k}">${t(`l${k}`)}</span>`).join('');

  const oldWrap = app.querySelector('.board-wrap');
  const scroll = oldWrap ? [oldWrap.scrollLeft, oldWrap.scrollTop] : [0, 0];
  const zoomIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M7.5 10.5h6${zoom ? '' : 'M10.5 7.5v6'}"/></svg>`;
  app.innerHTML = `${header(`<button class="chip" data-act="invite">${esc(S.code)}</button>`,
    `<span class="chip">${t('bag')} ${S.bag}</span><button class="chip zoom-btn" data-act="zoom" aria-label="Zoom">${zoomIcon}</button>`)}
  <div class="game">
    <div class="players">${players}</div>
    <div class="board-wrap ${zoom ? 'zoomed' : ''}"><div class="board">${cells}</div></div>
    <div class="dock">
      <div class="status">${status}</div>
      <div class="rack">${rack}</div>
      ${controls}
    </div>
    <ol class="log">${log}</ol>
    <div class="legend">${legend}</div>
  </div>
  ${S.status === 'ended' && showResults ? endOverlay() : ''}
  ${picker ? pickerOverlay() : ''}`;
  if (zoom) { const w = app.querySelector('.board-wrap'); w.scrollLeft = scroll[0]; w.scrollTop = scroll[1]; }
}

function toggleZoom(cx, cy) {
  const wrap = app.querySelector('.board-wrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  const px = (cx ?? r.left + r.width / 2) - r.left;
  const py = (cy ?? r.top + r.height / 2) - r.top;
  zoom = !zoom;
  render();
  if (zoom) { // keep the tapped spot under the finger
    const w = app.querySelector('.board-wrap');
    w.scrollLeft = px * ZOOM - px;
    w.scrollTop = py * ZOOM - py;
  }
}

function endOverlay() {
  const ranked = [...S.players].sort((a, b) => b.score - a.score);
  const top = ranked.filter((p) => p.score === ranked[0].score);
  return `<div class="overlay"><section class="card">
    <div class="card-head"><h2>${top.length > 1 ? t('tie') : t('wins', { name: esc(top[0].name) })}</h2><button class="x" data-act="closeResults" aria-label="close">×</button></div>
    <ol class="results">${ranked.map((p) => `<li><span>${esc(p.name)}</span><b>${p.score}</b></li>`).join('')}</ol>
    ${settingsBlock()}
    <button class="primary big" data-act="start">${t('again')}</button>
    <button class="link" data-act="home">${t('home')}</button>
  </section></div>`;
}

function pickerOverlay() {
  return `<div class="overlay" data-act="pickCancel"><section class="card">
    <h3>${t('pickLetter')}</h3>
    <div class="letters">${alphabet(S.lang).map((l) => `<button data-act="pick" data-v="${l}">${l}</button>`).join('')}</div>
    <button data-act="pickCancel">${t('cancel')}</button>
  </section></div>`;
}

// ---------- placing tiles ----------
function placeAt(id, r, c) {
  const tile = rackTile(id);
  const other = pendingAt(r, c);
  if (tile && !S.board[r][c] && (!other || other.id === id)) {
    const existing = pending.find((p) => p.id === id);
    if (existing) { existing.r = r; existing.c = c; }
    else pending.push({ id, r, c, l: tile.b ? '' : tile.l });
    selected = null;
    if (tile.b && !pending.find((p) => p.id === id).l) picker = { id };
  }
  render();
}
function unplace(id) {
  pending = pending.filter((p) => p.id !== id);
  render();
}

// ---------- clicks ----------
app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    if (cell.dataset.r && !e.target.closest('.tile') && selected && S?.status === 'playing') return placeAt(selected, +cell.dataset.r, +cell.dataset.c);
    if (e.target.closest('.tile.new')) return;
    const now = Date.now(); // double tap toggles zoom
    if (lastBoardTap && now - lastBoardTap.t < 350 && Math.hypot(e.clientX - lastBoardTap.x, e.clientY - lastBoardTap.y) < 40) {
      lastBoardTap = null;
      toggleZoom(e.clientX, e.clientY);
    } else lastBoardTap = { t: now, x: e.clientX, y: e.clientY };
    return;
  }
  if (el.classList.contains('overlay') && e.target !== el) return; // clicks inside a dialog
  const act = el.dataset.act;
  const v = el.dataset.v;
  const nameVal = () => (document.getElementById('name')?.value || '').trim();

  switch (act) {
    case 'ui':
      ui = ui === 'de' ? 'en' : 'de';
      store.set('plaettli:ui', ui);
      document.documentElement.lang = ui;
      if (S) onState(); else renderHome();
      break;
    case 'home': // keeps your seat: opening the game link again brings you back
      e.preventDefault();
      leaveGame();
      if (location.pathname + location.hash !== homeUrl()) history.pushState(null, '', homeUrl());
      renderHome(null);
      break;
    case 'newlang':
      store.set('plaettli:lang', v);
      renderHome();
      break;
    case 'create': {
      const name = nameVal();
      if (!name) return toast(t('err_name'));
      store.set('plaettli:name', name);
      const res = await guard(() => T.create(name, store.get('plaettli:lang') || ui));
      if (res) enter(res.code, res.me);
      break;
    }
    case 'join': {
      const name = nameVal();
      const code = (el.dataset.code || document.getElementById('code')?.value || '').trim().toUpperCase();
      if (!name) return toast(t('err_name'));
      if (!/^[A-Z]{4}$/.test(code)) return document.getElementById('code')?.focus();
      store.set('plaettli:name', name);
      const res = await guard(() => T.join(code, name));
      if (res) enter(res.code, res.me);
      break;
    }
    case 'forget':
      history.replaceState(null, '', homeUrl());
      renderHome(null);
      break;
    case 'copy':
      try { await navigator.clipboard.writeText(shareUrl()); toast(t('copied')); } catch { prompt(t('copyLink'), shareUrl()); }
      break;
    case 'zoom': toggleZoom(); break;
    case 'invite':
      if (navigator.share) navigator.share({ title: 'Plättli', text: t('shareText'), url: shareUrl() }).catch(() => {});
      else { try { await navigator.clipboard.writeText(shareUrl()); toast(t('copied')); } catch { prompt(t('copyLink'), shareUrl()); } }
      break;
    case 'share':
      navigator.share({ title: 'Plättli', text: t('shareText'), url: shareUrl() }).catch(() => {});
      break;
    case 'lang': run('settings', { lang: v }); break;
    case 'leave': if (await run('leave')) goHome(); break;
    case 'start': showResults = true; run('start'); break;
    case 'results': showResults = true; render(); break;
    case 'closeResults': showResults = false; render(); break;
    case 'shuffle':
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      render();
      break;
    case 'recall': pending = []; render(); break;
    case 'swap': pending = []; selected = null; swapMode = true; render(); break;
    case 'swapCancel': swapMode = false; swapSel.clear(); render(); break;
    case 'swapGo':
      if (await run('swap', { ids: [...swapSel] })) { swapMode = false; swapSel.clear(); render(); }
      break;
    case 'pass': if (confirm(t('passConfirm'))) run('pass'); break;
    case 'skip': run('skip'); break;
    case 'undo': run('undo'); break;
    case 'play': {
      const res = await run('play', { tiles: pending.map(({ id, r, c, l }) => ({ id, r, c, l })) });
      if (res) { pending = []; render(); }
      break;
    }
    case 'pick': {
      const p = pending.find((x) => x.id === picker?.id);
      if (p) p.l = v;
      picker = null;
      render();
      break;
    }
    case 'pickCancel':
      if (picker) pending = pending.filter((x) => x.id !== picker.id);
      picker = null;
      render();
      break;
  }
});
app.addEventListener('change', (e) => {
  if (e.target.dataset.act === 'check') run('settings', { check: e.target.checked });
});
app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') app.querySelector('[data-act=join]')?.click();
  if (e.target.id === 'name') app.querySelector('[data-act=join],[data-act=create]')?.click();
});

// ---------- drag & drop (mouse and touch) ----------
// On touch screens the tile floats above the finger, and the drop spot is under the floating tile.
const dropPoint = (d, e) => [e.clientX, e.clientY - d.lift];
app.addEventListener('pointerdown', (e) => {
  const tile = e.target.closest('.tile[data-id]');
  if (!tile || S?.status !== 'playing' || e.button > 0) return;
  e.preventDefault();
  drag = {
    id: tile.dataset.id, fromBoard: Boolean(tile.closest('.board')), x: e.clientX, y: e.clientY, el: tile,
    moved: false, pid: e.pointerId, lift: e.pointerType === 'mouse' ? 0 : 52,
  };
});
function edgeScroll() { // zoomed board scrolls when a dragged tile nears its edge
  if (!drag?.edge) return;
  const w = app.querySelector('.board-wrap');
  w.scrollLeft += drag.edge[0] * 9;
  w.scrollTop += drag.edge[1] * 9;
  requestAnimationFrame(edgeScroll);
}
window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6 || swapMode) return;
    drag.moved = true;
    drag.ghost = drag.el.cloneNode(true);
    drag.ghost.className = `tile drag-ghost ${drag.el.classList.contains('blank') ? 'blank' : ''}`;
    document.body.appendChild(drag.ghost);
    drag.el.classList.add('ghosted');
    navigator.vibrate?.(8);
  }
  const [x, y] = dropPoint(drag, e);
  drag.ghost.style.transform = `translate(${x - 26}px, ${y - 26}px)`;
  const cell = document.elementFromPoint(x, y)?.closest('.cell[data-r]');
  if (cell !== drag.hover) { drag.hover?.classList.remove('hover'); cell?.classList.add('hover'); drag.hover = cell; }
  if (zoom) {
    const r = app.querySelector('.board-wrap').getBoundingClientRect();
    const inside = x > r.left - 20 && x < r.right + 20 && y > r.top - 20 && y < r.bottom + 20;
    const ex = !inside ? 0 : x < r.left + 28 ? -1 : x > r.right - 28 ? 1 : 0;
    const ey = !inside ? 0 : y < r.top + 28 ? -1 : y > r.bottom - 28 ? 1 : 0;
    const was = drag.edge;
    drag.edge = ex || ey ? [ex, ey] : null;
    if (drag.edge && !was) requestAnimationFrame(edgeScroll);
  }
});
window.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag;
  drag = null;
  d.ghost?.remove();
  d.hover?.classList.remove('hover');
  if (!d.moved) { // tap
    if (d.fromBoard) unplace(d.id);
    else if (swapMode) { swapSel.has(d.id) ? swapSel.delete(d.id) : swapSel.add(d.id); render(); }
    else { selected = selected === d.id ? null : d.id; render(); }
    return;
  }
  const [x, y] = dropPoint(d, e);
  const cell = document.elementFromPoint(x, y)?.closest('.cell[data-r]');
  if (cell) return placeAt(d.id, +cell.dataset.r, +cell.dataset.c);
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const target = under?.closest('.rack') ? under : document.elementFromPoint(x, y);
  if (target?.closest('.rack')) {
    pending = pending.filter((p) => p.id !== d.id);
    const over = target.closest('.tile[data-id]');
    order = order.filter((id) => id !== d.id);
    if (over && over.dataset.id !== d.id) {
      const box = over.getBoundingClientRect();
      const i = order.indexOf(over.dataset.id) + (e.clientX > box.left + box.width / 2 ? 1 : 0);
      order.splice(i, 0, d.id);
    } else order.push(d.id);
  }
  render();
});
window.addEventListener('pointercancel', () => {
  if (!drag) return;
  drag.ghost?.remove();
  drag.hover?.classList.remove('hover');
  drag = null;
  render();
});

window.addEventListener('popstate', () => location.reload());

// ---------- start ----------
document.documentElement.lang = ui;
const m = location.pathname.match(/^\/([A-Za-z]{4})$/) || location.hash.match(/^#([A-Za-z]{4})$/);
const startCode = m ? m[1].toUpperCase() : null;
const saved = startCode && store.get(`plaettli:${startCode}`);
if (saved) enter(startCode, saved);
else renderHome(startCode);
window.addEventListener('hashchange', () => location.reload());

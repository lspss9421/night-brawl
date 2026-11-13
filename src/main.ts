import { CHARACTER_IDS } from './core/characters';
import { createGame, step } from './core/game';
import type { GameState } from './core/types';
import { DUMMY_LABEL, DUMMY_ORDER, dummyInput, type DummyMode } from './client/dummy';
import { Keyboard, P1_KEYS, P2_KEYS } from './client/keyboard';
import { Renderer } from './client/renderer';
import { loadAllSprites } from './client/sprites';
import { OnlineGame } from './net/online';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const kb = new Keyboard([P1_KEYS, P2_KEYS]);

type Screen = 'title' | 'select' | 'fight' | 'online';
let screen: Screen = 'title';
let online: OnlineGame | null = null;
let game: GameState | null = null;
// 開發版（npm run dev）預設顯示判定框、時間無限；發佈版像一般遊戲：不顯示判定框、回合 99 秒
// 測試期間：發佈版也預設顯示判定框（F1 可以關掉）
let showBoxes = true;
let p2Mode: DummyMode = 'human';
const cursor: [number, number] = [0, Math.min(1, CHARACTER_IDS.length - 1)];
const ready: [boolean, boolean] = [false, false];
let picks: [string, string] = ['sawa', 'mio'];
let assetsReady = false;
const timeLimitOn = () => (document.getElementById('timeLimit') as HTMLInputElement | null)?.checked ?? false;
// 讀取角色素材（沒有素材的角色會用色塊）；讀完前不能開始對戰
const assetsPromise = loadAllSprites().then((ids) => {
  assetsReady = true;
  if (ids.length) console.info('已載入角色素材：', ids.join(', '));
});

function updateSelect(): void {
  if (kb.consume('Escape')) { showTitle(); return; }
  if (kb.consume('F2')) {
    p2Mode = DUMMY_ORDER[(DUMMY_ORDER.indexOf(p2Mode) + 1) % DUMMY_ORDER.length];
    if (p2Mode !== 'human') ready[1] = true;
    else ready[1] = false;
  }
  const n = CHARACTER_IDS.length;
  if (!ready[0]) {
    if (kb.consume('KeyA')) cursor[0] = (cursor[0] + n - 1) % n;
    if (kb.consume('KeyD')) cursor[0] = (cursor[0] + 1) % n;
    if (kb.consume('KeyU')) ready[0] = true;
  } else if (kb.consume('KeyJ')) ready[0] = false;
  // 假人模式時由 P1 一起幫 P2 選角（W / S 切換）
  if (p2Mode !== 'human') {
    if (kb.consume('KeyW') || kb.consume('KeyS')) cursor[1] = (cursor[1] + 1) % n;
  } else if (!ready[1]) {
    if (kb.consume('ArrowLeft')) cursor[1] = (cursor[1] + n - 1) % n;
    if (kb.consume('ArrowRight')) cursor[1] = (cursor[1] + 1) % n;
    if (kb.consumeAny(P2_KEYS.LP)) ready[1] = true;
  } else if (kb.consumeAny(P2_KEYS.LK)) ready[1] = false;

  if (ready[0] && ready[1] && assetsReady) {
    picks = [CHARACTER_IDS[cursor[0]], CHARACTER_IDS[cursor[1]]];
    game = createGame(picks[0], picks[1], { timeLimit: timeLimitOn() });
    screen = 'fight';
    ready[0] = false;
    ready[1] = p2Mode !== 'human';
  }
}

function updateFight(): void {
  if (!game) return;
  if (kb.consume('F1')) showBoxes = !showBoxes;
  if (kb.consume('F2')) p2Mode = DUMMY_ORDER[(DUMMY_ORDER.indexOf(p2Mode) + 1) % DUMMY_ORDER.length];
  if (kb.consume('Escape')) { screen = 'select'; game = null; return; }
  if (game.phase === 'matchEnd' && kb.consume('Enter')) {
    game = createGame(picks[0], picks[1], { timeLimit: timeLimitOn() });
    return;
  }
  const i1 = kb.read(P1_KEYS);
  const i2 = p2Mode === 'human' ? kb.read(P2_KEYS) : dummyInput(game, 1, p2Mode);
  step(game, [i1, i2]);
}

// 固定 60 影格 / 秒的邏輯更新；畫面依瀏覽器刷新率繪製。
const STEP_MS = 1000 / 60;
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min(250, now - last);
  last = now;
  let steps = 0;
  while (acc >= STEP_MS && steps < 5) {
    if (screen === 'select') updateSelect();
    else if (screen === 'fight') updateFight();
    else if (screen === 'online') updateOnline();
    else kb.clearPressed();
    acc -= STEP_MS;
    steps++;
  }
  if (screen === 'title') renderer.drawMessage(['']);
  else if (screen === 'online') online?.draw(renderer, showBoxes);
  else if (screen === 'select') renderer.drawSelect(CHARACTER_IDS, cursor, ready, `玩家 2 模式：${DUMMY_LABEL[p2Mode]}`);
  else if (game) renderer.draw(game, { showBoxes, p2Label: p2Mode === 'human' ? '' : DUMMY_LABEL[p2Mode] });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ───── 主選單與線上對戰 ─────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $<HTMLDivElement>('menu');
const invite = $<HTMLDivElement>('invite');
const menuError = $<HTMLDivElement>('menuError');

function showTitle(message = ''): void {
  online?.leave();
  online = null;
  screen = 'title';
  game = null;
  menu.hidden = false;
  invite.hidden = true;
  menuError.textContent = message;
  history.replaceState(null, '', location.pathname);
}

function startOnline(mode: 'create' | 'join', code = ''): void {
  if (!assetsReady) { menuError.textContent = '素材讀取中，請稍候再試'; return; }
  (document.activeElement as HTMLElement | null)?.blur();
  menu.hidden = true;
  screen = 'online';
  kb.clearPressed();
  const delay = Number($<HTMLSelectElement>('delay').value) || 0;
  online = new OnlineGame(mode, code, delay, timeLimitOn(), () => {
    const o = online;
    if (!o) return;
    invite.hidden = o.status !== 'waiting';
    $<HTMLInputElement>('inviteLink').value = o.inviteLink;
    if (o.code) history.replaceState(null, '', `?room=${o.code}`);
  });
}

function updateOnline(): void {
  if (kb.consume('F1')) showBoxes = !showBoxes;
  if (kb.consume('Escape')) {
    const reason = online?.status === 'ended' ? online.endReason : '';
    showTitle(reason);
    return;
  }
  online?.update(kb);
}

$('btnLocal').onclick = () => {
  (document.activeElement as HTMLElement | null)?.blur();
  menu.hidden = true;
  screen = 'select';
  kb.clearPressed();
};
$('btnCreate').onclick = () => startOnline('create');
$('btnJoin').onclick = () => {
  const code = $<HTMLInputElement>('roomCode').value.trim().toUpperCase();
  if (code.length !== 4) { menuError.textContent = '請輸入 4 個字的房號'; return; }
  startOnline('join', code);
};
$<HTMLInputElement>('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnCopy').onclick = async () => {
  const input = $<HTMLInputElement>('inviteLink');
  try { await navigator.clipboard.writeText(input.value); $('btnCopy').textContent = '已複製'; }
  catch { input.select(); }
};

declare const __APP_VERSION__: string;
const versionEl = document.getElementById('version');
if (versionEl) versionEl.textContent = `版本 ${__APP_VERSION__}`;

// 發佈版：預設開啟回合時間、隱藏開發用說明
if (!import.meta.env.DEV) {
  const tl = document.getElementById('timeLimit') as HTMLInputElement | null;
  if (tl) tl.checked = true;
  document.querySelectorAll<HTMLElement>('.dev-only').forEach((el) => (el.hidden = true));
}

// 開發模式：方便測試時讀取連線狀態
if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_ONLINE) (window as unknown as { __online: () => unknown }).__online = () => online?.debugInfo();

// 用邀請連結打開時直接加入房間
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  void assetsPromise.then(() => startOnline('join', roomFromUrl.toUpperCase()));
}

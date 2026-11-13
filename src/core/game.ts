// 遊戲核心：固定 60 影格 / 秒、只用整數運算、不讀時間與亂數。
// 相同的初始狀態 + 相同的輸入序列 => 一定得到相同結果（rollback 連線的前提）。
import { animRef, frameIndexAt } from './anim';
import { getChar } from './characters';
import { ATTACK_BUTTONS, Btn, held, horizontal, type InputBits } from './input';
import type {
  Action,
  Box,
  CharacterDef,
  FighterState,
  FormStats,
  GameState,
  MoveDef,
} from './types';
import { FP } from './types';

export const SCREEN_W = 1280;
export const SCREEN_H = 720;
export const STAGE_LEFT = 60 * FP;
export const STAGE_RIGHT = 1220 * FP;
export const METER_MAX = 1000;
export const ROUND_FRAMES = 99 * 60;
export const WINS_TO_MATCH = 2;

const BUFFER_FRAMES = 5;
const DASH_WINDOW = 12;
const JUMPSQUAT = 4;
const LANDING = 4;
/** 後撤結束後要再等幾格才能再後撤（不能一直連續後撤） */
export const BACKDASH_COOLDOWN = 15;
const KNOCKDOWN_FRAMES = 30;
const GETUP_FRAMES = 22;
const THROW_RANGE = 110 * FP;
// 投技節奏（約 1 秒）：抓住 0～13 格 → 轉身 14～35 格 → 第 36 格丟出去 → 收招到第 62 格
const THROW_GRIP_FRAMES = 14;
const THROW_TOSS_FRAME = 36; // 投技動畫中把對手往身後丟出去的那一格
// 丟出去的速度：飛行約 33 格、水平約 580 像素（舞台寬度的一半）
const THROW_TOSS_VX = 1750;
// 抓住後轉身：被抓的人繞著投技方從前面甩到身後（轉身期間依序經過的位置，像素：[前方距離, 高度]，負數 = 身後）
const THROW_SWING: [number, number][] = [
  [90, 0], [90, 8], [90, 16], [88, 24], [84, 32], [76, 42], [64, 54], [48, 66],
  [28, 78], [6, 86], [-16, 90], [-34, 92], [-48, 92], [-58, 92], [-62, 92], [-64, 92],
];
const THROW_TOSS_VY = 1400;
const THROW_TOTAL = 62;
const THROW_TECH_WINDOW = 10; // 被抓後幾格內按投技可以拆投
const THROW_PUNISH_PCT = 150; // 檔架中被抓：傷害 1.5 倍

// ───── 鬥氣（Drive）─────
export const DRIVE_BAR = 10000;
export const DRIVE_MAX = 6 * DRIVE_BAR;
const DRIVE_REGEN = 50; // 每格回復量：約 20 秒回滿
const DRIVE_REGEN_BURNOUT = 100; // 燃盡時加快：約 10 秒回滿
const SPECIAL_COST = DRIVE_BAR;
const REVERSAL_COST = 2 * DRIVE_BAR;
const PARRY_START_COST = DRIVE_BAR / 2;
const PARRY_DRAIN = 100; // 按住檔架時每格消耗
const PARRY_MIN = 12; // 檔架最短持續格數
const PARRY_END = 12; // 放開檔架後的收招
const PERFECT_WINDOW = 2; // 檔架開始後幾格內擋到 = 完美檔架
const PARRY_GAIN = DRIVE_BAR / 2;
const PARRIED_STUN = 30; // 被完美檔架的一方僵直
const HIT_GAIN_LIGHT = DRIVE_BAR / 4;
const HIT_GAIN_HEAVY = DRIVE_BAR / 2;
const BURNOUT_BLOCKSTUN = 4;
const BURNOUT_CHIP_DIV = 4;
const TAUNT_FRAMES = 90;
const INTRO_FIRST = 150;
const INTRO_NEXT = 150; // 每回合都播完整的開場動畫
const KO_POSE_AT = 90;
const KO_END_AT = 260;
const PUSH_OVER_HEIGHT = 120 * FP;
const AIR_GRAVITY = 100;

// ───────────── 建立遊戲 ─────────────

function newFighter(charId: string, side: 0 | 1, wins: number): FighterState {
  const c = getChar(charId);
  return {
    charId,
    x: (side === 0 ? 400 : 880) * FP,
    y: 0,
    vx: 0,
    vy: 0,
    facing: side === 0 ? 1 : -1,
    hp: c.maxHp,
    meter: 0,
    action: 'idle',
    frame: 0,
    moveId: null,
    hitsDone: 0,
    stun: 0,
    crouchStun: false,
    slide: 0,
    slideDir: 1,
    jumpDir: 0,
    prevInput: 0,
    bufBits: 0,
    bufTimer: 0,
    lastFwdTap: -100,
    lastBackTap: -100,
    dashReq: 0,
    dashTimer: 0,
    invuln: 0,
    comboHits: 0,
    airHitKnockdown: false,
    form: 'normal',
    formTimer: 0,
    bubble: null,
    wins,
    drive: DRIVE_MAX,
    burnout: false,
    throwPunish: false,
    landDamage: 0,
    backdashCd: 0,
  };
}

export interface GameOptions {
  /** 回合時間限制（99 秒）；false = 時間無限 */
  timeLimit?: boolean;
  /** 測試用：能量一直是滿的，可以一直放必殺技 */
  infiniteMeter?: boolean;
}

export function createGame(p1: string, p2: string, opts: GameOptions = {}): GameState {
  const s: GameState = {
    frame: 0,
    phase: 'intro',
    phaseTimer: 0,
    round: 1,
    timer: ROUND_FRAMES,
    timeLimit: opts.timeLimit ?? false,
    infiniteMeter: opts.infiniteMeter ?? false,
    fighters: [newFighter(p1, 0, 0), newFighter(p2, 1, 0)],
    projectiles: [],
    sparks: [],
    hitstop: 0,
    superFreeze: null,
    roundResult: null,
    matchWinner: null,
    shake: null,
    events: [],
    lastAdv: null,
  };
  for (const f of s.fighters) f.bubble = { text: getChar(f.charId).texts.intro, timer: INTRO_FIRST };
  return s;
}

export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}

// ───────────── 查詢工具（渲染器也會用） ─────────────

export function formStats(f: FighterState): FormStats {
  const c = getChar(f.charId);
  return (f.form === 'dino' && c.forms.dino) || c.forms.normal;
}

export function currentMove(f: FighterState): MoveDef | null {
  if (!f.moveId) return null;
  return getChar(f.charId).moves[f.moveId] ?? null;
}

export function moveTotal(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}

export function movePhase(f: FighterState): 'startup' | 'active' | 'recovery' | null {
  const m = currentMove(f);
  if (!m || f.action !== 'attack') return null;
  if (f.frame <= m.startup) return 'startup';
  if (f.frame <= m.startup + m.active) return 'active';
  return 'recovery';
}

/** 把「角色相對座標的像素 Box」轉換成世界座標（centi-px）。 */
export function toWorld(f: FighterState, b: Box): Box {
  const x = f.facing === 1 ? f.x + b.x * FP : f.x - (b.x + b.w) * FP;
  return { x, y: f.y + b.y * FP, w: b.w * FP, h: b.h * FP };
}

function isCrouching(f: FighterState): boolean {
  if (f.action === 'crouch') return true;
  if (f.action === 'attack') return currentMove(f)?.stance === 'crouch';
  if (f.action === 'hitstun' || f.action === 'blockstun') return f.crouchStun;
  return false;
}

function isAirborne(f: FighterState): boolean {
  return f.y > 0 || f.action === 'air' || f.action === 'airHit';
}

/** 依目前動畫格取得受擊框（素材有資料時）；沒有就回傳 null。 */
function animHurt(s: GameState | undefined, f: FighterState): Box[] | null {
  const c = getChar(f.charId);
  if (!c.anims || !s) return null;
  const anims = c.anims;
  const len = (k: string) => anims[k]?.frames.reduce((a, fr) => a + Math.max(1, fr.duration), 0) ?? 0;
  const ref = animRef(s, f, len);
  if (!ref) return null;
  for (const key of ref.keys) {
    const a = anims[key];
    if (!a?.frames.length) continue;
    const idx = frameIndexAt(a.frames.map((fr) => fr.duration), ref.t, ref.loop ?? a.loop);
    const hurt = a.frames[idx].hurt;
    return hurt.length ? hurt : null;
  }
  return null;
}

export function hurtboxes(f: FighterState, s?: GameState): Box[] {
  if (f.invuln > 0) return [];
  switch (f.action) {
    case 'knockdown':
    case 'getup':
    case 'airHit':
    case 'thrown':
    case 'win':
    case 'lose':
      return [];
  }
  const st = formStats(f);
  const fromAnim = animHurt(s, f);
  const base = isAirborne(f) ? st.hurtAir : isCrouching(f) ? st.hurtCrouch : st.hurtStand;
  const boxes = fromAnim ? fromAnim.map((b) => toWorld(f, b)) : [toWorld(f, base)];
  const m = currentMove(f);
  if (m?.hurtbox && f.action === 'attack' && f.frame > m.startup) boxes.push(toWorld(f, m.hurtbox));
  return boxes;
}

/** 基本攻擊（站／蹲／空中 輕重拳腳）的攻擊框往前多延伸的距離（遊戲像素） */
export const NORMAL_REACH_BONUS = 25;
const NORMAL_IDS = /^[scj](LP|HP|LK|HK)$/;

/** 招式實際使用的攻擊框（角色座標，已加上基本攻擊的延伸距離） */
export function moveHitbox(m: MoveDef): Box | undefined {
  if (!m.hitbox) return undefined;
  return NORMAL_IDS.test(m.id) ? { ...m.hitbox, w: m.hitbox.w + NORMAL_REACH_BONUS } : m.hitbox;
}

/** 目前有效的攻擊判定（世界座標）；全畫面攻擊回傳整個舞台。 */
export function activeHitbox(f: FighterState): Box | null {
  const m = currentMove(f);
  if (!m || movePhase(f) !== 'active') return null;
  if (m.fullScreen) return { x: 0, y: 0, w: SCREEN_W * FP, h: SCREEN_H * FP };
  const hb = moveHitbox(m);
  return hb ? toWorld(f, hb) : null;
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// ───────────── 主迴圈 ─────────────

export function step(s: GameState, inputs: [InputBits, InputBits]): void {
  s.frame++;
  s.events = [];
  tickCosmetics(s);
  if (s.infiniteMeter) for (const f of s.fighters) f.meter = METER_MAX; // 測試用：能量一直補滿

  const live = s.phase === 'fight';
  const ins: [InputBits, InputBits] = live ? inputs : [0, 0];

  // 必殺技畫面暫停 / 打擊停頓：角色不動，但仍然記錄按鍵（輸入緩衝）
  if (s.superFreeze) {
    recordInput(s, 0, ins[0]);
    recordInput(s, 1, ins[1]);
    if (--s.superFreeze.timer <= 0) s.superFreeze = null;
    return;
  }
  if (s.hitstop > 0) {
    recordInput(s, 0, ins[0]);
    recordInput(s, 1, ins[1]);
    s.hitstop--;
    return;
  }

  recordInput(s, 0, ins[0]);
  recordInput(s, 1, ins[1]);
  updateFighter(s, 0, ins[0]);
  updateFighter(s, 1, ins[1]);
  updateFacing(s);
  resolvePush(s);
  updateProjectiles(s);
  if (live) detectHits(s);
  updatePhase(s);
}

function tickCosmetics(s: GameState): void {
  for (const f of s.fighters) {
    if (f.bubble && --f.bubble.timer <= 0) f.bubble = null;
  }
  s.sparks = s.sparks.filter((sp) => --sp.timer > 0);
  if (s.shake && --s.shake.timer <= 0) s.shake = null;
}

function shake(s: GameState, mag: number, timer = 10): void {
  if (!s.shake || s.shake.mag <= mag) s.shake = { timer, mag };
}

// ───── 鬥氣工具 ─────
function canSpend(f: FighterState, cost: number): boolean {
  return !f.burnout && f.drive >= cost;
}

function addDrive(s: GameState, f: FighterState, delta: number): void {
  f.drive = Math.max(0, Math.min(DRIVE_MAX, f.drive + delta));
  if (f.drive <= 0 && !f.burnout) {
    f.burnout = true;
    s.events.push('burnout');
    s.sparks.push({ x: f.x, y: f.y + 120 * FP, timer: 30, kind: 'burnout' });
  } else if (f.burnout && f.drive >= DRIVE_MAX) {
    f.burnout = false;
    s.events.push('burnout_end');
  }
}

function recordInput(s: GameState, i: 0 | 1, input: InputBits): void {
  const f = s.fighters[i];
  const prev = f.prevInput;
  const newPress = input & ~prev & ATTACK_BUTTONS;
  if (newPress) {
    if (f.bufTimer <= 0) f.bufBits = 0;
    f.bufBits |= newPress;
    f.bufTimer = BUFFER_FRAMES;
  }
  // 連按兩下前 / 後 = 衝刺 / 後撤
  const h = horizontal(input, f.facing);
  const hPrev = horizontal(prev, f.facing);
  if (h !== 0 && h !== hPrev) {
    if (h === 1) {
      if (s.frame - f.lastFwdTap <= DASH_WINDOW) { f.dashReq = 1; f.dashTimer = 4; }
      f.lastFwdTap = s.frame;
    } else {
      if (s.frame - f.lastBackTap <= DASH_WINDOW) { f.dashReq = -1; f.dashTimer = 4; }
      f.lastBackTap = s.frame;
    }
  }
  f.prevInput = input;
}

// ───────────── 角色狀態機 ─────────────

function setAction(f: FighterState, a: Action): void {
  if (f.action !== a) {
    f.action = a;
    f.frame = 0;
  }
  if (a !== 'attack') f.moveId = null;
  if (a === 'idle' || a === 'walkF' || a === 'walkB' || a === 'crouch') f.comboHits = 0;
}

function startMove(s: GameState, i: 0 | 1, id: string): void {
  const f = s.fighters[i];
  const m = getChar(f.charId).moves[id];
  f.action = 'attack';
  f.moveId = id;
  f.frame = 0;
  f.hitsDone = 0;
  f.bufBits = 0;
  f.dashReq = 0;
  if (m.invuln) f.invuln = Math.max(f.invuln, m.invuln);
  if (m.superFreeze) s.superFreeze = { owner: i, timer: m.superFreeze };
  if (m.kind === 'taunt') f.bubble = { text: getChar(f.charId).texts.taunt, timer: TAUNT_FRAMES };
  if (m.kind === 'special') addDrive(s, f, -(m.driveCost ?? SPECIAL_COST));
  if (m.kind === 'reversal') {
    addDrive(s, f, -REVERSAL_COST);
    s.events.push('reversal');
    s.sparks.push({ x: f.x, y: f.y + 110 * FP, timer: 18, kind: 'reversal' });
  }
  if (m.stance !== 'air') f.vx = 0;
}

function updateFighter(s: GameState, i: 0 | 1, input: InputBits): void {
  const f = s.fighters[i];
  const c = getChar(f.charId);
  const st = formStats(f);

  if (f.invuln > 0) f.invuln--;
  if (f.backdashCd > 0) f.backdashCd--;
  f.frame++;

  // 鬥氣隨時間回復（防禦、受擊、檔架中不回復）
  if (s.phase === 'fight' && !['blockstun', 'hitstun', 'airHit', 'thrown', 'parry', 'parried', 'knockdown'].includes(f.action)) {
    addDrive(s, f, f.burnout ? DRIVE_REGEN_BURNOUT : DRIVE_REGEN);
  }

  // 變身倒數
  if (f.form === 'dino' && s.phase === 'fight' && --f.formTimer <= 0) {
    f.form = 'normal';
    s.sparks.push({ x: f.x, y: f.y + 100 * FP, timer: 20, kind: 'puff' });
    // 正在出的恐龍招式會照原本資料做完（招式 id 不重複，查得到）
  }

  // 被打退 / 防禦後的滑行
  if (f.slide > 0) {
    f.x += f.slide * f.slideDir;
    f.slide = Math.max(0, f.slide - Math.max(30, Math.trunc(f.slide / 6)));
  }

  switch (f.action) {
    case 'idle':
    case 'walkF':
    case 'walkB':
    case 'crouch':
      groundNeutral(s, i, input, c, st);
      break;
    case 'jumpSquat':
      if (f.frame >= JUMPSQUAT) {
        setAction(f, 'air');
        f.vy = st.jumpVel;
        f.vx = f.jumpDir * st.jumpH * f.facing;
      }
      break;
    case 'air':
      if (tryAttack(s, i, input, 'air')) break;
      airPhysics(f, st.gravity);
      if (f.y <= 0) land(f);
      break;
    case 'land':
      if (f.frame >= LANDING) setAction(f, 'idle');
      break;
    case 'dashF':
      f.x += c.dash.speed * f.facing;
      if (f.frame >= c.dash.frames) setAction(f, 'idle');
      break;
    case 'dashB':
      f.x -= c.backdash.speed * f.facing;
      if (f.frame >= c.backdash.frames) { setAction(f, 'idle'); f.backdashCd = BACKDASH_COOLDOWN; }
      break;
    case 'attack':
      updateAttack(s, i, input, c, st);
      break;
    case 'parry':
      // 按住鬥氣鍵 = 檔架；持續消耗鬥氣，放開（至少維持 PARRY_MIN 格）或鬥氣用光就結束
      addDrive(s, f, -PARRY_DRAIN);
      if (f.burnout || (!held(input, Btn.DRIVE) && f.frame >= PARRY_MIN)) setAction(f, 'parryEnd');
      break;
    case 'parryEnd':
      if (f.frame >= PARRY_END) setAction(f, 'idle');
      break;
    case 'parried':
      if (--f.stun <= 0) setAction(f, 'idle');
      break;
    case 'blockstun':
      // 防禦中按鬥氣鍵 = 鬥氣反擊（扣 2 格）
      if (f.y === 0 && (f.bufBits & Btn.DRIVE) && canSpend(f, REVERSAL_COST) && f.form === 'normal') {
        startMove(s, i, 'reversal');
        break;
      }
      updateStun(f);
      break;
    case 'hitstun':
      updateStun(f);
      break;
    case 'airHit':
      airPhysics(f, AIR_GRAVITY);
      if (f.y <= 0) {
        f.y = 0;
        f.vx = 0;
        f.vy = 0;
        if (f.landDamage > 0) {
          // 被投出去摔到地上：這時才扣血
          f.hp = Math.max(0, f.hp - f.landDamage);
          f.landDamage = 0;
          f.comboHits++;
          s.hitstop = Math.max(s.hitstop, 8);
          shake(s, f.hp <= 0 ? 8 : 6, f.hp <= 0 ? 16 : 10);
          s.sparks.push({ x: f.x, y: 30 * FP, timer: 12, kind: 'hit' });
          s.events.push('throw_land');
        }
        if (f.airHitKnockdown || f.hp <= 0) setAction(f, 'knockdown');
        else { setAction(f, 'land'); f.comboHits = 0; }
      }
      break;
    case 'knockdown':
      if (f.frame >= KNOCKDOWN_FRAMES && f.hp > 0 && s.phase === 'fight') setAction(f, 'getup');
      break;
    case 'getup':
      if (f.frame >= GETUP_FRAMES) setAction(f, 'idle');
      break;
    case 'throwing':
      updateThrow(s, i, c);
      break;
    case 'thrown': {
      // 拆投：被抓後短時間內也按投技（重拳 + 重腳）
      const both = f.bufBits | input;
      if (f.frame <= THROW_TECH_WINDOW && (f.bufBits & (Btn.HP | Btn.HK)) && (both & Btn.HP) && (both & Btn.HK)) {
        throwTech(s, i);
      }
      break; // 其餘由投技方控制
    }
    case 'taunt':
    case 'win':
    case 'lose':
      break;
  }

  if (f.bufTimer > 0 && --f.bufTimer <= 0) f.bufBits = 0;
  if (f.dashTimer > 0 && --f.dashTimer <= 0) f.dashReq = 0;
}

function updateStun(f: FighterState): void {
  if (f.y > 0) {
    airPhysics(f, AIR_GRAVITY);
    if (f.y <= 0) { f.y = 0; f.vy = 0; f.vx = 0; }
  }
  if (--f.stun <= 0) setAction(f, 'idle');
}

function groundNeutral(s: GameState, i: 0 | 1, input: InputBits, c: CharacterDef, st: FormStats): void {
  const f = s.fighters[i];
  // 按下鬥氣鍵 = 開始檔架
  if ((f.bufBits & Btn.DRIVE) && held(input, Btn.DRIVE) && canSpend(f, 1) && f.form === 'normal') {
    f.bufBits &= ~Btn.DRIVE;
    setAction(f, 'parry');
    addDrive(s, f, -PARRY_START_COST);
    return;
  }
  if (tryAttack(s, i, input, 'ground')) return;
  const h = horizontal(input, f.facing);
  if (held(input, Btn.UP)) {
    f.jumpDir = h;
    setAction(f, 'jumpSquat');
    return;
  }
  if (f.dashReq === -1 && f.backdashCd > 0) f.dashReq = 0; // 後撤冷卻中：不能連續後撤
  if (f.dashReq !== 0 && st.canDash) {
    const back = f.dashReq === -1;
    f.dashReq = 0;
    setAction(f, back ? 'dashB' : 'dashF');
    if (back) f.invuln = Math.max(f.invuln, c.backdash.invuln);
    return;
  }
  if (held(input, Btn.DOWN) && st.canCrouch) { setAction(f, 'crouch'); return; }
  if (h === 1) { setAction(f, 'walkF'); f.x += st.walkFwd * f.facing; }
  else if (h === -1) { setAction(f, 'walkB'); f.x -= st.walkBack * f.facing; }
  else setAction(f, 'idle');
}

function airPhysics(f: FighterState, gravity: number): void {
  f.x += f.vx;
  f.y += f.vy;
  f.vy -= gravity;
}

function land(f: FighterState): void {
  f.y = 0;
  f.vy = 0;
  f.vx = 0;
  setAction(f, 'land');
}

type AttackCtx = 'ground' | 'air' | 'cancel' | 'kara';

/** 依緩衝的按鍵決定出什麼招。ctx = cancel 時只允許目前招式可取消的招。 */
function tryAttack(s: GameState, i: 0 | 1, input: InputBits, ctx: AttackCtx): boolean {
  const f = s.fighters[i];
  const b = f.bufBits;
  if (!b) return false;
  const c = getChar(f.charId);
  const st = formStats(f);
  const cur = currentMove(f);
  const allowed = (id: string | undefined): id is string =>
    !!id && (ctx === 'ground' || ctx === 'air' || (ctx === 'cancel' && !!cur?.cancel?.includes(id)) || ctx === 'kara');
  const both = b | input;

  // 必殺技：L + K 同按
  if (ctx !== 'air' && (b & (Btn.SP | Btn.HK)) && (both & Btn.SP) && (both & Btn.HK)
    && f.meter >= METER_MAX && f.form === 'normal' && (ctx !== 'cancel' || allowed(c.super))) {
    f.meter = 0;
    startMove(s, i, c.super);
    return true;
  }
  if (ctx === 'kara') {
    // 招式剛出的前幾格內補按，可轉成投技
    if ((b & (Btn.HP | Btn.HK)) && (both & Btn.HP) && (both & Btn.HK) && f.form === 'normal') { startMove(s, i, 'throwWhiff'); return true; }
    return false;
  }
  // 投技：→ + 重拳 + 重腳
  if (ctx === 'ground' && (b & (Btn.HP | Btn.HK)) && (both & Btn.HP) && (both & Btn.HK)
    && horizontal(input, f.facing) >= 0 && f.form === 'normal') {
    startMove(s, i, 'throwWhiff');
    return true;
  }
  if (ctx === 'ground' && (b & Btn.TAUNT)) {
    startMove(s, i, 'taunt');
    return true;
  }

  let id: string | undefined;
  if ((b & Btn.SP) && ctx !== 'air') {
    id = st.moves.sp;
    const m = id ? c.moves[id] : undefined;
    if (m?.projectile && s.projectiles.some((p) => p.owner === i)) id = undefined; // 一次只能有一發
    if (m?.kind === 'special' && !canSpend(f, m.driveCost ?? SPECIAL_COST)) id = undefined; // 鬥氣不夠或燃盡中
  }
  if (!id && ctx === 'air') {
    // 空中四個鍵各是不同的招
    if (b & Btn.HP) id = st.moves.jHP;
    else if (b & Btn.HK) id = st.moves.jHK;
    else if (b & Btn.LP) id = st.moves.jLP;
    else if (b & Btn.LK) id = st.moves.jLK;
  } else if (!id && (b & (Btn.HP | Btn.HK | Btn.LP | Btn.LK))) {
    const crouch = held(input, Btn.DOWN) && st.canCrouch;
    const pick = (btn: number, sid?: string, cid?: string) => ((b & btn) ? (crouch ? cid : sid) : undefined);
    id = pick(Btn.HP, st.moves.sHP, st.moves.cHP)
      ?? pick(Btn.HK, st.moves.sHK, st.moves.cHK)
      ?? pick(Btn.LP, st.moves.sLP, st.moves.cLP)
      ?? pick(Btn.LK, st.moves.sLK, st.moves.cLK);
  }
  if (!allowed(id)) return false;
  // 空中只能出空中招（特殊技、地面招在空中按了沒反應）
  if (ctx === 'air' && c.moves[id].stance !== 'air') return false;
  startMove(s, i, id);
  return true;
}

/** 投技在攻擊判定格時嘗試抓住對手。 */
function tryGrab(s: GameState, i: 0 | 1): void {
  const f = s.fighters[i];
  const o = s.fighters[1 - i];
  if (Math.abs(o.x - f.x) > THROW_RANGE || o.invuln > 0 || o.y !== 0) return;
  // 雙方同時投 → 自動拆投
  if (o.action === 'attack' && currentMove(o)?.kind === 'throw' && movePhase(o) === 'active') {
    f.hitsDone = 1;
    setAction(o, 'thrown');
    throwTech(s, 1 - i as 0 | 1);
    return;
  }
  const throwable =
    ['idle', 'walkF', 'walkB', 'crouch', 'jumpSquat', 'land', 'dashF', 'attack', 'taunt', 'parry', 'parryEnd'].includes(o.action) &&
    !(o.action === 'attack' && currentMove(o)?.stance === 'air');
  if (!throwable) return;
  f.hitsDone = 1;
  o.throwPunish = o.action === 'parry' || o.action === 'parryEnd';
  setAction(f, 'throwing');
  setAction(o, 'thrown');
  o.slide = 0;
  o.x = clampX(f.x + f.facing * 90 * FP);
  f.bufBits = 0;
  o.bufBits = 0;
  s.events.push('throw');
}

/** 拆投：雙方彈開，不扣血。i = 被抓的一方。 */
function throwTech(s: GameState, i: 0 | 1): void {
  const d = s.fighters[i];
  const a = s.fighters[1 - i];
  for (const [f, dir] of [[d, d.x >= a.x ? 1 : -1], [a, a.x > d.x ? 1 : -1]] as const) {
    setAction(f, 'blockstun');
    f.stun = 16;
    f.crouchStun = false;
    f.slide = 900;
    f.slideDir = dir as 1 | -1;
    f.bufBits = 0;
  }
  s.hitstop = Math.max(s.hitstop, 6);
  s.sparks.push({ x: Math.trunc((a.x + d.x) / 2), y: 110 * FP, timer: 14, kind: 'tech' });
  s.events.push('throw_tech');
}

function updateThrow(s: GameState, i: 0 | 1, c: CharacterDef): void {
  const f = s.fighters[i];
  const o = s.fighters[1 - i];
  if (o.action === 'thrown' && f.frame < THROW_TOSS_FRAME) {
    // 抓住時對手停在前面；轉身期間沿著 THROW_SWING 從前面繞到身後
    const turn = Math.max(0, f.frame - THROW_GRIP_FRAMES);
    const idx = Math.floor((turn * THROW_SWING.length) / (THROW_TOSS_FRAME - THROW_GRIP_FRAMES));
    const [dx, dy] = THROW_SWING[Math.min(idx, THROW_SWING.length - 1)];
    o.x = clampX(f.x + f.facing * dx * FP);
    o.y = dy * FP;
  }
  if (f.frame === THROW_TOSS_FRAME && o.action === 'thrown') {
    // 把對手從頭上往身後（反方向）丟出去；落地時才扣血
    const dmg = Math.trunc((c.throwDamage * (o.throwPunish ? THROW_PUNISH_PCT : 100)) / 100);
    o.throwPunish = false;
    o.landDamage = dmg;
    setAction(o, 'airHit');
    o.airHitKnockdown = true;
    o.x = clampX(f.x - f.facing * 64 * FP);
    o.y = 92 * FP;
    o.vx = -f.facing * THROW_TOSS_VX;
    o.vy = THROW_TOSS_VY;
    gainMeter(f, dmg);
    gainMeter(o, Math.trunc(dmg / 2));
    s.hitstop = 4;
    s.events.push('throw_toss');
  }
  if (f.frame >= THROW_TOTAL) {
    // 投技動畫結束時角色已經轉身，面向剛被丟出去的對手
    f.facing = (-f.facing) as 1 | -1;
    setAction(f, 'idle');
  }
}

function updateAttack(s: GameState, i: 0 | 1, input: InputBits, c: CharacterDef, st: FormStats): void {
  const f = s.fighters[i];
  const m = currentMove(f);
  if (!m) { setAction(f, 'idle'); return; }

  // 招式剛出的前 3 格：可補按成投技 / 必殺技
  if (f.frame <= 3 && (m.kind === 'normal' || m.kind === 'special') && m.stance !== 'air') {
    if (tryAttack(s, i, input, 'kara')) return;
  }
  // 打中或被防之後可取消
  if (f.hitsDone > 0 && f.frame > m.startup && m.cancel) {
    if (tryAttack(s, i, input, 'cancel')) return;
  }

  if (m.kind === 'throw' && f.hitsDone === 0 && movePhase(f) === 'active') {
    tryGrab(s, i);
    if (f.action !== 'attack') return;
  }

  if (m.advance && f.frame <= m.startup + m.active) f.x += m.advance * f.facing;

  if (m.projectile && f.frame === m.projectile.spawnFrame) {
    s.projectiles.push({
      owner: i,
      moveId: m.id,
      x: f.x + m.projectile.spawnX * FP * f.facing,
      y: m.projectile.spawnY * FP,
      vx: m.projectile.speed * f.facing,
      life: 300,
    });
  }

  if (m.kind === 'transform' && f.frame === m.startup && c.transform) {
    f.form = 'dino';
    f.formTimer = c.transform.duration;
    // 變身的爆發效果已經畫在動畫裡（邪惡力量、黑煙），不再另外冒白煙
  }

  if (m.stance === 'air') {
    airPhysics(f, st.gravity);
    if (f.y <= 0) { land(f); return; }
  } else if (f.y > 0) {
    // 保險：地面招若在空中出現（不應該發生），仍然受重力影響落地，不會卡在空中
    airPhysics(f, st.gravity);
    if (f.y <= 0) { f.y = 0; f.vy = 0; f.vx = 0; }
  }

  if (f.frame >= moveTotal(m)) {
    if (m.stance === 'air') setAction(f, 'air');
    else setAction(f, 'idle');
  }
}

function updateFacing(s: GameState): void {
  const turnable: Action[] = ['idle', 'walkF', 'walkB', 'crouch', 'jumpSquat', 'land', 'getup', 'parryEnd'];
  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i];
    const o = s.fighters[1 - i];
    if (!turnable.includes(f.action)) continue;
    if (o.x > f.x) f.facing = 1;
    else if (o.x < f.x) f.facing = -1;
  }
}

function clampX(x: number): number {
  return Math.min(STAGE_RIGHT, Math.max(STAGE_LEFT, x));
}

function resolvePush(s: GameState): void {
  const [a, b] = s.fighters;
  a.x = clampX(a.x);
  b.x = clampX(b.x);
  if (a.action === 'thrown' || b.action === 'thrown') return;
  if (a.landDamage > 0 || b.landDamage > 0) return; // 被投出去飛越對方頭上時不互推
  if (Math.abs(a.y - b.y) > PUSH_OVER_HEIGHT) return;
  const half = Math.trunc(((formStats(a).pushWidth + formStats(b).pushWidth) * FP) / 2);
  const dx = b.x - a.x;
  if (Math.abs(dx) >= half) return;
  const dir = dx !== 0 ? Math.sign(dx) : a.facing;
  const over = half - Math.abs(dx);
  a.x = clampX(a.x - dir * Math.ceil(over / 2));
  b.x = clampX(b.x + dir * Math.ceil(over / 2));
  // 有一方卡牆時，把另一方推開
  if (Math.abs(b.x - a.x) < half) {
    if (a.x === STAGE_LEFT || a.x === STAGE_RIGHT) b.x = clampX(a.x + dir * half);
    else a.x = clampX(b.x - dir * half);
  }
}

function updateProjectiles(s: GameState): void {
  for (const p of s.projectiles) {
    p.x += p.vx;
    p.life--;
  }
  // 兩發飛行道具互相抵銷
  if (s.projectiles.length === 2) {
    const [p, q] = s.projectiles;
    if (p.owner !== q.owner && overlap(projBox(s, p), projBox(s, q))) {
      s.sparks.push({ x: Math.trunc((p.x + q.x) / 2), y: p.y, timer: 12, kind: 'block' });
      p.life = 0;
      q.life = 0;
    }
  }
  s.projectiles = s.projectiles.filter((p) => p.life > 0 && p.x > 0 && p.x < SCREEN_W * FP);
}

export function projBox(s: GameState, p: GameState['projectiles'][number]): Box {
  const m = getChar(s.fighters[p.owner].charId).moves[p.moveId];
  const b = m.projectile!.box;
  return { x: p.x + b.x * FP, y: p.y + b.y * FP, w: b.w * FP, h: b.h * FP };
}

// ───────────── 打擊判定 ─────────────

interface PendingHit {
  attacker: 0 | 1;
  move: MoveDef;
  srcX: number;
  contact: { x: number; y: number };
  fromProjectile: boolean;
}

function detectHits(s: GameState): void {
  const pending: PendingHit[] = [];
  for (const i of [0, 1] as const) {
    const f = s.fighters[i];
    const o = s.fighters[1 - i];
    const m = currentMove(f);
    if (!m || movePhase(f) !== 'active') continue;
    const count = m.multiHit?.count ?? 1;
    if (f.hitsDone >= count) continue;
    if (m.multiHit && f.frame < m.startup + 1 + f.hitsDone * m.multiHit.interval) continue;
    const hit = activeHitbox(f);
    if (!hit) continue;
    const hurt = hurtboxes(o, s);
    const touched = hurt.find((h) => overlap(hit, h));
    if (!touched) continue;
    pending.push({
      attacker: i,
      move: m,
      srcX: f.x,
      contact: m.fullScreen
        ? { x: o.x, y: o.y + 120 * FP }
        : { x: Math.trunc((Math.max(hit.x, touched.x) + Math.min(hit.x + hit.w, touched.x + touched.w)) / 2), y: Math.trunc((Math.max(hit.y, touched.y) + Math.min(hit.y + hit.h, touched.y + touched.h)) / 2) },
      fromProjectile: false,
    });
  }
  for (const p of s.projectiles) {
    const o = s.fighters[1 - p.owner];
    const box = projBox(s, p);
    if (!hurtboxes(o, s).some((h) => overlap(box, h))) continue;
    const m = getChar(s.fighters[p.owner].charId).moves[p.moveId];
    pending.push({ attacker: p.owner, move: m, srcX: p.x - p.vx * 10, contact: { x: p.x, y: p.y }, fromProjectile: true });
    p.life = 0;
  }
  s.projectiles = s.projectiles.filter((p) => p.life > 0);
  for (const h of pending) applyHit(s, h);
}

function gainMeter(f: FighterState, amount: number): void {
  const c = getChar(f.charId);
  if (f.form === 'dino' && c.transform?.noMeterGain) return;
  if (f.action === 'attack' && currentMove(f)?.kind === 'transform') return;
  f.meter = Math.min(METER_MAX, f.meter + amount);
}

function applyHit(s: GameState, h: PendingHit): void {
  const a = s.fighters[h.attacker];
  const d = s.fighters[1 - h.attacker];
  const m = h.move;
  const dst = formStats(d);
  if (!h.fromProjectile) a.hitsDone++;

  const pushDir: 1 | -1 = d.x >= h.srcX ? 1 : -1;
  const input = d.prevInput;
  const holdingBack = pushDir === 1
    ? held(input, Btn.RIGHT) && !held(input, Btn.LEFT)
    : held(input, Btn.LEFT) && !held(input, Btn.RIGHT);
  const crouching = held(input, Btn.DOWN) && dst.canCrouch;
  const neutral = ['idle', 'walkF', 'walkB', 'crouch', 'blockstun'].includes(d.action);
  const inAir = d.action === 'air';
  const guardOk = !dst.canCrouch || m.guard === 'mid' || (m.guard === 'low' ? crouching : !crouching);
  const blocked = holdingBack && ((neutral && guardOk) || inAir);

  const hitstop = Math.max(3, Math.min(8, m.hitstop ?? 8)); // 頓幀 3～8 格
  const atWall = d.x <= STAGE_LEFT || d.x >= STAGE_RIGHT;
  const remaining = moveTotal(m) - a.frame; // 攻擊方還剩幾格收招（算有利格數用）

  // 檔架：擋下所有打擊（上中下段、空中、飛行道具、必殺技），不擋投技
  if (d.action === 'parry') {
    const perfect = d.frame <= PERFECT_WINDOW;
    addDrive(s, d, PARRY_GAIN);
    d.slide = Math.trunc(m.pushback / 2);
    d.slideDir = pushDir;
    if (perfect) {
      setAction(d, 'idle'); // 完美檔架：自己馬上能動
      if (!h.fromProjectile) {
        setAction(a, 'parried');
        a.stun = PARRIED_STUN;
        a.slide = 0;
      }
      s.hitstop = Math.max(s.hitstop, 10);
      shake(s, 4, 8);
      s.sparks.push({ ...h.contact, timer: 20, kind: 'perfect' });
      s.events.push('perfect_parry');
      s.lastAdv = { side: h.attacker, value: -PARRIED_STUN, blocked: true, move: m.name };
    } else {
      s.hitstop = Math.max(s.hitstop, 5);
      s.sparks.push({ ...h.contact, timer: 12, kind: 'parry' });
      s.events.push('parry');
    }
    return;
  }

  if (blocked) {
    const extra = d.burnout ? BURNOUT_BLOCKSTUN : 0;
    if (!inAir) {
      setAction(d, 'blockstun');
      d.frame = 0;
      d.stun = m.blockstun + extra;
      d.crouchStun = crouching;
    }
    if (m.chip) d.hp = Math.max(1, d.hp - m.chip);
    if (d.burnout) d.hp = Math.max(0, d.hp - Math.trunc(m.damage / BURNOUT_CHIP_DIV)); // 燃盡時防禦會被削血
    if (!h.fromProjectile) s.lastAdv = { side: h.attacker, value: m.blockstun + extra - remaining, blocked: true, move: m.name };
    s.events.push('block');
    d.slide = m.pushback;
    d.slideDir = pushDir;
    if (atWall && !h.fromProjectile) { a.slide = m.pushback; a.slideDir = (-pushDir) as 1 | -1; }
    gainMeter(a, Math.trunc((m.meterGain ?? m.damage) / 2));
    gainMeter(d, Math.trunc(m.damage / 4));
    s.hitstop = Math.max(s.hitstop, hitstop);
    s.sparks.push({ ...h.contact, timer: 10, kind: 'block' });
    return;
  }

  const scale = Math.max(50, 100 - 10 * Math.max(0, d.comboHits - 2));
  const defense = formStats(d).defensePct ?? 100; // 恐龍形態等比較耐打
  const dmg = Math.max(1, Math.trunc((m.damage * formStats(a).damagePct * scale * defense) / 1000000));
  d.hp = Math.max(m.nonLethal ? Math.min(1, d.hp) : 0, d.hp - dmg);
  // 一般攻擊打中回復鬥氣
  if (m.kind === 'normal' && !h.fromProjectile) addDrive(s, a, m.damage < 50 ? HIT_GAIN_LIGHT : HIT_GAIN_HEAVY);
  d.comboHits++;

  const count = m.multiHit?.count ?? 1;
  const isLastHit = h.fromProjectile || a.hitsDone >= count;
  const wasAir = isAirborne(d);
  const knock = (m.knockdown && isLastHit) || d.hp <= 0;

  if (knock || (wasAir && isLastHit)) {
    s.lastAdv = null;
    setAction(d, 'airHit');
    d.airHitKnockdown = knock;
    d.y = Math.max(d.y, 1);
    d.vx = pushDir * (m.launch && isLastHit ? m.launch.vx : 400);
    d.vy = m.launch && isLastHit ? m.launch.vy : knock ? 1100 : 600;
  } else {
    const wasCrouch = isCrouching(d);
    setAction(d, 'hitstun');
    d.frame = 0;
    d.stun = m.hitstun;
    d.crouchStun = wasCrouch;
    d.vx = 0;
    if (d.y > 0) d.vy = 0;
    d.slide = m.pushback;
    d.slideDir = pushDir;
    if (!h.fromProjectile) s.lastAdv = { side: h.attacker, value: m.hitstun - remaining, blocked: false, move: m.name };
  }
  if (atWall && !h.fromProjectile) { a.slide = m.pushback; a.slideDir = (-pushDir) as 1 | -1; }

  // 打擊感：重攻擊、擊倒、KO、必殺技時畫面震動
  if (d.hp <= 0) shake(s, 8, 16);
  else if (knock || m.kind === 'super' || m.damage >= 70) shake(s, m.kind === 'super' ? 5 : 4);
  s.events.push(m.damage >= 70 || knock ? 'hit_heavy' : 'hit_light');

  gainMeter(a, m.meterGain ?? m.damage);
  gainMeter(d, Math.trunc(dmg / 2));
  s.hitstop = Math.max(s.hitstop, hitstop);
  s.sparks.push({ ...h.contact, timer: 12, kind: 'hit' });
}

// ───────────── 回合流程 ─────────────

function updatePhase(s: GameState): void {
  s.phaseTimer++;
  const [a, b] = s.fighters;
  switch (s.phase) {
    case 'intro': {
      const len = s.round === 1 ? INTRO_FIRST : INTRO_NEXT;
      if (s.phaseTimer >= len) { s.phase = 'fight'; s.phaseTimer = 0; }
      break;
    }
    case 'fight': {
      if (s.timeLimit) s.timer--;
      const ko = a.hp <= 0 || b.hp <= 0;
      if (ko || s.timer <= 0) endRound(s, ko ? 'ko' : 'time');
      break;
    }
    case 'ko': {
      if (s.phaseTimer === KO_POSE_AT) {
        const w = s.roundResult?.winner;
        for (const i of [0, 1] as const) {
          const f = s.fighters[i];
          const c = getChar(f.charId);
          f.y = 0; f.vx = 0; f.vy = 0;
          f.form = 'normal';
          if (w === i) { setAction(f, 'win'); f.bubble = { text: c.texts.win, timer: 150 }; }
          else if (w !== null) { setAction(f, 'lose'); f.bubble = { text: c.texts.lose, timer: 150 }; }
        }
      }
      if (s.phaseTimer >= KO_END_AT) {
        if (a.wins >= WINS_TO_MATCH || b.wins >= WINS_TO_MATCH) {
          s.phase = 'matchEnd';
          s.phaseTimer = 0;
          s.matchWinner = a.wins >= WINS_TO_MATCH && b.wins >= WINS_TO_MATCH ? null : a.wins >= WINS_TO_MATCH ? 0 : 1;
        } else nextRound(s);
      }
      break;
    }
    case 'matchEnd':
      break;
  }
}

function endRound(s: GameState, reason: 'ko' | 'time'): void {
  const [a, b] = s.fighters;
  let winner: 0 | 1 | null;
  if (reason === 'ko') winner = a.hp <= 0 && b.hp <= 0 ? null : a.hp <= 0 ? 1 : 0;
  else {
    const ra = Math.trunc((a.hp * 1000) / getChar(a.charId).maxHp);
    const rb = Math.trunc((b.hp * 1000) / getChar(b.charId).maxHp);
    winner = ra === rb ? null : ra > rb ? 0 : 1;
  }
  if (winner === null) { a.wins++; b.wins++; } else s.fighters[winner].wins++;
  s.roundResult = { winner, reason };
  s.phase = 'ko';
  s.phaseTimer = 0;
  s.projectiles = [];
  s.superFreeze = null;
}

function nextRound(s: GameState): void {
  const [a, b] = s.fighters;
  s.round++;
  s.fighters = [newFighter(a.charId, 0, a.wins), newFighter(b.charId, 1, b.wins)];
  // 能量槽保留到下一回合（變身狀態不保留）
  s.fighters[0].meter = a.meter;
  s.fighters[1].meter = b.meter;
  s.phase = 'intro';
  s.phaseTimer = 0;
  s.timer = ROUND_FRAMES;
  s.projectiles = [];
  s.sparks = [];
  s.hitstop = 0;
  s.roundResult = null;
}

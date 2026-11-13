// 核心型別。所有遊戲邏輯只用整數運算（可決定性，之後做 rollback 連線必要）。
// 座標單位：centi-pixel（1 像素 = 100）。角色資料中的 Box 以「像素」表示。

export const FP = 100;

/** 以角色腳底中心為原點、面朝右時的矩形；y 往上為正，(x, y) 為左下角。單位：像素。 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GuardType = 'mid' | 'low' | 'high';
export type MoveKind = 'normal' | 'special' | 'super' | 'transform' | 'throw' | 'taunt' | 'reversal';

export interface ProjectileDef {
  spawnFrame: number;
  speed: number; // centi-px / frame
  box: Box; // 以投射物中心為原點
  spawnX: number; // 相對角色的生成位置（像素）
  spawnY: number;
}

export interface MoveDef {
  id: string;
  name: string;
  kind: MoveKind;
  stance: 'stand' | 'crouch' | 'air';
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  chip?: number;
  hitstun: number;
  blockstun: number;
  hitstop?: number;
  pushback: number; // centi-px / frame 的初速
  guard: GuardType;
  hitbox?: Box;
  /** 出招中（發生後到收招）額外的受擊範圍，例如鞭子伸出去的手。 */
  hurtbox?: Box;
  knockdown?: boolean;
  /** 打中或被防時可以取消接出的招式 id。 */
  cancel?: string[];
  meterGain?: number;
  projectile?: ProjectileDef;
  /** 多段攻擊：從 startup 開始每 interval 影格一段，共 count 段。 */
  multiHit?: { count: number; interval: number };
  /** 特殊技要扣的鬥氣（預設 1 格 = DRIVE_BAR） */
  driveCost?: number;
  fullScreen?: boolean;
  /** 從第 0 格起的無敵影格數。 */
  invuln?: number;
  /** 發生到持續期間每格向前移動（centi-px）。 */
  advance?: number;
  /** 必殺技畫面暫停的影格數。 */
  superFreeze?: number;
  /** 擊飛：命中時把對手往上打飛（centi-px / 格）；需搭配 knockdown */
  launch?: { vx: number; vy: number };
  /** 打不死人（對手最少留 1 滴血），例如鬥氣反擊 */
  nonLethal?: boolean;
  /** 攻擊範圍固定用程式設定的，不套用動畫畫出來的紅框 */
  codeHitbox?: boolean;
}

export interface FormStats {
  walkFwd: number;
  walkBack: number;
  jumpVel: number;
  gravity: number;
  jumpH: number;
  canDash: boolean;
  canCrouch: boolean;
  damagePct: number; // 100 = 1.0 倍
  /** 受到的傷害倍率（100 = 正常；越低越耐打），沒設定就是 100 */
  defensePct?: number;
  hurtStand: Box;
  hurtCrouch: Box;
  hurtAir: Box;
  pushWidth: number; // 像素
  /** 各按鍵對應的招式 id；缺少代表這個形態沒有該招。 */
  moves: {
    sLP?: string; sHP?: string; sLK?: string; sHK?: string;
    cLP?: string; cHP?: string; cLK?: string; cHK?: string;
    jLP?: string; jHP?: string; jLK?: string; jHK?: string;
    sp?: string;
  };
}

export interface CharacterDef {
  id: string;
  name: string;
  color: string; // M1 色塊用
  accent: string;
  maxHp: number;
  dash: { frames: number; speed: number };
  backdash: { frames: number; speed: number; invuln: number };
  throwDamage: number;
  forms: { normal: FormStats; dino?: FormStats };
  super: string; // 必殺技招式 id
  transform?: { duration: number; noMeterGain: boolean };
  moves: Record<string, MoveDef>;
  /** super：放必殺技時橫幅上的台詞（沒設定就顯示「角色名＋招式名」） */
  texts: { intro: string; win: string; lose: string; taunt: string; super?: string };
  /** 由素材資料（data.json）產生：每組動畫每一格的受擊框（遊戲像素、以腳底為原點） */
  anims?: Record<string, AnimHurt>;
}

export interface AnimHurt {
  loop: boolean;
  frames: { duration: number; hurt: Box[] }[];
}

export type Action =
  | 'idle'
  | 'walkF'
  | 'walkB'
  | 'crouch'
  | 'jumpSquat'
  | 'air'
  | 'land'
  | 'dashF'
  | 'dashB'
  | 'attack'
  | 'blockstun'
  | 'hitstun'
  | 'airHit'
  | 'knockdown'
  | 'getup'
  | 'throwing'
  | 'thrown'
  | 'taunt'
  | 'win'
  | 'lose'
  | 'parry'
  | 'parryEnd'
  | 'parried';

export interface Bubble {
  text: string;
  timer: number;
}

export interface FighterState {
  charId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  meter: number;
  action: Action;
  frame: number;
  moveId: string | null;
  hitsDone: number;
  stun: number;
  crouchStun: boolean;
  slide: number;
  slideDir: 1 | -1;
  jumpDir: -1 | 0 | 1;
  prevInput: number;
  bufBits: number;
  bufTimer: number;
  lastFwdTap: number;
  lastBackTap: number;
  dashReq: -1 | 0 | 1;
  dashTimer: number;
  invuln: number;
  comboHits: number;
  airHitKnockdown: boolean;
  form: 'normal' | 'dino';
  formTimer: number;
  bubble: Bubble | null;
  wins: number;
  /** 鬥氣（0～DRIVE_MAX，6 格） */
  drive: number;
  /** 燃盡：鬥氣用光後直到回滿為止 */
  burnout: boolean;
  /** 被投時是在檔架中（被抓會多扣血） */
  throwPunish: boolean;
  /** 被投出去後，落地時才扣的傷害 */
  landDamage: number;
  /** 後撤結束後的冷卻（影格），歸零前不能再後撤 */
  backdashCd: number;
}

export interface Projectile {
  owner: 0 | 1;
  moveId: string;
  x: number;
  y: number;
  vx: number;
  life: number;
}

export interface Spark {
  x: number;
  y: number;
  timer: number;
  kind: 'hit' | 'block' | 'puff' | 'parry' | 'perfect' | 'reversal' | 'tech' | 'burnout';
}

export type Phase = 'intro' | 'fight' | 'ko' | 'matchEnd';

export interface GameState {
  frame: number;
  phase: Phase;
  phaseTimer: number;
  round: number;
  timer: number;
  /** false = 時間無限（測試用） */
  timeLimit: boolean;
  /** 測試用：能量一直是滿的 */
  infiniteMeter?: boolean;
  fighters: [FighterState, FighterState];
  projectiles: Projectile[];
  sparks: Spark[];
  hitstop: number;
  superFreeze: { owner: 0 | 1; timer: number } | null;
  roundResult: { winner: 0 | 1 | null; reason: 'ko' | 'time' } | null;
  matchWinner: 0 | 1 | null;
  /** 畫面震動（只影響畫面） */
  shake: { timer: number; mag: number } | null;
  /** 這一格發生的事件（之後給音效用；rollback 重算時可能重複，播放端需自行去重） */
  events: string[];
  /** 最近一次命中／被防的有利格數（除錯畫面用） */
  lastAdv: { side: 0 | 1; value: number; blocked: boolean; move: string } | null;
}

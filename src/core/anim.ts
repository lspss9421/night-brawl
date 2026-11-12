// 角色狀態 → 該播哪組動畫、第幾個影格。
// 遊戲核心（每格受擊框）和畫面（畫哪一格圖）共用同一套規則，確保看到的和判定一致。
import { getChar } from './characters';
import type { FighterState, GameState, MoveDef } from './types';

export interface AnimRef {
  /** 依序嘗試的動畫名稱（前面的沒有素材就用後面的） */
  keys: string[];
  /** 動畫開始後經過的影格數 */
  t: number;
  /** 指定是否循環；undefined = 用動畫本身的設定 */
  loop?: boolean;
}

function currentMoveOf(f: FighterState): MoveDef | null {
  return f.moveId ? getChar(f.charId).moves[f.moveId] ?? null : null;
}

/** lengthOf(key) 回傳該動畫總影格數（沒有這組動畫回傳 0）。 */
export function animRef(s: GameState, f: FighterState, lengthOf: (key: string) => number): AnimRef | null {
  const t = Math.max(0, f.frame - 1);

  if (s.phase === 'intro' && f.action === 'idle') return { keys: ['intro', 'idle'], t: s.phaseTimer, loop: false };

  if (f.form === 'dino') {
    if (f.action === 'attack' && f.moveId) return { keys: [f.moveId], t, loop: false };
    const map: Partial<Record<FighterState['action'], string>> = {
      idle: 'dino_idle', walkF: 'dino_walk', walkB: 'dino_walk', crouch: 'dino_idle', jumpSquat: 'dino_jumpSquat',
      air: 'dino_air', land: 'dino_land', blockstun: 'dino_block', hitstun: 'dino_hit', airHit: 'dino_hit',
      thrown: 'dino_hit', knockdown: 'dino_knockdown', getup: 'dino_getup', win: 'dino_idle', lose: 'dino_knockdown',
      parry: 'dino_block', parryEnd: 'dino_idle', parried: 'dino_hit',
    };
    const k = map[f.action];
    return k ? { keys: [k], t } : null;
  }

  switch (f.action) {
    case 'idle': return { keys: ['idle'], t };
    case 'walkF': return { keys: ['walkF', 'idle'], t };
    case 'walkB': return { keys: ['walkB', 'walkF', 'idle'], t };
    case 'crouch': {
      const len = lengthOf('crouch');
      if (len && t < len) return { keys: ['crouch'], t, loop: false };
      return { keys: ['crouchIdle', 'crouch'], t: t - len, loop: true };
    }
    case 'jumpSquat': return { keys: ['jumpSquat', 'crouch', 'idle'], t, loop: false };
    case 'air': return { keys: ['air', 'idle'], t };
    case 'land': return { keys: ['land', 'idle'], t, loop: false };
    case 'dashF': return { keys: ['dashF', 'walkF', 'idle'], t };
    case 'dashB': return { keys: ['dashB', 'walkB', 'idle'], t };
    case 'attack': {
      const m = currentMoveOf(f);
      if (!m) return { keys: ['idle'], t };
      if (m.kind === 'taunt') return { keys: ['taunt', 'idle'], t, loop: false };
      const rest = m.stance === 'crouch' ? 'crouchIdle' : m.stance === 'air' ? 'air' : 'idle';
      const extra = m.kind === 'reversal' ? ['sHP'] : [];
      return { keys: [m.id, ...extra, rest], t, loop: false };
    }
    case 'blockstun': return { keys: f.crouchStun ? ['blockCrouch', 'blockStand'] : ['blockStand'], t, loop: false };
    case 'parry': return { keys: ['parry', 'blockStand'], t, loop: false };
    case 'parryEnd': return { keys: ['parryEnd', 'idle'], t, loop: false };
    case 'parried': return { keys: ['hitHeavy', 'hitLight'], t: 0, loop: false };
    case 'hitstun': {
      const heavy = f.stun + f.frame >= 18;
      const keys = f.crouchStun ? ['hitCrouch', 'hitLight'] : heavy ? ['hitHeavy', 'hitLight'] : ['hitLight', 'hitHeavy'];
      return { keys, t, loop: false };
    }
    case 'airHit': return { keys: ['airHit', 'hitHeavy'], t, loop: false };
    case 'knockdown': return { keys: ['knockdown'], t, loop: false };
    case 'getup': return { keys: ['getup', 'idle'], t, loop: false };
    case 'throwing': return { keys: ['throwing', 'sHP', 'idle'], t, loop: false };
    case 'thrown': return { keys: ['thrown', 'hitHeavy'], t, loop: false };
    case 'taunt': return { keys: ['taunt', 'idle'], t, loop: false };
    case 'win': return { keys: ['win', 'idle'], t };
    case 'lose': return { keys: ['lose', 'knockdown'], t: s.phaseTimer, loop: false };
  }
  return null;
}

/** 依經過的影格數找出第幾格（loop = false 時停在最後一格）。 */
export function frameIndexAt(durations: number[], t: number, loop: boolean): number {
  const total = durations.reduce((a, d) => a + Math.max(1, d), 0);
  let time = Math.max(0, t);
  if (loop && total > 0) time %= total;
  let acc = 0;
  for (let i = 0; i < durations.length; i++) {
    acc += Math.max(1, durations[i]);
    if (time < acc) return i;
  }
  return durations.length - 1;
}

// 依角色目前的狀態決定要播哪一組動畫（規則在 core/anim.ts，和判定共用）。
import { animRef } from '../core/anim';
import type { FighterState, GameState } from '../core/types';
import type { SpriteAnimation } from '../shared/spriteFormat';
import { animTotal } from './sprites';

export interface AnimPick {
  key: string;
  anim: SpriteAnimation;
  t: number;
  loop: boolean;
  /** 招式沒有專屬動畫、暫用其他動畫代替 */
  substitute: boolean;
}

export function pickAnim(s: GameState, f: FighterState, anims: Record<string, SpriteAnimation>): AnimPick | null {
  const ref = animRef(s, f, (k) => (anims[k]?.frames.length ? animTotal(anims[k]) : 0));
  if (!ref) return null;
  for (const [i, key] of ref.keys.entries()) {
    const anim = anims[key];
    if (anim?.frames.length) return { key, anim, t: ref.t, loop: ref.loop ?? anim.loop, substitute: i > 0 };
  }
  return null;
}

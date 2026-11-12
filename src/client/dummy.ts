import { currentMove, movePhase } from '../core/game';
import { Btn, type InputBits } from '../core/input';
import type { GameState } from '../core/types';

// 單人測試用的假人（M1 先做簡單版，正式的電腦 AI 在 M5）。
export type DummyMode = 'human' | 'stand' | 'block';

export const DUMMY_LABEL: Record<DummyMode, string> = {
  human: '玩家 2（真人）',
  stand: '假人：站著不動',
  block: '假人：全部防禦',
};

export const DUMMY_ORDER: DummyMode[] = ['human', 'stand', 'block'];

export function dummyInput(s: GameState, side: 0 | 1, mode: DummyMode): InputBits {
  if (mode !== 'block') return 0;
  const me = s.fighters[side];
  const foe = s.fighters[1 - side];
  // 往遠離對手的方向按住 = 防禦
  let bits = foe.x > me.x ? Btn.LEFT : Btn.RIGHT;
  const m = currentMove(foe);
  const phase = movePhase(foe);
  // 對手出下段攻擊時蹲防
  if (m && m.guard === 'low' && phase !== 'recovery') bits |= Btn.DOWN;
  return bits;
}

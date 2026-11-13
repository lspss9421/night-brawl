import { currentMove, movePhase } from '../core/game';
import { Btn, type InputBits } from '../core/input';
import type { GameState } from '../core/types';
import { CpuPlayer, type CpuLevel } from './cpu';

// 玩家 2 的模式：真人、練習用假人、電腦對手（三種難度）。
export type DummyMode = 'human' | 'stand' | 'block' | 'cpuEasy' | 'cpuNormal' | 'cpuHard';

export const DUMMY_LABEL: Record<DummyMode, string> = {
  human: '玩家 2（真人）',
  stand: '假人：站著不動',
  block: '假人：全部防禦',
  cpuEasy: '電腦：簡單',
  cpuNormal: '電腦：普通',
  cpuHard: '電腦：困難',
};

export const DUMMY_ORDER: DummyMode[] = ['human', 'cpuEasy', 'cpuNormal', 'cpuHard', 'stand', 'block'];

const CPU_LEVEL: Partial<Record<DummyMode, CpuLevel>> = { cpuEasy: 'easy', cpuNormal: 'normal', cpuHard: 'hard' };
// 每場對戰各有自己的電腦（記得自己的連段和判斷）；換難度就換一個
const cpus = new WeakMap<GameState, CpuPlayer>();

export function dummyInput(s: GameState, side: 0 | 1, mode: DummyMode): InputBits {
  const level = CPU_LEVEL[mode];
  if (level) {
    let cpu = cpus.get(s);
    if (!cpu || cpu.level !== level) {
      cpu = new CpuPlayer(level, Math.floor(Math.random() * 0x7fffffff));
      cpus.set(s, cpu);
    }
    return cpu.input(s, side);
  }
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

// 每位玩家每一影格的輸入，用位元表示（方便之後透過網路傳送、做 rollback）。
export const Btn = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  LP: 1 << 4, // 輕拳
  HP: 1 << 5, // 重拳
  LK: 1 << 6, // 輕腳
  HK: 1 << 7, // 重腳
  SP: 1 << 8, // 特殊
  TAUNT: 1 << 9, // 挑釁
  DRIVE: 1 << 10, // 鬥氣（按住檔架、防禦中按 = 鬥氣反擊）
} as const;

export type InputBits = number;

export const ATTACK_BUTTONS = Btn.LP | Btn.HP | Btn.LK | Btn.HK | Btn.SP | Btn.TAUNT | Btn.DRIVE;

export function held(bits: InputBits, b: number): boolean {
  return (bits & b) !== 0;
}

export function pressed(cur: InputBits, prev: InputBits, b: number): boolean {
  return (cur & b) !== 0 && (prev & b) === 0;
}

/** 把左右按鍵換算成「前 / 後」（依角色面向）。回傳 1 = 前、-1 = 後、0 = 無。 */
export function horizontal(bits: InputBits, facing: 1 | -1): -1 | 0 | 1 {
  const l = held(bits, Btn.LEFT);
  const r = held(bits, Btn.RIGHT);
  if (l === r) return 0;
  const dir = r ? 1 : -1;
  return dir === facing ? 1 : -1;
}

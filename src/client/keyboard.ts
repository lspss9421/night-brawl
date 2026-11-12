import { Btn, type InputBits } from '../core/input';

export type KeyMap = Record<keyof typeof Btn, string[]>;

// P1：WASD 移動，U/I 輕重拳，J/K 輕重腳，L 特殊，T 挑釁，O 鬥氣
export const P1_KEYS: KeyMap = {
  UP: ['KeyW'],
  DOWN: ['KeyS'],
  LEFT: ['KeyA'],
  RIGHT: ['KeyD'],
  LP: ['KeyU'],
  HP: ['KeyI'],
  LK: ['KeyJ'],
  HK: ['KeyK'],
  SP: ['KeyL'],
  TAUNT: ['KeyT'],
  DRIVE: ['KeyO'],
};

// P2（同一台電腦對打用）：方向鍵移動，P/[ 輕重拳，;/' 輕重腳，] 特殊，\ 挑釁，/ 鬥氣；也可用數字鍵盤
export const P2_KEYS: KeyMap = {
  UP: ['ArrowUp'],
  DOWN: ['ArrowDown'],
  LEFT: ['ArrowLeft'],
  RIGHT: ['ArrowRight'],
  LP: ['KeyP', 'Numpad4'],
  HP: ['BracketLeft', 'Numpad5'],
  LK: ['Semicolon', 'Numpad1'],
  HK: ['Quote', 'Numpad2'],
  SP: ['BracketRight', 'Numpad6'],
  TAUNT: ['Backslash', 'Numpad9'],
  DRIVE: ['Slash', 'Numpad3'],
};

export class Keyboard {
  private down = new Set<string>();
  private pressedOnce = new Set<string>();
  private gameKeys: Set<string>;

  constructor(maps: KeyMap[]) {
    this.gameKeys = new Set(maps.flatMap((m) => Object.values(m).flat()));
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return; // 正在輸入房號等
      if (this.gameKeys.has(e.code) || e.code === 'F1' || e.code === 'F2') e.preventDefault();
      if (!this.down.has(e.code)) this.pressedOnce.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  read(map: KeyMap): InputBits {
    let bits = 0;
    for (const [name, codes] of Object.entries(map) as [keyof typeof Btn, string[]][]) {
      if (codes.some((c) => this.down.has(c))) bits |= Btn[name];
    }
    return bits;
  }

  /** 選單用：這個鍵是否「剛按下」（每次按下只回傳一次 true）。 */
  consume(code: string): boolean {
    return this.pressedOnce.delete(code);
  }

  consumeAny(codes: string[]): boolean {
    let hit = false;
    for (const c of codes) if (this.consume(c)) hit = true;
    return hit;
  }

  clearPressed(): void {
    this.pressedOnce.clear();
  }
}

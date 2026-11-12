import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/core/characters';
import { animSlots } from '../src/shared/animations';
import { deriveTiming, packRects, rectToSpriteBox, spriteBoxToRect } from '../src/shared/spriteFormat';

const f = (duration: number, hit = false) => ({ duration, hit: hit ? [{}] : [] });

describe('deriveTiming：由動畫影格推算發生／持續／收招', () => {
  it('單段攻擊', () => {
    // 3 格起手（共 3+3=6 影格）、2 格攻擊（4 影格）、2 格收招（10 影格）
    const t = deriveTiming([f(3), f(3), f(2, true), f(2, true), f(5), f(5)]);
    expect(t).toMatchObject({ startup: 6, active: 4, recovery: 10, total: 20 });
    expect(t.hitWindows).toEqual([{ from: 7, to: 10 }]);
  });

  it('多段攻擊會分成多個區間', () => {
    const t = deriveTiming([f(4), f(2, true), f(3), f(2, true), f(6)]);
    expect(t.hitWindows).toEqual([{ from: 5, to: 6 }, { from: 10, to: 11 }]);
    expect(t).toMatchObject({ startup: 4, active: 7, recovery: 6, total: 17 });
  });

  it('沒有攻擊框時全部算起手', () => {
    expect(deriveTiming([f(4), f(4)])).toMatchObject({ startup: 8, active: 0, recovery: 0, total: 8 });
  });
});

describe('packRects：排版 sprite sheet', () => {
  it('每格位置不重疊、也不超出大圖', () => {
    const sizes = Array.from({ length: 60 }, (_, i) => ({ w: 40 + ((i * 37) % 90), h: 50 + ((i * 53) % 80) }));
    const { positions, width, height } = packRects(sizes, 512);
    expect(width).toBeLessThanOrEqual(512);
    sizes.forEach((s, i) => {
      const p = positions[i];
      expect(p.x + s.w).toBeLessThanOrEqual(width);
      expect(p.y + s.h).toBeLessThanOrEqual(height);
      for (let j = 0; j < i; j++) {
        const q = positions[j];
        const o = sizes[j];
        const overlap = p.x < q.x + o.w && q.x < p.x + s.w && p.y < q.y + o.h && q.y < p.y + s.h;
        expect(overlap).toBe(false);
      }
    });
  });
});

describe('座標換算', () => {
  it('圖片座標 ↔ 以腳底為原點、y 往上', () => {
    const anchor = { x: 64, y: 120 };
    const rect = { x: 50, y: 20, w: 30, h: 100 }; // 從頭頂到腳底
    const box = rectToSpriteBox(rect, anchor);
    expect(box).toEqual({ x: -14, y: 0, w: 30, h: 100 });
    expect(spriteBoxToRect(box, anchor)).toEqual(rect);
  });
});

describe('動畫清單', () => {
  it('每個招式都有對應的動畫欄位', () => {
    for (const c of Object.values(CHARACTERS)) {
      const keys = new Set(animSlots(c).map((s) => s.key));
      for (const id of Object.keys(c.moves)) expect(keys.has(id)).toBe(true);
      expect(keys.has('idle')).toBe(true);
    }
  });

  it('Mio 有恐龍形態與變回來的動畫；Sawa 有愛心波動的飛行道具', () => {
    const mio = animSlots(CHARACTERS.mio).map((s) => s.key);
    expect(mio).toContain('dino_idle');
    expect(mio).toContain('transformEnd');
    expect(animSlots(CHARACTERS.sawa).map((s) => s.key)).toContain('sp_projectile');
  });
});

// 角色素材資料格式（判定框編輯工具輸出、遊戲讀取）。
// 檔案：public/assets/characters/<角色id>/sheet.png + data.json
//
// 座標規則（data.json 內）：
// - sheet：在 sheet.png 中的位置（像素，左上為原點）
// - anchor：腳底點在該格圖片內的位置（像素，左上為原點）
// - 判定框：以腳底點為原點、y 往上為正、面朝右，(x, y) 為框的左下角，單位為「素材像素」
//   遊戲中換算：遊戲像素 = 素材像素 × scale

export const SPRITE_FORMAT_VERSION = 1;

export interface SpriteBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteFrame {
  sheet: { x: number; y: number; w: number; h: number };
  anchor: { x: number; y: number };
  /** 這一格停留幾個遊戲影格（60 影格 = 1 秒） */
  duration: number;
  hurt: SpriteBox[];
  hit: SpriteBox[];
  push: SpriteBox | null;
}

export interface SpriteAnimation {
  loop: boolean;
  frames: SpriteFrame[];
}

/** 招式的遊戲數值（在編輯工具中調整，覆蓋程式內預設值）。 */
export interface MoveProps {
  damage?: number;
  hitstun?: number;
  blockstun?: number;
  pushback?: number;
  guard?: 'mid' | 'low' | 'high';
  knockdown?: boolean;
  cancel?: string[];
}

export interface CharacterSpriteData {
  version: number;
  characterId: string;
  scale: number;
  sheet: { image: string; width: number; height: number };
  animations: Record<string, SpriteAnimation>;
  moves: Record<string, MoveProps>;
}

export interface Timing {
  startup: number;
  active: number;
  recovery: number;
  total: number;
  /** 每一段攻擊判定的區間（影格，從 1 開始），多段攻擊會有多個 */
  hitWindows: { from: number; to: number }[];
}

/** 由每格停留時間與攻擊判定推算 發生 / 持續 / 收招 影格數。 */
export function deriveTiming(frames: { duration: number; hit: unknown[] }[]): Timing {
  const hitWindows: { from: number; to: number }[] = [];
  let t = 0;
  for (const f of frames) {
    const from = t + 1;
    t += f.duration;
    if (f.hit.length === 0) continue;
    const last = hitWindows[hitWindows.length - 1];
    if (last && last.to === from - 1) last.to = t;
    else hitWindows.push({ from, to: t });
  }
  if (hitWindows.length === 0) return { startup: t, active: 0, recovery: 0, total: t, hitWindows };
  const startup = hitWindows[0].from - 1;
  const lastTo = hitWindows[hitWindows.length - 1].to;
  return { startup, active: lastTo - startup, recovery: t - lastTo, total: t, hitWindows };
}

/** 簡單的「層架」排版：把每格圖由高到低排成一列一列，回傳每格在大圖中的位置。 */
export function packRects(sizes: { w: number; h: number }[], maxWidth = 2048, padding = 2): {
  positions: { x: number; y: number }[];
  width: number;
  height: number;
} {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || a - b);
  const positions: { x: number; y: number }[] = new Array(sizes.length);
  let x = padding;
  let y = padding;
  let rowH = 0;
  let width = 0;
  for (const i of order) {
    const { w, h } = sizes[i];
    if (x + w + padding > maxWidth && x > padding) {
      x = padding;
      y += rowH + padding;
      rowH = 0;
    }
    positions[i] = { x, y };
    x += w + padding;
    rowH = Math.max(rowH, h);
    width = Math.max(width, x);
  }
  return { positions, width: Math.max(1, width), height: Math.max(1, y + rowH + padding) };
}

/** 編輯器內的矩形（圖片座標，左上為原點、y 往下）→ 輸出格式（腳底為原點、y 往上）。 */
export function rectToSpriteBox(r: SpriteBox, anchor: { x: number; y: number }): SpriteBox {
  return { x: r.x - anchor.x, y: anchor.y - (r.y + r.h), w: r.w, h: r.h };
}

export function spriteBoxToRect(b: SpriteBox, anchor: { x: number; y: number }): SpriteBox {
  return { x: b.x + anchor.x, y: anchor.y - b.y - b.h, w: b.w, h: b.h };
}

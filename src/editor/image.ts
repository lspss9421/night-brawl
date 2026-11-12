// 圖片處理：讀檔、去綠幕、找腳底點、裁切透明邊。

export interface Processed {
  png: Blob;
  w: number;
  h: number;
  anchor: { x: number; y: number };
}

const ALPHA_MIN = 32;

export async function loadImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

function toCanvas(img: CanvasImageSource, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

/** 轉成 PNG。用 OffscreenCanvas 編碼：分頁在背景時 canvas.toBlob 可能會卡住，這個不會。 */
async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const off = new OffscreenCanvas(canvas.width, canvas.height);
    off.getContext('2d')!.drawImage(canvas, 0, 0);
    return off.convertToBlob({ type: 'image/png' });
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 轉換失敗'))), 'image/png'));
}

/** 把接近純綠 (#00FF00) 的像素變透明。tolerance 越大，去得越多。 */
export function removeGreen(data: ImageData, tolerance = 90): void {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (g > 120 && g - Math.max(r, b) > tolerance) d[i + 3] = 0;
  }
}

/** 找出不透明像素的範圍。 */
export function opaqueBounds(data: ImageData): { x: number; y: number; w: number; h: number } | null {
  const { width, height, data: d } = data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] >= ALPHA_MIN) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 自動找腳底點：最下面一排不透明像素的底邊，水平取底部幾排的中心。 */
export function autoAnchor(data: ImageData): { x: number; y: number } {
  const { width, height, data: d } = data;
  let bottom = -1;
  for (let y = height - 1; y >= 0 && bottom < 0; y--) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] >= ALPHA_MIN) { bottom = y; break; }
    }
  }
  if (bottom < 0) return { x: Math.round(width / 2), y: height };
  let minX = width, maxX = -1;
  for (let y = Math.max(0, bottom - 5); y <= bottom; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] >= ALPHA_MIN) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return { x: Math.round((minX + maxX + 1) / 2), y: bottom + 1 };
}

export interface ImportOptions {
  chromaKey: boolean;
  /** 一張圖橫向切成幾格（0 = 自動、1 = 不切、N = 自動切成 N 格） */
  columns: number;
  /** 縮小倍數：AI 畫的「像素」常是 3～4 個真實像素，縮回原本的像素大小 */
  shrink: number;
}

/** 找出一排圖中每個角色的左右範圍（依中間的空白直欄切開）。
 *  expected > 0 時會調整成剛好這麼多格：太少就把最寬的一塊從最細的地方切開，太多就把最靠近的兩塊合併。 */
export function detectSegments(data: ImageData, expected = 0, minGap = 10, minWidth = 12): { x0: number; x1: number }[] {
  const { width, height, data: d } = data;
  const fill: number[] = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) if (d[(y * width + x) * 4 + 3] >= ALPHA_MIN) fill[x]++;
  }
  let runs: { x0: number; x1: number }[] = [];
  for (let x = 0; x < width; x++) {
    if (fill[x] < 2) continue;
    const last = runs[runs.length - 1];
    if (last && x - last.x1 <= minGap) last.x1 = x + 1;
    else runs.push({ x0: x, x1: x + 1 });
  }
  runs = runs.filter((r) => r.x1 - r.x0 >= minWidth);
  if (expected <= 0) return runs;
  while (runs.length < expected && runs.length > 0) {
    // 最寬的一塊通常是兩格黏在一起：在中段找不透明像素最少的直欄切開
    let wi = 0;
    runs.forEach((r, i) => { if (r.x1 - r.x0 > runs[wi].x1 - runs[wi].x0) wi = i; });
    const r = runs[wi];
    const w = r.x1 - r.x0;
    let best = -1;
    for (let x = r.x0 + Math.floor(w * 0.25); x < r.x1 - Math.floor(w * 0.25); x++) if (best < 0 || fill[x] < fill[best]) best = x;
    if (best <= r.x0) break;
    runs.splice(wi, 1, { x0: r.x0, x1: best }, { x0: best + 1, x1: r.x1 });
  }
  while (runs.length > expected) {
    let gi = 0;
    for (let i = 1; i < runs.length - 1; i++) if (runs[i + 1].x0 - runs[i].x1 < runs[gi + 1].x0 - runs[gi].x1) gi = i;
    runs.splice(gi, 2, { x0: runs[gi].x0, x1: runs[gi + 1].x1 });
  }
  return runs;
}

/** 自動切格：去背後依空白切開，每格放進同樣寬度的畫布（角色置中），再縮小。 */
async function processAuto(img: ImageBitmap, opt: ImportOptions): Promise<Processed[]> {
  const { canvas: full, ctx } = toCanvas(img, img.width, img.height);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  if (opt.chromaKey) {
    removeGreen(data);
    ctx.putImageData(data, 0, 0);
  }
  const segs = detectSegments(data, opt.columns);
  if (!segs.length) segs.push({ x0: 0, x1: img.width });
  const shrink = Math.max(1, opt.shrink);
  const pad = Math.ceil(8 * shrink);
  const cellW = Math.max(...segs.map((s) => s.x1 - s.x0)) + pad * 2;
  const w = Math.max(1, Math.round(cellW / shrink));
  const h = Math.max(1, Math.round(img.height / shrink));
  const out: Processed[] = [];
  for (const s of segs) {
    const sw = s.x1 - s.x0;
    const cell = document.createElement('canvas');
    cell.width = cellW;
    cell.height = img.height;
    const cg = cell.getContext('2d')!;
    cg.drawImage(full, s.x0, 0, sw, img.height, Math.floor((cellW - sw) / 2), 0, sw, img.height);
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sg = small.getContext('2d', { willReadFrequently: true })!;
    sg.imageSmoothingEnabled = false;
    sg.drawImage(cell, 0, 0, cellW, img.height, 0, 0, w, h);
    out.push({ png: await canvasToBlob(small), w, h, anchor: autoAnchor(sg.getImageData(0, 0, w, h)) });
  }
  return out;
}

/** 讀一張圖 → 依設定切格、縮小（保持像素銳利）、去綠幕、找腳底點。回傳一或多格。
 *  columns = 0：依角色之間的空白自動切開；columns = N（≥2）：自動切開並調整成剛好 N 格；columns = 1：不切。 */
export async function processFile(file: Blob, opt: ImportOptions): Promise<Processed[]> {
  const img = await loadImage(file);
  if (opt.columns !== 1) return processAuto(img, opt);
  const cols = 1;
  const shrink = Math.max(1, opt.shrink);
  const cellW = img.width / cols;
  const w = Math.max(1, Math.round(cellW / shrink));
  const h = Math.max(1, Math.round(img.height / shrink));
  const out: Processed[] = [];
  for (let c = 0; c < cols; c++) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, c * cellW, 0, cellW, img.height, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    if (opt.chromaKey) {
      removeGreen(data);
      ctx.putImageData(data, 0, 0);
    }
    const anchor = autoAnchor(data);
    const png = opt.chromaKey || cols > 1 || shrink > 1 ? await canvasToBlob(canvas) : file;
    out.push({ png, w, h, anchor });
  }
  return out;
}

export async function anchorOf(png: Blob): Promise<{ x: number; y: number }> {
  const img = await loadImage(png);
  const { canvas, ctx } = toCanvas(img, img.width, img.height);
  return autoAnchor(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

/** 依檔名自然排序（walk_2 排在 walk_10 前面）。 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export { canvasToBlob, toCanvas };

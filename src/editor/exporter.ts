// 匯出：把所有影格裁掉透明邊、排進一張 sheet.png，並產生 data.json。
// 匯入：讀回 sheet.png + data.json，拆回一格一格繼續編輯。
import {
  SPRITE_FORMAT_VERSION,
  packRects,
  rectToSpriteBox,
  spriteBoxToRect,
  type CharacterSpriteData,
  type SpriteFrame,
} from '../shared/spriteFormat';
import { canvasToBlob, loadImage, opaqueBounds, toCanvas } from './image';
import { newId, type EditorFrame, type EditorProject } from './project';

export interface ExportResult {
  png: Blob;
  json: CharacterSpriteData;
}

export async function buildExport(p: EditorProject): Promise<ExportResult> {
  // 收集所有影格並裁切
  const items: { anim: string; index: number; frame: EditorFrame; crop: { x: number; y: number; w: number; h: number }; img: ImageBitmap }[] = [];
  for (const [anim, a] of Object.entries(p.anims)) {
    for (let i = 0; i < a.frames.length; i++) {
      const f = a.frames[i];
      const img = await loadImage(f.png);
      const { ctx } = toCanvas(img, f.w, f.h);
      const crop = opaqueBounds(ctx.getImageData(0, 0, f.w, f.h)) ?? { x: 0, y: 0, w: 1, h: 1 };
      items.push({ anim, index: i, frame: f, crop, img });
    }
  }
  const { positions, width, height } = packRects(items.map((it) => ({ w: it.crop.w, h: it.crop.h })));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;

  const animations: CharacterSpriteData['animations'] = {};
  items.forEach((it, k) => {
    const pos = positions[k];
    g.drawImage(it.img, it.crop.x, it.crop.y, it.crop.w, it.crop.h, pos.x, pos.y, it.crop.w, it.crop.h);
    const f = it.frame;
    // 腳底點換算成「裁切後圖片」內的位置
    const anchor = { x: f.anchor.x - it.crop.x, y: f.anchor.y - it.crop.y };
    const out: SpriteFrame = {
      sheet: { x: pos.x, y: pos.y, w: it.crop.w, h: it.crop.h },
      anchor,
      duration: Math.max(1, Math.round(f.duration)),
      hurt: f.hurt.map((r) => rectToSpriteBox(r, f.anchor)),
      hit: f.hit.map((r) => rectToSpriteBox(r, f.anchor)),
      push: f.push ? rectToSpriteBox(f.push, f.anchor) : null,
    };
    (animations[it.anim] ??= { loop: p.anims[it.anim].loop, frames: [] }).frames[it.index] = out;
  });

  const json: CharacterSpriteData = {
    version: SPRITE_FORMAT_VERSION,
    characterId: p.characterId,
    scale: p.scale,
    sheet: { image: 'sheet.png', width, height },
    animations,
    moves: p.moves,
  };
  return { png: await canvasToBlob(canvas), json };
}

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 開發模式下直接存進專案的 public/assets/characters/<id>/ （由 vite.config.ts 的外掛處理）。 */
export async function saveToProject(id: string, r: ExportResult): Promise<void> {
  const files: [string, Blob][] = [
    ['sheet.png', r.png],
    ['data.json', new Blob([JSON.stringify(r.json, null, 2)], { type: 'application/json' })],
  ];
  for (const [name, blob] of files) {
    const res = await fetch(`/__editor/save/${encodeURIComponent(id)}/${name}`, { method: 'POST', body: blob });
    if (!res.ok) throw new Error(`${name}：${await res.text()}`);
  }
}

export async function importExport(png: Blob, json: CharacterSpriteData): Promise<EditorProject> {
  const sheet = await loadImage(png);
  const p: EditorProject = { characterId: json.characterId, scale: json.scale, anims: {}, moves: json.moves ?? {} };
  for (const [key, a] of Object.entries(json.animations)) {
    const frames: EditorFrame[] = [];
    for (const [i, f] of a.frames.entries()) {
      const { canvas, ctx } = toCanvas(sheet, f.sheet.w, f.sheet.h);
      ctx.clearRect(0, 0, f.sheet.w, f.sheet.h);
      ctx.drawImage(sheet, f.sheet.x, f.sheet.y, f.sheet.w, f.sheet.h, 0, 0, f.sheet.w, f.sheet.h);
      frames.push({
        id: newId(),
        name: `${key}_${i + 1}`,
        png: await canvasToBlob(canvas),
        w: f.sheet.w,
        h: f.sheet.h,
        anchor: { ...f.anchor },
        duration: f.duration,
        hurt: f.hurt.map((b) => spriteBoxToRect(b, f.anchor)),
        hit: f.hit.map((b) => spriteBoxToRect(b, f.anchor)),
        push: f.push ? spriteBoxToRect(f.push, f.anchor) : null,
      });
    }
    p.anims[key] = { loop: a.loop, frames };
  }
  return p;
}

export async function fetchFromProject(id: string): Promise<{ png: Blob; json: CharacterSpriteData } | null> {
  const base = `/assets/characters/${encodeURIComponent(id)}`;
  const [jr, pr] = await Promise.all([fetch(`${base}/data.json`, { cache: 'no-store' }), fetch(`${base}/sheet.png`, { cache: 'no-store' })]);
  if (!jr.ok || !pr.ok || !(jr.headers.get('content-type') ?? '').includes('json')) return null;
  return { json: (await jr.json()) as CharacterSpriteData, png: await pr.blob() };
}

// 中間的編輯畫布：顯示目前這一格、前一格的殘影、腳底點與判定框，並處理滑鼠操作。
import type { EditorFrame, Rect } from './project';

export type Tool = 'select' | 'hurt' | 'hit' | 'push' | 'anchor';
export type BoxKind = 'hurt' | 'hit' | 'push';
export interface Selection { kind: BoxKind; index: number }

export const BOX_COLOR: Record<BoxKind, string> = {
  hurt: '80,170,255',
  hit: '255,70,70',
  push: '255,215,64',
};

const images = new WeakMap<Blob, ImageBitmap>();
const loading = new WeakSet<Blob>();

/** 取得 Blob 對應的圖片（第一次會非同步載入，載入完呼叫 onReady）。 */
export function imageFor(blob: Blob, onReady: () => void): ImageBitmap | undefined {
  const img = images.get(blob);
  if (img) return img;
  if (!loading.has(blob)) {
    loading.add(blob);
    createImageBitmap(blob).then((bmp) => { images.set(blob, bmp); onReady(); }).catch(() => loading.delete(blob));
  }
  return undefined;
}

export function boxesOf(f: EditorFrame, kind: BoxKind): Rect[] {
  if (kind === 'push') return f.push ? [f.push] : [];
  return f[kind];
}

interface Callbacks {
  frame(): EditorFrame | null;
  onion(): EditorFrame | null;
  tool(): Tool;
  beforeChange(): void;
  changed(): void;
  selectionChanged(): void;
}

type Drag =
  | { mode: 'create'; kind: BoxKind; sx: number; sy: number }
  | { mode: 'move'; sel: Selection; start: Rect; sx: number; sy: number }
  | { mode: 'resize'; sel: Selection; start: Rect; corner: number }
  | { mode: 'anchor' }
  | { mode: 'pan'; px: number; py: number; startPan: { x: number; y: number } };

export class FrameView {
  zoom = 4;
  pan = { x: 0, y: 0 };
  selection: Selection | null = null;
  showOnion = true;
  private drag: Drag | null = null;
  private ctx: CanvasRenderingContext2D;
  private hover: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private cb: Callbacks) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.render()).observe(canvas);
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', () => this.onUp());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.25 : 0.8));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setZoom(z: number): void {
    this.zoom = Math.min(24, Math.max(1, Math.round(z * 4) / 4));
    this.render();
  }

  fit(): void {
    const f = this.cb.frame();
    if (!f) return;
    const r = this.canvas.getBoundingClientRect();
    this.zoom = Math.max(1, Math.floor(Math.min((r.width - 40) / f.w, (r.height - 40) / f.h)));
    this.pan = { x: 0, y: 0 };
    this.render();
  }

  // ───── 座標換算 ─────
  private origin(f: EditorFrame): { ox: number; oy: number } {
    const r = this.canvas.getBoundingClientRect();
    return { ox: Math.round((r.width - f.w * this.zoom) / 2 + this.pan.x), oy: Math.round((r.height - f.h * this.zoom) / 2 + this.pan.y) };
  }

  private toImage(e: MouseEvent, f: EditorFrame): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const { ox, oy } = this.origin(f);
    return { x: (e.clientX - r.left - ox) / this.zoom, y: (e.clientY - r.top - oy) / this.zoom };
  }

  // ───── 滑鼠 ─────
  private hitTest(f: EditorFrame, p: { x: number; y: number }): Selection | null {
    for (const kind of ['hit', 'hurt', 'push'] as BoxKind[]) {
      const list = boxesOf(f, kind);
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { kind, index: i };
      }
    }
    return null;
  }

  private cornerAt(b: Rect, p: { x: number; y: number }): number {
    const tol = 6 / this.zoom;
    const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
    return corners.findIndex(([cx, cy]) => Math.abs(cx - p.x) <= tol && Math.abs(cy - p.y) <= tol);
  }

  selectedRect(): Rect | null {
    const f = this.cb.frame();
    if (!f || !this.selection) return null;
    return boxesOf(f, this.selection.kind)[this.selection.index] ?? null;
  }

  private onDown(e: MouseEvent): void {
    const f = this.cb.frame();
    if (!f) return;
    if (e.button === 1 || e.button === 2 || e.altKey) {
      this.drag = { mode: 'pan', px: e.clientX, py: e.clientY, startPan: { ...this.pan } };
      return;
    }
    const p = this.toImage(e, f);
    const tool = this.cb.tool();
    if (tool === 'anchor') {
      this.cb.beforeChange();
      f.anchor = { x: Math.round(p.x), y: Math.round(p.y) };
      this.drag = { mode: 'anchor' };
      this.cb.changed();
      return;
    }
    // 先看是不是點在已選取框的角上（縮放）
    const sel = this.selectedRect();
    if (sel && this.selection) {
      const corner = this.cornerAt(sel, p);
      if (corner >= 0) {
        this.cb.beforeChange();
        this.drag = { mode: 'resize', sel: this.selection, start: { ...sel }, corner };
        return;
      }
    }
    const hit = this.hitTest(f, p);
    if (tool === 'select' || (hit && hit.kind === tool)) {
      this.selection = hit;
      this.cb.selectionChanged();
      if (hit) {
        this.cb.beforeChange();
        this.drag = { mode: 'move', sel: hit, start: { ...boxesOf(f, hit.kind)[hit.index] }, sx: p.x, sy: p.y };
      }
      this.render();
      return;
    }
    // 畫新框
    this.cb.beforeChange();
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const r: Rect = { x, y, w: 1, h: 1 };
    if (tool === 'push') {
      f.push = r;
      this.selection = { kind: 'push', index: 0 };
    } else {
      f[tool].push(r);
      this.selection = { kind: tool, index: f[tool].length - 1 };
    }
    this.drag = { mode: 'create', kind: tool, sx: x, sy: y };
    this.cb.selectionChanged();
    this.cb.changed();
  }

  private onMove(e: MouseEvent): void {
    const f = this.cb.frame();
    if (!f) return;
    const r = this.canvas.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    this.hover = inside ? this.toImage(e, f) : null;
    const d = this.drag;
    if (!d) { if (inside) this.render(); return; }
    if (d.mode === 'pan') {
      this.pan = { x: d.startPan.x + e.clientX - d.px, y: d.startPan.y + e.clientY - d.py };
      this.render();
      return;
    }
    const p = this.toImage(e, f);
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (d.mode === 'anchor') {
      f.anchor = { x: px, y: py };
    } else if (d.mode === 'create') {
      const box = this.selectedRect();
      if (box) Object.assign(box, normRect(d.sx, d.sy, px, py));
    } else if (d.mode === 'move') {
      const box = boxesOf(f, d.sel.kind)[d.sel.index];
      if (box) {
        box.x = d.start.x + Math.round(p.x - d.sx);
        box.y = d.start.y + Math.round(p.y - d.sy);
      }
    } else if (d.mode === 'resize') {
      const box = boxesOf(f, d.sel.kind)[d.sel.index];
      if (box) {
        const s = d.start;
        const fixedX = d.corner === 0 || d.corner === 2 ? s.x + s.w : s.x;
        const fixedY = d.corner === 0 || d.corner === 1 ? s.y + s.h : s.y;
        Object.assign(box, normRect(fixedX, fixedY, px, py));
      }
    }
    this.cb.changed();
  }

  private onUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.mode !== 'create') return;
    // 太小的框視為誤點，刪掉
    const f = this.cb.frame();
    const box = this.selectedRect();
    if (f && box && (box.w < 2 || box.h < 2) && this.selection) {
      this.deleteSelected(false);
    }
  }

  deleteSelected(record = true): void {
    const f = this.cb.frame();
    if (!f || !this.selection) return;
    if (record) this.cb.beforeChange();
    if (this.selection.kind === 'push') f.push = null;
    else f[this.selection.kind].splice(this.selection.index, 1);
    this.selection = null;
    this.cb.selectionChanged();
    this.cb.changed();
  }

  /** 方向鍵微調：有選取框就移動框，否則移動腳底點。 */
  nudge(dx: number, dy: number): void {
    const f = this.cb.frame();
    if (!f) return;
    this.cb.beforeChange();
    const box = this.selectedRect();
    if (box) { box.x += dx; box.y += dy; }
    else f.anchor = { x: f.anchor.x + dx, y: f.anchor.y + dy };
    this.cb.changed();
  }

  // ───── 繪製 ─────
  render(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    if (c.width !== Math.round(rect.width * dpr) || c.height !== Math.round(rect.height * dpr)) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, rect.width, rect.height);
    drawChecker(g, rect.width, rect.height);

    const f = this.cb.frame();
    if (!f) {
      g.fillStyle = '#aaa';
      g.font = '16px sans-serif';
      g.textAlign = 'center';
      g.fillText('把 PNG 影格拖進這裡，或按上方「匯入影格」', rect.width / 2, rect.height / 2);
      return;
    }
    const z = this.zoom;
    const { ox, oy } = this.origin(f);

    // 前一格殘影（以腳底點對齊）
    const prev = this.showOnion ? this.cb.onion() : null;
    if (prev) {
      const img = imageFor(prev.png, () => this.render());
      if (img) {
        g.globalAlpha = 0.3;
        g.drawImage(img, ox + (f.anchor.x - prev.anchor.x) * z, oy + (f.anchor.y - prev.anchor.y) * z, prev.w * z, prev.h * z);
        g.globalAlpha = 1;
      }
    }
    const img = imageFor(f.png, () => this.render());
    if (img) g.drawImage(img, ox, oy, f.w * z, f.h * z);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1;
    g.strokeRect(ox - 0.5, oy - 0.5, f.w * z + 1, f.h * z + 1);

    // 地面線 + 腳底點
    const ax = ox + f.anchor.x * z;
    const ay = oy + f.anchor.y * z;
    g.strokeStyle = 'rgba(0,255,170,0.8)';
    g.setLineDash([6, 4]);
    g.beginPath();
    g.moveTo(0, ay + 0.5);
    g.lineTo(rect.width, ay + 0.5);
    g.moveTo(ax + 0.5, ay - 60);
    g.lineTo(ax + 0.5, ay + 20);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#00ffaa';
    g.beginPath();
    g.arc(ax, ay, 5, 0, Math.PI * 2);
    g.fill();

    // 判定框
    for (const kind of ['push', 'hurt', 'hit'] as BoxKind[]) {
      boxesOf(f, kind).forEach((b, i) => {
        const sel = this.selection?.kind === kind && this.selection.index === i;
        const x = ox + b.x * z, y = oy + b.y * z, w = b.w * z, h = b.h * z;
        g.fillStyle = `rgba(${BOX_COLOR[kind]},${kind === 'push' ? 0.15 : 0.25})`;
        g.fillRect(x, y, w, h);
        g.strokeStyle = `rgba(${BOX_COLOR[kind]},1)`;
        g.lineWidth = sel ? 3 : 1.5;
        g.strokeRect(x, y, w, h);
        if (sel) {
          g.fillStyle = '#fff';
          for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) g.fillRect(cx - 4, cy - 4, 8, 8);
        }
      });
    }

    // 游標座標（相對腳底點，y 往上）
    if (this.hover) {
      const hx = Math.floor(this.hover.x) - f.anchor.x;
      const hy = f.anchor.y - Math.floor(this.hover.y);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(8, rect.height - 30, 210, 22);
      g.fillStyle = '#fff';
      g.font = '12px monospace';
      g.textAlign = 'left';
      g.fillText(`離腳底 x:${hx}  y:${hy}   放大 ${this.zoom}x`, 14, rect.height - 15);
    }
  }
}

function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)) };
}

function drawChecker(g: CanvasRenderingContext2D, w: number, h: number): void {
  const s = 16;
  g.fillStyle = '#2a2a33';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#32323d';
  for (let y = 0; y < h; y += s) for (let x = (y / s) % 2 ? s : 0; x < w; x += s * 2) g.fillRect(x, y, s, s);
}

// ───── 預覽播放 ─────

export class Preview {
  playing = true;
  showBoxes = true;
  private t = 0;
  private last = performance.now();
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private get: () => { frames: EditorFrame[]; loop: boolean; scale: number; mirror: boolean }) {
    this.ctx = canvas.getContext('2d')!;
    const loop = (now: number) => {
      const dt = now - this.last;
      this.last = now;
      if (this.playing) this.t += (dt / 1000) * 60;
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  restart(): void { this.t = 0; }

  private draw(): void {
    const { frames, loop, mirror } = this.get();
    let { scale } = this.get();
    const c = this.canvas;
    const g = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#3a2f4f';
    g.fillRect(0, 0, r.width, r.height);
    const groundY = r.height - 24;
    g.fillStyle = '#2a2238';
    g.fillRect(0, groundY, r.width, r.height - groundY);
    if (!frames.length) return;
    const total = frames.reduce((s, f) => s + Math.max(1, f.duration), 0);
    let t = Math.floor(this.t);
    if (loop) t %= total;
    else if (t >= total + 30) { this.t = 0; t = 0; } // 播完停一下再重播
    let idx = frames.length - 1;
    let acc = 0;
    for (let i = 0; i < frames.length; i++) {
      acc += Math.max(1, frames[i].duration);
      if (t < acc) { idx = i; break; }
    }
    const f = frames[idx];
    const img = imageFor(f.png, () => {});
    const cx = r.width / 2;
    // 預覽框放不下時自動縮小（遊戲中的實際倍數不變）
    const tallest = Math.max(...frames.map((fr) => fr.anchor.y));
    const fitScale = Math.max(0.25, Math.min(scale, (groundY - 24) / Math.max(1, tallest)));
    scale = fitScale;
    const flip = mirror ? -1 : 1;
    g.save();
    g.translate(cx, groundY);
    g.scale(flip, 1);
    if (img) g.drawImage(img, -f.anchor.x * scale, -f.anchor.y * scale, f.w * scale, f.h * scale);
    if (this.showBoxes) {
      for (const kind of ['push', 'hurt', 'hit'] as BoxKind[]) {
        for (const b of boxesOf(f, kind)) {
          g.strokeStyle = `rgba(${BOX_COLOR[kind]},0.9)`;
          g.lineWidth = 1.5;
          g.strokeRect((b.x - f.anchor.x) * scale, (b.y - f.anchor.y) * scale, b.w * scale, b.h * scale);
        }
      }
    }
    g.restore();
    g.fillStyle = '#fff';
    g.font = '12px monospace';
    g.textAlign = 'left';
    g.fillText(`第 ${idx + 1}/${frames.length} 格  影格 ${Math.min(t, total - 1) + 1}/${total}`, 8, 16);
  }
}

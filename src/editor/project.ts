// 編輯器的專案資料：每位角色一份，存在瀏覽器的 IndexedDB（關掉頁面也不會遺失）。
import type { MoveProps, SpriteBox } from '../shared/spriteFormat';

export type Rect = SpriteBox; // 編輯器內：圖片座標，左上為原點、y 往下

export interface EditorFrame {
  id: string;
  name: string;
  png: Blob; // 已去背的圖片
  w: number;
  h: number;
  anchor: { x: number; y: number };
  duration: number;
  hurt: Rect[];
  hit: Rect[];
  push: Rect | null;
}

export interface EditorAnim {
  loop: boolean;
  frames: EditorFrame[];
}

export interface EditorProject {
  characterId: string;
  scale: number;
  anims: Record<string, EditorAnim>;
  moves: Record<string, MoveProps>;
}

export function emptyProject(characterId: string): EditorProject {
  return { characterId, scale: 2, anims: {}, moves: {} };
}

let idCounter = 0;
export function newId(): string {
  idCounter++;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** 複製專案的「描述資料」（圖片 Blob 共用，不複製），給復原功能用。 */
export function snapshot(p: EditorProject): EditorProject {
  const anims: Record<string, EditorAnim> = {};
  for (const [k, a] of Object.entries(p.anims)) {
    anims[k] = {
      loop: a.loop,
      frames: a.frames.map((f) => ({
        ...f,
        anchor: { ...f.anchor },
        hurt: f.hurt.map((r) => ({ ...r })),
        hit: f.hit.map((r) => ({ ...r })),
        push: f.push ? { ...f.push } : null,
      })),
    };
  }
  return { ...p, anims, moves: structuredClone(p.moves) };
}

export class History {
  private undoStack: EditorProject[] = [];
  private redoStack: EditorProject[] = [];

  push(p: EditorProject): void {
    this.undoStack.push(snapshot(p));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(cur: EditorProject): EditorProject | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(snapshot(cur));
    return prev;
  }

  redo(cur: EditorProject): EditorProject | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(snapshot(cur));
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

// ───── IndexedDB ─────

const DB_NAME = 'fighter-sprite-editor';
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadProject(characterId: string): Promise<EditorProject | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(characterId);
    req.onsuccess = () => resolve((req.result as EditorProject) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(p: EditorProject): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(p, p.characterId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

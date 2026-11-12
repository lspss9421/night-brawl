// 讀取 public/assets/characters/<id>/ 的 sheet.png + data.json，並套進角色遊戲數值。
import { CHARACTER_IDS, getChar, registerCharacter } from '../core/characters';
import { applySpriteData } from '../core/spriteMerge';
import type { CharacterSpriteData, SpriteAnimation, SpriteFrame } from '../shared/spriteFormat';

export interface SpriteSet {
  data: CharacterSpriteData;
  sheet: ImageBitmap;
}

export const sprites = new Map<string, SpriteSet>();

export async function loadAllSprites(): Promise<string[]> {
  const loaded: string[] = [];
  await Promise.all(
    CHARACTER_IDS.map(async (id) => {
      try {
        const base = `${import.meta.env.BASE_URL}assets/characters/${id}`; // 支援放在子路徑（例如 GitHub Pages）
        const jr = await fetch(`${base}/data.json`, { cache: 'no-store' });
        if (!jr.ok || !(jr.headers.get('content-type') ?? '').includes('json')) return;
        const data = (await jr.json()) as CharacterSpriteData;
        const pr = await fetch(`${base}/${data.sheet.image}`, { cache: 'no-store' });
        if (!pr.ok) return;
        const sheet = await createImageBitmap(await pr.blob());
        sprites.set(id, { data, sheet });
        registerCharacter(applySpriteData(getChar(id), data));
        loaded.push(id);
      } catch (e) {
        console.warn(`角色 ${id} 素材讀取失敗，改用色塊`, e);
      }
    }),
  );
  return loaded;
}

/** 依經過的影格數取出動畫的某一格；loop = false 時停在最後一格。 */
export function frameAt(anim: SpriteAnimation, t: number, loop = anim.loop): SpriteFrame {
  const total = anim.frames.reduce((s, f) => s + Math.max(1, f.duration), 0);
  let time = Math.max(0, t);
  if (loop) time %= total;
  let acc = 0;
  for (const f of anim.frames) {
    acc += Math.max(1, f.duration);
    if (time < acc) return f;
  }
  return anim.frames[anim.frames.length - 1];
}

export function animTotal(anim: SpriteAnimation): number {
  return anim.frames.reduce((s, f) => s + Math.max(1, f.duration), 0);
}

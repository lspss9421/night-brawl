// 把判定框編輯器輸出的資料（data.json）套進角色的遊戲數值。
// 純函式、只用整數 → 雙方載入同一份 data.json 就會得到完全相同的角色資料（rollback 需要）。
import { deriveTiming, type CharacterSpriteData, type SpriteBox } from '../shared/spriteFormat';
import type { Box, CharacterDef, FormStats, MoveDef } from './types';

function toGame(b: SpriteBox, scale: number): Box {
  return { x: Math.round(b.x * scale), y: Math.round(b.y * scale), w: Math.round(b.w * scale), h: Math.round(b.h * scale) };
}

function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function firstHurt(data: CharacterSpriteData, key: string): Box | undefined {
  const f = data.animations[key]?.frames[0];
  return f?.hurt.length ? union(f.hurt.map((b) => toGame(b, data.scale))) : undefined;
}

export function applySpriteData(base: CharacterDef, data: CharacterSpriteData): CharacterDef {
  const def: CharacterDef = structuredClone(base);
  const scale = data.scale;

  // 角色身體：待機 / 蹲待機 / 空中 的第一格決定受擊範圍；待機的推擠框決定推擠寬度
  const n: FormStats = def.forms.normal;
  n.hurtStand = firstHurt(data, 'idle') ?? n.hurtStand;
  n.hurtCrouch = firstHurt(data, 'crouchIdle') ?? firstHurt(data, 'crouch') ?? n.hurtCrouch;
  n.hurtAir = firstHurt(data, 'air') ?? n.hurtAir;
  const push = data.animations.idle?.frames[0]?.push;
  if (push) n.pushWidth = Math.max(10, Math.round(push.w * scale));

  // 每組動畫每一格的受擊框（出招時伸出去的手腳也算受擊範圍，但比攻擊框短一點）
  def.anims = {};
  for (const [key, anim] of Object.entries(data.animations)) {
    if (key.endsWith('_projectile')) continue;
    def.anims[key] = {
      loop: anim.loop,
      frames: anim.frames.map((f) => {
        const hurt = f.hurt.map((b) => toGame(b, scale));
        for (const h of f.hit) {
          const limbW = Math.min(h.w, 40); // 從手腳根部算起最多 40 素材像素
          hurt.push(toGame({ x: h.x, y: h.y, w: Math.max(1, Math.round(limbW * 0.8)), h: h.h }, scale));
        }
        return { duration: Math.max(1, f.duration), hurt };
      }),
    };
  }

  for (const [id, m] of Object.entries(def.moves)) {
    const anim = data.animations[id];
    if (anim?.frames.length) applyAnimTiming(m, anim.frames, scale);
    const props = data.moves?.[id];
    if (props) {
      if (props.damage !== undefined) m.damage = props.damage;
      if (props.hitstun !== undefined) m.hitstun = props.hitstun;
      if (props.blockstun !== undefined) m.blockstun = props.blockstun;
      if (props.pushback !== undefined) m.pushback = props.pushback;
      if (props.guard) m.guard = props.guard;
      if (props.knockdown !== undefined) m.knockdown = props.knockdown;
      if (props.cancel) m.cancel = [...props.cancel];
    }
    // 飛行道具的判定
    const proj = data.animations[`${id}_projectile`]?.frames[0];
    if (m.projectile && proj?.hit.length) m.projectile.box = union(proj.hit.map((b) => toGame(b, scale)))!;
  }
  return def;
}

function applyAnimTiming(m: MoveDef, frames: CharacterSpriteData['animations'][string]['frames'], scale: number): void {
  if (m.fullScreen || m.kind === 'transform' || m.kind === 'taunt') return; // 這些招的時間由程式控制
  const t = deriveTiming(frames);
  if (t.hitWindows.length) {
    m.startup = t.startup;
    m.active = t.active;
    m.recovery = t.recovery;
    // 攻擊範圍：所有攻擊格的紅框合併
    let k = 0;
    const boxes: Box[] = [];
    for (const f of frames) {
      const from = k + 1;
      k += f.duration;
      if (f.hit.length && t.hitWindows.some((w) => from >= w.from && from <= w.to)) boxes.push(...f.hit.map((b) => toGame(b, scale)));
    }
    // 鬥氣反擊保留程式設定的攻擊範圍（防禦後雙方被推開，畫出來的手掌不夠長）
    if (m.kind !== 'reversal') m.hitbox = union(boxes) ?? m.hitbox;
  } else if (!m.projectile && t.total > 0 && m.hitbox === undefined) {
    // 沒有攻擊判定的招（例如投空）：整段動畫都是收招
    m.recovery = Math.max(0, t.total - m.startup - m.active);
  }
}

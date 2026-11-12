// M1 色塊渲染器（Canvas 2D）。只讀取遊戲狀態，不改變它。
// M3 接入 Sprite Sheet 時會換成正式的角色圖。
import { getChar } from '../core/characters';
import {
  METER_MAX,
  ROUND_FRAMES,
  SCREEN_H,
  SCREEN_W,
  WINS_TO_MATCH,
  DRIVE_BAR,
  activeHitbox,
  currentMove,
  formStats,
  hurtboxes,
  movePhase,
  projBox,
  toWorld,
} from '../core/game';
import type { Box, FighterState, GameState } from '../core/types';
import type { SpriteFrame } from '../shared/spriteFormat';
import { pickAnim } from './animSelect';
import { frameAt, sprites, type SpriteSet } from './sprites';
import { FP } from '../core/types';

const GROUND_Y = 640;
const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';

const ACTION_LABEL: Record<string, string> = {
  idle: '', walkF: '前進', walkB: '後退', crouch: '蹲', jumpSquat: '起跳', air: '', land: '著地',
  dashF: '前衝', dashB: '後撤', blockstun: '防禦！', hitstun: '受擊', airHit: '擊飛', knockdown: '倒地',
  getup: '起身', throwing: '投技', thrown: '被投', taunt: '挑釁', win: '勝利', lose: '戰敗',
  parry: '檔架', parryEnd: '檔架收招', parried: '破綻',
};

export interface RenderOptions {
  showBoxes: boolean;
  p2Label: string;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    this.ctx = canvas.getContext('2d')!;
  }

  // ───── 座標 ─────
  private sx(x: number): number { return x / FP; }
  private sy(y: number): number { return GROUND_Y - y / FP; }
  private rect(b: Box): [number, number, number, number] {
    return [this.sx(b.x), this.sy(b.y + b.h), b.w / FP, b.h / FP];
  }

  draw(s: GameState, opt: RenderOptions): void {
    const g = this.ctx;
    // 畫面震動：只移動場景，不移動血條等介面
    g.save();
    if (s.shake) {
      const k = s.shake.mag * Math.min(1, s.shake.timer / 8);
      g.translate((s.frame % 2 ? 1 : -1) * k, (s.frame % 3 === 0 ? 1 : -1) * k * 0.6);
    }
    this.drawStage();
    for (const f of s.fighters) this.drawFighter(s, f, opt.showBoxes);
    this.drawSuperEffects(s);
    for (const p of s.projectiles) this.drawProjectile(s, p);
    for (const sp of s.sparks) this.drawSpark(sp.x, sp.y, sp.timer, sp.kind);
    if (opt.showBoxes) for (const f of s.fighters) this.drawBoxes(s, f);
    for (const f of s.fighters) this.drawBubble(f);
    g.restore();
    if (s.superFreeze) this.drawSuperFreeze(s);
    this.drawHud(s, opt);
    if (opt.showBoxes) this.drawDebug(s);
    this.drawPhase(s);
    g.textAlign = 'left';
  }

  /** 除錯資訊：狀態、第幾格、頓幀、鬥氣、有利格數。 */
  private drawDebug(s: GameState): void {
    const g = this.ctx;
    const PHASE: Record<string, string> = { startup: '前搖', active: '攻擊判定', recovery: '後搖' };
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      const m = currentMove(f);
      const ph = movePhase(f);
      const name = m && f.action === 'attack' ? `${m.name}（${f.moveId}）` : ACTION_LABEL[f.action] || f.action;
      const lines = [
        `狀態 ${f.action}　${name}`,
        m && f.action === 'attack' ? `${PHASE[ph ?? ''] ?? ''} 第 ${f.frame}/${m.startup + m.active + m.recovery} 格（發生 ${m.startup}・持續 ${m.active}・收招 ${m.recovery}）` : `第 ${f.frame} 格${f.stun > 0 ? `　硬直剩 ${f.stun}` : ''}`,
        `鬥氣 ${(f.drive / DRIVE_BAR).toFixed(2)} 格${f.burnout ? '（燃盡）' : ''}　無敵 ${f.invuln}　連段 ${f.comboHits}`,
      ];
      const x = i === 0 ? 40 : SCREEN_W - 40 - 380;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(x, 108, 380, 64);
      g.font = `13px ${FONT}`;
      g.textAlign = 'left';
      g.fillStyle = '#e0ffe0';
      lines.forEach((t, k) => g.fillText(t, x + 8, 126 + k * 18));
    }
    const adv = s.lastAdv;
    const info = `頓幀 ${s.hitstop}　${adv ? `上一擊：${adv.side === 0 ? 'P1' : 'P2'} ${adv.move} ${adv.blocked ? '被防' : '命中'} ${adv.value >= 0 ? '+' : ''}${adv.value} 格` : ''}`;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.font = `13px ${FONT}`;
    const w = g.measureText(info).width + 20;
    g.fillRect(SCREEN_W / 2 - w / 2, 92, w, 22);
    g.textAlign = 'center';
    g.fillStyle = '#fff59d';
    g.fillText(info, SCREEN_W / 2, 108);
    g.textAlign = 'left';
  }

  private drawStage(): void {
    const g = this.ctx;
    const sky = g.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#2b2350');
    sky.addColorStop(1, '#6b4f8f');
    g.fillStyle = sky;
    g.fillRect(0, 0, SCREEN_W, GROUND_Y);
    g.fillStyle = '#3a2f4f';
    g.fillRect(0, GROUND_Y, SCREEN_W, SCREEN_H - GROUND_Y);
    g.strokeStyle = '#9f8fc4';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, GROUND_Y);
    g.lineTo(SCREEN_W, GROUND_Y);
    g.stroke();
    // 舞台邊界
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, 0, 30, GROUND_Y);
    g.fillRect(SCREEN_W - 30, 0, 30, GROUND_Y);
  }

  private drawFighter(s: GameState, f: FighterState, debug: boolean): void {
    const g = this.ctx;
    const c = getChar(f.charId);
    const st = formStats(f);
    const dino = f.form === 'dino';
    const cx = this.sx(f.x);
    const baseY = this.sy(f.y);

    // 影子
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(cx, GROUND_Y + 4, 40, 8, 0, 0, Math.PI * 2);
    g.fill();

    const m = currentMove(f);
    const flash = f.invuln > 0 && Math.floor(s.frame / 3) % 2 === 0;
    const set = sprites.get(f.charId);
    const pick = set ? pickAnim(s, f, set.data.animations) : null;
    let w = st.hurtStand.w;
    if (set && pick) {
      this.drawSprite(set, frameAt(pick.anim, pick.t, pick.loop), cx, baseY, f.facing, flash ? 0.55 : 1, f.burnout);
    } else {
    let h = st.hurtStand.h;
    if (f.action === 'crouch' || (m?.stance === 'crouch') || ((f.action === 'hitstun' || f.action === 'blockstun') && f.crouchStun)) h = st.hurtCrouch.h;
    if (f.action === 'air' || m?.stance === 'air' || f.action === 'airHit') h = st.hurtAir.h;
    if (f.action === 'knockdown' || f.action === 'thrown') { w = h; h = 40; }
    if (f.action === 'getup') h = Math.trunc(h * 0.6);
    if (f.action === 'lose') h = Math.trunc(h * 0.55);

    g.globalAlpha = flash ? 0.55 : 1;
    g.fillStyle = dino ? '#ffca28' : c.color;
    g.strokeStyle = dino ? '#a67c00' : c.accent;
    g.lineWidth = 3;
    const x0 = cx - w / 2;
    const y0 = baseY - h;
    roundRect(g, x0, y0, w, h, dino ? 30 : 10);
    g.fill();
    g.stroke();

    if (dino) {
      // 白肚子 + 尾巴
      g.fillStyle = '#fff3d0';
      g.beginPath();
      g.ellipse(cx + f.facing * 6, baseY - h * 0.38, w * 0.3, h * 0.26, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffca28';
      g.beginPath();
      g.moveTo(cx - f.facing * w * 0.45, baseY - 30);
      g.lineTo(cx - f.facing * (w * 0.5 + 40), baseY - 8);
      g.lineTo(cx - f.facing * w * 0.45, baseY - 6);
      g.fill();
    }

    // 眼睛（表示面向）
    if (f.action !== 'knockdown' && f.action !== 'thrown') {
      const eyeY = y0 + Math.min(34, h * 0.2);
      g.fillStyle = '#1b1b2f';
      g.fillRect(cx + f.facing * (w * 0.18), eyeY, 6, 9);
      g.fillRect(cx + f.facing * (w * 0.18) + f.facing * 12, eyeY, 6, 9);
    }
    g.globalAlpha = 1;
    }

    // 檔架：水藍色光圈
    if (f.action === 'parry') {
      const r = 70 + Math.sin(s.frame / 3) * 4;
      g.strokeStyle = 'rgba(80,220,255,0.85)';
      g.fillStyle = 'rgba(80,220,255,0.15)';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(cx, baseY - 100, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (f.action === 'parried') {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = `bold 18px ${FONT}`;
      g.textAlign = 'center';
      g.fillText('✦ 破綻 ✦', cx, baseY - 230);
    }

    // 鞭子
    if (!pick && m?.id === 'sp' && f.charId === 'mio' && movePhase(f) === 'active' && m.hitbox) {
      const hb = toWorld(f, m.hitbox);
      const tipX = f.facing === 1 ? this.sx(hb.x + hb.w) : this.sx(hb.x);
      const yy = this.sy(hb.y + hb.h / 2);
      g.strokeStyle = '#6d4c41';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(cx + f.facing * w * 0.4, yy);
      g.quadraticCurveTo((cx + tipX) / 2, yy - 18, tipX, yy);
      g.stroke();
    }

    // 招式手腳（發生中為虛線外框、持續中為實心）
    const ph = movePhase(f);
    // （有專屬動畫的招式不畫，動畫本身就看得到手腳）
    if ((!pick || pick.substitute) && m?.hitbox && !m.fullScreen && (ph === 'startup' || ph === 'active') && !(m.id === 'sp' && f.charId === 'mio' && ph === 'active')) {
      const [rx, ry, rw, rh] = this.rect(toWorld(f, m.hitbox));
      if (ph === 'active') {
        g.fillStyle = dino ? '#ffca28' : c.color;
        g.fillRect(rx, ry, rw, rh);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.strokeRect(rx, ry, rw, rh);
      } else {
        g.setLineDash([4, 4]);
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.lineWidth = 1;
        g.strokeRect(rx, ry, rw, rh);
        g.setLineDash([]);
      }
    }

    // 動作名稱
    const label = m && f.action === 'attack' ? m.name : ACTION_LABEL[f.action] ?? '';
    if (label && (debug || !pick)) {
      g.font = `bold 15px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 4;
      g.strokeText(label, cx, baseY + 26);
      g.fillText(label, cx, baseY + 26);
    }
  }

  private drawSprite(set: SpriteSet, fr: SpriteFrame, x: number, y: number, facing: 1 | -1, alpha: number, dim = false): void {
    const g = this.ctx;
    const sc = set.data.scale;
    g.save();
    g.globalAlpha = alpha;
    if (dim) g.filter = 'brightness(0.65) saturate(0.4)'; // 燃盡：角色變暗
    g.imageSmoothingEnabled = false;
    g.translate(Math.round(x), Math.round(y));
    g.scale(facing, 1);
    g.drawImage(set.sheet, fr.sheet.x, fr.sheet.y, fr.sheet.w, fr.sheet.h, -fr.anchor.x * sc, -fr.anchor.y * sc, fr.sheet.w * sc, fr.sheet.h * sc);
    g.restore();
  }

  private drawProjectile(s: GameState, p: GameState['projectiles'][number]): void {
    const set = sprites.get(s.fighters[p.owner].charId);
    const anim = set?.data.animations[`${p.moveId}_projectile`];
    if (set && anim?.frames.length) {
      this.drawSprite(set, frameAt(anim, s.frame, true), this.sx(p.x), this.sy(p.y), p.vx >= 0 ? 1 : -1, 1);
    } else {
      this.drawHeart(projBox(s, p));
    }
  }

  private drawBoxes(s: GameState, f: FighterState): void {
    const g = this.ctx;
    g.lineWidth = 2;
    for (const hb of hurtboxes(f, s)) {
      g.strokeStyle = 'rgba(80,180,255,0.9)';
      g.strokeRect(...this.rect(hb));
    }
    const hit = activeHitbox(f);
    if (hit && !currentMove(f)?.fullScreen) {
      g.fillStyle = 'rgba(255,40,40,0.35)';
      g.fillRect(...this.rect(hit));
      g.strokeStyle = 'rgba(255,60,60,1)';
      g.strokeRect(...this.rect(hit));
    }
    // 推擠框
    const pw = formStats(f).pushWidth;
    g.strokeStyle = 'rgba(255,230,80,0.7)';
    g.strokeRect(this.sx(f.x) - pw / 2, this.sy(f.y) - 6, pw, 6);
  }

  private drawHeart(b: Box): void {
    const g = this.ctx;
    const [x, y, w, h] = this.rect(b);
    const cx = x + w / 2;
    g.fillStyle = '#ff4f9a';
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, y + h * 0.95);
    g.bezierCurveTo(x - w * 0.3, y + h * 0.45, x + w * 0.15, y - h * 0.2, cx, y + h * 0.25);
    g.bezierCurveTo(x + w * 0.85, y - h * 0.2, x + w * 1.3, y + h * 0.45, cx, y + h * 0.95);
    g.fill();
    g.stroke();
  }

  private drawSuperEffects(s: GameState): void {
    const g = this.ctx;
    for (const f of s.fighters) {
      const m = currentMove(f);
      if (!m?.fullScreen || f.action !== 'attack') continue;
      const t = f.frame - m.startup;
      if (t < 0 || t > m.active) continue;
      const cx = this.sx(f.x);
      const cy = this.sy(f.y + 150 * FP);
      g.lineWidth = 6;
      for (let k = 0; k < 4; k++) {
        const r = ((t * 14 + k * 160) % 640) + 20;
        g.strokeStyle = `rgba(255,120,190,${1 - r / 660})`;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.font = `bold 34px ${FONT}`;
      g.fillStyle = '#ffd1e8';
      g.textAlign = 'center';
      for (let k = 0; k < 10; k++) {
        const nx = (k * 137 + t * 9) % SCREEN_W;
        const ny = 120 + ((k * 83 + t * 3) % 380);
        g.fillText(k % 2 ? '♪' : '♫', nx, ny);
      }
      // 麥克風
      g.fillStyle = '#ddd';
      g.fillRect(cx + f.facing * 20 - 4, cy - 10, 8, 30);
      g.fillStyle = '#555';
      g.beginPath();
      g.arc(cx + f.facing * 20, cy - 14, 9, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawSpark(x: number, y: number, timer: number, kind: string): void {
    const g = this.ctx;
    const cx = this.sx(x);
    const cy = this.sy(y);
    if (kind === 'parry' || kind === 'perfect') {
      // 檔架：水藍色光環；完美檔架：更大、白色閃光
      const big = kind === 'perfect';
      const life = big ? 20 : 12;
      const r = (life - timer) * (big ? 9 : 6) + 20;
      g.strokeStyle = big ? `rgba(255,255,255,${timer / life})` : `rgba(80,220,255,${timer / life})`;
      g.lineWidth = big ? 8 : 5;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      if (big) {
        g.strokeStyle = `rgba(80,220,255,${timer / life})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
        g.stroke();
      }
      return;
    }
    if (kind === 'reversal') {
      // 鬥氣反擊：金色光芒
      g.strokeStyle = `rgba(255,200,40,${timer / 18})`;
      g.lineWidth = 5;
      g.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const r = (18 - timer) * 7 + 30;
        g.moveTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5);
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.stroke();
      return;
    }
    if (kind === 'tech') {
      g.strokeStyle = `rgba(255,255,255,${timer / 14})`;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(cx - 30, cy - 30); g.lineTo(cx + 30, cy + 30);
      g.moveTo(cx + 30, cy - 30); g.lineTo(cx - 30, cy + 30);
      g.stroke();
      return;
    }
    if (kind === 'burnout') {
      g.fillStyle = `rgba(120,120,120,${timer / 30})`;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        g.arc(cx + (k - 2) * 22, cy - (30 - timer) * 2 - (k % 2) * 10, 16, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    if (kind === 'puff') {
      g.fillStyle = `rgba(255,255,255,${timer / 24})`;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const r = (24 - timer) * 4;
        g.beginPath();
        g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 26, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    const color = kind === 'hit' ? '255,220,60' : '120,200,255';
    const r = (14 - timer) * 4 + 12;
    g.strokeStyle = `rgba(${color},${timer / 12})`;
    g.lineWidth = 4;
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.moveTo(cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4);
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.stroke();
  }

  private drawBubble(f: FighterState): void {
    if (!f.bubble) return;
    const g = this.ctx;
    const st = formStats(f);
    const cx = this.sx(f.x);
    const top = this.sy(f.y + st.hurtStand.h * FP) - 24;
    g.font = `bold 22px ${FONT}`;
    const tw = g.measureText(f.bubble.text).width;
    const bw = tw + 32;
    const bh = 44;
    const bx = Math.min(SCREEN_W - bw - 8, Math.max(8, cx - bw / 2));
    const by = Math.max(80, top - bh);
    g.fillStyle = '#fff';
    g.strokeStyle = '#333';
    g.lineWidth = 3;
    roundRect(g, bx, by, bw, bh, 18);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 8, by + bh - 1);
    g.lineTo(cx, by + bh + 14);
    g.lineTo(cx + 8, by + bh - 1);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = '#333';
    g.fillText(f.bubble.text, bx + bw / 2, by + 30);
  }

  private drawSuperFreeze(s: GameState): void {
    const g = this.ctx;
    const f = s.fighters[s.superFreeze!.owner];
    const m = currentMove(f);
    g.fillStyle = 'rgba(10,0,20,0.55)';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    const c = getChar(f.charId);
    g.fillStyle = c.color;
    g.fillRect(0, 300, SCREEN_W, 90);
    g.font = `bold 52px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.strokeStyle = c.accent;
    g.lineWidth = 6;
    const text = `${c.name}　${m?.name ?? ''}`;
    g.strokeText(text, SCREEN_W / 2, 364);
    g.fillText(text, SCREEN_W / 2, 364);
  }

  private drawHud(s: GameState, opt: RenderOptions): void {
    const g = this.ctx;
    const barW = 500;
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      const c = getChar(f.charId);
      const left = i === 0;
      const x = left ? 40 : SCREEN_W - 40 - barW;
      // 血條
      g.fillStyle = '#222';
      g.fillRect(x, 30, barW, 26);
      const ratio = f.hp / c.maxHp;
      g.fillStyle = ratio > 0.3 ? '#4caf50' : '#ff7043';
      const hw = barW * ratio;
      g.fillRect(left ? x + barW - hw : x, 30, hw, 26);
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.strokeRect(x, 30, barW, 26);
      // 鬥氣槽（6 格，綠色；燃盡時灰色閃爍）
      const dx0 = left ? x : x + barW - 300;
      const segW = 300 / 6;
      for (let k = 0; k < 6; k++) {
        const sx = left ? dx0 + 300 - (k + 1) * segW : dx0 + k * segW;
        g.fillStyle = '#1b1b1b';
        g.fillRect(sx + 2, 60, segW - 4, 9);
        const fill = Math.max(0, Math.min(1, (f.drive - k * DRIVE_BAR) / DRIVE_BAR));
        if (fill > 0) {
          g.fillStyle = f.burnout ? (Math.floor(s.frame / 10) % 2 ? '#777' : '#555') : fill >= 1 ? '#69f0ae' : '#2e9d6a';
          const fw = (segW - 4) * fill;
          g.fillRect(left ? sx + 2 + (segW - 4) - fw : sx + 2, 60, fw, 9);
        }
      }
      if (f.burnout) {
        g.font = `bold 13px ${FONT}`;
        g.fillStyle = Math.floor(s.frame / 10) % 2 ? '#ff8a80' : '#fff';
        g.textAlign = left ? 'left' : 'right';
        g.fillText('燃盡', left ? dx0 + 306 : dx0 - 6, 69);
      }
      // 名字 + 回合勝場
      g.font = `bold 20px ${FONT}`;
      g.fillStyle = '#fff';
      g.textAlign = left ? 'left' : 'right';
      const label = i === 1 && opt.p2Label ? `${c.name}（${opt.p2Label}）` : c.name;
      g.fillText(label, left ? x : x + barW, 96);
      for (let k = 0; k < WINS_TO_MATCH; k++) {
        const dx = left ? x + barW - 14 - k * 24 : x + 14 + k * 24;
        g.beginPath();
        g.arc(dx, 72, 8, 0, Math.PI * 2);
        g.fillStyle = k < f.wins ? '#ffd54f' : '#444';
        g.fill();
      }
      // 能量條
      const mw = 300;
      const mx = left ? 40 : SCREEN_W - 40 - mw;
      g.fillStyle = '#222';
      g.fillRect(mx, 676, mw, 18);
      const full = f.meter >= METER_MAX;
      g.fillStyle = full ? (Math.floor(s.frame / 6) % 2 ? '#40c4ff' : '#e1f5fe') : '#29b6f6';
      g.fillRect(mx, 676, (mw * f.meter) / METER_MAX, 18);
      g.strokeStyle = '#fff';
      g.strokeRect(mx, 676, mw, 18);
      g.font = `bold 16px ${FONT}`;
      g.fillStyle = '#fff';
      g.textAlign = left ? 'left' : 'right';
      g.fillText(full ? '必殺技 OK！（L+K）' : '能量', left ? mx : mx + mw, 668);
      // 變身倒數
      if (f.form === 'dino') {
        g.fillStyle = '#ffca28';
        g.textAlign = left ? 'left' : 'right';
        g.fillText(`恐龍形態 ${Math.ceil(f.formTimer / 60)} 秒`, left ? mx + mw + 16 : mx - 16, 691);
      }
      // 連段數（顯示在攻擊方）
      const foe = s.fighters[1 - i];
      if (foe.comboHits >= 2) {
        g.font = `bold 40px ${FONT}`;
        g.fillStyle = '#ffeb3b';
        g.strokeStyle = '#000';
        g.lineWidth = 5;
        g.textAlign = left ? 'left' : 'right';
        const t = `${foe.comboHits} HITS`;
        g.strokeText(t, left ? 40 : SCREEN_W - 40, 215);
        g.fillText(t, left ? 40 : SCREEN_W - 40, 215);
      }
    }
    // 計時
    g.font = `bold 44px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    const sec = Math.ceil(Math.max(0, s.timer) / 60);
    g.fillText(s.timeLimit ? String(Math.min(ROUND_FRAMES / 60, sec)) : '∞', SCREEN_W / 2, 64);
  }

  private drawPhase(s: GameState): void {
    const g = this.ctx;
    let text = '';
    let sub = '';
    if (s.phase === 'intro') {
      const len = s.round === 1 ? 150 : 90;
      text = s.phaseTimer > len - 40 ? 'FIGHT!' : `ROUND ${s.round}`;
    } else if (s.phase === 'ko' && s.phaseTimer < 90) {
      text = s.roundResult?.reason === 'time' ? 'TIME' : 'K.O.';
    } else if (s.phase === 'matchEnd') {
      const w = s.matchWinner;
      text = w === null ? 'DRAW' : `${getChar(s.fighters[w].charId).name} WIN!`;
      sub = 'Enter：再戰　Esc：回到選角';
    }
    if (!text) return;
    g.font = `bold 84px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.strokeStyle = '#b71c4a';
    g.lineWidth = 10;
    g.strokeText(text, SCREEN_W / 2, 300);
    g.fillText(text, SCREEN_W / 2, 300);
    if (sub) {
      g.font = `bold 26px ${FONT}`;
      g.lineWidth = 5;
      g.strokeStyle = '#000';
      g.strokeText(sub, SCREEN_W / 2, 360);
      g.fillText(sub, SCREEN_W / 2, 360);
    }
  }

  // ───── 角色選擇畫面 ─────
  drawSelect(ids: string[], cursor: [number, number], ready: [boolean, boolean], p2Label: string, hint?: string, tags: [string, string] = ['P1', 'P2']): void {
    const g = this.ctx;
    this.drawStage();
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = `bold 48px ${FONT}`;
    g.fillText('選擇角色', SCREEN_W / 2, 90);
    g.font = `18px ${FONT}`;
    g.fillText(hint ?? 'P1：A / D 選擇、U 確定　　P2：← / → 選擇、P 確定　　F2：切換玩家 2 / 假人', SCREEN_W / 2, 130);

    const cardW = 260;
    const gap = 60;
    const total = ids.length * cardW + (ids.length - 1) * gap;
    ids.forEach((id, k) => {
      const c = getChar(id);
      const x = SCREEN_W / 2 - total / 2 + k * (cardW + gap);
      const y = 190;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(g, x, y, cardW, 330, 16);
      g.fill();
      g.fillStyle = c.color;
      roundRect(g, x + cardW / 2 - 45, y + 40, 90, 180, 12);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `bold 28px ${FONT}`;
      g.fillText(c.name, x + cardW / 2, y + 260);
      g.font = `16px ${FONT}`;
      g.fillText(id === 'sawa' ? '速度型｜愛心波動｜偶像演唱會' : '一般型｜鞭擊｜變身恐龍', x + cardW / 2, y + 292);
      for (const p of [0, 1] as const) {
        if (cursor[p] !== k) continue;
        g.strokeStyle = p === 0 ? '#ff5252' : '#448aff';
        g.lineWidth = 6;
        const inset = p === 0 ? 0 : 10;
        roundRect(g, x - 6 + inset, y - 6 + inset, cardW + 12 - inset * 2, 342 - inset * 2, 18);
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.font = `bold 22px ${FONT}`;
        g.fillText(`${tags[p]}${ready[p] ? ' ✔' : ''}`, x + (p === 0 ? 40 : cardW - 40), y + 28);
      }
    });
    g.fillStyle = '#fff';
    g.font = `bold 22px ${FONT}`;
    g.fillText(p2Label, SCREEN_W / 2, 580);
  }

  /** 連線等待等訊息畫面。 */
  drawMessage(lines: string[]): void {
    const g = this.ctx;
    this.drawStage();
    g.textAlign = 'center';
    lines.forEach((t, i) => {
      g.font = i === 0 ? `bold 44px ${FONT}` : `22px ${FONT}`;
      g.fillStyle = i === 0 ? '#fff' : '#ddd';
      g.fillText(t, SCREEN_W / 2, 260 + (i === 0 ? 0 : 40 + i * 40));
    });
  }

  /** 線上對戰資訊列（畫在畫面最下方中間）。 */
  drawNetInfo(text: string, warn?: string): void {
    const g = this.ctx;
    g.font = `14px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.5)';
    const w = g.measureText(text).width + 24;
    g.fillRect(SCREEN_W / 2 - w / 2, 700, w, 20);
    g.fillStyle = '#ddd';
    g.fillText(text, SCREEN_W / 2, 715);
    if (warn) {
      g.font = `bold 20px ${FONT}`;
      g.fillStyle = '#ff8a80';
      g.fillText(warn, SCREEN_W / 2, 200);
    }
    g.textAlign = 'left';
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

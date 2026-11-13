// 每位角色需要哪些動畫（編輯工具左側清單）。依角色資料自動產生。
import type { CharacterDef } from '../core/types';

export interface AnimSlot {
  key: string;
  label: string;
  group: string;
  loop: boolean;
  moveId?: string;
  /** 這組動畫是否需要畫攻擊判定 */
  attack: boolean;
  /** 建議格數（來自角色設定書） */
  suggested: number;
}

type Base = [key: string, label: string, group: string, loop: boolean, suggested: number];

const BASE: Base[] = [
  ['idle', '待機', '基本', true, 6],
  ['crouch', '蹲下', '基本', false, 2],
  ['crouchIdle', '蹲待機', '基本', true, 4],
  ['walkF', '前走', '移動', true, 6],
  ['walkB', '後走', '移動', true, 6],
  ['dashF', '前衝', '移動', false, 4],
  ['dashB', '後撤', '移動', false, 4],
  ['jumpSquat', '起跳', '移動', false, 2],
  ['air', '空中', '移動', true, 2],
  ['land', '著地', '移動', false, 2],
  ['blockStand', '站防', '防禦', false, 2],
  ['blockCrouch', '蹲防', '防禦', false, 2],
  ['blockAir', '空防', '防禦', false, 2],
  ['parry', '檔架', '防禦', false, 3],
  ['parryEnd', '檔架收招', '防禦', false, 2],
  ['hitLight', '輕受擊', '受擊', false, 2],
  ['hitHeavy', '重受擊', '受擊', false, 3],
  ['hitCrouch', '蹲受擊', '受擊', false, 2],
  ['airHit', '擊飛', '受擊', false, 4],
  ['knockdown', '倒地', '受擊', false, 3],
  ['getup', '起身', '受擊', false, 4],
  ['throwing', '摔投（投技成功）', '投技', false, 6],
  ['thrown', '被投', '投技', false, 2],
  ['intro', '登場', '演出', false, 6],
  ['win', '勝利', '演出', true, 6],
  ['lose', '戰敗', '演出', true, 6],
];

const DINO_BASE: Base[] = [
  ['dino_idle', '恐龍・待機', '恐龍形態', true, 6],
  ['dino_walk', '恐龍・走', '恐龍形態', true, 6],
  ['dino_jumpSquat', '恐龍・起跳', '恐龍形態', false, 2],
  ['dino_air', '恐龍・空中', '恐龍形態', true, 2],
  ['dino_land', '恐龍・落地', '恐龍形態', false, 2],
  ['dino_block', '恐龍・防禦', '恐龍形態', false, 2],
  ['dino_hit', '恐龍・受擊', '恐龍形態', false, 3],
  ['dino_knockdown', '恐龍・倒地', '恐龍形態', false, 3],
  ['dino_getup', '恐龍・起身', '恐龍形態', false, 4],
];

const GROUP_ORDER = ['基本', '移動', '一般技', '特殊技', '必殺技', '投技', '防禦', '受擊', '演出', '恐龍形態', '特效'];

const SUGGESTED: Record<string, number> = {
  sLP: 4, sHP: 6, sLK: 4, sHK: 6, cLP: 4, cHP: 6, cLK: 4, cHK: 6, jLP: 4, jHP: 4, jLK: 4, jHK: 4,
  throwWhiff: 3, taunt: 6, dLP: 5, dHP: 6, dLK: 6, dHK: 7, dBreath: 7, reversal: 6,
};

export function animSlots(c: CharacterDef): AnimSlot[] {
  const slots: AnimSlot[] = BASE.map(([key, label, group, loop, suggested]) => ({ key, label, group, loop, attack: false, suggested }));
  const dinoMoves = new Set(Object.values(c.forms.dino?.moves ?? {}));
  for (const m of Object.values(c.moves)) {
    let group = '一般技';
    if (dinoMoves.has(m.id)) group = '恐龍形態';
    else if (m.kind === 'special') group = '特殊技';
    else if (m.kind === 'super' || m.kind === 'transform') group = '必殺技';
    else if (m.kind === 'throw') group = '投技';
    else if (m.kind === 'taunt') group = '演出';
    else if (m.kind === 'reversal') group = '防禦';
    const attack = !!m.hitbox || !!m.fullScreen;
    const suggested = SUGGESTED[m.id] ?? (m.kind === 'super' ? 9 : m.kind === 'transform' ? 8 : 6);
    slots.push({ key: m.id, label: m.name, group, loop: false, moveId: m.id, attack, suggested });
    if (m.projectile) {
      slots.push({ key: `${m.id}_projectile`, label: `${m.name}（飛行道具）`, group: '特效', loop: true, attack: true, suggested: 4 });
    }
  }
  if (c.forms.dino) {
    for (const [key, label, group, loop, suggested] of DINO_BASE) slots.push({ key, label, group, loop, attack: false, suggested });
  }
  if (c.transform) slots.push({ key: 'transformEnd', label: '變回來', group: '必殺技', loop: false, attack: false, suggested: 4 });
  return slots.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

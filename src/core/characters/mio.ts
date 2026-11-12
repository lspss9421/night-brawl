import type { CharacterDef } from '../types';
import { commonMoves, move, toRecord } from './common';

// Mio：一般型，數值都是標準值。特殊技鞭擊距離長；必殺技變身恐龍 10 秒。
// 數值見 docs/characters/mio/mio.md
const LIGHT_CANCEL = ['sHP', 'sHK', 'cHP', 'cHK', 'sp', 'super'];
const HEAVY_CANCEL = ['sp', 'super'];

export const mio: CharacterDef = {
  id: 'mio',
  name: 'Mio',
  color: '#ffd54f',
  accent: '#7e57c2',
  maxHp: 1000,
  dash: { frames: 14, speed: 900 },
  backdash: { frames: 18, speed: 700, invuln: 6 },
  throwDamage: 120,
  forms: {
    normal: {
      walkFwd: 400,
      walkBack: 320,
      jumpVel: 2000,
      gravity: 100,
      jumpH: 560, // 跳躍水平距離（加長）
      canDash: true,
      canCrouch: true,
      damagePct: 100,
      hurtStand: { x: -30, y: 0, w: 60, h: 200 },
      hurtCrouch: { x: -34, y: 0, w: 68, h: 120 },
      hurtAir: { x: -28, y: 20, w: 56, h: 160 },
      pushWidth: 50,
      moves: {
        sLP: 'sLP', sHP: 'sHP', sLK: 'sLK', sHK: 'sHK',
        cLP: 'cLP', cHP: 'cHP', cLK: 'cLK', cHK: 'cHK',
        jLP: 'jLP', jHP: 'jHP', jLK: 'jLK', jHK: 'jHK', sp: 'sp',
      },
    },
    dino: {
      walkFwd: 280,
      walkBack: 224,
      jumpVel: 1600,
      gravity: 100,
      jumpH: 380,
      canDash: false,
      canCrouch: false,
      damagePct: 130,
      hurtStand: { x: -45, y: 0, w: 90, h: 185 },
      hurtCrouch: { x: -45, y: 0, w: 90, h: 185 },
      hurtAir: { x: -42, y: 20, w: 84, h: 150 },
      pushWidth: 80,
      moves: {
        sLP: 'dLight', sLK: 'dLight', sHP: 'dHeavy', sHK: 'dHeavy',
        sp: 'dTail',
      },
    },
  },
  super: 'super',
  transform: { duration: 600, noMeterGain: true },
  moves: {
    ...commonMoves(),
    ...toRecord([
      move({ id: 'sLP', name: '站輕拳', startup: 4, active: 2, recovery: 7, damage: 30, hitstun: 13, blockstun: 9, hitstop: 6, hitbox: { x: 20, y: 140, w: 70, h: 30 }, cancel: LIGHT_CANCEL }),
      move({ id: 'sHP', name: '站重拳', startup: 8, active: 3, recovery: 16, damage: 80, hitstun: 20, blockstun: 15, hitstop: 9, pushback: 700, hitbox: { x: 20, y: 120, w: 95, h: 40 }, cancel: HEAVY_CANCEL }),
      move({ id: 'sLK', name: '站輕腳', startup: 5, active: 3, recovery: 9, damage: 35, hitstun: 13, blockstun: 9, hitstop: 6, hitbox: { x: 15, y: 60, w: 85, h: 30 }, cancel: LIGHT_CANCEL }),
      move({ id: 'sHK', name: '站重腳', startup: 10, active: 3, recovery: 18, damage: 90, hitstun: 21, blockstun: 15, hitstop: 10, pushback: 800, hitbox: { x: 20, y: 90, w: 115, h: 40 }, cancel: HEAVY_CANCEL }),
      move({ id: 'cLP', name: '蹲輕拳', stance: 'crouch', startup: 4, active: 2, recovery: 7, damage: 25, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 20, y: 80, w: 70, h: 30 }, cancel: LIGHT_CANCEL }),
      move({ id: 'cHP', name: '蹲重拳（對空）', stance: 'crouch', startup: 7, active: 4, recovery: 18, damage: 75, hitstun: 20, blockstun: 14, hitstop: 9, knockdown: true, launch: { vx: 250, vy: 1600 }, hitbox: { x: 5, y: 100, w: 70, h: 130 }, cancel: HEAVY_CANCEL }),
      move({ id: 'cLK', name: '蹲輕腳', stance: 'crouch', guard: 'low', startup: 5, active: 2, recovery: 9, damage: 25, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 15, y: 0, w: 90, h: 30 }, cancel: LIGHT_CANCEL }),
      move({ id: 'cHK', name: '蹲重腳（掃腿）', stance: 'crouch', guard: 'low', startup: 9, active: 3, recovery: 22, damage: 80, hitstun: 20, blockstun: 14, hitstop: 9, knockdown: true, hitbox: { x: 15, y: 0, w: 125, h: 30 } }),
      move({ id: 'jLP', name: '空中輕拳', stance: 'air', guard: 'high', startup: 5, active: 5, recovery: 5, damage: 40, hitstun: 16, blockstun: 11, hitstop: 6, hitbox: { x: 15, y: 70, w: 65, h: 35 } }),
      move({ id: 'jHP', name: '空中重拳', stance: 'air', guard: 'high', startup: 8, active: 6, recovery: 8, damage: 80, hitstun: 19, blockstun: 13, hitstop: 8, hitbox: { x: 10, y: 20, w: 85, h: 60 } }),
      move({ id: 'jLK', name: '空中輕腳', stance: 'air', guard: 'high', startup: 5, active: 6, recovery: 5, damage: 40, hitstun: 16, blockstun: 11, hitstop: 6, hitbox: { x: 10, y: 40, w: 60, h: 40 } }),
      move({ id: 'jHK', name: '空中重腳', stance: 'air', guard: 'high', startup: 9, active: 7, recovery: 8, damage: 85, hitstun: 19, blockstun: 13, hitstop: 8, hitbox: { x: 5, y: 10, w: 105, h: 45 } }),
      move({
        id: 'sp', name: '鞭擊', kind: 'special', startup: 14, active: 4, recovery: 24,
        damage: 90, hitstun: 22, blockstun: 16, hitstop: 10, pushback: 900,
        // 鞭尖最遠打到 280 像素，約站重腳（135）的 2 倍
        hitbox: { x: 40, y: 115, w: 240, h: 30 },
      }),
      move({
        id: 'super', name: '變身恐龍', kind: 'transform', startup: 40, active: 0, recovery: 10,
        invuln: 50, superFreeze: 40, meterGain: 0,
      }),
      // 恐龍形態（精簡招式組）
      move({ id: 'dLight', name: '小爪拍', startup: 6, active: 3, recovery: 10, damage: 40, hitstun: 14, blockstun: 10, hitstop: 7, hitbox: { x: 35, y: 80, w: 70, h: 40 }, cancel: ['dHeavy', 'dTail'] }),
      move({ id: 'dHeavy', name: '肚子撞', startup: 12, active: 4, recovery: 20, damage: 90, hitstun: 22, blockstun: 16, hitstop: 11, pushback: 1100, advance: 500, hitbox: { x: 30, y: 30, w: 80, h: 110 }, cancel: ['dTail'] }),
      move({ id: 'dTail', name: '尾巴橫掃', kind: 'special', startup: 14, active: 4, recovery: 22, damage: 80, hitstun: 20, blockstun: 15, hitstop: 10, pushback: 900, knockdown: true, hitbox: { x: 40, y: 20, w: 170, h: 40 } }),
    ]),
  },
  texts: { intro: '好累喔～不想動', win: 'Ya～', lose: '嗚…我輸了…', taunt: '搖呀搖～♪' },
};

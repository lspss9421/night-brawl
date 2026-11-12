import type { CharacterDef } from '../types';
import { commonMoves, move, toRecord } from './common';

// 佐波 Sawa：速度型。出招快、移動快、距離短、血少。數值見 docs/characters/sawa/sawa.md
const LIGHT_CANCEL = ['sHP', 'sHK', 'cHP', 'cHK', 'sp', 'super'];
const HEAVY_CANCEL = ['sp', 'super'];

export const sawa: CharacterDef = {
  id: 'sawa',
  name: '佐波 Sawa',
  color: '#f06292',
  accent: '#b71c4a',
  maxHp: 900,
  dash: { frames: 12, speed: 1100 },
  backdash: { frames: 14, speed: 800, invuln: 6 },
  throwDamage: 100,
  forms: {
    normal: {
      walkFwd: 520,
      walkBack: 420,
      jumpVel: 2100,
      gravity: 120,
      jumpH: 650, // 跳躍水平距離（加長）
      canDash: true,
      canCrouch: true,
      damagePct: 100,
      hurtStand: { x: -28, y: 0, w: 56, h: 190 },
      hurtCrouch: { x: -32, y: 0, w: 64, h: 115 },
      hurtAir: { x: -26, y: 20, w: 52, h: 150 },
      pushWidth: 48,
      moves: {
        sLP: 'sLP', sHP: 'sHP', sLK: 'sLK', sHK: 'sHK',
        cLP: 'cLP', cHP: 'cHP', cLK: 'cLK', cHK: 'cHK',
        jLP: 'jLP', jHP: 'jHP', jLK: 'jLK', jHK: 'jHK', sp: 'sp',
      },
    },
  },
  super: 'super',
  moves: {
    ...commonMoves(),
    ...toRecord([
      move({ id: 'sLP', name: '站輕拳', startup: 3, active: 2, recovery: 6, damage: 25, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 18, y: 135, w: 60, h: 28 }, cancel: LIGHT_CANCEL }),
      move({ id: 'sHP', name: '站重拳', startup: 7, active: 3, recovery: 15, damage: 70, hitstun: 19, blockstun: 14, hitstop: 9, pushback: 700, hitbox: { x: 20, y: 115, w: 80, h: 38 }, cancel: HEAVY_CANCEL }),
      move({ id: 'sLK', name: '站輕腳', startup: 4, active: 3, recovery: 8, damage: 30, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 15, y: 55, w: 72, h: 28 }, cancel: LIGHT_CANCEL }),
      move({ id: 'sHK', name: '站重腳', startup: 9, active: 3, recovery: 16, damage: 80, hitstun: 20, blockstun: 14, hitstop: 9, pushback: 800, hitbox: { x: 20, y: 85, w: 100, h: 38 }, cancel: HEAVY_CANCEL }),
      move({ id: 'cLP', name: '蹲輕拳', stance: 'crouch', startup: 3, active: 2, recovery: 6, damage: 22, hitstun: 12, blockstun: 8, hitstop: 6, hitbox: { x: 18, y: 75, w: 60, h: 28 }, cancel: LIGHT_CANCEL }),
      move({ id: 'cHP', name: '蹲重拳（對空）', stance: 'crouch', startup: 6, active: 4, recovery: 17, damage: 70, hitstun: 19, blockstun: 13, hitstop: 9, knockdown: true, launch: { vx: 250, vy: 1600 }, hitbox: { x: 5, y: 95, w: 62, h: 125 }, cancel: HEAVY_CANCEL }),
      move({ id: 'cLK', name: '蹲輕腳', stance: 'crouch', guard: 'low', startup: 4, active: 2, recovery: 8, damage: 22, hitstun: 11, blockstun: 8, hitstop: 6, hitbox: { x: 15, y: 0, w: 80, h: 28 }, cancel: LIGHT_CANCEL }),
      move({ id: 'cHK', name: '蹲重腳（掃腿）', stance: 'crouch', guard: 'low', startup: 8, active: 3, recovery: 21, damage: 75, hitstun: 20, blockstun: 13, hitstop: 9, knockdown: true, hitbox: { x: 15, y: 0, w: 105, h: 28 } }),
      move({ id: 'jLP', name: '空中輕拳', stance: 'air', guard: 'high', startup: 4, active: 5, recovery: 5, damage: 35, hitstun: 16, blockstun: 11, hitstop: 6, hitbox: { x: 15, y: 70, w: 60, h: 35 } }),
      move({ id: 'jHP', name: '空中重拳', stance: 'air', guard: 'high', startup: 7, active: 6, recovery: 8, damage: 70, hitstun: 19, blockstun: 13, hitstop: 8, hitbox: { x: 10, y: 20, w: 80, h: 60 } }),
      move({ id: 'jLK', name: '空中輕腳', stance: 'air', guard: 'high', startup: 4, active: 6, recovery: 5, damage: 35, hitstun: 16, blockstun: 11, hitstop: 6, hitbox: { x: 10, y: 40, w: 55, h: 40 } }),
      move({ id: 'jHK', name: '空中重腳', stance: 'air', guard: 'high', startup: 8, active: 7, recovery: 8, damage: 75, hitstun: 19, blockstun: 13, hitstop: 8, hitbox: { x: 5, y: 10, w: 100, h: 45 } }),
      move({
        id: 'sp', name: '愛心波動', kind: 'special', startup: 13, active: 1, recovery: 26,
        damage: 60, hitstun: 18, blockstun: 12, hitstop: 8, pushback: 600,
        projectile: { spawnFrame: 13, speed: 800, box: { x: -24, y: -24, w: 48, h: 48 }, spawnX: 60, spawnY: 125 },
      }),
      move({
        id: 'super', name: '偶像演唱會', kind: 'super', startup: 20, active: 60, recovery: 30,
        damage: 55, hitstun: 30, blockstun: 14, hitstop: 4, pushback: 0,
        fullScreen: true, multiHit: { count: 5, interval: 12 }, knockdown: true,
        invuln: 80, superFreeze: 40, meterGain: 0,
      }),
    ]),
  },
  texts: { intro: '來吧！戰鬥吧！', win: 'Ya～', lose: '嗚…我輸了…', taunt: '67～' },
};

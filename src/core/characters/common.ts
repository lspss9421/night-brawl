import type { MoveDef } from '../types';

/** 建立招式資料的小工具：未填的欄位用合理預設值。 */
export function move(def: Partial<MoveDef> & Pick<MoveDef, 'id' | 'name' | 'startup' | 'active' | 'recovery'>): MoveDef {
  return {
    kind: 'normal',
    stance: 'stand',
    damage: 0,
    hitstun: 0,
    blockstun: 0,
    pushback: 500,
    guard: 'mid',
    ...def,
  };
}

/** 每位角色共通的招式：投技、投空、挑釁。 */
export function commonMoves(): Record<string, MoveDef> {
  const list = [
    // 投技：第 5 格才抓到（比輕攻擊慢，所以會被攻擊打斷）；抓空收招很大
    move({ id: 'throwWhiff', name: '投技', kind: 'throw', startup: 5, active: 2, recovery: 23 }),
    // 鬥氣反擊：防禦中按鬥氣鍵，扣 2 格；出招到攻擊結束前無敵，傷害小、打不死人，主要把對手推開
    move({
      id: 'reversal', name: '鬥氣反擊', kind: 'reversal', startup: 20, active: 3, recovery: 26,
      damage: 50, hitstun: 20, blockstun: 16, hitstop: 8, pushback: 1600, invuln: 23, nonLethal: true,
      hitbox: { x: 0, y: 30, w: 150, h: 150 }, // 防禦後雙方被推開，所以範圍要夠遠
    }),
    move({ id: 'taunt', name: '挑釁', kind: 'taunt', startup: 0, active: 0, recovery: 90 }),
  ];
  return Object.fromEntries(list.map((m) => [m.id, m]));
}

export function toRecord(list: MoveDef[]): Record<string, MoveDef> {
  return Object.fromEntries(list.map((m) => [m.id, m]));
}

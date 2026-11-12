import type { CharacterDef } from '../types';
import { mio } from './mio';
import { sawa } from './sawa';

export const CHARACTERS: Record<string, CharacterDef> = { sawa, mio };
export const CHARACTER_IDS = Object.keys(CHARACTERS);

/** 用套上素材資料後的版本取代角色定義（遊戲開始前呼叫）。 */
export function registerCharacter(def: CharacterDef): void {
  CHARACTERS[def.id] = def;
}

export function getChar(id: string): CharacterDef {
  const c = CHARACTERS[id];
  if (!c) throw new Error(`Unknown character: ${id}`);
  return c;
}

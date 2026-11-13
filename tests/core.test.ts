import { describe, expect, it } from 'vitest';
import { BACKDASH_COOLDOWN, cloneState, createGame, DRIVE_BAR, DRIVE_MAX, METER_MAX, moveHitbox, step } from '../src/core/game';
import { getChar } from '../src/core/characters';
import { Btn } from '../src/core/input';
import type { GameState } from '../src/core/types';
import { FP } from '../src/core/types';

const { UP, DOWN, LEFT, RIGHT, LP, HP, LK, HK, SP, DRIVE } = Btn;

/** 跳過開場，回到可以操作的狀態，並把兩人擺到指定位置（像素）。 */
function ready(p1: string, p2: string, x1 = 600, x2 = 680): GameState {
  const s = createGame(p1, p2);
  while (s.phase !== 'fight') step(s, [0, 0]);
  s.fighters[0].x = x1 * FP;
  s.fighters[1].x = x2 * FP;
  step(s, [0, 0]);
  return s;
}

function run(s: GameState, frames: number, i1 = 0, i2 = 0): void {
  for (let k = 0; k < frames; k++) step(s, [i1, i2]);
}

/** 按一下（按住 1 格後放開）。 */
function tap(s: GameState, bits: number, i2 = 0, hold = 0): void {
  step(s, [bits, i2]);
  run(s, 1, hold, i2);
}

function lcg(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x;
  };
}

describe('可決定性（rollback 的前提）', () => {
  it('相同輸入跑兩次，結果完全一樣', () => {
    const play = () => {
      const s = createGame('sawa', 'mio');
      const r = lcg(42);
      for (let k = 0; k < 4000; k++) step(s, [r() & 0x7ff, r() & 0x7ff]);
      return JSON.stringify(s);
    };
    expect(play()).toEqual(play());
  });

  it('從中途存檔重播，結果和不中斷一樣', () => {
    const r = lcg(7);
    const inputs = Array.from({ length: 3000 }, () => [r() & 0x7ff, r() & 0x7ff] as [number, number]);
    const a = createGame('mio', 'sawa');
    let snap: GameState | null = null;
    inputs.forEach((inp, k) => {
      if (k === 1500) snap = cloneState(a);
      step(a, inp);
    });
    const b = snap!;
    inputs.slice(1500).forEach((inp) => step(b, inp));
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
  });
});

describe('基本攻防', () => {
  it('站輕拳打中會扣血', () => {
    const s = ready('sawa', 'mio');
    tap(s, LP);
    run(s, 20);
    expect(s.fighters[1].hp).toBe(1000 - 25);
  });

  it('按住後方向可以防禦', () => {
    const s = ready('sawa', 'mio');
    step(s, [LP, RIGHT]);
    let blocked = false;
    for (let k = 0; k < 20; k++) {
      step(s, [0, RIGHT]);
      if (s.fighters[1].action === 'blockstun') blocked = true;
    }
    expect(blocked).toBe(true);
    expect(s.fighters[1].hp).toBe(1000);
  });

  it('下段攻擊：站防擋不住、蹲防擋得住', () => {
    const s1 = ready('sawa', 'mio');
    step(s1, [DOWN | LK, RIGHT]);
    run(s1, 20, DOWN, RIGHT);
    expect(s1.fighters[1].hp).toBeLessThan(1000);

    const s2 = ready('sawa', 'mio');
    step(s2, [DOWN | LK, RIGHT | DOWN]);
    run(s2, 20, DOWN, RIGHT | DOWN);
    expect(s2.fighters[1].hp).toBe(1000);
  });

  it('輕攻擊打中可以取消成重攻擊（連段）', () => {
    const s = ready('mio', 'sawa');
    step(s, [LP, 0]);
    for (let k = 0; k < 8; k++) step(s, [k >= 4 ? HP : 0, 0]);
    run(s, 40);
    expect(s.fighters[1].hp).toBe(900 - 30 - 80);
  });

  it('投技：近身 → + 重拳 + 重腳，第 5 格抓到，對手被摔倒', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [RIGHT | HP | HK, 0]);
    expect(s.fighters[0].action).toBe('attack'); // 還在出手
    run(s, 6);
    expect(s.fighters[0].action).toBe('throwing');
    run(s, 100);
    expect(s.fighters[1].hp).toBe(900 - 120);
  });

  it('投技：對手被往身後丟出去約半個舞台，落地時才扣血、摔倒再爬起來', () => {
    const s = ready('mio', 'sawa', 900, 980);
    step(s, [RIGHT | HP | HK, 0]);
    run(s, 6);
    expect(s.fighters[1].action).toBe('thrown');
    // 丟出去的瞬間還沒扣血
    for (let k = 0; k < 60 && s.fighters[1].action === 'thrown'; k++) step(s, [0, 0]);
    expect(s.fighters[1].action).toBe('airHit');
    expect(s.fighters[1].hp).toBe(900);
    // 落地才扣血並倒地
    for (let k = 0; k < 60 && s.fighters[1].action === 'airHit'; k++) step(s, [0, 0]);
    expect(s.fighters[1].hp).toBe(900 - 120);
    expect(s.fighters[1].action).toBe('knockdown');
    expect(s.fighters[1].x).toBeLessThan(s.fighters[0].x); // 被丟到投技方的另一邊
    expect(s.fighters[0].x - s.fighters[1].x).toBeGreaterThan(500 * FP); // 飛了約半個舞台
    // 爬起來後可以行動
    for (let k = 0; k < 80 && s.fighters[1].action !== 'idle'; k++) step(s, [0, 0]);
    expect(s.fighters[1].action).toBe('idle');
  });

  it('攻擊克制投技：投技出手中被輕拳打中就抓不到', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [RIGHT | HP | HK, LP]);
    run(s, 40);
    expect(s.fighters[0].hp).toBeLessThan(1000);
    expect(s.fighters[1].hp).toBe(900);
  });

  it('拆投：被抓後馬上也按投技，雙方彈開不扣血', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [RIGHT | HP | HK, 0]);
    run(s, 6);
    expect(s.fighters[1].action).toBe('thrown');
    step(s, [0, HP | HK]);
    run(s, 40);
    expect(s.fighters[1].hp).toBe(900);
    expect(s.fighters[0].hp).toBe(1000);
  });

  it('投技抓空收招很大', () => {
    const s = ready('mio', 'sawa', 300, 900);
    step(s, [RIGHT | HP | HK, 0]);
    run(s, 15);
    expect(s.fighters[0].action).toBe('attack');
  });

  it('投技不能防禦', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [RIGHT | HP | HK, RIGHT]);
    run(s, 100, 0, RIGHT);
    expect(s.fighters[1].hp).toBe(900 - 120);
  });

  it('連按兩下前 = 衝刺', () => {
    const s = ready('sawa', 'mio', 300, 900);
    step(s, [RIGHT, 0]);
    step(s, [0, 0]);
    step(s, [RIGHT, 0]);
    expect(s.fighters[0].action).toBe('dashF');
  });

  it('後撤完要等一下才能再後撤', () => {
    const s = ready('sawa', 'mio', 600, 900);
    const backdash = () => { step(s, [LEFT, 0]); step(s, [0, 0]); step(s, [LEFT, 0]); };
    backdash();
    expect(s.fighters[0].action).toBe('dashB');
    while (s.fighters[0].action === 'dashB') step(s, [0, 0]);
    backdash(); // 剛結束馬上再按：冷卻中，不會後撤
    expect(s.fighters[0].action).not.toBe('dashB');
    run(s, BACKDASH_COOLDOWN);
    backdash();
    expect(s.fighters[0].action).toBe('dashB');
  });

  it('空中按特殊技不會讓角色卡在空中（兩位角色）', () => {
    for (const ch of ['sawa', 'mio']) {
      const s = ready(ch, ch === 'sawa' ? 'mio' : 'sawa', 300, 900);
      step(s, [UP, 0]);
      run(s, 12);
      expect(s.fighters[0].y).toBeGreaterThan(0);
      tap(s, SP);
      run(s, 80);
      expect(s.fighters[0].y, ch).toBe(0);
      expect(s.fighters[0].action, ch).not.toBe('attack');
    }
  });

  it('空中按特殊技＋重腳（必殺技指令）也不會卡在空中', () => {
    const s = ready('mio', 'sawa', 300, 900);
    s.fighters[0].meter = METER_MAX;
    step(s, [UP, 0]);
    run(s, 12);
    tap(s, SP | HK);
    run(s, 120);
    expect(s.fighters[0].y).toBe(0);
  });

  it('蹲重拳打中會把對手打飛到空中再倒地', () => {
    const s = ready('sawa', 'mio', 600, 660);
    step(s, [DOWN | HP, 0]);
    let maxY = 0;
    for (let k = 0; k < 60; k++) { step(s, [DOWN, 0]); maxY = Math.max(maxY, s.fighters[1].y); }
    expect(maxY).toBeGreaterThan(80 * FP);
    for (let k = 0; k < 60 && s.fighters[1].action !== 'knockdown'; k++) step(s, [0, 0]);
    expect(s.fighters[1].action).toBe('knockdown');
  });

  it('空中四個鍵是四種不同的招', () => {
    const ids: string[] = [];
    for (const btn of [LP, HP, LK, HK]) {
      const s = ready('sawa', 'mio', 300, 900);
      step(s, [UP, 0]);
      run(s, 8);
      step(s, [btn, 0]);
      ids.push(s.fighters[0].moveId ?? '');
    }
    expect(ids).toEqual(['jLP', 'jHP', 'jLK', 'jHK']);
  });

  it('跳躍會離地再落地', () => {
    const s = ready('sawa', 'mio', 300, 900);
    step(s, [UP, 0]);
    run(s, 10);
    expect(s.fighters[0].y).toBeGreaterThan(0);
    run(s, 60);
    expect(s.fighters[0].y).toBe(0);
  });
});

describe('鬥氣（Drive）', () => {
  it('開局鬥氣全滿；Sawa 愛心波動、Mio 鞭擊各扣 2 格', () => {
    for (const ch of ['sawa', 'mio']) {
      const s = ready(ch, ch === 'sawa' ? 'mio' : 'sawa', 300, 900);
      expect(s.fighters[0].drive).toBe(DRIVE_MAX);
      tap(s, SP);
      expect(s.fighters[0].moveId, ch).toBe('sp');
      const d = s.fighters[0].drive;
      expect(d, ch).toBeLessThan(DRIVE_MAX - 2 * DRIVE_BAR + 200);
      expect(d, ch).toBeGreaterThan(DRIVE_MAX - 2 * DRIVE_BAR - 200);
    }
  });

  it('鬥氣不到 2 格時放不出特殊技', () => {
    for (const ch of ['sawa', 'mio']) {
      const s = ready(ch, ch === 'sawa' ? 'mio' : 'sawa', 300, 900);
      s.fighters[0].drive = DRIVE_BAR * 1.5; // 1.5 格（按鍵緩衝 5 格內回不到 2 格）
      tap(s, SP);
      run(s, 20);
      expect(s.fighters[0].moveId, ch).not.toBe('sp');
      expect(s.projectiles.length).toBe(0);
    }
  });

  it('一般攻擊打中回復鬥氣', () => {
    const s = ready('sawa', 'mio');
    s.fighters[0].drive = 2 * DRIVE_BAR;
    tap(s, HK);
    run(s, 15);
    expect(s.fighters[0].drive).toBeGreaterThanOrEqual(2 * DRIVE_BAR + DRIVE_BAR / 2);
  });

  it('隨時間回復：平常約 20 秒從 0 回滿', () => {
    const s = ready('sawa', 'mio', 300, 900);
    s.fighters[0].drive = 1;
    run(s, 1150);
    expect(s.fighters[0].drive).toBeLessThan(DRIVE_MAX);
    expect(s.fighters[0].burnout).toBe(false); // 只是很少，不是用光
    run(s, 100);
    expect(s.fighters[0].drive).toBe(DRIVE_MAX);
  });

  it('燃盡時回復加快：約 10 秒回滿並解除燃盡', () => {
    const s = ready('sawa', 'mio', 300, 900);
    s.fighters[0].drive = 0;
    s.fighters[0].burnout = true;
    run(s, 570);
    expect(s.fighters[0].burnout).toBe(true);
    run(s, 50);
    expect(s.fighters[0].burnout).toBe(false);
  });

  it('燃盡：不能放特殊技，防禦會被削血、硬直變長', () => {
    const s = ready('sawa', 'mio');
    s.fighters[1].drive = 0;
    s.fighters[1].burnout = true;
    step(s, [HK, RIGHT]);
    run(s, 15, 0, RIGHT);
    expect(s.fighters[1].hp).toBe(1000 - Math.trunc(80 / 4));
  });

  it('檔架：按住鬥氣鍵擋下攻擊，不扣血、回復鬥氣', () => {
    const s = ready('sawa', 'mio');
    step(s, [0, DRIVE]);
    run(s, 5, 0, DRIVE); // 先檔架一陣子（不是完美檔架）
    const before = s.fighters[1].drive;
    step(s, [HK, DRIVE]);
    run(s, 15, 0, DRIVE);
    expect(s.fighters[1].hp).toBe(1000);
    expect(s.fighters[0].action === 'parried').toBe(false);
    expect(s.fighters[1].drive).toBeGreaterThan(before - 25 * 100 - 1); // 擋下時有回半格
  });

  it('完美檔架：剛按下時擋到，攻擊方僵直、自己馬上能動', () => {
    const s = ready('sawa', 'mio');
    step(s, [HK, 0]);
    run(s, 8); // 重腳第 10 格才打到
    step(s, [0, DRIVE]);
    let parried = false;
    for (let k = 0; k < 6; k++) { step(s, [0, DRIVE]); if (s.fighters[0].action === 'parried') parried = true; }
    expect(parried).toBe(true);
    expect(s.fighters[1].hp).toBe(1000);
  });

  it('檔架擋不住投技，而且被抓會多扣血', () => {
    const s = ready('mio', 'sawa', 600, 680);
    step(s, [0, DRIVE]);
    step(s, [RIGHT | HP | HK, DRIVE]);
    run(s, 100, 0, DRIVE);
    expect(s.fighters[1].hp).toBe(900 - 180);
  });

  it('鬥氣反擊：防禦中按鬥氣鍵，扣 2 格、打不死人、把對手推開', () => {
    const s = ready('sawa', 'mio');
    step(s, [HK, RIGHT]);
    for (let k = 0; k < 30 && !(s.fighters[1].action === 'blockstun' && s.hitstop === 0); k++) step(s, [0, RIGHT]);
    expect(s.fighters[1].action).toBe('blockstun');
    s.fighters[0].hp = 10;
    const drive = s.fighters[1].drive;
    step(s, [0, DRIVE]);
    expect(s.fighters[1].moveId).toBe('reversal');
    expect(s.fighters[1].drive).toBeLessThan(drive - 2 * DRIVE_BAR + 200);
    run(s, 40);
    expect(s.fighters[0].hp).toBe(1); // 打不死人
  });

  it('燃盡時不能檔架、不能鬥氣反擊', () => {
    const s = ready('sawa', 'mio');
    s.fighters[1].drive = 0;
    s.fighters[1].burnout = true;
    step(s, [0, DRIVE]);
    expect(s.fighters[1].action).not.toBe('parry');
  });
});

describe('Sawa', () => {
  it('愛心波動會飛出去打中遠處的對手', () => {
    const s = ready('sawa', 'mio', 300, 900);
    tap(s, SP);
    run(s, 15);
    expect(s.projectiles.length).toBe(1);
    run(s, 120);
    expect(s.fighters[1].hp).toBe(1000 - 60);
    expect(s.projectiles.length).toBe(0);
  });

  it('一次只能有一發愛心波動', () => {
    const s = ready('sawa', 'mio', 100, 1200);
    tap(s, SP);
    run(s, 45);
    tap(s, SP);
    run(s, 15);
    expect(s.projectiles.length).toBe(1);
  });

  it('必殺技（L+K）全畫面多段攻擊，沒防禦會被打中', () => {
    const s = ready('sawa', 'mio', 200, 1100);
    s.fighters[0].meter = METER_MAX;
    step(s, [SP | HK, 0]);
    expect(s.superFreeze).not.toBeNull();
    run(s, 200);
    expect(s.fighters[0].meter).toBe(0);
    expect(s.fighters[1].hp).toBeLessThan(1000 - 200);
  });

  it('必殺技可以被防禦擋下（不扣血）', () => {
    const s = ready('sawa', 'mio', 200, 1100);
    s.fighters[0].meter = METER_MAX;
    step(s, [SP | HK, RIGHT]);
    run(s, 200, 0, RIGHT);
    expect(s.fighters[1].hp).toBe(1000);
  });

  it('能量不夠時 L+K 不會放必殺技', () => {
    const s = ready('sawa', 'mio', 200, 1100);
    step(s, [SP | HK, 0]);
    expect(s.superFreeze).toBeNull();
  });
});

describe('Mio', () => {
  it('鞭擊比站重腳打得更遠（約 2 倍）', () => {
    const gap = 260;
    const s1 = ready('mio', 'sawa', 400, 400 + gap);
    tap(s1, HK);
    run(s1, 40);
    expect(s1.fighters[1].hp).toBe(900);

    const s2 = ready('mio', 'sawa', 400, 400 + gap);
    tap(s2, SP);
    run(s2, 40);
    expect(s2.fighters[1].hp).toBe(900 - 90);
  });

  it('必殺技變身恐龍 20 秒：變慢、時間到變回來', () => {
    const s = ready('mio', 'sawa', 300, 900);
    s.fighters[0].meter = METER_MAX;
    step(s, [SP | HK, 0]);
    run(s, 80 + 124 + 1); // 畫面暫停 80 + 變身動作 124（戴帽、邪惡力量爆發、怒吼）
    const m = s.fighters[0];
    expect(m.form).toBe('dino');

    const x0 = m.x;
    run(s, 10, RIGHT);
    const dinoWalk = m.x - x0;
    expect(dinoWalk).toBe(280 * 10);

    run(s, 1200);
    expect(m.form).toBe('normal');
  });

  it('恐龍形態的攻擊傷害 ×1.5', () => {
    const s = ready('mio', 'sawa', 300, 900);
    s.fighters[0].meter = METER_MAX;
    step(s, [SP | HK, 0]);
    run(s, 80 + 124 + 5); // 等變身動作整段結束
    s.fighters[0].x = 600 * FP;
    s.fighters[1].x = 700 * FP;
    run(s, 2);
    tap(s, LP);
    run(s, 30);
    expect(s.fighters[1].hp).toBe(900 - Math.trunc(40 * 1.5));
  });
});

describe('回合流程', () => {
  it('預設時間無限：時間不會倒數', () => {
    const s = ready('sawa', 'mio');
    const t = s.timer;
    run(s, 600);
    expect(s.timer).toBe(t);
    expect(s.phase).toBe('fight');
  });

  it('KO 後拿下一回合，先拿兩回合的人贏', () => {
    const s = ready('sawa', 'mio');
    s.fighters[1].hp = 1;
    tap(s, LP);
    run(s, 10);
    expect(s.phase).toBe('ko');
    expect(s.fighters[0].wins).toBe(1);
    while (s.phase !== 'fight') step(s, [0, 0]);
    expect(s.round).toBe(2);
    s.fighters[0].x = 600 * FP;
    s.fighters[1].x = 680 * FP;
    s.fighters[1].hp = 1;
    run(s, 1);
    tap(s, LP);
    for (let k = 0; k < 400 && (s.phase as string) !== 'matchEnd'; k++) step(s, [0, 0]);
    expect(s.phase).toBe('matchEnd');
    expect(s.matchWinner).toBe(0);
  });

  it('能量槽會保留到下一回合（變身不保留）', () => {
    const s = ready('mio', 'sawa');
    s.fighters[0].meter = 700;
    s.fighters[0].form = 'dino';
    s.fighters[0].formTimer = 300;
    s.fighters[1].meter = METER_MAX;
    s.fighters[1].hp = 1;
    tap(s, LP);
    while (s.phase !== 'intro') step(s, [0, 0]);
    expect(s.round).toBe(2);
    expect(s.fighters[0].meter).toBe(700);
    expect(s.fighters[0].form).toBe('normal');
    expect(s.fighters[1].meter).toBe(METER_MAX);
  });

  it('時間到時血量比例高的人贏', () => {
    const s = ready('sawa', 'mio');
    s.fighters[0].hp = 450; // 50%
    s.fighters[1].hp = 600; // 60%
    s.timeLimit = true;
    s.timer = 2;
    run(s, 3);
    expect(s.roundResult).toEqual({ winner: 1, reason: 'time' });
  });

  it('出場時角色頭上有對話框', () => {
    const s = createGame('sawa', 'mio');
    expect(s.fighters[0].bubble?.text).toBe('來吧！戰鬥吧！');
    expect(s.fighters[1].bubble?.text).toBe('好累喔～不想動');
  });

  it('挑釁會冒出對話框', () => {
    const s = ready('sawa', 'mio', 300, 900);
    tap(s, Btn.TAUNT);
    expect(s.fighters[0].bubble?.text).toBe('67～');
  });
});

void LEFT;

describe('攻擊範圍', () => {
  it('基本攻擊的攻擊框往前延伸，特殊技不變', async () => {
    const { NORMAL_REACH_BONUS } = await import('../src/core/game');
    const c = getChar('sawa');
    expect(moveHitbox(c.moves.sLP)!.w).toBe(c.moves.sLP.hitbox!.w + NORMAL_REACH_BONUS);
    expect(moveHitbox(c.moves.jHK)!.w).toBe(c.moves.jHK.hitbox!.w + NORMAL_REACH_BONUS);
    expect(moveHitbox(getChar('mio').moves.sp)).toEqual(getChar('mio').moves.sp.hitbox);
  });

  it('蹲重拳的攻擊框在蹲姿身體前緣的上方', () => {
    for (const id of ['sawa', 'mio']) {
      const c = getChar(id);
      const hb = c.moves.cHP.hitbox!;
      const body = c.forms.normal.hurtCrouch;
      expect(hb.x, id).toBeGreaterThanOrEqual(body.x + body.w - 20);
      expect(hb.y + hb.h, id).toBeGreaterThan(body.y + body.h);
    }
  });
});

describe('Mio 恐龍形態（奶龍）', () => {
  const transform = (s: GameState) => {
    const m = s.fighters[1];
    m.meter = METER_MAX;
    tap(s, 0, SP | HK);
    while (m.form !== 'dino' || m.action === 'attack') step(s, [0, 0]); // 變身後還有怒吼動作，等它結束
    run(s, 2);
  };

  it('變身持續 20 秒', () => {
    const s = ready('sawa', 'mio', 400, 700);
    transform(s);
    const m = s.fighters[1];
    expect(m.formTimer).toBeGreaterThan(20 * 60 - 70); // 怒吼動作約 1 秒也算在變身時間裡
    run(s, m.formTimer + 5);
    expect(m.form).toBe('normal');
  });

  it('恐龍形態比較耐打（受到的傷害較少）', () => {
    const hitMio = (dino: boolean) => {
      const s = ready('sawa', 'mio', 600, 680);
      if (dino) { transform(s); s.fighters[0].x = 600 * FP; s.fighters[1].x = 680 * FP; }
      const hp0 = s.fighters[1].hp;
      tap(s, HP);
      run(s, 30);
      return hp0 - s.fighters[1].hp;
    };
    const normal = hitMio(false);
    const dino = hitMio(true);
    expect(normal).toBeGreaterThan(0);
    expect(dino).toBeLessThan(normal);
  });

  it('龍之吐息扣 3 格鬥氣、不夠就放不出來，可以連打 4 下', () => {
    const s = ready('sawa', 'mio', 500, 700);
    transform(s);
    const m = s.fighters[1];
    m.drive = 2 * DRIVE_BAR;
    tap(s, 0, SP);
    expect(m.moveId).not.toBe('dBreath');
    run(s, 10);
    m.drive = DRIVE_MAX;
    tap(s, 0, SP);
    expect(m.moveId).toBe('dBreath');
    expect(m.drive).toBeLessThanOrEqual(DRIVE_MAX - 3 * DRIVE_BAR + 200);
    s.fighters[0].x = m.x - 150 * FP;
    run(s, 70);
    expect(s.fighters[0].comboHits === 0 ? m.hitsDone : m.hitsDone).toBe(4);
  });
});

describe('測試選項', () => {
  it('能量一直是滿的：放完必殺技馬上又是滿的', () => {
    const s = createGame('sawa', 'mio', { infiniteMeter: true });
    while (s.phase !== 'fight') step(s, [0, 0]);
    step(s, [0, 0]);
    expect(s.fighters[0].meter).toBe(METER_MAX);
    step(s, [SP | HK, 0]);
    run(s, 2);
    expect(s.fighters[0].moveId).toBe('super');
    expect(s.fighters[0].meter).toBe(METER_MAX);
  });
});

import { describe, expect, it } from 'vitest';
import { cloneState, createGame, step } from '../src/core/game';
import type { GameState } from '../src/core/types';
import { hashState, RollbackSession, type SessionMsg } from '../src/net/rollback';

/** 可重現的亂數 */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

interface NetOptions { latency: number; jitter: number; loss: number; seed: number }

/** 在同一個程式裡模擬兩台電腦：訊息延遲、抖動、遺失。 */
function playOnline(frames: number, delay: [number, number], net: NetOptions) {
  const rand = rng(net.seed);
  const initial = createGame('sawa', 'mio');
  const queues: { at: number; msg: SessionMsg }[][] = [[], []]; // 送往 0 / 送往 1
  let tick = 0;
  const sessions = ([0, 1] as const).map((me) => new RollbackSession(initial, {
    local: me,
    delay: delay[me],
    keepInputs: true,
    send: (msg) => {
      if (msg.k === 'in' && rand() < net.loss) return; // 掉封包
      const lag = net.latency + Math.floor(rand() * (net.jitter + 1));
      queues[1 - me].push({ at: tick + lag, msg: structuredClone(msg) });
    },
  }));
  // 每個玩家的按鍵：每 4～12 格換一次，模擬人在按
  const pressing: [number, number] = [0, 0];
  const holdLeft: [number, number] = [0, 0];
  const deliver = () => {
    for (const me of [0, 1] as const) {
      const ready = queues[me].filter((q) => q.at <= tick);
      queues[me] = queues[me].filter((q) => q.at > tick);
      for (const q of ready) sessions[me].receive(q.msg);
    }
  };
  for (tick = 0; sessions[0].frame < frames || sessions[1].frame < frames; tick++) {
    deliver();
    for (const me of [0, 1] as const) {
      if (holdLeft[me]-- <= 0) { pressing[me] = Math.floor(rand() * 2048); holdLeft[me] = 4 + Math.floor(rand() * 9); }
      if (sessions[me].frame < frames) sessions[me].advance(pressing[me]);
      else sessions[me].idle();
    }
    if (tick > frames * 10) throw new Error('卡住了');
  }
  // 讓剩下的訊息都送達，雙方確認所有輸入
  net.loss = 0;
  for (let k = 0; k < 200; k++, tick++) { deliver(); for (const s of sessions) s.idle(); }
  return { sessions, initial };
}

/** 用確認過的輸入離線重播，得到「正確答案」。 */
function replay(initial: GameState, s: RollbackSession, frames: number): GameState {
  const g = cloneState(initial);
  for (let f = 0; f < frames; f++) step(g, [s.confirmedInput(0, f) ?? 0, s.confirmedInput(1, f) ?? 0]);
  return g;
}

describe('Rollback 連線同步', () => {
  it('網路順暢時雙方結果相同', () => {
    const { sessions, initial } = playOnline(600, [2, 2], { latency: 1, jitter: 0, loss: 0, seed: 1 });
    const [a, b] = sessions;
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(hashState(a.state)).toBe(hashState(replay(initial, a, 600)));
    expect(a.desyncFrame).toBeNull();
    expect(b.desyncFrame).toBeNull();
  });

  it('延遲 6 格＋抖動＋10% 掉封包，回滾後雙方仍然完全一致', () => {
    const { sessions, initial } = playOnline(1500, [1, 2], { latency: 6, jitter: 4, loss: 0.1, seed: 42 });
    const [a, b] = sessions;
    expect(a.rollbacks).toBeGreaterThan(0); // 確實有發生回滾
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(hashState(a.state)).toBe(hashState(replay(initial, a, 1500)));
    expect(a.desyncFrame).toBeNull();
    expect(b.desyncFrame).toBeNull();
  });

  it('雙方確認的輸入完全一樣', () => {
    const { sessions } = playOnline(400, [0, 3], { latency: 4, jitter: 2, loss: 0.05, seed: 7 });
    const [a, b] = sessions;
    for (let f = 0; f < 400; f++) {
      expect(a.confirmedInput(0, f)).toBe(b.confirmedInput(0, f));
      expect(a.confirmedInput(1, f)).toBe(b.confirmedInput(1, f));
    }
  });

  it('對手太久沒有輸入時會暫停等待，不會無限預測', () => {
    const s = new RollbackSession(createGame('sawa', 'mio'), { local: 0, delay: 2, maxPrediction: 8, send: () => {} });
    for (let k = 0; k < 30; k++) s.advance(0);
    expect(s.frame).toBe(8);
  });

  it('偵測得到不同步', () => {
    const initial = createGame('sawa', 'mio');
    const msgs: SessionMsg[][] = [[], []];
    const a = new RollbackSession(initial, { local: 0, delay: 0, send: (m) => msgs[1].push(m) });
    const broken = cloneState(initial);
    broken.fighters[1].hp -= 1; // 故意讓另一邊的狀態不一樣
    const b = new RollbackSession(broken, { local: 1, delay: 0, send: (m) => msgs[0].push(m) });
    for (let k = 0; k < 200; k++) {
      a.advance(0); b.advance(0);
      for (const m of msgs[0].splice(0)) a.receive(m);
      for (const m of msgs[1].splice(0)) b.receive(m);
    }
    expect(a.desyncFrame).not.toBeNull();
  });
});

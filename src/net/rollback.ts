// Rollback（回滾）連線同步。
// 原理：每一格先用「預測的對手輸入」（沿用對手最後一次確認的輸入）照常模擬，畫面不用等網路；
// 之後收到對手真正的輸入，如果跟預測不同，就讀回當時的存檔、用正確輸入重新模擬到現在。
// 遊戲核心是可決定的，所以雙方最後的結果一定相同。
import { cloneState, step } from '../core/game';
import type { InputBits } from '../core/input';
import type { GameState } from '../core/types';

export interface InputMsg {
  k: 'in';
  /** 第一個輸入對應的影格 */
  f: number;
  /** 從 f 開始連續的輸入 */
  i: number[];
  /** 傳送者目前模擬到的影格 */
  cur: number;
  /** 傳送者已經連續收到我方輸入到哪一格 */
  ack: number;
}

export interface SumMsg {
  k: 'sum';
  f: number;
  h: number;
}

export type SessionMsg = InputMsg | SumMsg;

export interface RollbackOptions {
  local: 0 | 1;
  /** 輸入延遲（影格）：本地輸入延後幾格才生效，換取較少的回滾 */
  delay: number;
  /** 最多可以預測幾格；對手輸入落後超過這個數就暫停等待 */
  maxPrediction?: number;
  /** 保留所有輸入紀錄（測試／重播用；正常對戰會清掉舊的） */
  keepInputs?: boolean;
  send(msg: SessionMsg): void;
}

const CHECKSUM_INTERVAL = 60;
const RESEND_WINDOW = 30;

export function hashState(s: GameState): number {
  const str = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class RollbackSession {
  state: GameState;
  /** 下一個要模擬的影格 */
  frame = 0;
  readonly local: 0 | 1;
  readonly remote: 0 | 1;
  readonly delay: number;
  readonly maxPrediction: number;

  /** 對手回報的目前影格（用於時間同步） */
  remoteFrame = 0;
  rollbacks = 0;
  maxRollbackDepth = 0;
  /** 偵測到不同步的影格（null = 正常） */
  desyncFrame: number | null = null;

  private inputs: [Map<number, InputBits>, Map<number, InputBits>] = [new Map(), new Map()];
  private remoteConfirmed = -1;
  private remoteAck = -1;
  private used = new Map<number, InputBits>();
  private history = new Map<number, GameState>();
  private rollbackFrom: number | null = null;
  private nextSum = CHECKSUM_INTERVAL;
  private mySums = new Map<number, number>();
  private theirSums = new Map<number, number>();

  constructor(initial: GameState, private opt: RollbackOptions) {
    this.state = cloneState(initial);
    this.local = opt.local;
    this.remote = opt.local === 0 ? 1 : 0;
    this.delay = Math.max(0, Math.floor(opt.delay));
    this.maxPrediction = opt.maxPrediction ?? 8;
    // 延遲期間的前幾格沒有輸入：當作沒按
    for (let f = 0; f < this.delay; f++) this.inputs[this.local].set(f, 0);
  }

  /** 已經確認到的對手輸入最遠的影格 */
  get confirmedFrame(): number {
    return this.remoteConfirmed;
  }

  /** 收到對手的訊息。 */
  receive(msg: SessionMsg): void {
    if (msg.k === 'sum') {
      this.theirSums.set(msg.f, msg.h);
      this.checkSums();
      return;
    }
    const remote = this.inputs[this.remote];
    for (let k = 0; k < msg.i.length; k++) {
      const f = msg.f + k;
      if (remote.has(f)) continue;
      remote.set(f, msg.i[k]);
      // 這一格已經用預測模擬過，而且預測錯了 → 需要回滾
      if (f < this.frame && this.used.get(f) !== msg.i[k]) {
        this.rollbackFrom = this.rollbackFrom === null ? f : Math.min(this.rollbackFrom, f);
      }
    }
    while (remote.has(this.remoteConfirmed + 1)) this.remoteConfirmed++;
    this.remoteFrame = Math.max(this.remoteFrame, msg.cur);
    this.remoteAck = Math.max(this.remoteAck, msg.ack);
  }

  /** 對手的輸入落後太多時暫停，避免預測太久、回滾太深。 */
  canAdvance(): boolean {
    return this.frame - (this.remoteConfirmed + 1) < this.maxPrediction;
  }

  /** 每個遊戲影格呼叫一次。回傳是否真的前進了一格。 */
  advance(localInput: InputBits): boolean {
    const target = this.frame + this.delay;
    if (!this.inputs[this.local].has(target)) this.inputs[this.local].set(target, localInput);
    this.applyRollback();
    let moved = false;
    if (this.canAdvance()) {
      this.simulate(this.frame);
      this.frame++;
      moved = true;
    }
    this.sendInputs();
    this.updateSums();
    this.cleanup();
    return moved;
  }

  /** 在不前進的情況下處理回滾並送出輸入（暫停等待時呼叫）。 */
  idle(): void {
    this.applyRollback();
    this.sendInputs();
  }

  /** 本地比對手快太多時回傳 true，呼叫端可以跳過一格讓對手追上。 */
  aheadOfRemote(oneWayFrames: number): boolean {
    return this.frame - (this.remoteFrame + oneWayFrames) >= 2;
  }

  /** 測試用：取得某一格雙方實際使用的確認輸入。 */
  confirmedInput(player: 0 | 1, f: number): InputBits | undefined {
    return this.inputs[player].get(f);
  }

  /** 測試用：取得模擬第 f 格之前的狀態。 */
  stateBefore(f: number): GameState | undefined {
    return f === this.frame ? this.state : this.history.get(f);
  }

  private predict(): InputBits {
    return this.inputs[this.remote].get(this.remoteConfirmed) ?? 0;
  }

  private simulate(f: number): void {
    this.history.set(f, cloneState(this.state));
    const remoteInput = this.inputs[this.remote].get(f) ?? this.predict();
    this.used.set(f, remoteInput);
    const localInput = this.inputs[this.local].get(f) ?? 0;
    step(this.state, this.local === 0 ? [localInput, remoteInput] : [remoteInput, localInput]);
  }

  private applyRollback(): void {
    const from = this.rollbackFrom;
    this.rollbackFrom = null;
    if (from === null || from >= this.frame) return;
    const saved = this.history.get(from);
    if (!saved) return; // 不應該發生：太舊的存檔已清掉
    const end = this.frame;
    this.state = cloneState(saved);
    this.rollbacks++;
    this.maxRollbackDepth = Math.max(this.maxRollbackDepth, end - from);
    for (let f = from; f < end; f++) this.simulate(f);
  }

  private sendInputs(): void {
    const mine = this.inputs[this.local];
    const last = this.frame + this.delay;
    const from = Math.max(this.remoteAck + 1, last - RESEND_WINDOW + 1, 0);
    const list: number[] = [];
    for (let f = from; f <= last && mine.has(f); f++) list.push(mine.get(f)!);
    this.opt.send({ k: 'in', f: from, i: list, cur: this.frame, ack: this.remoteConfirmed });
  }

  /** 定期交換確認過的狀態雜湊，檢查雙方是否一致。 */
  private updateSums(): void {
    while (this.nextSum <= this.remoteConfirmed && this.nextSum < this.frame) {
      const s = this.history.get(this.nextSum) ?? (this.nextSum === this.frame ? this.state : undefined);
      if (!s) break;
      const h = hashState(s);
      this.mySums.set(this.nextSum, h);
      this.opt.send({ k: 'sum', f: this.nextSum, h });
      this.nextSum += CHECKSUM_INTERVAL;
    }
    this.checkSums();
  }

  private checkSums(): void {
    for (const [f, h] of this.mySums) {
      const theirs = this.theirSums.get(f);
      if (theirs === undefined) continue;
      if (theirs !== h && this.desyncFrame === null) this.desyncFrame = f;
      this.mySums.delete(f);
      this.theirSums.delete(f);
    }
  }

  private cleanup(): void {
    const keepFrom = Math.min(this.remoteConfirmed, this.nextSum) - 2;
    for (const f of this.history.keys()) if (f < keepFrom) { this.history.delete(f); this.used.delete(f); }
    if (this.opt.keepInputs) return;
    const inputKeep = Math.min(this.remoteConfirmed, this.remoteAck) - RESEND_WINDOW - 2;
    for (const m of this.inputs) for (const f of m.keys()) if (f < inputKeep) m.delete(f);
  }
}

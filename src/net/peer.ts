// 玩家之間的連線：先透過配對伺服器（WebSocket）交換連線資訊，再建立 WebRTC 直連。
// 兩條資料通道：
//   game：不保證順序、不重送（輸入封包，掉了也沒關係，下一包會再帶）
//   ctrl：保證送達（選角、開始、再戰等控制訊息）

export type ServerMsg =
  | { t: 'created'; code: string }
  | { t: 'joined'; code: string }
  | { t: 'peer-joined' }
  | { t: 'peer-left' }
  | { t: 'signal'; data: SignalData }
  | { t: 'error'; msg: string };

type SignalData = { sdp: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };

export interface PeerEvents {
  onServer(msg: ServerMsg): void;
  onOpen(): void;
  onGame(msg: unknown): void;
  onCtrl(msg: unknown): void;
  onClose(reason: string): void;
}

function signalUrl(): string {
  const env = import.meta.env.VITE_SIGNAL_URL as string | undefined;
  if (env) return env;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export function iceServers(): RTCIceServer[] {
  const env = import.meta.env.VITE_ICE_SERVERS as string | undefined;
  if (env) {
    try { return JSON.parse(env) as RTCIceServer[]; } catch { console.warn('VITE_ICE_SERVERS 格式錯誤'); }
  }
  // 預設只用公開的 STUN；有些網路需要另外設定 TURN 中繼伺服器才連得上
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

/** 兩種配對方式共用的介面。 */
export interface Link {
  readonly host: boolean;
  create(): void;
  join(code: string): void;
  sendGame(msg: unknown): void;
  sendCtrl(msg: unknown): void;
  close(): void;
}

/** 本機開發：用我們自己的配對伺服器（vite 開發伺服器上的 /ws）。 */
export class PeerLink implements Link {
  private ws: WebSocket;
  private pc: RTCPeerConnection | null = null;
  private game: RTCDataChannel | null = null;
  private ctrl: RTCDataChannel | null = null;
  private isHost = false;
  private opened = false;
  private closed = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(private ev: PeerEvents) {
    this.ws = new WebSocket(signalUrl());
    this.ws.onmessage = (e) => this.onServerMessage(JSON.parse(String(e.data)) as ServerMsg);
    this.ws.onclose = () => { if (!this.opened) this.fail('連不上配對伺服器'); };
    this.ws.onerror = () => { if (!this.opened) this.fail('連不上配對伺服器'); };
  }

  private whenWsOpen(fn: () => void): void {
    if (this.ws.readyState === WebSocket.OPEN) fn();
    else this.ws.addEventListener('open', fn, { once: true });
  }

  create(): void {
    this.isHost = true;
    this.whenWsOpen(() => this.ws.send(JSON.stringify({ t: 'create' })));
  }

  join(code: string): void {
    this.isHost = false;
    this.whenWsOpen(() => this.ws.send(JSON.stringify({ t: 'join', code })));
  }

  get host(): boolean {
    return this.isHost;
  }

  sendGame(msg: unknown): void {
    if (this.game?.readyState === 'open') this.game.send(JSON.stringify(msg));
  }

  sendCtrl(msg: unknown): void {
    if (this.ctrl?.readyState === 'open') this.ctrl.send(JSON.stringify(msg));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.sendCtrl({ k: 'bye' }); } catch { /* ignore */ }
    try { this.ws.send(JSON.stringify({ t: 'leave' })); } catch { /* ignore */ }
    this.ws.close();
    this.game?.close();
    this.ctrl?.close();
    this.pc?.close();
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.ev.onClose(reason);
  }

  private async onServerMessage(msg: ServerMsg): Promise<void> {
    this.ev.onServer(msg);
    if (msg.t === 'peer-joined' && this.isHost) await this.startHost();
    else if (msg.t === 'joined') this.setupPeer();
    else if (msg.t === 'signal') await this.onSignal(msg.data);
    else if (msg.t === 'peer-left') this.fail('對手已離開');
    else if (msg.t === 'error') this.fail(msg.msg);
  }

  private setupPeer(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail('無法和對手建立連線（可能需要 TURN 中繼伺服器）');
      if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        // disconnected 可能只是暫時的；由遊戲端的 10 秒逾時決定是否結束
      }
    };
    pc.ondatachannel = (e) => this.bindChannel(e.channel);
    return pc;
  }

  private bindChannel(ch: RTCDataChannel): void {
    if (ch.label === 'game') this.game = ch;
    else this.ctrl = ch;
    ch.onmessage = (e) => {
      const data = JSON.parse(String(e.data));
      if (ch.label === 'game') this.ev.onGame(data);
      else this.ev.onCtrl(data);
    };
    ch.onopen = () => this.checkOpen();
    ch.onclose = () => { if (this.opened) this.fail('連線中斷'); };
  }

  private checkOpen(): void {
    if (!this.opened && this.game?.readyState === 'open' && this.ctrl?.readyState === 'open') {
      this.opened = true;
      this.ev.onOpen();
    }
  }

  private async startHost(): Promise<void> {
    const pc = this.setupPeer();
    this.bindChannel(pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
    this.bindChannel(pc.createDataChannel('ctrl', { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal({ sdp: pc.localDescription!.toJSON() });
  }

  private async onSignal(data: SignalData): Promise<void> {
    const pc = this.setupPeer();
    if ('sdp' in data) {
      await pc.setRemoteDescription(data.sdp);
      for (const c of this.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (data.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal({ sdp: pc.localDescription!.toJSON() });
      }
    } else if ('candidate' in data) {
      if (!pc.remoteDescription) this.pendingCandidates.push(data.candidate);
      else await pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  private signal(data: SignalData): void {
    this.ws.send(JSON.stringify({ t: 'signal', data }));
  }
}

// ───── 發佈版（GitHub Pages 等靜態網站）：用 PeerJS 的免費公開伺服器配對 ─────
// 房主用「前綴 + 房號」當 PeerJS 的 ID，對方用房號連過去；對戰資料一樣是雙方直連。
const PEER_PREFIX = 'sawamio-room-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export class PeerJsLink implements Link {
  private peer: import('peerjs').Peer | null = null;
  private game: import('peerjs').DataConnection | null = null;
  private ctrl: import('peerjs').DataConnection | null = null;
  private isHost = false;
  private opened = false;
  private closed = false;
  private tries = 0;

  constructor(private ev: PeerEvents) {}

  get host(): boolean {
    return this.isHost;
  }

  create(): void {
    this.isHost = true;
    void this.startHost();
  }

  join(code: string): void {
    this.isHost = false;
    void this.startGuest(code.toUpperCase());
  }

  private async newPeer(id?: string): Promise<import('peerjs').Peer> {
    const { Peer } = await import('peerjs');
    const opts = { config: { iceServers: iceServers() } };
    return id ? new Peer(id, opts) : new Peer(opts);
  }

  private async startHost(): Promise<void> {
    const code = randomCode();
    const peer = await this.newPeer(PEER_PREFIX + code);
    this.peer = peer;
    peer.on('open', () => this.ev.onServer({ t: 'created', code }));
    peer.on('error', (e: { type: string }) => {
      if (e.type === 'unavailable-id' && this.tries++ < 5) { peer.destroy(); void this.startHost(); return; }
      if (!this.opened) this.fail(`配對伺服器錯誤（${e.type}）`);
    });
    peer.on('connection', (conn) => {
      if (this.opened || (conn.label !== 'game' && conn.label !== 'ctrl')) { conn.close(); return; }
      if (!this.game && !this.ctrl) this.ev.onServer({ t: 'peer-joined' });
      this.bind(conn);
    });
  }

  private async startGuest(code: string): Promise<void> {
    const peer = await this.newPeer();
    this.peer = peer;
    peer.on('error', (e: { type: string }) => {
      if (this.opened) return;
      this.fail(e.type === 'peer-unavailable' ? '找不到這個房間' : `配對伺服器錯誤（${e.type}）`);
    });
    peer.on('open', () => {
      this.ev.onServer({ t: 'joined', code });
      const target = PEER_PREFIX + code;
      this.bind(peer.connect(target, { label: 'game', reliable: false, serialization: 'json' }));
      this.bind(peer.connect(target, { label: 'ctrl', reliable: true, serialization: 'json' }));
    });
  }

  private bind(conn: import('peerjs').DataConnection): void {
    if (conn.label === 'game') this.game = conn;
    else this.ctrl = conn;
    conn.on('open', () => this.checkOpen());
    conn.on('data', (data) => {
      if (conn.label === 'game') this.ev.onGame(data);
      else this.ev.onCtrl(data);
    });
    conn.on('close', () => { if (this.opened) this.fail('連線中斷'); });
    conn.on('error', () => { if (!this.opened) this.fail('無法和對手建立連線（可能需要 TURN 中繼伺服器）'); });
  }

  private checkOpen(): void {
    if (!this.opened && this.game?.open && this.ctrl?.open) {
      this.opened = true;
      this.ev.onOpen();
    }
  }

  sendGame(msg: unknown): void {
    if (this.game?.open) void this.game.send(msg);
  }

  sendCtrl(msg: unknown): void {
    if (this.ctrl?.open) void this.ctrl.send(msg);
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.ev.onClose(reason);
    this.peer?.destroy();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.sendCtrl({ k: 'bye' }); } catch { /* ignore */ }
    setTimeout(() => this.peer?.destroy(), 200);
  }
}

/** 開發時用本機配對伺服器；發佈版（或設定 VITE_SIGNALING=peerjs）用 PeerJS。設定 VITE_SIGNAL_URL 則一律用自架伺服器。 */
export function createLink(ev: PeerEvents): Link {
  const mode = import.meta.env.VITE_SIGNALING as string | undefined;
  const useOwnServer = !!import.meta.env.VITE_SIGNAL_URL || (import.meta.env.DEV && mode !== 'peerjs');
  return useOwnServer ? new PeerLink(ev) : new PeerJsLink(ev);
}

// 配對伺服器的房間邏輯：只負責開房、加入、轉送 WebRTC 連線資訊（signaling）。
// 對戰資料不經過伺服器，玩家之間直接用 WebRTC 連線。
// 開發時由 vite.config.ts 掛在開發伺服器的 /ws 上；正式上線用 server/index.mjs 獨立執行。

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 0/O、1/I
const MAX_MESSAGE = 64 * 1024;

/** @typedef {{ send(data: string): void; close(): void; on(ev: string, fn: (...a: any[]) => void): void }} Socket */

export function createRoomServer() {
  /** @type {Map<string, Socket[]>} */
  const rooms = new Map();

  function newCode() {
    for (let tries = 0; tries < 100; tries++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
    throw new Error('no free room code');
  }

  function send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* 對方已斷線 */ }
  }

  /** 處理一條新的 WebSocket 連線。 */
  function handle(ws) {
    /** @type {string | null} */
    let room = null;

    const leave = () => {
      if (!room) return;
      const members = rooms.get(room) ?? [];
      const rest = members.filter((m) => m !== ws);
      for (const m of rest) send(m, { t: 'peer-left' });
      if (rest.length) rooms.set(room, rest);
      else rooms.delete(room);
      room = null;
    };

    ws.on('message', (raw) => {
      const text = String(raw);
      if (text.length > MAX_MESSAGE) return;
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'create') {
        leave();
        room = newCode();
        rooms.set(room, [ws]);
        send(ws, { t: 'created', code: room });
      } else if (msg.t === 'join') {
        const code = String(msg.code ?? '').toUpperCase().trim();
        const members = rooms.get(code);
        if (!members) return send(ws, { t: 'error', msg: '找不到這個房間' });
        if (members.length >= 2) return send(ws, { t: 'error', msg: '房間已滿' });
        leave();
        room = code;
        members.push(ws);
        send(ws, { t: 'joined', code });
        send(members[0], { t: 'peer-joined' });
      } else if (msg.t === 'signal') {
        if (!room) return;
        for (const m of rooms.get(room) ?? []) if (m !== ws) send(m, { t: 'signal', data: msg.data });
      } else if (msg.t === 'leave') {
        leave();
      }
    });
    ws.on('close', leave);
    ws.on('error', leave);
  }

  return { handle, rooms };
}

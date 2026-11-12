// 正式上線用的配對伺服器（獨立執行）：node server/index.mjs
// 環境變數 PORT（預設 8787）。前端用 VITE_SIGNAL_URL 指到這台伺服器，例如 wss://your-server.example/ws
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createRoomServer } from './rooms.mjs';

const port = Number(process.env.PORT ?? 8787);
const rooms = createRoomServer();
const http = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'text/plain' });
  res.end(req.url === '/health' ? `ok ${rooms.rooms.size} rooms` : 'not found');
});
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws) => rooms.handle(ws));
http.listen(port, () => console.log(`signaling server on :${port}/ws`));

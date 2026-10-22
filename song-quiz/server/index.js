// 멜론 연도별 차트 노래 맞히기 – 실시간 서버
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { yearCatalog, loadCharts } = require('./charts');
const media = require('./media');
const { Room } = require('./room');

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'public')));
// 글꼴을 직접 제공 (학교망·오프라인에서도 같은 모양)
for (const font of ['black-han-sans', 'ibm-plex-sans-kr']) {
  app.use(`/vendor/${font}`, express.static(path.join(__dirname, '..', 'node_modules', '@fontsource', font)));
}
app.get('/media/:token', (req, res) => {
  const file = media.lookup(req.params.token);
  if (!file) return res.sendStatus(404);
  return res.sendFile(file, { headers: { 'Cache-Control': 'no-store' } });
});
app.get('/api/years', (_req, res) => res.json(yearCatalog()));
app.get('/healthz', (_req, res) => res.send('ok'));

const rooms = new Map();
let roomSeq = 100;

function newestYearWithData() {
  const found = yearCatalog().find((y) => y.count > 0);
  return found ? found.year : null;
}

function lobbyList() {
  return [...rooms.values()].map((r) => r.summary());
}

function pushLobby() {
  io.to('lobby').emit('lobby:rooms', lobbyList());
}

function cleanProfile(profile = {}) {
  const nickname = String(profile.nickname || '').replace(/\s+/g, ' ').trim().slice(0, 10) || '손님';
  const a = profile.avatar || {};
  const avatar = {
    color: Number.isInteger(a.color) ? Math.max(0, Math.min(7, a.color)) : 0,
    face: Number.isInteger(a.face) ? Math.max(0, Math.min(3, a.face)) : 0,
    item: Number.isInteger(a.item) ? Math.max(0, Math.min(4, a.item)) : 0,
  };
  return { nickname, avatar };
}

io.on('connection', (socket) => {
  let profile = null;
  let room = null;

  const leaveRoom = () => {
    if (!room) return;
    const left = room;
    room = null;
    socket.leave(left.id);
    left.removePlayer(socket.id);
    socket.join('lobby');
    pushLobby();
  };

  socket.on('lobby:enter', (data, ack) => {
    profile = cleanProfile(data);
    socket.join('lobby');
    ack?.({ ok: true, profile, rooms: lobbyList(), years: yearCatalog() });
  });

  socket.on('room:create', (data, ack) => {
    if (!profile) return ack?.({ error: '닉네임을 먼저 정하세요.' });
    leaveRoom();
    roomSeq += 1;
    const id = String(roomSeq);
    const title = String(data?.title || '').trim().slice(0, 24) || `${profile.nickname}의 노래방`;
    const created = new Room(io, {
      id,
      title,
      defaultYear: newestYearWithData(),
      onEmpty: (r) => {
        rooms.delete(r.id);
        pushLobby();
      },
    });
    rooms.set(id, created);
    socket.leave('lobby');
    room = created;
    room.addPlayer(socket, profile);
    pushLobby();
    ack?.({ ok: true, roomId: id });
  });

  socket.on('room:join', (data, ack) => {
    if (!profile) return ack?.({ error: '닉네임을 먼저 정하세요.' });
    const target = rooms.get(String(data?.roomId));
    if (!target) return ack?.({ error: '방이 사라졌어요. 목록을 새로고침하세요.' });
    if (target.isFull()) return ack?.({ error: '방이 꽉 찼어요.' });
    leaveRoom();
    socket.leave('lobby');
    room = target;
    room.addPlayer(socket, profile);
    pushLobby();
    ack?.({ ok: true, roomId: target.id });
  });

  socket.on('room:leave', (_d, ack) => {
    leaveRoom();
    ack?.({ ok: true, rooms: lobbyList() });
  });

  socket.on('room:settings', (patch) => {
    room?.updateSettings(socket.id, patch || {});
    pushLobby();
  });

  socket.on('game:start', (_d, ack) => {
    if (!room) return;
    const result = room.start(socket.id);
    pushLobby();
    ack?.(result);
  });

  socket.on('game:again', () => {
    room?.backToWaiting(socket.id);
    pushLobby();
  });

  socket.on('chat', (text) => room?.chat(socket.id, text));
  socket.on('game:skip', () => room?.voteSkip(socket.id));
  socket.on('video:error', (data) => room?.videoFailed(socket.id, data?.videoId));

  socket.on('disconnect', () => leaveRoom());
});

// 관리용: 차트 파일을 고친 뒤 다시 읽기 (서버 콘솔에서 SIGHUP 또는 재시작)
process.on('SIGHUP', () => {
  loadCharts();
  console.log('[charts] 다시 읽었어요');
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  console.log('');
  console.log('  그때 그 노래 서버가 켜졌어요.');
  console.log(`  이 컴퓨터에서:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  같은 와이파이:   http://${ip}:${PORT}`);
  console.log('  끄려면 이 창을 닫거나 Ctrl+C');
  console.log('');
});

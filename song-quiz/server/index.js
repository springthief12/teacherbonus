// 멜론 연도별 차트 노래 맞히기 – 실시간 서버
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { yearCatalog, loadCharts } = require('./charts');
const media = require('./media');
const { Room } = require('./room');
const { cleanName } = require('./profanity');
const { router: adminRouter } = require('./admin');

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
// 휴대폰이 잠기거나 와이파이가 끊기면 20초 안에 알아채도록 확인 주기를 짧게
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 8000 });

app.use(express.static(path.join(__dirname, '..', 'public')));
// Pretendard 글꼴을 직접 제공 (학교망·오프라인에서도 같은 모양, 쓰는 글자만 내려받음)
app.use('/vendor/pretendard', express.static(path.join(__dirname, '..', 'node_modules', 'pretendard', 'dist', 'web', 'variable')));
app.get('/media/:token', (req, res) => {
  const file = media.lookup(req.params.token);
  if (!file) return res.sendStatus(404);
  return res.sendFile(file, { headers: { 'Cache-Control': 'no-store' } });
});
app.get('/api/years', (_req, res) => res.json(yearCatalog()));
// 관리자 페이지 (곡별 유튜브 음원 확인·수정)
app.use('/api/admin', adminRouter());
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('/healthz', (_req, res) => res.send('ok'));

// 접속 QR: 선생님 PC에서 localhost로 열었을 때도 학생용 주소(같은 와이파이 IP)를 알려 준다
app.get('/api/join-info', (_req, res) => res.json({ lan: lanAddresses(), port: PORT }));
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 300);
  if (!/^https?:\/\//.test(text)) return res.sendStatus(400);
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#5A4632', light: '#FFFFFF' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch {
    res.sendStatus(500);
  }
});

const rooms = new Map();
let roomSeq = 100;

function newestYearWithData() {
  const found = yearCatalog().find((y) => y.count > 0);
  return found ? found.year : null;
}

// 모두 연결이 끊긴 방은 목록에서 숨긴다 (자리는 남아 있어 재접속·QR 입장은 가능)
function lobbyList() {
  return [...rooms.values()].filter((r) => r.connectedPlayers().length > 0).map((r) => r.summary());
}

function pushLobby() {
  io.to('lobby').emit('lobby:rooms', lobbyList());
}

function cleanKey(key) {
  const k = String(key || '');
  return /^[a-zA-Z0-9_-]{16,64}$/.test(k) ? k : null;
}

function cleanProfile(profile = {}) {
  const typed = String(profile.nickname || '').replace(/\s+/g, ' ').trim().slice(0, 10) || '손님';
  const nickname = cleanName(typed, `손님${Math.floor(100 + Math.random() * 900)}`);
  const a = profile.avatar || {};
  const avatar = {
    color: Number.isInteger(a.color) ? Math.max(0, Math.min(7, a.color)) : 0,
    face: Number.isInteger(a.face) ? Math.max(0, Math.min(3, a.face)) : 0,
    item: Number.isInteger(a.item) ? Math.max(0, Math.min(4, a.item)) : 0,
  };
  return { nickname, avatar, renamed: nickname !== typed };
}

io.on('connection', (socket) => {
  let profile = null;
  // 기기마다 하나인 열쇠: 연결이 끊겼다 다시 와도 같은 사람으로 알아본다 (다른 사람에게는 보내지 않음)
  let key = null;
  let room = null;

  // 스스로 나가기: 자리를 바로 비운다
  const leaveRoom = () => {
    if (!room) return;
    const left = room;
    room = null;
    socket.leave(left.id);
    left.leave(socket.id);
    socket.join('lobby');
    pushLobby();
  };

  const enter = (target, ack) => {
    const result = target.join(socket, profile, key);
    if (result.error) return ack?.({ error: result.error });
    socket.leave('lobby');
    room = target;
    pushLobby();
    return ack?.({ ok: true, roomId: target.id, you: result.id });
  };

  socket.on('lobby:enter', (data, ack) => {
    profile = cleanProfile(data);
    key = cleanKey(data?.key) || key || `s-${socket.id.replace(/[^a-zA-Z0-9_-]/g, '')}xxxxxxxx`;
    socket.join('lobby');
    ack?.({ ok: true, profile: { nickname: profile.nickname, avatar: profile.avatar }, renamed: profile.renamed, rooms: lobbyList(), years: yearCatalog() });
  });

  socket.on('room:create', (data, ack) => {
    if (!profile) return ack?.({ error: '닉네임을 먼저 정하세요.' });
    leaveRoom();
    roomSeq += 1;
    const id = String(roomSeq);
    const title = cleanName(String(data?.title || '').trim().slice(0, 24), '') || `${profile.nickname}의 방`;
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
    enter(created, ack);
  });

  socket.on('room:join', (data, ack) => {
    if (!profile) return ack?.({ error: '닉네임을 먼저 정하세요.' });
    const target = rooms.get(String(data?.roomId));
    if (!target) return ack?.({ error: '방이 사라졌어요. 목록에서 다시 골라 주세요.', gone: true });
    if (room === target) return ack?.({ ok: true, roomId: target.id, you: target.pidOf(socket.id) });
    if (!target.canJoin(key)) return ack?.({ error: '방이 꽉 찼어요.' });
    leaveRoom();
    return enter(target, ack);
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

  socket.on('chat', (payload, ack) => {
    const res = room ? room.chat(socket.id, payload) : { ok: false, reason: 'room' };
    if (typeof ack === 'function') ack(res);
  });
  socket.on('game:skip', () => room?.voteSkip(socket.id));
  socket.on('video:error', (data) => room?.videoFailed(socket.id, data?.videoId));

  // 연결이 끊긴 경우: 자리를 잠시 남겨 둔다
  socket.on('disconnect', () => {
    if (!room) return;
    room.disconnect(socket.id);
    room = null;
    pushLobby();
  });
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
  // 집·학교 공유기 주소(192.168, 10, 172.16~31)를 앞으로
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((x, y) => rank(x) - rank(y));
}

server.listen(PORT, () => {
  console.log('');
  console.log('  무제 서버가 켜졌어요.');
  console.log(`  이 컴퓨터에서:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  같은 와이파이:   http://${ip}:${PORT}`);
  console.log(`  음원 관리:       http://localhost:${PORT}/admin  (이 PC에서는 비밀번호 없이)`);
  console.log('  끄려면 이 창을 닫거나 Ctrl+C');
  console.log('');
});

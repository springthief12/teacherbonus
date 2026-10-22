// 3명이 접속해 정답·스킵·방장 권한·재접속까지 진행하는 흐름 테스트
// 실행: 서버를 켠 상태에서 `npm test`
const crypto = require('crypto');
const { io } = require('socket.io-client');
const chart = require('../data/charts/2010.json');

const URL = process.env.URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

function client(nickname, color, key = crypto.randomBytes(16).toString('hex')) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.state = null;
  s.chats = [];
  s.reveals = [];
  s.replaced = false;
  s.key = key;
  s.on('room:state', (st) => { s.state = st; });
  s.on('chat', (m) => s.chats.push(m));
  s.on('round:reveal', (d) => s.reveals.push(d));
  s.on('round:hint', ({ hints }) => { if (s.state?.round) s.state.round.hints = hints; });
  s.on('room:replaced', () => { s.replaced = true; });
  s.call = (ev, data) => new Promise((res) => s.emit(ev, data, res));
  s.profile = { nickname, avatar: { color, face: 1, item: 2 }, key };
  s.enter = () => s.call('lobby:enter', s.profile);
  s.join = async (roomId) => {
    const res = await s.call('room:join', { roomId });
    if (res.you) s.me = res.you;
    return res;
  };
  return s;
}

async function until(fn, ms = 15000, label = '') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(50);
  }
  throw new Error(`시간 초과: ${label}`);
}

const me = (s, viewer = s) => viewer.state.players.find((p) => p.id === s.me);

(async () => {
  const a = client('선생님', 0);
  const b = client('두리', 2);
  const c = client('세찌', 4);
  for (const s of [a, b, c]) await s.enter();

  const created = await a.call('room:create', { title: '테스트방' });
  a.me = created.you;
  check('방 만들기', created.ok && Boolean(created.you));
  const jb = await b.join(created.roomId);
  const jc = await c.join(created.roomId);
  check('두 명 입장', jb.ok && jc.ok);
  await until(() => a.state && a.state.players.length === 3, 3000, '3명');
  check('방장은 만든 사람', a.state.hostId === a.me);
  check('기기 열쇠는 다른 사람에게 보내지 않음', !JSON.stringify(a.state).includes(b.key));

  b.emit('room:settings', { songCount: 50 });
  await wait(200);
  check('학생은 설정 못 바꿈', a.state.settings.songCount === 20);
  a.emit('room:settings', { songCount: 10, scoring: 'speed', years: [2010, 1999] });
  await wait(200);
  check('방장 설정 반영, 데이터 없는 연도는 걸러짐',
    a.state.settings.songCount === 10 && a.state.settings.scoring === 'speed' && a.state.settings.years.join() === '2010');

  const notHost = await b.call('game:start');
  check('학생은 시작 불가', Boolean(notHost.error));

  // 방장 연결이 잠깐 끊겨도 방장은 넘어가지 않음
  a.disconnect();
  await until(() => b.state.players.find((p) => p.id === a.me)?.away, 3000, '방장 끊김');
  check('방장 연결 끊김: 자리 유지 + 방장 유지', b.state.hostId === a.me && b.state.players.length === 3);
  a.connect();
  await until(() => a.connected, 3000, '재연결');
  await a.enter();
  const back = await a.join(created.roomId);
  await until(() => !b.state.players.find((p) => p.id === a.me)?.away, 3000, '방장 복귀');
  check('같은 기기로 재접속 → 같은 자리', back.you === a.me && b.state.players.length === 3);

  const started = await a.call('game:start');
  check('방장이 게임 시작', started.ok);
  await until(() => a.state.status === 'playing', 10000, '첫 곡 재생');
  check('라운드 정보', a.state.round.total === 10 && a.state.round.hints[0] === '2010년 차트');
  check('진행 중엔 정답 비공개', a.state.round.answer === null);

  b.emit('chat', '이건 오답일걸');
  await until(() => c.chats.some((m) => m.text === '이건 오답일걸'), 3000, '오답 채팅');
  check('오답 채팅이 다른 사람에게 보임', c.chats.find((m) => m.text === '이건 오답일걸').playerId === b.me);

  // 두리가 제목을 하나씩 입력해 정답을 찾는다
  const titles = chart.songs.map((s) => s.title.replace(/\s*\(.*?\)\s*/g, ' ').trim());
  for (const t of titles) {
    if (b.state.status !== 'playing') break;
    b.emit('chat', t);
    await wait(550);
  }
  await until(() => a.state.status === 'reveal', 5000, '정답 공개');
  const rev = a.reveals.at(-1);
  check('정답자 판정', rev.reason === 'correct' && rev.winnerId === b.me, `+${rev.points}점`);
  const scoreB = me(b, a).score;
  check('점수 반영', scoreB === rev.points && me(b, a).correct === 1);

  // 학생 폰이 잠겨 연결이 끊겼다가 돌아와도 점수 유지
  b.disconnect();
  await until(() => me(b, a)?.away, 3000, '학생 끊김');
  check('학생 연결 끊김: 자리 유지', a.state.players.length === 3);
  b.connect();
  await until(() => b.connected, 3000, '학생 재연결');
  await b.enter();
  await b.join(created.roomId);
  await until(() => me(b, a) && !me(b, a).away, 3000, '학생 복귀');
  check('학생 재접속 → 점수 그대로', me(b, a).score === scoreB);

  // 같은 기기에서 창을 하나 더 열면 예전 창은 방에서 나감
  const c2 = client('세찌', 4, c.key);
  await c2.enter();
  await c2.join(created.roomId);
  await until(() => c.replaced, 3000, '창 교체');
  check('같은 기기 새 창 → 예전 창 정리, 자리 하나', c.replaced && a.state.players.length === 3);

  // 정답 공개 중 과반수(2/3) 넘기기 → 바로 다음 곡
  if (a.state.status === 'reveal') {
    const idx = a.state.round.index;
    b.emit('game:skip');
    await wait(200);
    check('1표로는 안 넘어감', a.state.status === 'reveal');
    c2.emit('chat', '!s');
    await until(() => a.state.round && a.state.round.index === idx + 1, 4000, '다음 곡');
    check('과반수 넘기기 → 다음 곡', true);
  }

  await until(() => a.state.status === 'playing', 10000, '다음 곡 재생');
  a.emit('game:skip');
  b.emit('game:skip');
  await until(() => a.state.status === 'reveal', 3000, '스킵 공개');
  check('정답 전 스킵 → 정답 공개', a.reveals.at(-1).reason === 'skip');

  // 방장이 스스로 나가면 잠시 다른 사람이 방장 → 돌아오면 다시 방장
  a.emit('room:leave');
  await until(() => b.state.players.length === 2, 3000, '방장 퇴장');
  check('방장이 나가면 임시 방장', b.state.hostId !== a.me && b.state.players.some((p) => p.id === b.state.hostId));
  await a.join(created.roomId);
  await until(() => b.state.hostId === a.me, 3000, '방장 복귀');
  check('방을 만든 사람이 다시 들어오면 방장 복귀', b.state.hostId === a.me);
  check('게임은 계속 진행', ['reveal', 'loading', 'playing'].includes(b.state.status));

  await until(() => b.state.status === 'playing', 10000, '힌트 확인용 곡');
  await wait(30 * 1000 * 0.66 + 1200);
  const hints = b.state.round.hints;
  check('힌트 3단계', hints.length === 3 && hints[1].startsWith('가수') && hints[2].startsWith('제목'), hints.join(' / '));

  [a, b, c, c2].forEach((s) => s.close());
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

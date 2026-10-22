// 3명이 접속해 정답·스킵·방장 넘김까지 진행하는 흐름 테스트
// 실행: 서버를 켠 상태에서 `node test/flow.test.js`
const { io } = require('socket.io-client');
const chart = require('../data/charts/2010.json');

const URL = process.env.URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

function client(nickname, color) {
  const s = io(URL, { transports: ['websocket'] });
  s.state = null;
  s.chats = [];
  s.reveals = [];
  s.on('room:state', (st) => { s.state = st; });
  s.on('chat', (m) => s.chats.push(m));
  s.on('round:reveal', (d) => s.reveals.push(d));
  s.on('round:hint', ({ hints }) => { if (s.state?.round) s.state.round.hints = hints; });
  s.call = (ev, data) => new Promise((res) => s.emit(ev, data, res));
  s.profile = { nickname, avatar: { color, face: 1, item: 2 } };
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

(async () => {
  const a = client('하나', 0);
  const b = client('두리', 2);
  const c = client('세찌', 4);
  for (const s of [a, b, c]) await s.call('lobby:enter', s.profile);

  const created = await a.call('room:create', { title: '테스트방' });
  check('방 만들기', created.ok);
  const jb = await b.call('room:join', { roomId: created.roomId });
  const jc = await c.call('room:join', { roomId: created.roomId });
  check('두 명 입장', jb.ok && jc.ok);
  await until(() => a.state && a.state.players.length === 3, 3000, '3명');
  check('방장은 만든 사람', a.state.hostId === a.id);

  b.emit('room:settings', { songCount: 50 });
  await wait(200);
  check('방장 아닌 사람은 설정 못 바꿈', a.state.settings.songCount === 20);
  a.emit('room:settings', { songCount: 10, scoring: 'speed', years: [2010, 1999] });
  await wait(200);
  check('방장 설정 반영, 데이터 없는 연도는 걸러짐',
    a.state.settings.songCount === 10 && a.state.settings.scoring === 'speed' && a.state.settings.years.join() === '2010');

  const notHost = await b.call('game:start');
  check('방장 아니면 시작 불가', Boolean(notHost.error));
  const started = await a.call('game:start');
  check('게임 시작', started.ok);
  await until(() => a.state.status === 'playing', 10000, '첫 곡 재생');
  check('라운드 정보', a.state.round.total === 10 && a.state.round.hints[0].includes('2010'));
  check('진행 중엔 정답 비공개', a.state.round.answer === null);

  // 오답은 채팅으로 보인다
  b.emit('chat', '이건 오답일걸');
  await until(() => c.chats.some((m) => m.text === '이건 오답일걸'), 3000, '오답 채팅');
  check('오답 채팅이 다른 사람에게 보임', true);

  // A가 제목을 하나씩 입력해 정답을 찾는다 (도배 방지에 걸리지 않도록 천천히)
  const titles = chart.songs.map((s) => s.title.replace(/\s*\(.*?\)\s*/g, ' ').trim());
  for (const t of titles) {
    if (a.state.status !== 'playing') break;
    a.emit('chat', t);
    await wait(550);
  }
  await until(() => a.state.status === 'reveal', 5000, '정답 공개');
  const rev = a.reveals.at(-1);
  check('정답자 판정', rev.reason === 'correct' && rev.winnerId === a.id, `+${rev.points}점`);
  const meA = a.state.players.find((p) => p.id === a.id);
  check('점수 반영', meA.score === rev.points && meA.correct === 1);
  check('정답 문장은 채팅에 노출 안 됨',
    !b.chats.some((m) => m.kind === 'player' && m.playerId === a.id && m.text === rev.answer.title.replace(/\s*\(.*?\)\s*/g, ' ').trim()));
  check('정답 공개 상태에서 답 공개', a.state.round.answer && a.state.round.answer.title === rev.answer.title);

  // 정답 공개 중 과반수(2/3) 넘기기 → 바로 다음 곡
  const idx = a.state.round.index;
  b.emit('game:skip');
  await wait(200);
  check('1표로는 안 넘어감', a.state.status === 'reveal');
  c.emit('chat', '!s');
  await until(() => a.state.round && a.state.round.index === idx + 1, 4000, '다음 곡');
  check('과반수 넘기기 → 다음 곡', true);

  // 정답 전에 모두 넘기면 정답을 보여주고 넘어감
  await until(() => a.state.status === 'playing', 10000, '두 번째 곡 재생');
  a.emit('game:skip');
  b.emit('game:skip');
  await until(() => a.state.status === 'reveal', 3000, '스킵 공개');
  check('정답 전 스킵 → 정답 공개', a.reveals.at(-1).reason === 'skip');

  // 방장이 나가면 다음 사람이 방장
  a.emit('room:leave');
  await until(() => b.state.players.length === 2, 3000, '방장 퇴장');
  check('방장 넘김', b.state.hostId === b.id);
  check('게임은 계속 진행', ['reveal', 'loading', 'playing'].includes(b.state.status));

  // 초성 힌트가 시간이 지나면 나온다 (라운드 30초 기준 35%·65%)
  await until(() => b.state.status === 'playing', 10000, '세 번째 곡');
  await wait(30 * 1000 * 0.66 + 1200);
  const hints = b.state.round.hints;
  check('힌트 3단계', hints.length === 3 && hints[1].startsWith('가수') && hints[2].startsWith('제목'), hints.join(' / '));

  [a, b, c].forEach((s) => s.close());
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

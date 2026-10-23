// 관리자 페이지·셔플 제외 테스트 (서버를 직접 띄워서 확인)
// 실행: node test/admin.test.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 3190;
const URL = `http://localhost:${PORT}`;
const CACHE = path.join(ROOT, 'data', 'youtube-cache.json');
const OVERRIDES = path.join(ROOT, 'data', 'overrides.json');
const AUDIO = path.join(ROOT, 'data', 'audio', '2010');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// 원래 파일 보관 → 끝나면 되돌리기
const backup = {
  cache: fs.existsSync(CACHE) ? fs.readFileSync(CACHE) : null,
  overrides: fs.existsSync(OVERRIDES) ? fs.readFileSync(OVERRIDES) : null,
};
function restore() {
  if (backup.cache) fs.writeFileSync(CACHE, backup.cache); else fs.writeFileSync(CACHE, '{}\n');
  if (backup.overrides) fs.writeFileSync(OVERRIDES, backup.overrides); else if (fs.existsSync(OVERRIDES)) fs.unlinkSync(OVERRIDES);
  fs.rmSync(AUDIO, { recursive: true, force: true });
}

// 준비: 2010년
//  1~3위: 음원 파일 / 4위: 뮤직비디오만 찾음(음원 없음) / 5위: 자동으로 음원을 찾음(확인 전)
//  6위: 검사 전 / 7위: 셔플에서 뺌(검사 전) / 8위: 확인함(검색 기록 없이 설정만 남은 상태 = 서버 재시작 뒤)
//  나머지: '음원 없음'으로 검사된 상태
const { squash } = require('../server/answer');
const { CACHE_VERSION } = require('../server/youtube');
const chart = require('../data/charts/2010.json');
const song = (rank) => chart.songs.find((s) => s.rank === rank);
const AUTO_TITLE = `${song(5).artist} - ${song(5).title} (Audio)`;
const cache = {};
for (const s of chart.songs) {
  if (s.rank <= 3 || s.rank >= 6 && s.rank <= 8) continue;
  cache[`${squash(s.artist)}|${squash(s.title)}`] = {
    v: CACHE_VERSION,
    candidates: s.rank === 4
      ? [{ id: 'AAAAAAAAAAA', title: `${s.title} (Official MV)`, channel: '어딘가', seconds: 230, score: 2, ok: false }]
      : s.rank === 5
        ? [{ id: 'CCCCCCCCCCC', title: AUTO_TITLE, channel: `${s.artist} - Topic`, seconds: 220, score: 18, ok: true }]
        : [],
    bad: [],
    checkedAt: Date.now(),
  };
}
fs.writeFileSync(CACHE, JSON.stringify(cache));
const okey = (s) => `2010|${squash(s.artist)}|${squash(s.title)}`;
fs.writeFileSync(OVERRIDES, JSON.stringify({ songs: {
  [okey(song(7))]: { disabled: true, title: song(7).title, artist: song(7).artist, updatedAt: 1 },
  [okey(song(8))]: { youtubeId: 'EEEEEEEEEEE', videoTitle: '저장해 둔 음원 제목', videoChannel: '가수 - Topic', title: song(8).title, artist: song(8).artist, updatedAt: 1 },
} }));
fs.mkdirSync(AUDIO, { recursive: true });
for (const r of [1, 2, 3]) {
  const buf = Buffer.alloc(44 + 16000);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + 16000, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(16000, 40);
  fs.writeFileSync(path.join(AUDIO, `${r}.wav`), buf);
}

const server = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures', 'no-youtube-search.cjs'), 'server/index.js'], {
  cwd: ROOT,
  // 저장소에 쌓인 실제 관리자 설정(song-quiz-data/overrides.json)은 읽지 않게 없는 파일을 가리킨다
  env: { ...process.env, PORT: String(PORT), ADMIN_PASSWORD: 'test-pass-1234', ALLOW_NO_AUDIO: '', GITHUB_TOKEN: '', GITHUB_FILE: 'song-quiz/test/no-such-overrides.json', RENDER: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const remote = { 'X-Forwarded-For': '203.0.113.9' }; // 다른 컴퓨터에서 온 요청처럼

async function req(p, { body, headers = {} } = {}) {
  const res = await fetch(`${URL}${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  return { status: res.status, data, cookie: res.headers.get('set-cookie') };
}

function player(nick) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.state = null;
  s.on('room:state', (st) => { s.state = st; });
  s.call = (ev, data) => new Promise((res) => s.emit(ev, data, res));
  s.profile = { nickname: nick, avatar: { color: 1, face: 0, item: 0 }, key: crypto.randomBytes(16).toString('hex') };
  return s;
}

async function playWholeGame(songCount) {
  const host = player('선생님');
  await host.call('lobby:enter', host.profile);
  const created = await host.call('room:create', {});
  host.emit('room:settings', { years: [2010], songCount, roundTime: 20, revealTime: 5, skipRule: 'anyone' });
  await wait(200);
  const started = await host.call('game:start');
  const seen = [];
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const st = host.state;
    if (st && st.status === 'playing' && !seen.some((x) => x.index === st.round.index)) {
      seen.push({ index: st.round.index, total: st.round.total, audio: Boolean(st.round.audioUrl), video: st.round.videoId });
      host.emit('game:skip'); // 바로 넘기기
    }
    if (st && st.status === 'reveal') host.emit('game:skip');
    if (st && st.status === 'ended') break;
    await wait(120);
  }
  const answers = host.state.status === 'ended' ? true : false;
  host.close();
  return { created, started, seen, ended: answers };
}

(async () => {
  try {
    for (let i = 0; i < 40; i += 1) {
      try { if ((await fetch(`${URL}/healthz`)).ok) break; } catch { /* 아직 */ }
      await wait(150);
    }

    // ---------- 권한 ----------
    const meLocal = await req('/api/admin/me');
    check('서버 PC(localhost)에서는 비밀번호 없이 관리', meLocal.data.authed === true && meLocal.data.local === true);
    const meRemote = await req('/api/admin/me', { headers: remote });
    check('다른 컴퓨터에서는 로그인 필요', meRemote.data.authed === false && meRemote.data.passwordSet === true);
    const blocked = await req('/api/admin/songs?year=2010', { headers: remote });
    check('로그인 전 곡 목록 차단', blocked.status === 401);
    const wrong = await req('/api/admin/login', { body: { password: 'nope' }, headers: remote });
    check('틀린 비밀번호 거절', wrong.status === 401);
    const right = await req('/api/admin/login', { body: { password: 'test-pass-1234' }, headers: remote });
    const cookie = (right.cookie || '').split(';')[0];
    check('맞는 비밀번호 → 로그인 쿠키(HttpOnly)', right.status === 200 && /HttpOnly/i.test(right.cookie || ''));
    const afterLogin = await req('/api/admin/songs?year=2010', { headers: { ...remote, Cookie: cookie } });
    check('로그인 후 곡 목록', afterLogin.status === 200 && afterLogin.data.songs.length === 50);
    const forged = await req('/api/admin/songs?year=2010', { headers: { ...remote, Cookie: 'sq_admin=forged' } });
    check('위조한 쿠키 거절', forged.status === 401);

    // ---------- 곡 상태 ----------
    const list = afterLogin.data.songs;
    const byRank = (r) => list.find((s) => s.rank === r);
    check('음원 파일 있는 곡 표시', byRank(1).audioFile === true);
    check('곡 제목이 영상 정보로 덮이지 않음', list.every((s) => s.title && s.artist), byRank(4).title);
    check('뮤직비디오만 있는 곡은 음원 없음으로 판정', byRank(4).source === 'missing' && byRank(4).candidates[0].ok === false);

    // ---------- 셔플 제외 ----------
    let game = await playWholeGame(10);
    const vids = (g, id) => g.seen.filter((x) => x.video === id).length;
    check('음원 없는 곡·뺀 곡은 셔플에서 제외 (음원 파일 3 + 자동 1 + 확인함 1)',
      game.started.ok && game.seen.length === 5 && game.seen.every((x) => x.audio || x.video) && vids(game, 'CCCCCCCCCCC') === 1 && vids(game, 'EEEEEEEEEEE') === 1,
      `나온 곡 ${game.seen.length}개`);

    // ---------- 확인 (음원 고정) ----------
    check('자동으로 찾은 곡은 확인 전', byRank(5).source === 'search' && byRank(5).youtubeId === 'CCCCCCCCCCC');
    check('확인한 곡은 검색 기록이 없어도 저장해 둔 영상 정보로 표시', byRank(8).source === 'override' && byRank(8).videoTitle === '저장해 둔 음원 제목');
    const noAudio = await req('/api/admin/song', { body: { key: byRank(4).key, confirm: true } });
    check('음원이 없는 곡은 확인 거절', noAudio.status === 400);
    const confirmed = await req('/api/admin/song', { body: { key: byRank(5).key, confirm: true } });
    check('확인 → 지금 음원으로 고정 (영상 정보도 저장)', confirmed.status === 200 && confirmed.data.song.source === 'override'
      && confirmed.data.song.youtubeId === 'CCCCCCCCCCC' && confirmed.data.song.videoTitle === AUTO_TITLE);
    const pinned = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')).songs[byRank(5).key] || {};
    check('확인한 음원이 설정 파일에 저장', pinned.youtubeId === 'CCCCCCCCCCC' && pinned.videoTitle === AUTO_TITLE);
    const again = await req('/api/admin/song', { body: { key: byRank(5).key, confirm: true } });
    check('이미 확인한 곡을 다시 확인해도 그대로', again.status === 200 && again.data.song.youtubeId === 'CCCCCCCCCCC');
    const checkAll = await req('/api/admin/check', { body: { year: 2010 } });
    check('검사 안 한 곡 검사: 확인한 곡·뺀 곡은 건너뜀 (6위만)', checkAll.data.checking && checkAll.data.checking.total === 1,
      `검사 대상 ${checkAll.data.checking && checkAll.data.checking.total}곡`);

    // 관리자가 4위 곡에 링크를 직접 넣으면 다시 셔플에 들어감
    const key4 = byRank(4).key;
    const bad = await req('/api/admin/song', { body: { key: key4, youtube: '이상한 주소' } });
    check('잘못된 유튜브 주소 거절', bad.status === 400);
    const pick = await req('/api/admin/song', { body: { key: key4, youtube: 'https://youtu.be/BBBBBBBBBBB?si=abc', start: 7 } });
    check('링크 저장 + 시작 위치', pick.status === 200 && pick.data.song.source === 'override' && pick.data.song.youtubeId === 'BBBBBBBBBBB' && pick.data.song.start === 7);
    // 2위는 셔플에서 빼기
    const key2 = byRank(2).key;
    await req('/api/admin/song', { body: { key: key2, disabled: true } });
    game = await playWholeGame(10);
    const videos = vids(game, 'BBBBBBBBBBB');
    check('직접 넣은 링크 곡은 다시 포함, 제외한 곡은 빠짐', game.seen.length === 5 && videos === 1 && vids(game, 'CCCCCCCCCCC') === 1,
      `나온 곡 ${game.seen.length}개, 링크 곡 ${videos}개`);

    const saved = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
    check('이 PC 파일(data/overrides.json)에 저장', Object.values(saved.songs).some((v) => v.youtubeId === 'BBBBBBBBBBB') && Object.values(saved.songs).some((v) => v.disabled));

    // 되돌리기
    const reset = await req('/api/admin/song', { body: { key: key4, youtube: null, start: null } });
    check('자동 검색으로 되돌리기', reset.data.song.source === 'missing');
    const undo = await req('/api/admin/song', { body: { key: byRank(5).key, youtube: null } });
    const afterUndo = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')).songs[byRank(5).key];
    check('확인 취소 → 자동 검색 결과로, 저장된 설정도 지움', undo.data.song.source === 'search' && afterUndo === undefined);

    // ---------- 활성화 / 비활성화 (다른 해 차트의 같은 곡도 함께) ----------
    const listOf = async (y) => (await req(`/api/admin/songs?year=${y}`)).data.songs;
    const dyn21 = (await listOf(2021)).find((s) => s.title === 'Dynamite');
    const off = await req('/api/admin/song', { body: { key: dyn21.key, disabled: true } });
    const dyn20 = (await listOf(2020)).find((s) => s.title === 'Dynamite');
    check('비활성화 → 다른 해 차트의 같은 곡도 함께 꺼짐', off.status === 200 && off.data.song.disabled === true
      && off.data.also.some((x) => x.year === 2020 && x.rank === 12) && dyn20.disabled === true);
    const on = await req('/api/admin/song', { body: { key: dyn20.key, disabled: false } });
    const dyn21b = (await listOf(2021)).find((s) => s.title === 'Dynamite');
    const leftover = Object.values(JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')).songs).filter((v) => v.title === 'Dynamite');
    check('활성화도 함께 → 설정이 남지 않음', on.data.song.disabled === false && dyn21b.disabled === false && leftover.length === 0);
    // 다른 해 차트에 없는 곡을 골라서 확인 (차트가 늘어나도 맞게)
    const charts = require('../server/charts');
    const soloSong = charts.songsOf(2021).find((s) => !charts.sameSongs(s).length);
    const solo = (await listOf(2021)).find((s) => s.rank === soloSong.rank);
    const soloOff = await req('/api/admin/song', { body: { key: solo.key, disabled: true } });
    check('한 해에만 있는 곡은 그 곡만', soloOff.data.song.disabled === true && soloOff.data.also.length === 0);
    await req('/api/admin/song', { body: { key: solo.key, disabled: false } });

    // 관리자 페이지 HTML
    const page = await fetch(`${URL}/admin`);
    check('관리자 페이지 열림', page.ok && (await page.text()).includes('음원 관리'));
  } catch (err) {
    console.error(err);
    results.push(false);
  } finally {
    server.kill();
    restore();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`관리자·셔플 제외: ${results.length - failed}/${results.length} 통과`);
  if (failed) console.log(serverLog.slice(-1500));
  process.exit(failed ? 1 : 0);
})();

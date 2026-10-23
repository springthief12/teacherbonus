// 실제 서버와 차트로 모든 연도의 선택 → 50곡 진행 → 정답/점수를 확인한다.
// 외부 YouTube와 운영 음원 설정에 의존하지 않도록 임시 복사본에 WAV/캐시를 넣는다.
// 실행: node test/chart-years.test.js (별도로 서버를 켤 필요 없음)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');
const { io } = require('socket.io-client');
const charts = require('../server/charts');
const { songKey, squash } = require('../server/answer');
const { CACHE_VERSION } = require('../server/youtube'); // 검색 방식이 바뀌면 올라가는 기록 형식 번호

const ROOT = path.resolve(__dirname, '..');
const YEARS = Array.from({ length: 18 }, (_, i) => 2008 + i);
const ADDED_YEARS = [2008, 2009, 2012, 2013, 2014, 2015, 2016, 2019, 2023, 2024];
const ALL_SONGS = YEARS.flatMap((year) => charts.songsOf(year));

// PCM 데이터의 첫 두 샘플은 테스트가 재생된 차트/곡을 알아보는 표식이다.
function wav(song) {
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  bytes.writeUInt16LE(song.year, 44); bytes.writeUInt16LE(song.rank, 46);
  return bytes;
}

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => err ? reject(err) : resolve()));
  return port;
}

async function fixtureServer(t, { localAudio = true, overrides = { songs: {} } } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'song-quiz-chart-years-'));
  const root = path.join(tmp, 'song-quiz');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'server'), path.join(root, 'server'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'data', 'charts'), path.join(root, 'data', 'charts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'overrides.json'), JSON.stringify(overrides));
  // 캐시에서 음원 없음으로 확인된 곡도 로컬 음원이나 관리자 지정 영상이 있으면 재생해야 한다.
  const cache = Object.fromEntries(ALL_SONGS.map((song) => [
    `${squash(song.artist)}|${squash(song.title)}`,
    { v: CACHE_VERSION, candidates: [], bad: [], checkedAt: 1 },
  ]));
  fs.writeFileSync(path.join(root, 'data', 'youtube-cache.json'), JSON.stringify(cache));
  if (localAudio) {
    for (const song of ALL_SONGS) {
      const dir = path.join(root, 'data', 'audio', String(song.year));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${song.rank}.wav`), wav(song));
    }
  }
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env, PORT: String(port), NODE_PATH: path.join(ROOT, 'node_modules'),
      GITHUB_TOKEN: '', GITHUB_REPO: '', GITHUB_FILE: 'unused/overrides.json',
      YT_API_KEY: '', ALLOW_NO_AUDIO: '', ADMIN_PASSWORD: '', RENDER: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (data) => { log += data; });
  server.stderr.on('data', (data) => { log += data; });
  t.after(async () => {
    try {
      if (server.exitCode === null && server.signalCode === null) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('임시 서버 종료 시간 초과')), 5000);
          server.once('close', () => { clearTimeout(timer); resolve(); });
          server.kill();
        });
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  let lastError;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.equal(server.exitCode, null, `임시 서버 종료: ${log}`);
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return { url };
    } catch (err) { lastError = err.cause?.code || err.message; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`서버 시작 시간 초과 (${lastError || '응답 없음'}): ${log}`);
}

async function player(t, url) {
  const socket = io(url, {
    transports: ['websocket'], forceNew: true, reconnection: false, timeout: 3000,
  });
  t.after(() => socket.close());
  socket.state = null;
  socket.on('room:state', (state) => { socket.state = state; });
  socket.call = (event, data) => new Promise((resolve, reject) => {
    socket.timeout(3000).emit(event, data, (err, response) => err ? reject(err) : resolve(response));
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('Socket.IO 연결 시간 초과')), 3000);
    const connected = () => done();
    function done(err) {
      clearTimeout(timer);
      socket.off('connect', connected);
      socket.off('connect_error', done);
      if (err) reject(err); else resolve();
    }
    socket.once('connect', connected);
    socket.once('connect_error', done);
  });
  const entered = await socket.call('lobby:enter', { nickname: '연도검증', key: 'chart-years-test-device', avatar: {} });
  assert.equal(entered.ok, true);
  return socket;
}

function stateWhen(socket, predicate) {
  if (predicate(socket.state)) return Promise.resolve(socket.state);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:state', onState);
      reject(new Error(`방 상태 대기 시간 초과: ${JSON.stringify(socket.state)}`));
    }, 3000);
    function onState(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('room:state', onState);
      resolve(state);
    }
    socket.on('room:state', onState);
  });
}

async function settings(socket, patch, predicate) {
  const changed = stateWhen(socket, (state) => state && predicate(state.settings));
  socket.emit('room:settings', patch);
  return changed;
}

async function skip(socket, predicate) {
  const changed = stateWhen(socket, predicate);
  socket.emit('game:skip');
  return changed;
}

test('2008~2025년 모든 차트가 실제 서버에서 50곡씩 진행되고 정답과 점수가 반영된다', { timeout: 60000 }, async (t) => {
  const { url } = await fixtureServer(t);
  const catalog = await (await fetch(`${url}/api/years`)).json();
  for (const year of YEARS) {
    assert.deepEqual(catalog.find((entry) => entry.year === year), { year, count: 50, verified: true });
  }
  assert.equal(catalog.find((entry) => entry.year === 2026).count, 0);
  const host = await player(t, url);
  const created = await host.call('room:create', {});
  assert.equal(created.ok, true);
  await settings(host, { years: [2026, 1999, '잘못된 연도'] }, (value) => value.years.length === 0);
  assert.match((await host.call('game:start')).error, /연도/);
  await host.call('room:leave');

  for (const year of YEARS) {
    await t.test(`${year}년${ADDED_YEARS.includes(year) ? ' (추가)' : ''}: 50곡, 시험용 음원 HTTP 응답, 정답, 결과`, async () => {
      const room = await host.call('room:create', { title: `${year}년 검증` });
      await settings(host, { years: [String(year), year, 2026], songCount: 50, skipRule: 'anyone' },
        (value) => value.songCount === 50 && value.years.join() === String(year));
      assert.equal((await host.call('game:start')).ok, true);
      const seen = new Set();
      for (let index = 0; index < 50; index += 1) {
        const playing = await stateWhen(host, (state) => state?.status === 'playing' && state.round.index === index);
        assert.equal(playing.round.total, 50);
        assert.equal(playing.round.year, year);
        assert.equal(playing.round.hints[0].value, `${year}년`);
        assert.equal(playing.round.answer, null, '정답은 공개 전에 숨겨야 함');
        assert.match(playing.round.audioUrl, /^\/media\/[a-f0-9]{24}$/);
        let reveal;
        if (index === 0) {
          const audio = await fetch(`${url}${playing.round.audioUrl}`);
          assert.equal(audio.status, 200);
          const bytes = Buffer.from(await audio.arrayBuffer());
          assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
          assert.equal(bytes.readUInt16LE(44), year, '재생한 음원이 선택한 연도와 일치');
          const song = charts.songsOf(year).find((candidate) => candidate.rank === bytes.readUInt16LE(46));
          assert.ok(song);
          const correct = await host.call('chat', { text: song.title, cid: `year${year}` });
          assert.deepEqual(correct, { ok: true, correct: true, points: 10 });
          reveal = await stateWhen(host, (state) => state?.status === 'reveal' && state.round.index === index);
          assert.equal(reveal.round.winnerId, room.you);
          assert.equal(reveal.players.find((entry) => entry.id === room.you).score, 10);
        } else {
          reveal = await skip(host, (state) => state?.status === 'reveal' && state.round.index === index);
        }
        const answer = reveal.round.answer;
        const song = charts.songsOf(year).find((candidate) => candidate.rank === answer.rank);
        assert.ok(song, `${year}년 차트에 없는 순위`);
        assert.deepEqual(answer, { title: song.title, artist: song.artist, year, rank: song.rank });
        assert.ok(!seen.has(songKey(song)), '한 연도 안에서 같은 곡을 두 번 재생함');
        seen.add(songKey(song));
        await skip(host, (state) => index === 49
          ? state?.status === 'ended'
          : state?.status === 'playing' && state.round.index === index + 1);
      }
      assert.equal(seen.size, 50);
      assert.equal(host.state.results.total, 50);
      assert.equal(host.state.results.ranking[0].score, 10);
      assert.equal(host.state.results.ranking[0].correct, 1);
      await host.call('room:leave');
    });
  }
});

test('추가 연도를 함께 고르면 중복곡은 먼저 오른 해로 한 번만 나온다', () => {
  const expected = new Map();
  for (const year of YEARS) {
    for (const song of charts.songsOf(year)) if (!expected.has(songKey(song))) expected.set(songKey(song), song);
  }
  assert.ok(expected.size < ALL_SONGS.length, '중복곡이 포함된 실제 데이터로 검사해야 함');
  const pool = charts.buildPool([...YEARS].reverse().concat(2014, 2026));
  assert.equal(pool.length, expected.size);
  assert.equal(new Set(pool.map(songKey)).size, pool.length);
  for (const song of pool) assert.equal(song.year, expected.get(songKey(song)).year);
});

test('기존 해에서 지정한 영상은 추가된 해에서도 상속되어 게임을 진행한다', { timeout: 20000 }, async (t) => {
  const persisted = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'song-quiz-data', 'overrides.json'), 'utf8'));
  const candidates = ADDED_YEARS.flatMap((year) => charts.songsOf(year));
  const inherited = candidates.flatMap((song) => Object.entries(persisted.songs)
    .filter(([key, value]) => value.youtubeId && !value.disabled && Number(key.split('|')[0]) !== song.year && songKey(value) === songKey(song))
    .map(([key, value]) => ({ song, key, value, from: Number(key.split('|')[0]) })))[0];
  assert.ok(inherited, '기존 영상 설정과 추가 연도 사이에 실제로 겹치는 곡이 있어야 함');
  const { song, key, value, from } = inherited;
  const { url } = await fixtureServer(t, { localAudio: false, overrides: { songs: { [key]: value } } });
  const res = await fetch(`${url}/api/admin/songs?year=${song.year}`);
  assert.equal(res.status, 200);
  const listed = (await res.json()).songs.find((candidate) => candidate.rank === song.rank);
  assert.equal(listed.source, 'override');
  assert.equal(listed.inheritedFrom, from);
  assert.equal(listed.youtubeId, value.youtubeId);
  const host = await player(t, url);
  const room = await host.call('room:create', {});
  await settings(host, { years: [song.year], songCount: 10, skipRule: 'anyone' },
    (state) => state.songCount === 10 && state.years.join() === String(song.year));
  assert.equal((await host.call('game:start')).ok, true);
  const playing = await stateWhen(host, (state) => state?.status === 'playing');
  assert.equal(playing.round.total, 1, '음원이 없다고 확인된 곡은 빼고 지정 영상이 있는 곡만 포함');
  assert.equal(playing.round.year, song.year);
  assert.equal(playing.round.videoId, value.youtubeId);
  assert.equal(playing.round.audioUrl, null);
  assert.equal(playing.round.startSeconds, value.start ?? 0);
  assert.equal((await host.call('chat', song.title)).correct, true);
  const revealed = await stateWhen(host, (state) => state?.status === 'reveal');
  assert.equal(revealed.round.answer.title, song.title);
  assert.equal(revealed.round.winnerId, room.you);
  await skip(host, (state) => state?.status === 'ended');
  assert.equal(host.state.results.ranking[0].score, 10);
  await host.call('room:leave');
});

// 여러 해 차트에 걸친 같은 곡: 셔플은 한 번만, 확인한 음원·음원 파일은 같이 쓰기
// 실행: node test/years.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const charts = require('../server/charts');
const { songKey } = require('../server/answer');

const song = (year, title) => charts.songsOf(year).find((s) => s.title === title);

test('여러 해를 고르면 겹치는 곡은 한 번만, 먼저 오른 해로 나온다', () => {
  for (let i = 0; i < 20; i += 1) {
    const pool = charts.buildPool([2021, 2020]);
    const keys = pool.map(songKey);
    assert.equal(new Set(keys).size, keys.length, '같은 곡이 두 번 들어감');
    assert.equal(pool.find((s) => s.title === 'Dynamite').year, 2020);
  }
  assert.equal(charts.buildPool([2021]).length, 50, '한 해만 고르면 50곡 그대로');
  assert.equal(charts.buildPool([2020, 2021]).length, 100 - charts.songsOf(2021).filter((s) => charts.sameSongs(s).some((o) => o.year === 2020)).length);
});

test('셔플에서 뺀 곡은 다른 해의 같은 곡으로 대신 들어갈 수 있다', () => {
  const dyn2020 = song(2020, 'Dynamite');
  const pool = charts.buildPool([2020, 2021], (s) => s !== dyn2020);
  const dyn = pool.filter((s) => s.title === 'Dynamite');
  assert.equal(dyn.length, 1);
  assert.equal(dyn[0].year, 2021);
});

function loadOverrides(t, initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-years-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'server'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'data', 'overrides.json'), JSON.stringify(initial));
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'server', 'overrides.js'), 'utf8'), {
    module: mod, exports: mod.exports,
    require: (name) => (name === './answer' ? require('../server/answer') : require(name)),
    __dirname: path.join(dir, 'server'),
    process: { env: { GITHUB_FILE: 'no-such-dir/overrides.json' } },
    Buffer, console: { warn() {} }, setTimeout, clearTimeout,
  }, { filename: 'overrides.js' });
  return mod.exports;
}

test('2020년에서 확인한 음원을 2021년 같은 곡에도 쓴다', async (t) => {
  const d20 = song(2020, 'Dynamite');
  const d21 = song(2021, 'Dynamite');
  const b21 = song(2021, 'Butter');
  const key20 = `2020|${require('../server/answer').squash(d20.artist)}|${require('../server/answer').squash(d20.title)}`;
  const overrides = loadOverrides(t, { songs: {
    [key20]: { youtubeId: 'DYN2020xxxx', videoTitle: 'Dynamite (Audio)', videoChannel: 'BTS - Topic', start: 5, title: d20.title, artist: d20.artist, updatedAt: 10 },
  } });

  const got = overrides.get(d21);
  assert.equal(got.youtubeId, 'DYN2020xxxx');
  assert.equal(got.videoTitle, 'Dynamite (Audio)');
  assert.equal(got.start, 5);
  assert.equal(got.inheritedFrom, 2020);
  assert.equal(overrides.get(d20).inheritedFrom, undefined, '원래 해에서는 그대로');
  assert.equal(overrides.get(b21), null, '다른 곡에는 영향 없음');

  // 2021년에서 시작 위치만 바꾸면 영상은 2020년 것을 쓰고 시작 위치만 이 해 설정
  await overrides.set(d21, { start: 9 });
  assert.equal(overrides.get(d21).youtubeId, 'DYN2020xxxx');
  assert.equal(overrides.get(d21).start, 9);

  // 2021년에서 다른 영상을 고르면 그 해는 따로 쓴다
  await overrides.set(d21, { youtubeId: 'DYN2021xxxx' });
  assert.equal(overrides.get(d21).youtubeId, 'DYN2021xxxx');
  assert.equal(overrides.get(d21).inheritedFrom, undefined);
  assert.equal(overrides.get(d20).youtubeId, 'DYN2020xxxx');

  // 그 해 설정을 지우면 다시 2020년 것을 쓴다
  await overrides.set(d21, { youtubeId: null, start: null });
  assert.equal(overrides.get(d21).youtubeId, 'DYN2020xxxx');
});

test('영상 없이 제외한 기존 곡은 추가 연도에서도 제외되고 시작 위치는 유지된다', (t) => {
  const original = song(2025, '너의 모든 순간');
  const added = song(2014, '너의 모든 순간');
  assert.ok(original && added, '기존/추가 차트에 모두 있는 실제 곡으로 검사');
  const { squash } = require('../server/answer');
  const key = (s) => `${s.year}|${squash(s.artist)}|${squash(s.title)}`;
  const overrides = loadOverrides(t, { songs: {
    [key(original)]: { disabled: true, title: original.title, artist: original.artist, updatedAt: 10 },
    [key(added)]: { start: 9, title: added.title, artist: added.artist, updatedAt: 20 },
  } });
  const got = overrides.get(added);
  assert.equal(got.disabled, true, 'youtubeId가 없는 제외 설정도 공유해야 함');
  assert.equal(got.start, 9, '추가 연도에서 지정한 시작 위치는 유지');
  assert.equal(got.youtubeId, undefined, '제외 설정만 있는 곡에 영상 설정을 만들면 안 됨');
  const pool = charts.buildPool([2014], (s) => !(overrides.get(s) || {}).disabled);
  assert.ok(!pool.some((s) => songKey(s) === songKey(original)));
});

test('추가 연도에 별도 영상을 지정해도 기존 제외 설정이 적용되고 모두 활성화하면 해제된다', async (t) => {
  const original = song(2025, '너의 모든 순간');
  const added = song(2014, '너의 모든 순간');
  const other = song(2022, '너의 모든 순간');
  const { squash } = require('../server/answer');
  const key = (s) => `${s.year}|${squash(s.artist)}|${squash(s.title)}`;
  const overrides = loadOverrides(t, { songs: {
    [key(original)]: { youtubeId: 'ORIGINALxxx', disabled: true, start: 5, title: original.title, artist: original.artist, updatedAt: 10 },
    [key(added)]: { youtubeId: 'ADDED2014xx', start: 9, title: added.title, artist: added.artist, updatedAt: 20 },
    [key(other)]: { disabled: true, title: other.title, artist: other.artist, updatedAt: 30 },
  } });
  let got = overrides.get(added);
  assert.equal(got.disabled, true, '추가 연도에 별도 고정 영상이 있어도 제외해야 함');
  assert.equal(got.youtubeId, 'ADDED2014xx');
  assert.equal(got.start, 9);
  assert.equal(got.inheritedFrom, undefined, '자기 연도의 영상은 상속 영상으로 표시하지 않음');
  await overrides.set(original, { disabled: null });
  assert.equal(overrides.get(added).disabled, true, '다른 해에 남아 있는 제외 설정도 반영');
  const copies = [added, ...charts.sameSongs(added)];
  await overrides.setMany(copies.map((s) => [s, { disabled: null }]));
  for (const s of copies) assert.ok(!(overrides.get(s) || {}).disabled, `${s.year}년 제외 설정이 남음`);
  got = overrides.get(added);
  assert.equal(got.youtubeId, 'ADDED2014xx', '활성화해도 별도 고정 영상 유지');
  assert.equal(got.start, 9, '활성화해도 별도 시작 위치 유지');
  assert.equal(overrides.get(original).youtubeId, 'ORIGINALxxx', '기존 해 영상도 유지');
  assert.equal(overrides.get(original).start, 5);
});

test('직접 넣은 음원 파일도 다른 해의 같은 곡에서 같이 쓴다', (t) => {
  const d20 = song(2020, 'Dynamite');
  const d21 = song(2021, 'Dynamite');
  const dir = path.join(ROOT, 'data', 'audio', '2020');
  const file = path.join(dir, `${d20.rank}.mp3`);
  if (fs.existsSync(file) || charts.audioFileFor(d21)) return t.skip('이 PC에 실제 음원 파일이 있어 건너뜀');
  const madeDir = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, '');
  t.after(() => { fs.rmSync(file, { force: true }); if (madeDir) fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(charts.audioFileFor(d21), file);
  assert.equal(charts.audioFileFor(song(2021, 'Butter')), null);
});

// 유튜브 음원 고르기: 가사 영상 1순위 → 음원 전용 채널(Topic) → Official Audio, 뮤직비디오·변형 버전 제외
// 실행: node test/youtube.test.js (인터넷 없이 점수 계산만 확인)
const assert = require('node:assert/strict');
const { test } = require('node:test');
const yt = require('../server/youtube');

const v = (title, channel, seconds = 200) => ({ id: title.slice(0, 11).padEnd(11, 'x'), title, channel, seconds });
const pinkVenom = { year: 2022, rank: 36, title: 'Pink Venom', artist: 'BLACKPINK' };

test('가수가 맞는 가사 영상이 음원 전용 채널보다 먼저', () => {
  const ranked = yt.scoreAll(pinkVenom, [
    v('Pink Venom', 'BLACKPINK - Topic'),
    v("BLACKPINK - 'Pink Venom' M/V", 'BLACKPINK'),
    v('BLACKPINK - Pink Venom (Official Audio)', 'BLACKPINK'),
    v('BLACKPINK - Pink Venom Lyrics (Color Coded Lyrics)', 'Bias Lyrics'),
  ]);
  assert.equal(ranked[0].title, 'BLACKPINK - Pink Venom Lyrics (Color Coded Lyrics)');
  assert.equal(ranked[0].lyric, true);
  assert.equal(ranked[1].channel, 'BLACKPINK - Topic');
  assert.equal(ranked.find((c) => c.title.includes('M/V')).ok, false, '뮤직비디오는 후보에서 제외');
});

test('한글 가사 영상([가사])도 1순위', () => {
  const song = { year: 2017, rank: 18, title: '선물', artist: '멜로망스' };
  const ranked = yt.scoreAll(song, [v('선물', 'MeloMance - Topic', 250), v('멜로망스 - 선물 [가사]', '어느 채널', 250)]);
  assert.equal(ranked[0].title, '멜로망스 - 선물 [가사]');
});

test('가수가 다른 가사 영상(같은 제목의 다른 노래)은 음원 전용 채널보다 뒤', () => {
  const song = { year: 2018, rank: 7, title: '선물', artist: '멜로망스' };
  const ranked = yt.scoreAll(song, [v('[가사] 선물 - 다른가수', 'x', 230), v('선물', 'MeloMance - Topic', 250)]);
  assert.equal(ranked[0].channel, 'MeloMance - Topic');
});

test('빠르게·느리게·라이브·커버·다른 언어 버전 가사 영상은 쓰지 않는다', () => {
  for (const title of [
    'BLACKPINK - Pink Venom (sped up) lyrics', 'BLACKPINK - Pink Venom slowed + reverb lyrics',
    'BLACKPINK Pink Venom LIVE 가사', 'Pink Venom cover lyrics BLACKPINK', 'BLACKPINK - Pink Venom (Japanese Ver.) Lyrics',
    'BLACKPINK - Pink Venom 1 HOUR lyrics', 'BLACKPINK - Pink Venom 8D AUDIO lyrics',
  ]) {
    const [c] = yt.scoreAll(pinkVenom, [v(title, 'BLACKPINK')]);
    assert.equal(c.ok, false, title);
  }
});

test('노래 제목에 들어 있는 단어는 감점하지 않는다 (instagram의 inst, Alive의 live)', () => {
  const [ig] = yt.scoreAll({ title: 'instagram', artist: 'DEAN' }, [v('DEAN - instagram (Lyrics)', 'x')]);
  assert.equal(ig.ok, true);
  const [alive] = yt.scoreAll({ title: 'Alive', artist: 'BIGBANG (빅뱅)' }, [v('BIGBANG - Alive lyrics', 'x')]);
  assert.equal(alive.ok, true);
});

test('검색 순서: 가사(영어) → 가사(한국어) → 음원 채널, 좋은 가사 영상이 나오면 멈춤', async () => {
  const song = { year: 2021, rank: 2, title: "롤린 (Rollin')", artist: '브레이브걸스' };
  assert.deepEqual(yt.searchQueries(song), ['Brave Girls 롤린 lyrics', '브레이브걸스 롤린 가사', 'Brave Girls 롤린 topic']);
  const asked = [];
  const found = await yt.collect(song, async (q) => {
    asked.push(q);
    return q.endsWith('lyrics') ? [v('브레이브걸스 - 롤린 (Rollin\') Lyrics', 'x')] : [v('롤린', 'Brave Girls - Topic')];
  });
  assert.equal(asked.length, 1, '첫 검색에서 멈춰야 함');
  assert.equal(found.length, 1);

  const asked2 = [];
  await yt.collect(song, async (q) => { asked2.push(q); return [v('롤린', 'Brave Girls - Topic')]; });
  assert.equal(asked2.length, 3, '가사 영상이 없으면 세 번 모두 검색');
});

test('검색 방식이 바뀌어 예전 기록(버전 3)은 다시 검색 대상', () => {
  assert.ok(yt.CACHE_VERSION >= 4);
});

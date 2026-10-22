// 곡 → 유튜브 영상 ID 찾기 (캐시 저장)
// 뮤직비디오 대신 '노래가 바로 시작하는 음원 버전'을 고른다.
//  - 1순위: 음반사가 올린 음원 전용 영상 (채널 이름이 "가수 - Topic")
//  - 2순위: Official Audio / 음원 영상
//  - 뮤직비디오·티저·무대·커버 등은 후보에서 뺀다
// 찾는 순서: 데이터 파일의 youtubeId → data/youtube-cache.json → 검색
//           (YT_API_KEY가 있으면 YouTube Data API, 없으면 yt-search)
const fs = require('fs');
const path = require('path');
const { squash, stripExtras } = require('./answer');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'youtube-cache.json');
const CACHE_VERSION = 2; // 뮤직비디오를 고르던 예전 캐시는 무시
const API_KEY = process.env.YT_API_KEY || '';

// 유튜브 음원 채널은 영문 이름이 많아서, 한글 가수명과 함께 비교한다
const ARTIST_EN = {
  미쓰에이: 'miss A', 아이유: 'IU', MC몽: 'MC Mong', 포맨: '4MEN', 소녀시대: "Girls' Generation",
  원더걸스: 'Wonder Girls', 티아라: 'T-ARA', 카라: 'KARA', 다비치: 'DAVICHI', 이승기: 'Lee Seung Gi',
  뜨거운감자: 'Kim C', 애프터스쿨: 'AFTERSCHOOL', 시크릿: 'SECRET', 현아: 'HyunA', 강승윤: 'Kang Seung Yoon',
  서인영: 'Seo In Young', 비: 'RAIN', 가인: 'Gain', 조권: 'Jo Kwon', 디셈버: 'DECEMBER', 먼데이키즈: 'Monday Kiz',
  비스트: 'BEAST', 바이브: 'VIBE', 서영은: 'Seo Young Eun', 태양: 'TAEYANG', 씨야: 'SeeYa', 지나: 'G.NA',
  씨스타: 'SISTAR', 빅뱅: 'BIGBANG', 샤이니: 'SHINee', 슈퍼주니어: 'Super Junior', 투애니원: '2NE1',
  씨엔블루: 'CNBLUE', 에프티아일랜드: 'FTISLAND', 브라운아이드걸스: 'Brown Eyed Girls', 포미닛: '4MINUTE',
  엠블랙: 'MBLAQ', 인피니트: 'INFINITE', 에이핑크: 'Apink', 걸스데이: "Girl's Day", 버스커버스커: 'Busker Busker',
  악동뮤지션: 'AKMU', 방탄소년단: 'BTS', 트와이스: 'TWICE', 레드벨벳: 'Red Velvet', 엑소: 'EXO', 마마무: 'MAMAMOO',
  백지영: 'Baek Ji Young', 김범수: 'Kim Bum Soo', 허각: 'Huh Gak', 케이윌: 'K.will', 에일리: 'Ailee',
};

let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch {
  cache = {};
}

let saveTimer = null;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), () => {});
  }, 500);
}

const keyOf = (song) => `${squash(song.artist)}|${squash(song.title)}`;

/** "소녀시대 (GIRLS' GENERATION)", "MC몽, 서인영" → 비교용 이름 조각들 */
function artistNames(artist) {
  const parts = String(artist).split(/[(),&]|feat\.?/i).map((x) => x.trim()).filter(Boolean);
  const names = new Set();
  for (const part of parts) {
    names.add(part);
    const en = ARTIST_EN[part.replace(/\s+/g, '')];
    if (en) names.add(en);
  }
  return [...names].map(squash).filter((n) => n.length >= 2);
}

const MV_WORDS = [
  'mv', 'm/v', '뮤직비디오', 'musicvideo', 'officialvideo', 'teaser', '티저', 'performance', '퍼포먼스',
  'dancepractice', '안무', 'live', '라이브', 'stage', '무대', '교차편집', 'cover', '커버', 'reaction', '리액션',
  'remix', 'inst', 'karaoke', '노래방', '1시간', '1hour', '반복', 'spedup', 'nightcore', 'piano', '피아노',
  'fancam', '직캠', 'shorts', 'behind', '비하인드', 'making', '메이킹', 'mr제거', 'acapella',
];

function scoreCandidate(song, video) {
  const title = squash(video.title);
  const raw = String(video.title).toLowerCase();
  const channel = squash(video.channel || '');
  const isTopic = /-\s*topic$/i.test(String(video.channel || '').trim());
  const want = squash(stripExtras(song.title)) || squash(song.title);
  const names = artistNames(song.artist);

  let score = 0;
  if (title.includes(want)) score += 6; else score -= 6;
  if (isTopic) score += 10; // 음원 전용 영상: 영상 없이 노래가 바로 시작
  if (names.some((n) => channel.includes(n) || title.includes(n))) score += 4;
  if (/official\s*audio|audio|음원|lyric/i.test(raw)) score += 2;
  const compact = raw.replace(/\s+/g, '');
  for (const w of MV_WORDS) {
    // 노래 제목 자체에 들어 있는 단어(예: Alive의 live)는 감점하지 않는다
    if (compact.includes(w) && !want.includes(squash(w))) score -= 8;
  }
  if (video.seconds) {
    if (video.seconds >= 120 && video.seconds <= 420) score += 2;
    else score -= 4;
  }
  return score;
}

function queryParts(song) {
  const title = stripExtras(song.title) || song.title;
  const first = String(song.artist).split(/[(),&]/)[0].trim();
  const en = ARTIST_EN[first.replace(/\s+/g, '')];
  return { title, artist: en || first, artistKo: first };
}

async function searchWithYtSearch(song) {
  const yts = require('yt-search');
  const { title, artist, artistKo } = queryParts(song);
  const queries = [`${artist} ${title} topic`, `${artistKo} ${title} audio`];
  const seen = new Map();
  for (const q of queries) {
    const result = await yts({ query: q, hl: 'ko', gl: 'KR' });
    for (const v of (result.videos || []).slice(0, 15)) {
      if (!seen.has(v.videoId)) {
        seen.set(v.videoId, { id: v.videoId, title: v.title, seconds: v.seconds, channel: v.author && v.author.name });
      }
    }
    // 첫 검색에서 음원 전용 영상을 찾았으면 두 번째 검색은 생략
    if ([...seen.values()].some((v) => scoreCandidate(song, v) >= 14)) break;
  }
  return [...seen.values()];
}

async function searchWithApi(song) {
  const { title, artist } = queryParts(song);
  const q = encodeURIComponent(`${artist} ${title} topic`);
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=15&regionCode=KR&q=${q}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((it) => ({
    id: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    seconds: null,
  }));
}

/**
 * 후보를 점수순으로 정렬 (같은 점수면 유튜브 검색 순서 유지)
 * 음원 버전이 하나도 없을 때만 뮤직비디오를 마지막 대안으로 남긴다.
 */
function rank(song, videos) {
  const scored = videos
    .map((v, i) => ({ ...v, i, score: scoreCandidate(song, v) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const audio = scored.filter((v) => v.score > 4);
  const fallback = audio.length ? [] : scored.filter((v) => v.score >= 2).slice(0, 2);
  return [...audio, ...fallback].map((v) => v.id);
}

const inflight = new Map();

/** 재생 가능한 후보 영상 ID 하나를 돌려준다. 없으면 null */
async function resolveVideo(song) {
  if (song.youtubeId) return song.youtubeId;

  const key = keyOf(song);
  const entry = cache[key] && cache[key].v === CACHE_VERSION ? cache[key] : null;
  if (entry) {
    const usable = entry.candidates.filter((id) => !entry.bad.includes(id));
    if (usable.length) return usable[0];
    if (entry.exhausted) return null;
  }

  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    try {
      const videos = API_KEY ? await searchWithApi(song) : await searchWithYtSearch(song);
      const ranked = rank(song, videos);
      const prevBad = entry ? entry.bad : [];
      cache[key] = { v: CACHE_VERSION, candidates: ranked.slice(0, 5), bad: prevBad, exhausted: ranked.length === 0 };
      saveCache();
      const usable = cache[key].candidates.filter((id) => !prevBad.includes(id));
      return usable[0] || null;
    } catch (err) {
      console.warn(`[youtube] "${song.artist} - ${song.title}" 검색 실패: ${err.message}`);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

/** 클라이언트가 재생 불가(삭제·퍼가기 금지)를 알리면 다음 후보로 넘긴다 */
function markBad(song, videoId) {
  const key = keyOf(song);
  const entry = cache[key] && cache[key].v === CACHE_VERSION
    ? cache[key]
    : { v: CACHE_VERSION, candidates: [], bad: [] };
  if (!entry.bad.includes(videoId)) entry.bad.push(videoId);
  cache[key] = entry;
  saveCache();
  const usable = entry.candidates.filter((id) => !entry.bad.includes(id));
  return usable[0] || null;
}

module.exports = { resolveVideo, markBad, scoreCandidate, rank, artistNames, queryParts };

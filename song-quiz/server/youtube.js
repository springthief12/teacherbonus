// 곡 → 유튜브 영상 ID 찾기 (캐시 저장)
// 1순위: 데이터 파일의 youtubeId
// 2순위: data/youtube-cache.json
// 3순위: YT_API_KEY가 있으면 YouTube Data API, 없으면 yt-search(키 없이 검색)
const fs = require('fs');
const path = require('path');
const { squash } = require('./answer');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'youtube-cache.json');
const API_KEY = process.env.YT_API_KEY || '';

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

const BAD_WORDS = [
  'dancepractice', '안무', 'live', '라이브', 'cover', '커버', 'reaction', '리액션',
  '교차편집', 'stage', '무대', '1시간', '1hour', '반복', 'karaoke', '노래방', 'inst',
  'piano', '피아노', 'remix', 'spedup', 'nightcore', 'teaser', '티저', 'behind', '비하인드',
  'shorts', 'fancam', '직캠', 'lyrics', '가사',
];

function scoreCandidate(song, video) {
  const t = squash(video.title);
  let score = 0;
  if (t.includes(squash(song.title.replace(/\(.*?\)/g, '')))) score += 5;
  if (t.includes(squash(song.artist))) score += 3;
  if (/official|mv|m\/v|뮤직비디오|audio/i.test(video.title)) score += 2;
  for (const w of BAD_WORDS) if (t.includes(w)) score -= 4;
  if (video.seconds) {
    if (video.seconds >= 120 && video.seconds <= 420) score += 2;
    else score -= 3;
  }
  return score;
}

async function searchWithYtSearch(song) {
  const yts = require('yt-search');
  const result = await yts({ query: `${song.artist} ${song.title} MV`, hl: 'ko', gl: 'KR' });
  return (result.videos || []).slice(0, 12).map((v) => ({
    id: v.videoId,
    title: v.title,
    seconds: v.seconds,
  }));
}

async function searchWithApi(song) {
  const q = encodeURIComponent(`${song.artist} ${song.title} MV`);
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=10&regionCode=KR&q=${q}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((it) => ({
    id: it.id.videoId,
    title: it.snippet.title,
    seconds: null,
  }));
}

const inflight = new Map();

/** 재생 가능한 후보 영상 ID 하나를 돌려준다. 없으면 null */
async function resolveVideo(song) {
  if (song.youtubeId) return song.youtubeId;

  const key = keyOf(song);
  const entry = cache[key];
  if (entry) {
    const usable = entry.candidates.filter((id) => !entry.bad.includes(id));
    if (usable.length) return usable[0];
    if (entry.exhausted) return null;
  }

  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    try {
      const videos = API_KEY ? await searchWithApi(song) : await searchWithYtSearch(song);
      const ranked = videos
        .map((v) => ({ ...v, score: scoreCandidate(song, v) }))
        .filter((v) => v.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((v) => v.id);
      const prevBad = entry ? entry.bad : [];
      cache[key] = { candidates: ranked.slice(0, 5), bad: prevBad, exhausted: ranked.length === 0 };
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
  const entry = cache[key] || { candidates: [], bad: [] };
  if (!entry.bad.includes(videoId)) entry.bad.push(videoId);
  cache[key] = entry;
  saveCache();
  const usable = entry.candidates.filter((id) => !entry.bad.includes(id));
  return usable[0] || null;
}

module.exports = { resolveVideo, markBad };

// 곡 → 유튜브 영상 ID 찾기 (캐시 저장)
// 뮤직비디오 대신 '노래가 바로 시작하는 음원 버전'을 고른다.
//  - 1순위: 음반사가 올린 음원 전용 영상 (채널 이름이 "가수 - Topic")
//  - 2순위: Official Audio / 음원 영상
//  - 뮤직비디오·티저·무대·커버 등은 후보에서 뺀다
// 찾는 순서: 데이터 파일의 youtubeId → data/youtube-cache.json → 검색
//           (YT_API_KEY가 있으면 YouTube Data API, 없으면 yt-search)
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { squash, stripExtras } = require('./answer');
const overrides = require('./overrides');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'youtube-cache.json');
const CACHE_VERSION = 3; // 후보 정보(제목·채널)까지 저장하는 형식
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
  노을: 'Noel', 리쌍: 'LeeSSang', 울랄라세션: 'Ulala Session', 박봄: 'Park Bom', 마이티마우스: 'Mighty Mouth',
  이현: 'Lee Hyun', 송지은: 'Song Ji Eun', 씨스타19: 'SISTAR19', 처진달팽이: 'Sagging Snail', 투개월: 'Two Month',
  지코: 'ZICO', 창모: 'CHANGMO', 조정석: 'Jo Jung Suk', 장범준: 'Jang Beom June', 가호: 'Gaho', 엠씨더맥스: 'M.C the MAX',
  오마이걸: 'OH MY GIRL', 마크툽: 'MAKTUB', 블루: 'BLOO', 화사: 'Hwa Sa', 오반: 'OVAN', 폴킴: 'Paul Kim', 싹쓰리: 'SSAK3',
  전미도: 'Jeon Mi Do', 김필: 'Kim Feel', 산들: 'SANDEUL', 신예영: 'Shin Yeyoung', 조이: 'JOY', 백현: 'BAEKHYUN',
  볼빨간사춘기: 'BOL4', 백예린: 'Yerin Baek', 제시: 'Jessi', 하현우: 'Ha Hyun Woo', 스탠딩에그: 'Standing Egg',
  전상근: 'Jeon Sang Keun', 진민호: 'Jin Min Ho', 아이즈원: 'IZ*ONE', 염따: 'YUMDDA', 임재현: 'Lim Jae Hyun',
  브레이브걸스: 'Brave Girls', 이무진: 'Lee Mu Jin', MSG워너비: 'MSG Wannabe', 헤이즈: 'Heize', 미란이: 'Mirani',
  양요섭: 'Yang Yoseob', 적재: 'Jukjae', SG워너비: 'SG Wannabe', 호미들: 'Homies', 태연: 'TAEYEON', 정동하: 'Jung Dong Ha',
  디핵: 'D-Hack', 임영웅: 'Lim Young Woong', 로제: 'ROSÉ', 임창정: 'Lim Chang Jung',
  제니: 'JENNIE', 로이킴: 'Roy Kim', 이창섭: 'Lee Changsub', 이클립스: 'ECLIPSE', 우디: 'Woody', 너드커넥션: 'Nerd Connection',
  성시경: 'Sung Si Kyung', 잔나비: 'JANNABI', 아일릿: 'ILLIT', 멜로망스: 'MeloMance', 박재정: 'Parc Jae Jung',
  장덕철: 'Jang Deok Cheol', 닐로: 'Nilo', 로꼬: 'Loco', 이수: 'Lee Soo', 양다일: 'Yang Da Il', 문문: 'MoonMoon',
  길구봉구: 'Gilgu Bonggu', 펀치: 'Punch', 김하온: 'HAON', 용준형: 'Yong Jun Hyung', 박원: 'Park Won', 선미: 'SUNMI',
  청하: 'CHUNG HA', 숀: 'SHAUN', 모모랜드: 'MOMOLAND', 윤종신: 'Yoon Jong Shin', 벤: 'Ben', 비투비: 'BTOB', 여자친구: 'GFRIEND',
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

// ---------- 검색은 작업 스레드에서 (게임 진행이 멈추지 않게) ----------
let worker = null;
let workerBroken = false;
let seq = 0;
const waiting = new Map(); // id -> { resolve, reject, timer }
const SEARCH_TIMEOUT_MS = 25000;

function failAll(err) {
  for (const job of waiting.values()) { clearTimeout(job.timer); job.reject(err); }
  waiting.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'yt-worker.js'));
  worker.unref(); // 검색 스레드 때문에 서버가 안 꺼지는 일이 없게
  worker.on('message', ({ id, videos, error }) => {
    const job = waiting.get(id);
    if (!job) return;
    waiting.delete(id);
    clearTimeout(job.timer);
    if (error) job.reject(new Error(error)); else job.resolve({ videos });
  });
  worker.on('error', (err) => {
    console.warn(`[youtube] 검색 스레드 오류: ${err.message}`);
    worker = null;
    failAll(err);
  });
  worker.on('exit', () => { worker = null; failAll(new Error('검색 스레드가 종료됨')); });
  return worker;
}

function ytsearch(query) {
  if (!workerBroken) {
    try {
      const w = getWorker();
      return new Promise((resolve, reject) => {
        seq += 1;
        const id = seq;
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error('검색 시간 초과')); }, SEARCH_TIMEOUT_MS);
        waiting.set(id, { resolve, reject, timer });
        w.postMessage({ id, query });
      });
    } catch (err) {
      workerBroken = true; // 작업 스레드를 못 쓰는 환경이면 예전처럼 같은 스레드에서
      console.warn(`[youtube] 검색 스레드를 못 띄워 기본 방식으로 검색: ${err.message}`);
    }
  }
  return require('yt-search')({ query, hl: 'ko', gl: 'KR' });
}

async function searchWithYtSearch(song) {
  const { title, artist, artistKo } = queryParts(song);
  const queries = [`${artist} ${title} topic`, `${artistKo} ${title} audio`];
  const seen = new Map();
  for (const q of queries) {
    const result = await ytsearch(q);
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

/** 후보에 점수를 매겨 정렬 (같은 점수면 유튜브 검색 순서 유지) */
function scoreAll(song, videos) {
  return videos
    .map((v, i) => ({ ...v, i, score: scoreCandidate(song, v) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ i, ...v }) => ({ ...v, ok: v.score > 4 }));
}

/** 음원 버전으로 인정되는 후보 ID만 (뮤직비디오는 대안으로도 쓰지 않음) */
function rank(song, videos) {
  return scoreAll(song, videos).filter((v) => v.ok).map((v) => v.id);
}

const inflight = new Map();
const cacheEntry = (song) => {
  const e = cache[keyOf(song)];
  return e && e.v === CACHE_VERSION ? e : null;
};

/** 검색을 실제로 돌려 후보 전체(점수·정보 포함)를 돌려주고 캐시에 저장 */
async function searchCandidates(song) {
  const key = keyOf(song);
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const videos = API_KEY ? await searchWithApi(song) : await searchWithYtSearch(song);
    const scored = scoreAll(song, videos);
    const prev = cacheEntry(song);
    cache[key] = {
      v: CACHE_VERSION,
      candidates: scored.slice(0, 10),
      bad: prev ? prev.bad : [],
      checkedAt: Date.now(),
    };
    saveCache();
    return scored;
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

function usableFromCache(entry) {
  if (!entry) return undefined; // 아직 검사 안 함
  const ok = entry.candidates.filter((c) => c.ok && !entry.bad.includes(c.id));
  return ok.length ? ok[0].id : null; // null: 검사했지만 쓸 만한 음원 없음
}

/** 재생할 영상 ID. 없으면 null (→ 셔플에서 제외) */
async function resolveVideo(song) {
  const o = overrides.get(song);
  if (o && o.youtubeId) return o.youtubeId; // 관리자가 고른 영상
  if (song.youtubeId) return song.youtubeId; // 차트 파일에 적힌 영상

  const cached = usableFromCache(cacheEntry(song));
  if (cached !== undefined) return cached;
  try {
    await searchCandidates(song);
    return usableFromCache(cacheEntry(song)) || null;
  } catch (err) {
    console.warn(`[youtube] "${song.artist} - ${song.title}" 검색 실패: ${err.message}`);
    return null;
  }
}

/** 검사 결과 이미 '쓸 만한 음원 없음'으로 확인된 곡인지 (셔플 전에 미리 제외) */
function knownMissing(song) {
  const o = overrides.get(song);
  if (o && o.youtubeId) return false;
  if (song.youtubeId) return false;
  return usableFromCache(cacheEntry(song)) === null;
}

/** 관리자 페이지용 현재 상태 */
function status(song) {
  const o = overrides.get(song);
  const entry = cacheEntry(song);
  const auto = usableFromCache(entry);
  let source = 'unchecked';
  let youtubeId = null;
  if (o && o.youtubeId) { source = 'override'; youtubeId = o.youtubeId; }
  else if (song.youtubeId) { source = 'data'; youtubeId = song.youtubeId; }
  else if (auto) { source = 'search'; youtubeId = auto; }
  else if (auto === null) source = 'missing';
  const current = entry && entry.candidates.find((c) => c.id === youtubeId);
  const pinned = source === 'override' ? o : null; // 확인할 때 저장해 둔 영상 정보
  return {
    source,
    youtubeId,
    videoTitle: current ? current.title : (pinned && pinned.videoTitle) || null,
    videoChannel: current ? current.channel : (pinned && pinned.videoChannel) || null,
    checkedAt: entry ? entry.checkedAt : null,
    candidates: entry ? entry.candidates : [],
    bad: entry ? entry.bad : [],
  };
}

/** 클라이언트가 재생 불가(삭제·퍼가기 금지)를 알리면 다음 후보로 넘긴다 */
function markBad(song, videoId) {
  const key = keyOf(song);
  const entry = cacheEntry(song) || { v: CACHE_VERSION, candidates: [], bad: [], checkedAt: Date.now() };
  if (!entry.bad.includes(videoId)) entry.bad.push(videoId);
  cache[key] = entry;
  saveCache();
  const o = overrides.get(song);
  if (o && o.youtubeId === videoId) return null; // 관리자가 고른 영상이 막혔으면 관리자 확인 필요
  return usableFromCache(entry) || null;
}

/** 관리자가 '재생 불가' 표시를 지울 때 */
function clearBad(song) {
  const entry = cacheEntry(song);
  if (entry) { entry.bad = []; saveCache(); }
}

module.exports = {
  resolveVideo, markBad, clearBad, searchCandidates, knownMissing, status,
  scoreCandidate, rank, artistNames, queryParts,
};

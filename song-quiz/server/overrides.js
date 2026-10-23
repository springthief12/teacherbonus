// 관리자가 고친 곡별 설정 (유튜브 영상, 시작 위치, 셔플 제외)
// - 기본: data/overrides.json 에 저장 (교실 PC에서 실행하면 그대로 남음)
// - 선택: GITHUB_TOKEN과 GITHUB_REPO를 설정하면 깃허브 저장소에도 저장해서
//         Render처럼 다시 시작하면 파일이 지워지는 서버에서도 유지된다.
const fs = require('fs');
const path = require('path');
const { squash, songKey } = require('./answer');

const FILE = path.join(__dirname, '..', 'data', 'overrides.json');
const GH = {
  token: process.env.GITHUB_TOKEN || '',
  repo: process.env.GITHUB_REPO || '', // 예: springthief12/teacherbonus
  branch: process.env.GITHUB_BRANCH || 'master',
  // song-quiz 폴더 밖에 두어야 저장할 때마다 Render가 다시 배포하지 않는다
  file: process.env.GITHUB_FILE || 'song-quiz-data/overrides.json',
};
const githubOn = () => Boolean(GH.token && GH.repo);

let store = { songs: {} };
let remoteSha = null;
let status = { lastSave: null, lastError: null, remote: githubOn() ? 'loading' : 'off' };

const keyOf = (song) => `${song.year}|${squash(song.artist)}|${squash(song.title)}`;

function readLocal() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (data && typeof data.songs === 'object') return data;
  } catch { /* 파일 없음 */ }
  return { songs: {} };
}

function merge(a, b) {
  const out = { songs: { ...a.songs } };
  for (const [k, v] of Object.entries(b.songs || {})) {
    if (!out.songs[k] || (v.updatedAt || 0) > (out.songs[k].updatedAt || 0)) out.songs[k] = v;
  }
  return out;
}

async function gh(method, body) {
  const url = `https://api.github.com/repos/${GH.repo}/contents/${GH.file}${method === 'GET' ? `?ref=${encodeURIComponent(GH.branch)}` : ''}`;
  const res = await fetch(url, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${GH.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'song-quiz',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function loadRemote() {
  if (!githubOn()) return;
  try {
    const res = await gh('GET');
    if (res.status === 404) { status.remote = 'ready'; return; }
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const json = await res.json();
    remoteSha = json.sha;
    const remote = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
    store = merge(store, remote);
    sharedIndex = null;
    status.remote = 'ready';
  } catch (err) {
    status.remote = 'error';
    status.lastError = `깃허브에서 불러오기 실패: ${err.message}`;
    console.warn(`[overrides] ${status.lastError}`);
  }
}

// 저장 요청을 순서대로 처리해 이전 요청의 GitHub SHA와 내용이 서로 엇갈리지 않게 한다.
let writeQueue = Promise.resolve();

async function saveLocal() {
  try {
    await fs.promises.writeFile(FILE, `${JSON.stringify(store, null, 2)}\n`);
  } catch (err) {
    status.lastError = `파일 저장 실패: ${err.message}`;
    throw new Error(status.lastError);
  }
}

async function pushRemote(attempt = 0, reapply) {
  if (!githubOn()) return;
  status.remote = 'saving';
  try {
    const content = Buffer.from(`${JSON.stringify(store, null, 2)}\n`).toString('base64');
    const res = await gh('PUT', {
      message: 'song-quiz: 관리자 페이지에서 음원 설정 수정',
      content,
      branch: GH.branch,
      ...(remoteSha ? { sha: remoteSha } : {}),
    });
    if ((res.status === 409 || res.status === 422) && attempt < 2) {
      await loadRemote(); // 다른 곳에서 바뀌었으면 합쳐서 다시
      // 마지막 설정을 지운 요청도 원격 병합으로 되살아나지 않도록 다시 적용한다.
      reapply();
      await saveLocal();
      return pushRemote(attempt + 1, reapply);
    }
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const json = await res.json();
    remoteSha = json.content && json.content.sha;
    status.lastSave = Date.now();
    status.lastError = null;
    status.remote = 'ready';
  } catch (err) {
    status.lastError = `깃허브 저장 실패: ${err.message}`;
    status.remote = 'error';
    console.warn(`[overrides] ${status.lastError}`);
    throw new Error(status.lastError);
  }
}

// 다른 해 차트의 같은 곡에서 확인해 둔 음원 (곡 열쇠 → 가장 최근에 고친 설정)
let sharedIndex = null;
let sharedDisabled = new Set();
function shared() {
  if (sharedIndex) return sharedIndex;
  sharedIndex = new Map();
  sharedDisabled = new Set();
  for (const [key, v] of Object.entries(store.songs)) {
    if (!v || !v.title || !v.artist) continue;
    const k = songKey(v);
    // 차트에 새 연도가 추가되어도 기존에 제외한 같은 곡은 다시 출제하지 않는다.
    // 영상 링크 없이 비활성화만 저장한 곡도 포함한다.
    if (v.disabled) sharedDisabled.add(k);
    if (!v.youtubeId) continue;
    const prev = sharedIndex.get(k);
    if (!prev || (v.updatedAt || 0) > (prev.updatedAt || 0)) sharedIndex.set(k, { ...v, year: Number(key.split('|')[0]), key });
  }
  return sharedIndex;
}

function get(song) {
  const key = keyOf(song);
  const own = store.songs[key] || null;
  const commonKey = songKey(song);
  // 2020년에서 확인한 "Dynamite"를 2021년 "Dynamite"에도 그대로 쓴다 (다시 확인하지 않아도 됨)
  const from = shared().get(commonKey);
  const current = ((own && own.youtubeId) || !from || from.key === key) ? own : {
    ...(own || {}),
    youtubeId: from.youtubeId,
    videoTitle: from.videoTitle,
    videoChannel: from.videoChannel,
    start: own && own.start !== undefined ? own.start : from.start,
    inheritedFrom: from.year,
  };
  // 그 해에 별도 영상을 고른 경우에도 다른 해에서 제외한 설정은 함께 적용한다.
  if (sharedDisabled.has(commonKey) && !(current && current.disabled)) return { ...(current || {}), disabled: true };
  return current;
}

/** patch: { youtubeId?, start?, disabled?, videoTitle?, videoChannel? } (null이면 지움)
 *  youtubeId가 있으면 '확인한 곡': 이 영상으로 고정되고 다시 검색하지 않는다 */
function applyOne(song, patch) {
  const key = keyOf(song);
  const cur = { ...(store.songs[key] || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') delete cur[k];
    else cur[k] = v;
  }
  cur.title = song.title;
  cur.artist = song.artist;
  cur.updatedAt = Date.now();
  const meaningful = ['youtubeId', 'start', 'disabled'].some((k) => cur[k] !== undefined);
  if (meaningful) store.songs[key] = cur;
  else delete store.songs[key];
}

/** 여러 곡을 한 번에 고친다 (파일·깃허브 저장도 한 번). items: [[song, patch], ...] */
function setMany(items) {
  const pending = writeQueue.catch(() => {}).then(async () => {
    await ready;
    const apply = () => {
      for (const [song, patch] of items) applyOne(song, patch);
      sharedIndex = null;
    };
    apply();
    // 원격 저장에 실패해도 내려받거나 다시 저장할 수 있도록 로컬 수정은 남긴다.
    await saveLocal();
    if (githubOn()) await pushRemote(0, apply);
    else { status.lastSave = Date.now(); status.lastError = null; }
    return items.map(([song]) => store.songs[keyOf(song)] || null);
  });
  writeQueue = pending;
  return pending;
}

function set(song, patch) {
  return setMany([[song, patch]]).then((saved) => saved[0]);
}

function exportAll() {
  return store;
}

function info() {
  return {
    github: githubOn(),
    repo: githubOn() ? `${GH.repo} (${GH.file})` : null,
    // Render 같은 서버는 다시 시작하면 파일이 사라진다
    ephemeral: Boolean(process.env.RENDER) && !githubOn(),
    ...status,
  };
}

// 저장소에 함께 들어 있는 설정(song-quiz-data/overrides.json)도 처음에 읽어 둔다
function readRepoCopy() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', GH.file), 'utf8'));
    if (data && typeof data.songs === 'object') return data;
  } catch { /* 없음 */ }
  return { songs: {} };
}

store = merge(readRepoCopy(), readLocal());
const ready = loadRemote();

module.exports = { get, set, setMany, keyOf, exportAll, info, ready };

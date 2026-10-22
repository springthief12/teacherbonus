// 관리자가 고친 곡별 설정 (유튜브 영상, 시작 위치, 셔플 제외)
// - 기본: data/overrides.json 에 저장 (교실 PC에서 실행하면 그대로 남음)
// - 선택: GITHUB_TOKEN과 GITHUB_REPO를 설정하면 깃허브 저장소에도 저장해서
//         Render처럼 다시 시작하면 파일이 지워지는 서버에서도 유지된다.
const fs = require('fs');
const path = require('path');
const { squash } = require('./answer');

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
    status.remote = 'ready';
  } catch (err) {
    status.remote = 'error';
    status.lastError = `깃허브에서 불러오기 실패: ${err.message}`;
    console.warn(`[overrides] ${status.lastError}`);
  }
}

let localTimer = null;
let remoteTimer = null;

function saveLocal() {
  clearTimeout(localTimer);
  localTimer = setTimeout(() => {
    fs.writeFile(FILE, `${JSON.stringify(store, null, 2)}\n`, (err) => {
      if (err) status.lastError = `파일 저장 실패: ${err.message}`;
    });
  }, 300);
}

async function pushRemote(attempt = 0) {
  if (!githubOn()) return;
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
      return pushRemote(attempt + 1);
    }
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const json = await res.json();
    remoteSha = json.content && json.content.sha;
    status.lastSave = Date.now();
    status.lastError = null;
  } catch (err) {
    status.lastError = `깃허브 저장 실패: ${err.message}`;
    console.warn(`[overrides] ${status.lastError}`);
  }
}

function scheduleRemote() {
  if (!githubOn()) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => pushRemote(), 1500);
}

function get(song) {
  return store.songs[keyOf(song)] || null;
}

/** patch: { youtubeId?, start?, disabled? } (null이면 지움) */
function set(song, patch) {
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
  saveLocal();
  scheduleRemote();
  if (!githubOn()) status.lastSave = Date.now();
  return store.songs[key] || null;
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

module.exports = { get, set, keyOf, exportAll, info, ready };

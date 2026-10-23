// 연도별 차트 데이터 로더 (data/charts/<연도>.json)
const fs = require('fs');
const path = require('path');
const { songKey } = require('./answer');

const CHART_DIR = path.join(__dirname, '..', 'data', 'charts');

// 이 게임에서 다루는 연도 범위. 데이터가 없는 연도는 화면에서 "준비 중"으로 표시된다.
const FIRST_YEAR = 2008;
const LAST_YEAR = 2026;

let charts = new Map();

function loadCharts() {
  const next = new Map();
  if (fs.existsSync(CHART_DIR)) {
    for (const file of fs.readdirSync(CHART_DIR)) {
      if (!/^\d{4}\.json$/.test(file)) continue;
      try {
        const chart = JSON.parse(fs.readFileSync(path.join(CHART_DIR, file), 'utf8'));
        const year = Number(chart.year || file.slice(0, 4));
        const songs = (chart.songs || [])
          .filter((s) => s && s.title && s.artist)
          .slice(0, 50)
          .map((s, i) => ({
            id: `${year}-${i + 1}`,
            year,
            rank: s.rank ?? null,
            title: String(s.title),
            artist: String(s.artist),
            aliases: Array.isArray(s.aliases) ? s.aliases : [],
            youtubeId: s.youtubeId || null,
            start: Number.isFinite(s.start) ? s.start : null,
            highlight: Number.isFinite(s.highlight) ? s.highlight : null,
          }));
        next.set(year, { year, verified: Boolean(chart.verified), source: chart.source || 'unknown', songs });
      } catch (err) {
        console.error(`[charts] ${file} 읽기 실패:`, err.message);
      }
    }
  }
  charts = next;
  return charts;
}

/** 화면용 연도 목록: 범위 안의 모든 연도 + 곡 수 */
function yearCatalog() {
  const list = [];
  for (let y = LAST_YEAR; y >= FIRST_YEAR; y -= 1) {
    const chart = charts.get(y);
    list.push({
      year: y,
      count: chart ? chart.songs.length : 0,
      verified: chart ? chart.verified : false,
    });
  }
  return list;
}

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 선택한 연도들의 곡을 모아 섞는다 (eligible: 셔플에 넣을 곡만 남기는 조건)
 *  여러 해에 걸쳐 차트에 오른 곡은 한 번만 넣는다 (먼저 오른 해 기준) */
function buildPool(years, eligible = () => true) {
  const pool = [];
  const seen = new Set();
  for (const y of [...new Set(years.map(Number))].sort((a, b) => a - b)) {
    const chart = charts.get(y);
    if (!chart) continue;
    for (const song of chart.songs) {
      if (!eligible(song)) continue;
      const key = songKey(song);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(song);
    }
  }
  return shuffle(pool);
}

/** 다른 해 차트에 있는 같은 곡들 */
function sameSongs(song) {
  const key = songKey(song);
  const out = [];
  for (const chart of charts.values()) {
    for (const s of chart.songs) if (s !== song && s.year !== song.year && songKey(s) === key) out.push(s);
  }
  return out;
}

function songsOf(year) {
  const chart = charts.get(Number(year));
  return chart ? chart.songs : [];
}

function hasYear(year) {
  return charts.has(Number(year));
}

// 직접 넣은 음원 파일: data/audio/<연도>/<순위>.mp3 (01.mp3도 가능)
const AUDIO_DIR = path.join(__dirname, '..', 'data', 'audio');
const AUDIO_EXTS = ['mp3', 'm4a', 'ogg', 'wav', 'aac'];

function ownAudioFile(song) {
  if (!song.rank) return null;
  const names = [String(song.rank), String(song.rank).padStart(2, '0')];
  for (const name of names) {
    for (const ext of AUDIO_EXTS) {
      const file = path.join(AUDIO_DIR, String(song.year), `${name}.${ext}`);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/** 이 곡의 음원 파일. 없으면 다른 해 차트의 같은 곡에 넣어 둔 파일을 같이 쓴다 */
function audioFileFor(song) {
  const own = ownAudioFile(song);
  if (own || !song.year) return own;
  for (const other of sameSongs(song)) {
    const file = ownAudioFile(other);
    if (file) return file;
  }
  return null;
}

loadCharts();

module.exports = { loadCharts, yearCatalog, buildPool, songsOf, hasYear, audioFileFor, sameSongs, FIRST_YEAR, LAST_YEAR };

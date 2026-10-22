// 연도별 차트 데이터 로더 (data/charts/<연도>.json)
const fs = require('fs');
const path = require('path');

const CHART_DIR = path.join(__dirname, '..', 'data', 'charts');

// 멜론 시대별 차트(연도별)가 다루는 범위. 데이터가 없는 연도는 화면에서 "준비 중"으로 표시된다.
const FIRST_YEAR = 1984;
const LAST_YEAR = 2025;

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

/** 선택한 연도들의 곡을 모아 섞은 뒤 count곡을 뽑는다 */
function buildPlaylist(years, count) {
  const pool = [];
  for (const y of years) {
    const chart = charts.get(Number(y));
    if (chart) pool.push(...chart.songs);
  }
  return shuffle(pool).slice(0, Math.max(1, count));
}

function hasYear(year) {
  return charts.has(Number(year));
}

loadCharts();

module.exports = { loadCharts, yearCatalog, buildPlaylist, hasYear, FIRST_YEAR, LAST_YEAR };

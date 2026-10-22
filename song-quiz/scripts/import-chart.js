#!/usr/bin/env node
// 텍스트 목록 → data/charts/<연도>.json
// 사용법: node scripts/import-chart.js 2011 chart-2011.txt
//
// 한 줄에 한 곡. 아래 형식을 모두 읽습니다.
//   1. 제목 - 가수
//   1 제목 - 가수
//   제목<Tab>가수            (엑셀에서 두 칸 복사)
//   1<Tab>제목<Tab>가수
//   제목 / 가수
// 순위 숫자가 없으면 줄 순서대로 1위부터 매깁니다.
const fs = require('fs');
const path = require('path');

const [year, file] = process.argv.slice(2);
if (!/^\d{4}$/.test(year || '') || !file) {
  console.error('사용법: node scripts/import-chart.js <연도> <텍스트파일>');
  process.exit(1);
}

const out = path.join(__dirname, '..', 'data', 'charts', `${year}.json`);
const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
const keep = new Map((previous?.songs || []).map((s) => [`${s.artist}|${s.title}`, s]));

const songs = [];
for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  let line = raw.trim();
  if (!line) continue;

  let rank = null;
  const tabs = line.split('\t').map((x) => x.trim()).filter(Boolean);
  let title;
  let artist;

  if (tabs.length >= 2) {
    if (/^\d+$/.test(tabs[0]) && tabs.length >= 3) {
      rank = Number(tabs[0]);
      [title, artist] = [tabs[1], tabs[2]];
    } else {
      [title, artist] = [tabs[0], tabs[1]];
    }
  } else {
    const m = line.match(/^(\d+)[.)\s]+(.*)$/);
    if (m) {
      rank = Number(m[1]);
      line = m[2];
    }
    const sep = line.lastIndexOf(' - ') >= 0 ? ' - ' : (line.lastIndexOf(' / ') >= 0 ? ' / ' : null);
    if (!sep) {
      console.warn(`건너뜀 (구분자 없음): ${raw}`);
      continue;
    }
    const at = line.lastIndexOf(sep);
    title = line.slice(0, at).trim();
    artist = line.slice(at + sep.length).trim();
  }

  const old = keep.get(`${artist}|${title}`) || {};
  songs.push({
    rank: rank ?? songs.length + 1,
    title,
    artist,
    aliases: old.aliases || [],
    ...(old.youtubeId ? { youtubeId: old.youtubeId } : {}),
    ...(Number.isFinite(old.start) ? { start: old.start } : {}),
    ...(Number.isFinite(old.highlight) ? { highlight: old.highlight } : {}),
  });
}

songs.sort((a, b) => a.rank - b.rank);
const chart = {
  year: Number(year),
  source: 'melon',
  verified: true,
  note: `멜론 연도별 차트 ${year}년 TOP ${songs.length}`,
  songs: songs.slice(0, 50),
};
fs.writeFileSync(out, `${JSON.stringify(chart, null, 2)}\n`);
console.log(`${out} 에 ${chart.songs.length}곡 저장 (서버를 다시 켜면 반영)`);

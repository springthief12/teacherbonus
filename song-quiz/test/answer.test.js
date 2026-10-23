// 정답 판정: 곡 정보 괄호는 정답이 아니고, 영어 제목은 한글 발음으로도 맞힌다
// 실행: node test/answer.test.js
const assert = require('node:assert/strict');
const { test } = require('node:test');

const charts = require('../server/charts');
const { isCorrect, chosungHint, stripExtras } = require('../server/answer');

const song = (year, title) => charts.songsOf(year).find((s) => s.title === title);

test('버전·무대·파트·삽입곡 표기는 정답으로 치지 않는다', () => {
  assert.equal(isCorrect(song(2008, '주문-MIROTIC (Clean Ver.)'), 'cleanver'), false);
  assert.equal(isCorrect(song(2014, 'Mr. Chu (On Stage)'), 'onstage'), false);
  assert.equal(isCorrect(song(2009, '거짓말 (Part.1)'), 'part1'), false);
  assert.equal(isCorrect(song(2009, "비와 당신 (영화 '라디오스타' 삽입곡)"), '영화라디오스타삽입곡'), false);
  assert.equal(isCorrect(song(2008, '가슴으로 외쳐 (Rap Feat. Rhymer)'), 'rapfeatrhymer'), false);
  assert.equal(isCorrect(song(2009, '거짓말 (Part.1)'), '거짓말'), true);
});

test('제목 뒤의 "- Clean Ver."를 떼고 맞힌다', () => {
  const seven = song(2024, 'Seven (feat. Latto) - Clean Ver.');
  assert.equal(stripExtras(seven.title), 'Seven');
  assert.equal(isCorrect(seven, 'Seven'), true);
  assert.equal(chosungHint(seven.title), 'S____');
});

test('새로 넣은 연도의 영어 제목도 한글 발음으로 맞힌다', () => {
  assert.equal(isCorrect(song(2009, 'Gee'), '지'), true);
  assert.equal(isCorrect(song(2014, 'Mr. Chu (On Stage)'), '미스터츄'), true);
  assert.equal(isCorrect(song(2016, 'OOH-AHH하게'), '우아하게'), true);
  assert.equal(isCorrect(song(2008, '주문-MIROTIC (Clean Ver.)'), '주문'), true);
});

test('영어 제목에는 모두 한글 발음 정답이 있다', () => {
  const missing = [];
  for (const { year } of charts.yearCatalog()) {
    for (const s of charts.songsOf(year)) {
      if (/[A-Za-z]/.test(stripExtras(s.title)) && !s.aliases.length) missing.push(`${year} ${s.title}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('전각 ￦로 쓴 글자도 힌트에서 가린다', () => {
  assert.equal(chosungHint('PO￦ER'), 'P____');
});

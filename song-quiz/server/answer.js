// 정답 판정과 힌트 생성 도우미

const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** 비교용 문자열: 소문자, 공백·기호 제거 */
function squash(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^0-9a-z가-힣ㄱ-ㅎ]/g, '');
}

/** 괄호 속 부가 정보(feat., with, OST 등)를 떼어낸 제목 */
function stripExtras(text) {
  return String(text || '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft|with)\b\.?.*$/i, ' ')
    .trim();
}

/**
 * 한 곡에 대해 인정할 정답 목록을 만든다.
 * - 원제목, 괄호를 뗀 제목, 괄호 안의 부제(예: "숨 (Breath)" → "Breath")
 * - 데이터에 적힌 aliases
 */
function acceptedAnswers(song) {
  const set = new Set();
  const add = (value) => {
    const key = squash(value);
    if (key.length > 0) set.add(key);
  };

  add(song.title);
  add(stripExtras(song.title));

  const inner = String(song.title || '').match(/\(([^)]+)\)/g) || [];
  inner.forEach((part) => {
    const body = part.slice(1, -1);
    if (!/^(feat|ft|with|prod|narr)\b/i.test(body.trim())) add(body);
  });

  (song.aliases || []).forEach(add);
  return [...set];
}

function editDistance(a, b) {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

const HANGUL_ONLY = /^[가-힣0-9]+$/;
const LATIN_ONLY = /^[a-z0-9]+$/;

/**
 * 정답 판정 (띄어쓰기·기호·대소문자 무시)
 * 1) 제목·부제·별칭과 정확히 같으면 정답
 * 2) 영어 제목의 한글 발음(별칭)은 한 글자 차이까지 인정 (예: 베드걸굳걸 → Bad Girl Good Girl)
 * 3) 긴 영어 제목은 철자 한 글자 실수까지 인정
 */
function isCorrect(song, guess) {
  const key = squash(guess);
  if (!key) return false;
  const answers = acceptedAnswers(song);
  if (answers.includes(key)) return true;

  if (HANGUL_ONLY.test(key) && [...key].length >= 4) {
    const spoken = (song.aliases || []).map(squash).filter((a) => HANGUL_ONLY.test(a) && [...a].length >= 4);
    if (spoken.some((a) => editDistance(a, key) <= 1)) return true;
  }
  if (LATIN_ONLY.test(key) && key.length >= 8) {
    if (answers.some((a) => LATIN_ONLY.test(a) && a.length >= 8 && editDistance(a, key) <= 1)) return true;
  }
  return false;
}

/** 제목 초성 힌트: 한글은 초성, 영문은 단어 첫 글자 + 밑줄 */
function chosungHint(text) {
  const base = stripExtras(text) || String(text || '');
  return base
    .split(/(\s+)/)
    .map((word) => {
      if (/^\s+$/.test(word)) return ' ';
      let out = '';
      let latinStarted = false;
      for (const ch of word) {
        const code = ch.charCodeAt(0);
        if (code >= 0xac00 && code <= 0xd7a3) {
          out += CHOSUNG[Math.floor((code - 0xac00) / 588)];
          latinStarted = false;
        } else if (/[a-z]/i.test(ch)) {
          out += latinStarted ? '_' : ch.toUpperCase();
          latinStarted = true;
        } else {
          out += ch;
          if (ch !== "'" && ch !== '’') latinStarted = false;
        }
      }
      return out;
    })
    .join('');
}

module.exports = { squash, stripExtras, acceptedAnswers, isCorrect, chosungHint };

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
    if (!/^(feat|ft|with|prod)\b/i.test(body.trim())) add(body);
  });

  (song.aliases || []).forEach(add);
  return [...set];
}

function isCorrect(song, guess) {
  const key = squash(guess);
  if (!key) return false;
  return acceptedAnswers(song).includes(key);
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

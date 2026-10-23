// 욕설·비속어 블라인드
// - 띄어쓰기·숫자·기호를 끼워 넣은 변형(시1발, ㅅ.ㅂ, 시 발), 초성(ㅅㅂ, ㅂㅅ, ㅈㄴ…),
//   영어 자판으로 친 한글(tlqkf), 영어 욕설까지 찾아 그 부분을 *로 가린다.
// - 오탐을 줄이려고 "다시 발표"처럼 두 단어가 우연히 이어지는 경우는 붙여서 보지 않는다.
//   (한 글자씩 띄워 쓴 "시 발"만 붙여서 본다)

// 한 단어 안에서 찾는 표현 (글자·자모·영문만 남긴 상태에서 검사)
const WORD_PATTERNS = [
  // 씨발 계열
  '(씨|쒸|씌|싀|쓰|ㅆ|c)[이으]*(발|빨|팔|펄|벌|뻘|불|부랄|부럴|ㅂ|ㅃ)',
  '(시|쉬|ㅅ)[이으]*(발|빨|팔|펄|벌|뻘|ㅂ|ㅃ)',
  '씨바|씨빠|쒸바',
  '씹(새|쌔|창|년|놈|할|팔|탱|련|덕|선|노|것)',
  '썅|쌍(년|놈|넘)',
  // 병신 계열
  '(병|븅|빙|뷩|ㅂ)[이으]*(신|싄|쉰|씬|딱|ㅅ)',
  'ㅄ',
  // 새끼 계열
  // 동물의 새끼를 뜻하는 '오리새끼'는 곡 제목(미운오리새끼)에도 쓰인다.
  '(?<!오리)(새|쌔|섀|쎄|쌕|색|섹)(끼|키|ㄲ|히)',
  'ㄱㅅㄲ|ㅅㄲ',
  '개(새|쌔|섀|색|쉐|쇄|씨|ㅅ)',
  '개(년|놈|넘|같|좆|소리|지랄|빡|돼지|쓰레기|씹)',
  // 좆·존나 계열
  '좆|좃|졷|줫|좇|ㅈ같|ㅈㄴ|ㅈㄲ|ㅈ까|존나|존니|존내|존넨|졸라|조낸|졸래|젼나|쫀나|존ㄴ',
  // 지랄·미친·또라이
  '지랄|지럴|지롤|쥐랄|g랄|ㅈㄹ',
  '미친(놈|년|새|것|개|넘|뇬|x|련)|미췬|ㅁ친|미ㅊ|ㅁㅊ',
  '또라이|돌아이|똘아이|ㄸㄹㅇ',
  // 닥쳐·꺼져·뒤져
  '닥(쳐|치|처)|닭쳐|ㄷㅊ',
  '꺼져라|ㄲㅈ',
  '(뒤|뒈|디)(져라|질래|지고싶|진다)|뒈져|뒈지',
  // 패드립
  '니(애미|애비|에미|에비|미럴|기미|어미|애믜)|느(금|그애미|그애비|개비|검마)|애미|애비|엠창|엄창|앰창|ㄴㄱㅁ',
  // 기타 욕설·비하
  '(염|옘|엠|얌)(병|뱅|븅)',
  '등신|등쉰|찐따|찐찌|ㅉㄸ',
  '호로(새|자식|잡|놈|년)|후레자식|후래자식|잡놈|잡년|화냥년|창녀|걸레년',
  '엿(먹|같|이나)',
  '빡대가리|돌대가리|닭대가리|대갈통',
  '맘충|급식충|틀딱|한남충|한녀충|김치녀|된장녀|일베충|메갈|짱깨|짱개|쪽바리|조센징|애자',
  // 성적인 표현
  '섹스|쎅스|섹쓰|쎾스|야동|딸딸이|ㅅㅅ',
  // 손가락 욕 (ㅗ)
  'ㅗ',
  // 영어 자판으로 친 한글 욕설 (시발, 병신, 지랄, 존나, 개새끼)
  'tlqkf|tlqk|qudtls|wlfkf|whssk|rotorl',
  // 영어 욕설
  'fuck|fuk|fck|fxck|phuck|shit|bitch|biatch|asshole|motherfucker|mofo|nigger|nigga|cunt|whore|slut|pussy|wtf|stfu|retard|sibal|ssibal|shibal|sival',
];

// 숫자까지 남긴 상태에서 찾는 표현 (시8, c8, 18놈)
const DIGIT_PATTERNS = [
  '(c|씨|시|ㅅ|ㅆ)8',
  '18(놈|새|새끼|넘)',
  '10(새|색)',
  'sh[1!]t|b[1!]tch',
];

const wordRe = new RegExp(WORD_PATTERNS.join('|'), 'g');
const digitRe = new RegExp(DIGIT_PATTERNS.join('|'), 'g');

function toHalfWidth(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
  return ch;
}

/**
 * 원문 → 검사용 문자열. 각 글자가 원문 몇 번째 글자에서 왔는지 함께 기록한다.
 * 단어 사이는 공백 한 칸으로 두어 패턴이 단어를 넘어가지 않게 하고,
 * 한 글자짜리 단어가 이어지면("시 발", "ㅅ ㅂ") 붙여서 본다.
 */
function normalize(chars, keepDigits) {
  const keep = keepDigits ? /[가-힣ㄱ-ㅎㅏ-ㅣa-z0-9!]/ : /[가-힣ㄱ-ㅎㅏ-ㅣa-z]/;
  const tokens = [];
  let cur = null;
  chars.forEach((raw, i) => {
    if (/\s/.test(raw)) { cur = null; return; }
    if (!cur) { cur = { text: '', map: [] }; tokens.push(cur); }
    const ch = toHalfWidth(raw).toLowerCase();
    if (keep.test(ch)) {
      cur.text += ch;
      cur.map.push(i);
    }
  });

  let text = '';
  const map = [];
  let prevSingle = false;
  for (const t of tokens) {
    if (!t.text) continue;
    const single = [...t.text].length === 1;
    if (text && !(single && prevSingle)) { text += ' '; map.push(-1); }
    text += t.text;
    map.push(...t.map);
    prevSingle = single;
  }
  return { text, map };
}

function markMatches(re, norm, masked) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(norm.text)) !== null) {
    if (!m[0]) { re.lastIndex += 1; continue; }
    const idx = norm.map.slice(m.index, m.index + m[0].length).filter((x) => x >= 0);
    if (idx.length) {
      for (let k = Math.min(...idx); k <= Math.max(...idx); k += 1) masked[k] = true;
    }
  }
}

/**
 * @returns {{ text: string, hit: boolean }} 가린 문장과 가린 곳이 있었는지
 */
function censor(input) {
  const original = String(input || '').normalize('NFC');
  const chars = [...original];
  const masked = new Array(chars.length).fill(false);

  markMatches(wordRe, normalize(chars, false), masked);
  markMatches(digitRe, normalize(chars, true), masked);
  chars.forEach((ch, i) => { if (ch === '凸' || ch === '🖕') masked[i] = true; });

  const hit = masked.some(Boolean);
  if (!hit) return { text: original, hit: false };
  const text = chars.map((ch, i) => (masked[i] && !/\s/.test(ch) ? '*' : ch)).join('');
  return { text, hit: true };
}

/** 닉네임·방 이름: 가린 뒤 남는 글자가 없으면 대신 쓸 이름 */
function cleanName(input, fallback) {
  const { text, hit } = censor(input);
  if (!hit) return text;
  const rest = text.replace(/[*\s]/g, '');
  return rest.length >= 1 ? text : fallback;
}

module.exports = { censor, cleanName };

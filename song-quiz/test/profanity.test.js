// 비속어 필터 테스트: 가려야 할 표현과, 가리면 안 되는 일상어·노래 제목
// 실행: node test/profanity.test.js
const { censor, cleanName } = require('../server/profanity');
const fs = require('fs');
const path = require('path');
const chartDir = path.join(__dirname, '..', 'data', 'charts');
const allSongs = fs.readdirSync(chartDir).filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(chartDir, f), 'utf8')).songs);

const shouldBlock = [
  '시발', '씨발', '씨빨', '시팔', '쓰벌', 'ㅅㅂ', 'ㅆㅂ', 'ㅅ1ㅂ', 'ㅅ.ㅂ', '시 발', '시1발', '씨~발', 'c발', 'c8', '시8',
  '씨이발', '쒸발', '씨부랄', '씹새', '썅', '쌍년',
  '병신', 'ㅂㅅ', 'ㅄ', '븅신', '빙신', '병 신', '병1신',
  '새끼', '개새끼', '개새', 'ㅅㄲ', 'ㄱㅅㄲ', '색히', '쌔끼', '개같네', '개소리하네',
  '좆', '좆같다', 'ㅈ같', '존나', '졸라', 'ㅈㄴ', 'ㅈㄲ', '존니 웃기다',
  '지랄', 'ㅈㄹ', '미친놈', 'ㅁㅊ', '또라이', 'ㄸㄹㅇ', '닥쳐', 'ㄷㅊ', 'ㄲㅈ', '꺼져라', '뒤질래',
  '느금마', '니애미', '애미', '엠창', '염병', '등신', '찐따', '엿먹어', '빡대가리', '맘충', '틀딱',
  '섹스', '야동', 'ㅗ', 'ㅗㅗ', '凸',
  'tlqkf', 'qudtls', 'wlfkf', 'whssk', 'rotoRl',
  'fuck', 'F U C K', 'f*ck', 'shit', 'sh1t', 'bitch', 'wtf', 'Ｆｕｃｋ',
  '아 시발 모르겠다', '이거 존나 쉽네', '야 이 병신아',
];

const shouldPass = [
  '다시 발표해 줘', '21세기 노래', '하루 세끼', '마음에 새기다', '개미', '시바견 귀여워', '존재', '존경해요', '졸업',
  '병원', '신병', '이불 덮어', '다시 이불', '보지 마', '자지 마', '에미넴', '수고 ㅅㄱ', 'ㅋㅋㅋㅋ', 'ㅎㅎ', 'ㅠㅠ', 'ㄱㄱ',
  '오 이거 알아', '시간아 멈춰라', '사랑 빛', '18년도 노래', '2018년', '8시', 'class', 'assassin', 'Scotch',
  '이 노래 뭐더라', '미쳤다 진짜', '너 때문에 미쳐', '꺼져 줄게 잘 살아', '죽어도 못 보내', '죽을 만큼 아파서',
  '출발점',
];

let fail = 0;
for (const t of shouldBlock) {
  const r = censor(t);
  if (!r.hit) { fail += 1; console.log(`FAIL 못 가림: "${t}"`); }
}
for (const t of shouldPass) {
  const r = censor(t);
  if (r.hit) { fail += 1; console.log(`FAIL 잘못 가림: "${t}" → "${r.text}"`); }
}
// 노래 제목·가수 이름은 절대 가리면 안 됨
for (const s of allSongs) {
  for (const t of [s.title, s.artist, ...s.aliases]) {
    const r = censor(t);
    if (r.hit) { fail += 1; console.log(`FAIL 노래 정보를 가림: "${t}" → "${r.text}"`); }
  }
}
// 가리는 모양
const sample = censor('아 시1발 진짜');
if (sample.text !== '아 *** 진짜') { fail += 1; console.log(`FAIL 가린 모양: ${sample.text}`); }
if (cleanName('시발', '손님') !== '손님') { fail += 1; console.log('FAIL 닉네임 대체'); }
if (cleanName('민지', '손님') !== '민지') { fail += 1; console.log('FAIL 정상 닉네임'); }

const total = shouldBlock.length + shouldPass.length + allSongs.length * 2 + 3;
console.log(`비속어 필터: ${fail ? `${fail}개 실패` : '모두 통과'} (가림 ${shouldBlock.length}개, 통과 ${shouldPass.length}개, 노래 정보 ${allSongs.length}곡)`);
process.exit(fail ? 1 : 0);

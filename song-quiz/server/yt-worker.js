// 유튜브 검색을 따로 떨어진 작업 스레드에서 돌린다.
// 검색 결과 페이지(약 1MB)를 해석하는 데 CPU를 많이 쓰는데(빠른 PC에서도 0.2초 안팎, Render 무료 서버에서는 몇 초),
// 게임 서버와 같은 스레드에서 돌리면 그동안 학생들이 보낸 정답·채팅 처리가 통째로 멈춘다.
const { parentPort } = require('worker_threads');
const dasu = require('dasu');

// 페이지에서 검색 결과(ytInitialData)가 든 <script>만 남겨 해석 비용을 줄인다.
// 예상한 모양이 아니면 원문을 그대로 넘긴다.
function slim(text) {
  if (typeof text !== 'string' || text.length < 50000 || text.includes('id="initial-data"')) return text;
  const blocks = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('ytInitialData', from);
    if (at < 0) break;
    const start = text.lastIndexOf('<script', at);
    const end = text.indexOf('</script>', at);
    if (start < 0 || end < 0) return text;
    if (!blocks.length || blocks[blocks.length - 1][0] !== start) blocks.push([start, end + 9]);
    from = end + 9;
  }
  if (!blocks.length) return text;
  return `<html><body>${blocks.map(([s, e]) => text.slice(s, e)).join('\n')}</body></html>`;
}

const originalReq = dasu.req;
dasu.req = function req(params, callback) {
  return originalReq.call(this, params, (err, res, body) => {
    if (err || !res) return callback(err, res, body);
    const small = slim(body);
    res.responseText = small;
    callback(err, res, small);
  });
};

const yts = require('yt-search');

parentPort.on('message', async ({ id, query }) => {
  try {
    const result = await yts({ query, hl: 'ko', gl: 'KR' });
    const videos = (result.videos || []).slice(0, 15).map((v) => ({
      videoId: v.videoId,
      title: v.title,
      seconds: v.seconds,
      author: { name: v.author && v.author.name },
    }));
    parentPort.postMessage({ id, videos });
  } catch (err) {
    parentPort.postMessage({ id, error: String((err && err.message) || err).split('\n')[0] });
  }
});

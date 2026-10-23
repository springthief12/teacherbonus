// 관리자 API 테스트는 위에서 준비한 캐시만 사용한다.
// 미검사 곡이 실제 검색 결과에 따라 자동 활성화되면 곡 수/검사 대상 검증이 달라진다.
// --require로 서버와 검색 Worker에만 주입하므로 서비스 코드에는 영향을 주지 않는다.
const file = require.resolve('yt-search');
require.cache[file] = {
  id: file,
  filename: file,
  loaded: true,
  exports: async () => { throw new Error('관리자 테스트에서는 외부 YouTube 검색을 사용하지 않습니다.'); },
};

// 소리 전용 재생기
// - 음원 파일(audioUrl)이 있으면 <audio>로 재생: 광고 없음
// - 없으면 유튜브를 화면 밖에 숨겨 소리만 재생 (youtube-nocookie 모드)
// - 서버가 정한 시각 기준으로 모두 같은 구간을 듣도록 1.5초마다 위치를 맞춘다 (광고가 끼어도 끝나면 제자리로)
(function () {
  let yt = null;
  let ytReady = false;
  let apiFailed = false;
  let pendingYt = null;
  const audio = new Audio();
  audio.preload = 'auto';

  let job = null; // 현재 재생 요청
  let mode = null; // 'file' | 'yt'
  let startTimer = null;
  let volume = 70;
  let unlocked = false;
  // 아주 짧은 무음: 휴대폰(특히 아이폰)은 사용자가 누른 순간 한 번 재생해 둬야 나중에 자동 재생이 됨
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  let handlers = { onError() {}, onBlocked() {}, onPlaying() {} };

  // ---------- 공통 ----------
  const serverNow = () => Date.now() + (job ? job.clockOffset || 0 : 0);
  const expectedPos = () => job.startSeconds + Math.max(0, (serverNow() - job.startedAt) / 1000);
  const keyOf = (j) => (j ? j.audioUrl || j.videoId || null : null);

  function play(next) {
    if (!next || (!next.audioUrl && !next.videoId)) { stop(); return; }
    if (job && keyOf(job) === keyOf(next)) { job = next; return; }
    stop();
    job = next;
    mode = next.audioUrl ? 'file' : 'yt';
    if (mode === 'file') playFile(); else playYt();
  }

  function stop() {
    clearTimeout(startTimer);
    pendingYt = null;
    job = null;
    mode = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (ytReady) yt.stopVideo();
  }

  function scheduleStart(begin) {
    const delay = job.startedAt - serverNow();
    if (delay > 0) startTimer = setTimeout(begin, delay);
    else begin();
  }

  // ---------- 음원 파일 ----------
  function playFile() {
    const current = job;
    audio.src = current.audioUrl;
    audio.volume = volume / 100;
    audio.currentTime = current.startSeconds;
    scheduleStart(() => {
      if (job !== current) return;
      audio.currentTime = expectedPos();
      audio.play().then(() => handlers.onPlaying()).catch(() => handlers.onBlocked());
    });
  }

  audio.addEventListener('error', () => {
    if (mode === 'file' && job) handlers.onError({ audioUrl: job.audioUrl });
  });

  // ---------- 유튜브 ----------
  let apiRequested = false;
  // 유튜브 재생기는 실제로 노래를 틀 기기에서만 불러온다 (학생 휴대폰은 불러오지 않음)
  function loadApi() {
    if (apiRequested) return;
    apiRequested = true;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => { apiFailed = true; };
    document.head.appendChild(tag);
  }

  window.onYouTubeIframeAPIReady = function () {
    yt = new YT.Player('yt-player', {
      host: 'https://www.youtube-nocookie.com',
      width: '200',
      height: '200',
      playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1 },
      events: {
        onReady: () => {
          ytReady = true;
          yt.setVolume(volume);
          if (pendingYt) { pendingYt = null; playYt(); }
        },
        onError: (e) => {
          if (mode === 'yt' && job && [2, 5, 100, 101, 150].includes(e.data)) handlers.onError({ videoId: job.videoId });
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) handlers.onPlaying();
        },
      },
    });
  };

  function playYt() {
    if (!ytReady) { pendingYt = true; loadApi(); return; }
    const current = job;
    yt.cueVideoById({ videoId: current.videoId, startSeconds: current.startSeconds });
    scheduleStart(() => {
      if (job !== current) return;
      yt.loadVideoById({ videoId: current.videoId, startSeconds: expectedPos() });
      setTimeout(() => {
        if (job !== current) return;
        const s = yt.getPlayerState();
        if (s !== YT.PlayerState.PLAYING && s !== YT.PlayerState.BUFFERING) handlers.onBlocked();
      }, 2500);
    });
  }

  // ---------- 위치 맞추기 ----------
  setInterval(() => {
    if (!job || serverNow() < job.startedAt) return;
    const want = expectedPos();
    if (mode === 'file' && !audio.paused && audio.duration) {
      if (want < audio.duration - 1 && Math.abs(audio.currentTime - want) > 1.5) audio.currentTime = want;
    }
    if (mode === 'yt' && ytReady && yt.getPlayerState() === YT.PlayerState.PLAYING) {
      const dur = yt.getDuration();
      if (dur && want < dur - 1 && Math.abs(yt.getCurrentTime() - want) > 2) yt.seekTo(want, true);
    }
  }, 1500);

  // ---------- 바깥에 내보내는 기능 ----------
  window.QuizPlayer = {
    init(h = {}) {
      handlers = { ...handlers, ...h };
    },
    play,
    stop,
    unlock() {
      if (unlocked || job) return;
      unlocked = true;
      try {
        audio.src = SILENT;
        const p = audio.play();
        if (p) p.then(() => { if (!job) audio.pause(); }).catch(() => { unlocked = false; });
      } catch {
        unlocked = false;
      }
    },
    resume() {
      if (mode === 'file') audio.play().then(() => handlers.onPlaying()).catch(() => {});
      if (mode === 'yt' && ytReady) yt.playVideo();
    },
    setVolume(v) {
      volume = v;
      audio.volume = v / 100;
      if (ytReady) yt.setVolume(v);
    },
    isAvailable: () => !apiFailed,
    get current() { return keyOf(job); },
  };
})();

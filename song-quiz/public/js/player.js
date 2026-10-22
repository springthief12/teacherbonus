// 유튜브 IFrame 재생기 래퍼: 서버가 정한 시각에 맞춰 같은 구간을 재생
(function () {
  let player = null;
  let ready = false;
  let apiFailed = false;
  let pending = null; // API 준비 전에 들어온 재생 요청
  let currentId = null;
  let startTimer = null;
  let volume = 70;
  let onError = () => {};
  let onBlocked = () => {};
  let onPlaying = () => {};

  function loadApi() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => { apiFailed = true; };
    document.head.appendChild(tag);
  }

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('yt-player', {
      width: '100%',
      height: '100%',
      playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3 },
      events: {
        onReady: () => {
          ready = true;
          player.setVolume(volume);
          if (pending) { const p = pending; pending = null; play(p); }
        },
        onError: (e) => {
          if ([2, 5, 100, 101, 150].includes(e.data) && currentId) onError(currentId, e.data);
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) onPlaying();
        },
      },
    });
  };

  /**
   * job = { videoId, startSeconds, startedAt(서버 시각 ms), clockOffset(ms) }
   * clockOffset: 서버시각 - 내시각
   */
  function play(job) {
    if (!job || !job.videoId) { stop(); return; }
    if (!ready) { pending = job; return; }
    clearTimeout(startTimer);

    const now = Date.now() + (job.clockOffset || 0);
    const delay = job.startedAt - now;
    currentId = job.videoId;

    if (delay > 0) {
      player.cueVideoById({ videoId: job.videoId, startSeconds: job.startSeconds });
      startTimer = setTimeout(() => {
        player.playVideo();
        watchForBlock();
      }, delay);
    } else {
      player.loadVideoById({ videoId: job.videoId, startSeconds: job.startSeconds + (-delay / 1000) });
      watchForBlock();
    }
  }

  // 브라우저가 자동 재생을 막으면 "소리 켜기" 버튼을 띄운다
  function watchForBlock() {
    setTimeout(() => {
      if (!player || !currentId) return;
      const state = player.getPlayerState();
      if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) onBlocked();
    }, 2500);
  }

  function resume() {
    if (ready && currentId) player.playVideo();
  }

  function stop() {
    clearTimeout(startTimer);
    pending = null;
    currentId = null;
    if (ready) player.stopVideo();
  }

  function setVolume(v) {
    volume = v;
    if (ready) player.setVolume(v);
  }

  function isAvailable() {
    return !apiFailed;
  }

  window.QuizPlayer = {
    init(handlers = {}) {
      onError = handlers.onError || onError;
      onBlocked = handlers.onBlocked || onBlocked;
      onPlaying = handlers.onPlaying || onPlaying;
      loadApi();
    },
    play,
    stop,
    resume,
    setVolume,
    isAvailable,
    get currentId() { return currentId; },
  };
})();

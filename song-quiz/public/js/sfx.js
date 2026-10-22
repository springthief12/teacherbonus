// 효과음: 파일 없이 브라우저에서 바로 만드는 짧고 부드러운 소리
// 음량은 노래보다 한참 작게, 높은 음은 짧게 끝나도록 잡았다.
(function () {
  let ctx = null;
  let master = null;
  let enabled = true;
  try { enabled = localStorage.getItem('songquiz.sfx') !== 'off'; } catch { /* 저장 불가 환경 */ }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      const soften = ctx.createBiquadFilter(); // 귀에 거슬리는 고음을 살짝 깎는다
      soften.type = 'lowpass';
      soften.frequency.value = 5200;
      master.connect(soften);
      soften.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone({ freq, to, type = 'sine', start = 0, dur = 0.12, gain = 0.08, attack = 0.008 }) {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  const C5 = 523.25; const E5 = 659.25; const G5 = 783.99; const C6 = 1046.5; const G4 = 392;

  const SOUNDS = {
    // 버튼: 아주 짧은 '톡'
    click: () => tone({ freq: 1100, to: 820, dur: 0.045, gain: 0.04 }),
    // 정답: 도-미-솔-도 올라가는 실로폰 느낌
    correct: () => [C5, E5, G5, C6].forEach((f, i) => tone({ freq: f, type: 'triangle', start: i * 0.075, dur: 0.3, gain: 0.1 })),
    // 넘기기 표 하나: 작은 '뽁'
    vote: () => tone({ freq: 700, to: 480, dur: 0.11, gain: 0.06 }),
    // 정답 전에 넘김: 아래로 미끄러지는 소리
    skip: () => tone({ freq: 640, to: 300, type: 'triangle', dur: 0.24, gain: 0.07 }),
    // 시간 끝, 아무도 못 맞힘: 내려가는 두 음
    timeout: () => { tone({ freq: C5, type: 'triangle', dur: 0.2, gain: 0.07 }); tone({ freq: G4, type: 'triangle', start: 0.17, dur: 0.32, gain: 0.07 }); },
    // 다음 곡으로 넘어감: '띵동'
    next: () => { tone({ freq: G5, dur: 0.16, gain: 0.06 }); tone({ freq: C6, start: 0.11, dur: 0.24, gain: 0.06 }); },
    // 게임 시작
    start: () => [G4, C5, E5, G5].forEach((f, i) => tone({ freq: f, type: 'triangle', start: i * 0.09, dur: 0.22, gain: 0.08 })),
    // 게임 끝: 짧은 팡파르
    end: () => {
      [C5, E5, G5].forEach((f, i) => tone({ freq: f, type: 'triangle', start: i * 0.12, dur: 0.24, gain: 0.08 }));
      tone({ freq: C6, type: 'triangle', start: 0.38, dur: 0.6, gain: 0.09 });
    },
  };

  window.Sfx = {
    play(name) {
      if (!enabled || !SOUNDS[name] || !ensure()) return;
      try { SOUNDS[name](); } catch { /* 소리 장치 문제는 무시 */ }
    },
    unlock() { ensure(); },
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = Boolean(on);
      try { localStorage.setItem('songquiz.sfx', enabled ? 'on' : 'off'); } catch { /* 무시 */ }
    },
  };
})();

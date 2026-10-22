// 효과음: 파일 없이 브라우저에서 바로 만드는 짧은 소리
// 노래에 묻히지 않도록 크게 내고, 효과음이 나는 동안 노래 소리를 잠깐 낮춘다(onDuck).
(function () {
  let ctx = null;
  let master = null;
  let enabled = true;
  let onDuck = () => {};
  try { enabled = localStorage.getItem('songquiz.sfx') !== 'off'; } catch { /* 저장 불가 환경 */ }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1.0;
      // 작은 소리는 키우고 큰 소리는 눌러서 또렷하고 일정하게
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 6;
      comp.ratio.value = 5;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.6;
      master.connect(comp);
      comp.connect(makeup);
      makeup.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone({ freq, to, type = 'triangle', start = 0, dur = 0.12, gain = 0.2, attack = 0.006, bright = 0 }) {
    const t0 = ctx.currentTime + start;
    const voices = [{ f: freq, g: gain, type }];
    if (bright) voices.push({ f: freq * 2, g: gain * bright, type: 'sine' }); // 한 옥타브 위를 섞어 또렷하게
    for (const v of voices) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = v.type;
      osc.frequency.setValueAtTime(v.f, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to * (v.f / freq), t0 + dur);
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(v.g, t0 + attack);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(amp);
      amp.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }
  }

  const C5 = 523.25; const E5 = 659.25; const G5 = 783.99; const C6 = 1046.5; const G4 = 392;

  // [소리, 노래를 낮출 시간(ms)]
  const SOUNDS = {
    click: [() => tone({ freq: 1200, to: 900, type: 'sine', dur: 0.05, gain: 0.12 }), 0],
    correct: [() => [C5, E5, G5, C6].forEach((f, i) => tone({ freq: f, start: i * 0.075, dur: 0.34, gain: 0.32, bright: 0.45 })), 900],
    vote: [() => tone({ freq: 760, to: 520, type: 'square', dur: 0.12, gain: 0.12 }), 250],
    skip: [() => tone({ freq: 660, to: 300, dur: 0.28, gain: 0.3, bright: 0.3 }), 450],
    timeout: [() => { tone({ freq: C5, dur: 0.22, gain: 0.28, bright: 0.3 }); tone({ freq: G4, start: 0.18, dur: 0.36, gain: 0.28, bright: 0.3 }); }, 700],
    next: [() => { tone({ freq: G5, dur: 0.18, gain: 0.26, bright: 0.4 }); tone({ freq: C6, start: 0.12, dur: 0.28, gain: 0.26, bright: 0.4 }); }, 550],
    start: [() => [G4, C5, E5, G5].forEach((f, i) => tone({ freq: f, start: i * 0.09, dur: 0.24, gain: 0.28, bright: 0.35 })), 700],
    end: [() => {
      [C5, E5, G5].forEach((f, i) => tone({ freq: f, start: i * 0.12, dur: 0.26, gain: 0.3, bright: 0.35 }));
      tone({ freq: C6, start: 0.38, dur: 0.7, gain: 0.32, bright: 0.4 });
    }, 1200],
  };

  window.Sfx = {
    play(name) {
      const sound = SOUNDS[name];
      if (!enabled || !sound || !ensure()) return;
      try {
        sound[0]();
        if (sound[1]) onDuck(sound[1]);
      } catch { /* 소리 장치 문제는 무시 */ }
    },
    unlock() { ensure(); },
    onDuck(fn) { onDuck = fn; },
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = Boolean(on);
      try { localStorage.setItem('songquiz.sfx', enabled ? 'on' : 'off'); } catch { /* 무시 */ }
    },
  };
})();

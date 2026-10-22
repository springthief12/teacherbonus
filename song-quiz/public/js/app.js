// 그때 그 노래 – 클라이언트
(function () {
  const $ = (sel) => document.querySelector(sel);
  const esc = Avatar.escape;

  const LABELS = {
    songCount: { title: '곡 수', fmt: (v) => `${v}곡` },
    roundTime: { title: '제한 시간', fmt: (v) => `${v}초` },
    startMode: { title: '재생 위치', fmt: (v) => ({ intro: '전주부터', highlight: '중간부터' }[v]) },
    skipRule: { title: '넘기기', fmt: (v) => ({ majority: '과반수 투표', anyone: '한 명이라도', host: '방장만' }[v]) },
    scoring: { title: '점수', fmt: (v) => ({ flat: '정답 10점', speed: '빠를수록 더' }[v]) },
    revealTime: { title: '정답 후 듣기', fmt: (v) => `${v}초` },
  };
  const STATUS_TEXT = { waiting: '대기 중', loading: '다음 곡 준비 중', playing: '게임 중', reveal: '게임 중', ended: '게임 끝' };

  // ---------- 프로필 ----------
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem('songquiz.profile')) || null; } catch { return null; }
  })();
  const profile = stored || {
    nickname: `손님${Math.floor(100 + Math.random() * 900)}`,
    avatar: { color: Math.floor(Math.random() * 8), face: 0, item: 1 },
  };
  const saveProfile = () => {
    try { localStorage.setItem('songquiz.profile', JSON.stringify(profile)); } catch { /* 저장 불가 환경 */ }
  };

  function renderProfile() {
    $('#avatar-preview').innerHTML = Avatar.svg(profile.avatar, { label: 'SIDE A' });
    $('#nickname').value = profile.nickname;
    $('#pick-color').innerHTML = Avatar.COLORS.map((c, i) =>
      `<button type="button" class="swatch" data-i="${i}" aria-label="${c.name}" aria-pressed="${profile.avatar.color === i}" style="--c:${c.body}"></button>`).join('');
    $('#pick-face').innerHTML = Avatar.FACES.map((f, i) =>
      `<button type="button" class="chip" data-i="${i}" aria-pressed="${profile.avatar.face === i}">${f}</button>`).join('');
    $('#pick-item').innerHTML = Avatar.ITEMS.map((f, i) =>
      `<button type="button" class="chip" data-i="${i}" aria-pressed="${profile.avatar.item === i}">${f}</button>`).join('');
  }

  function bindPicker(sel, key) {
    $(sel).addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-i]');
      if (!btn) return;
      profile.avatar[key] = Number(btn.dataset.i);
      saveProfile();
      renderProfile();
    });
  }
  bindPicker('#pick-color', 'color');
  bindPicker('#pick-face', 'face');
  bindPicker('#pick-item', 'item');
  $('#nickname').addEventListener('input', (e) => {
    profile.nickname = e.target.value.trim().slice(0, 10);
    saveProfile();
  });

  // ---------- 연결 ----------
  const socket = io();
  let state = null; // room:state
  let clockOffset = 0; // 서버시각 - 내시각
  let years = [];
  let lastRevealKey = null;

  function enterLobby() {
    return new Promise((resolve) => {
      socket.emit('lobby:enter', profile, (res) => {
        if (res?.ok) {
          years = res.years;
          renderRooms(res.rooms);
        }
        resolve(res);
      });
    });
  }

  socket.on('connect', () => {
    $('#conn-state').textContent = '연결됨';
    $('#conn-state').dataset.on = 'true';
    if (state) {
      toast('연결이 다시 이어졌어요. 방에 다시 들어가 주세요.');
      state = null;
      showView('lobby');
    }
    enterLobby();
  });
  socket.on('disconnect', () => {
    $('#conn-state').textContent = '연결 끊김 · 다시 연결 중';
    $('#conn-state').dataset.on = 'false';
    QuizPlayer.stop();
  });

  socket.on('lobby:rooms', renderRooms);
  socket.on('toast', (d) => toast(d.text));

  socket.on('room:state', (s) => {
    clockOffset = s.serverNow - Date.now();
    state = s;
    renderRoom();
  });

  socket.on('round:hint', ({ hints }) => {
    if (!state?.round) return;
    state.round.hints = hints;
    renderLyrics();
  });

  socket.on('round:video', (d) => {
    if (!state?.round) return;
    clockOffset = d.serverNow - Date.now();
    state.round.videoId = d.videoId;
    syncPlayer(true);
    renderStatusLine();
  });

  socket.on('round:reveal', (d) => {
    lastRevealKey = null; // renderReveal에서 연출 다시 실행
    pendingReveal = d;
  });
  let pendingReveal = null;

  socket.on('chat', addChat);

  // ---------- 로비 ----------
  function renderRooms(list) {
    const ul = $('#room-list');
    if (!list || !list.length) {
      ul.innerHTML = '<li class="room-empty">아직 열린 방이 없어요. 아래에서 첫 방을 만들어 보세요.</li>';
      return;
    }
    ul.innerHTML = list.map((r) => `
      <li class="room-item">
        <span class="room-item-no">${r.id}</span>
        <span class="room-item-title">${esc(r.title)}</span>
        <span class="room-item-years">${r.years.length ? r.years.map((y) => `${y}`).join(' ') : '연도 미정'}</span>
        <span class="room-item-count">${r.count}/${r.max}</span>
        <span class="room-item-status" data-status="${r.status}">${STATUS_TEXT[r.status]}</span>
        <button type="button" class="btn small" data-join="${r.id}" ${r.count >= r.max ? 'disabled' : ''}>들어가기</button>
      </li>`).join('');
  }

  $('#room-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-join]');
    if (!btn) return;
    await enterLobby();
    $('#chat-log').innerHTML = '';
    socket.emit('room:join', { roomId: btn.dataset.join }, (res) => {
      if (res?.error) return toast(res.error);
      openRoom();
    });
  });

  $('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await enterLobby();
    $('#chat-log').innerHTML = '';
    socket.emit('room:create', { title: $('#room-title').value }, (res) => {
      if (res?.error) return toast(res.error);
      $('#room-title').value = '';
      openRoom();
    });
  });

  function openRoom() {
    showView('room');
    $('#chat-input').focus();
  }

  $('#btn-leave').addEventListener('click', () => {
    socket.emit('room:leave', null, (res) => {
      state = null;
      QuizPlayer.stop();
      showView('lobby');
      renderRooms(res?.rooms);
    });
  });

  function showView(name) {
    $('#view-lobby').hidden = name !== 'lobby';
    $('#view-room').hidden = name !== 'room';
  }

  // ---------- 방 화면 ----------
  const isHost = () => state && state.hostId === socket.id;

  function renderRoom() {
    if (!state) return;
    const s = state;
    $('#room-no').textContent = `[${s.id}]`;
    $('#room-title-text').textContent = s.title;
    $('#room-meta').textContent = `${s.settings.years.join(', ') || '연도 미정'} · ${s.players.length}/8명 · ${STATUS_TEXT[s.status]}`;

    const r = s.round;
    $('#dial-round').textContent = r ? `${r.index + 1}/${r.total}` : `${s.settings.songCount}곡`;
    const votes = s.players.filter((p) => p.skipVote).length;
    $('#dial-skip').textContent = r && (s.status === 'playing' || s.status === 'reveal') ? `${votes}/${r.skipNeeded}` : '–';

    const pane = { waiting: 'waiting', loading: 'play', playing: 'play', reveal: 'reveal', ended: 'ended' }[s.status];
    for (const name of ['waiting', 'play', 'reveal', 'ended']) $(`#pane-${name}`).hidden = name !== pane;
    $('#screen').dataset.status = s.status;

    if (pane === 'waiting') renderWaiting();
    if (pane === 'play') { renderLyrics(); renderStatusLine(); }
    if (pane === 'reveal') renderReveal();
    if (pane === 'ended') renderEnded();

    renderSeats();
    syncPlayer(false);

    const me = s.players.find((p) => p.id === socket.id);
    $('#btn-skip').setAttribute('aria-pressed', String(Boolean(me?.skipVote)));
    $('#btn-skip').disabled = !(s.status === 'playing' || s.status === 'reveal');
  }

  function renderWaiting() {
    const host = isHost();
    const chosen = new Set(state.settings.years);
    const decades = new Map();
    for (const y of years) {
      const d = Math.floor(y.year / 10) * 10;
      if (!decades.has(d)) decades.set(d, []);
      decades.get(d).push(y);
    }
    $('#year-grid').innerHTML = [...decades.entries()].map(([d, list]) => `
      <div class="decade">
        <span class="decade-name">${d}년대</span>
        <div class="decade-years">
          ${list.slice().sort((a, b) => a.year - b.year).map((y) => `
            <button type="button" class="year" data-year="${y.year}"
              aria-pressed="${chosen.has(y.year)}" ${!y.count || !host ? 'disabled' : ''}
              title="${y.count ? `${y.count}곡${y.verified ? '' : ' (샘플)'}` : '데이터 준비 중'}">
              ${String(y.year).slice(2)}${y.count && !y.verified ? '<i>샘플</i>' : ''}
            </button>`).join('')}
        </div>
      </div>`).join('');

    const order = ['songCount', 'roundTime', 'startMode', 'skipRule', 'scoring', 'revealTime'];
    $('#options').innerHTML = order.map((key) => `
      <div class="option">
        <span class="option-name">${LABELS[key].title}</span>
        <div class="seg" role="group" aria-label="${LABELS[key].title}">
          ${state.options[key].map((v) => `
            <button type="button" data-key="${key}" data-value="${v}" aria-pressed="${state.settings[key] === v}" ${host ? '' : 'disabled'}>
              ${LABELS[key].fmt(v)}
            </button>`).join('')}
        </div>
      </div>`).join('');

    const count = years.filter((y) => chosen.has(y.year)).reduce((n, y) => n + y.count, 0);
    $('#pick-hint').textContent = host
      ? '데이터가 있는 연도만 고를 수 있어요. 여러 해를 섞어도 돼요.'
      : '방장이 연도와 규칙을 고르고 있어요.';
    $('#start-note').textContent = chosen.size
      ? `${[...chosen].join(', ')}년 · 후보 ${count}곡 중 ${Math.min(count, state.settings.songCount)}곡`
      : '연도를 하나 이상 고르세요.';
    $('#btn-start').hidden = !host;
    $('#btn-start').disabled = !chosen.size;
  }

  $('#year-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-year]');
    if (!btn || btn.disabled) return;
    const y = Number(btn.dataset.year);
    const set = new Set(state.settings.years);
    if (set.has(y)) set.delete(y); else set.add(y);
    socket.emit('room:settings', { years: [...set] });
  });

  $('#options').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn || btn.disabled) return;
    const raw = btn.dataset.value;
    const value = /^\d+$/.test(raw) ? Number(raw) : raw;
    socket.emit('room:settings', { [btn.dataset.key]: value });
  });

  $('#btn-start').addEventListener('click', () => {
    socket.emit('game:start', null, (res) => { if (res?.error) toast(res.error); });
  });
  $('#btn-again').addEventListener('click', () => socket.emit('game:again'));

  // 노래방 가사처럼 힌트 줄을 쌓고, 시간 흐름을 노란 색칠로 보여준다
  function renderLyrics() {
    const r = state?.round;
    if (!r) return;
    const lines = state.status === 'loading'
      ? ['다음 곡 준비 중']
      : r.hints;
    const html = lines.map((h, i) => `<p class="${i === lines.length - 1 ? 'now' : ''}">${esc(h)}</p>`).join('');
    $('#lyrics-base').innerHTML = html;
    $('#lyrics-fill').innerHTML = html;
    $('#song-no').textContent = `No. ${String(r.index + 1).padStart(2, '0')}`;
  }

  function renderStatusLine() {
    const r = state?.round;
    if (!r) return;
    let text = '';
    if (state.status === 'loading') text = '음원을 찾는 중이에요';
    else if (!r.videoId) text = '음원 없이 힌트로만 진행하는 곡이에요';
    else text = '들리는 노래의 제목을 채팅으로 입력하세요';
    $('#screen-status').textContent = text;
  }

  function renderReveal() {
    const r = state.round;
    const a = r.answer;
    if (!a) return;
    const key = `${r.index}`;
    $('#reveal-title').textContent = a.title;
    $('#reveal-title').dataset.text = a.title;
    $('#reveal-artist').textContent = `${a.artist} · ${a.year}년${a.rank ? ` ${a.rank}위` : ''}`;

    const winner = state.players.find((p) => p.id === r.winnerId);
    const pts = pendingReveal && pendingReveal.points ? pendingReveal.points : null;
    $('#reveal-winner').innerHTML = winner
      ? `<div class="winner-avatar">${Avatar.svg(winner.avatar, { label: 'WIN' })}</div>
         <div class="winner-text"><strong>${esc(winner.nickname)}</strong>${pts ? `<span class="points">+${pts}</span>` : ''}</div>`
      : `<div class="winner-text none">${pendingReveal?.reason === 'skip' ? '넘겼어요' : '아무도 못 맞혔어요'}</div>`;

    if (lastRevealKey !== key) {
      lastRevealKey = key;
      const pane = $('#pane-reveal');
      pane.classList.remove('celebrate');
      void pane.offsetWidth; // 애니메이션 다시 시작
      if (winner) pane.classList.add('celebrate');
    }
  }

  function renderEnded() {
    const res = state.results;
    if (!res) return;
    $('#ranking').innerHTML = res.ranking.map((p) => `
      <li class="rank-row" data-place="${p.place}">
        <span class="rank-place">${p.place}</span>
        <span class="rank-avatar">${Avatar.svg(p.avatar)}</span>
        <span class="rank-name">${esc(p.nickname)}</span>
        <span class="rank-correct">${p.correct}곡</span>
        <span class="rank-score">${String(p.score).padStart(5, '0')}</span>
      </li>`).join('');
    $('#btn-again').hidden = !isHost();
  }

  function renderSeats() {
    const seats = [];
    const playing = state.status === 'playing' || state.status === 'reveal';
    for (let i = 0; i < 8; i += 1) {
      const p = state.players[i];
      if (!p) {
        seats.push('<div class="seat empty"><span>빈 자리</span></div>');
        continue;
      }
      const cls = [
        'seat',
        p.id === socket.id ? 'me' : '',
        state.round && state.round.winnerId === p.id && state.status === 'reveal' ? 'winner' : '',
        p.skipVote ? 'voted' : '',
        playing ? 'spin' : '',
      ].join(' ');
      seats.push(`
        <div class="${cls}" data-pid="${p.id}">
          <div class="bubble" hidden></div>
          ${p.skipVote ? '<span class="tag-skip">넘김</span>' : ''}
          <div class="seat-avatar">${Avatar.svg(p.avatar, { label: `${i + 1}P` })}</div>
          <div class="seat-name">${p.id === state.hostId ? '<span class="host" title="방장">방장</span>' : ''}${esc(p.nickname)}</div>
          <div class="seat-score">${String(p.score).padStart(5, '0')}</div>
        </div>`);
    }
    const prevBubbles = {};
    document.querySelectorAll('.seat .bubble:not([hidden])').forEach((b) => {
      prevBubbles[b.closest('.seat').dataset.pid] = b.textContent;
    });
    $('#seats').innerHTML = seats.join('');
    for (const [pid, text] of Object.entries(prevBubbles)) showBubble(pid, text, 1200);
  }

  // ---------- 재생 동기화 ----------
  function syncPlayer(force) {
    if (!state) return;
    const r = state.round;
    const live = (state.status === 'playing' || state.status === 'reveal') && r && r.videoId;
    $('#screen').dataset.video = live && state.status === 'reveal' ? 'show' : 'hide';
    if (!live) {
      if (QuizPlayer.currentId) QuizPlayer.stop();
      return;
    }
    if (force || QuizPlayer.currentId !== r.videoId) {
      QuizPlayer.play({ videoId: r.videoId, startSeconds: r.startSeconds, startedAt: r.startedAt, clockOffset });
    }
  }

  QuizPlayer.init({
    onError: (videoId) => socket.emit('video:error', { videoId }),
    onBlocked: () => { $('#sound-gate').hidden = false; },
    onPlaying: () => { $('#sound-gate').hidden = true; },
  });
  $('#sound-gate').addEventListener('click', () => {
    QuizPlayer.resume();
    $('#sound-gate').hidden = true;
  });
  $('#volume').addEventListener('input', (e) => QuizPlayer.setVolume(Number(e.target.value)));

  // ---------- 시계 (매 프레임) ----------
  function tick() {
    requestAnimationFrame(tick);
    if (!state || !state.round) return;
    const r = state.round;
    const now = Date.now() + clockOffset;
    if (state.status === 'playing') {
      const elapsed = Math.max(0, (now - r.startedAt) / 1000);
      const remain = Math.max(0, r.roundTime - elapsed);
      const p = Math.min(1, elapsed / r.roundTime);
      $('#countdown').textContent = now < r.startedAt ? '준비' : String(Math.ceil(remain));
      $('#countdown').dataset.low = remain <= 5 ? 'true' : 'false';
      $('#lyrics-fill').style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
    } else if (state.status === 'loading') {
      $('#countdown').textContent = '…';
      $('#lyrics-fill').style.clipPath = 'inset(0 100% 0 0)';
    } else if (state.status === 'reveal' && r.revealEndsAt) {
      const left = Math.max(0, Math.ceil((r.revealEndsAt - now) / 1000));
      const votes = state.players.filter((p) => p.skipVote).length;
      const last = r.index + 1 >= r.total;
      $('#reveal-next').textContent = `${last ? '결과 발표' : '다음 곡'}까지 ${left}초 · 넘기기 ${votes}/${r.skipNeeded}`;
    }
  }
  requestAnimationFrame(tick);

  // ---------- 채팅 ----------
  function timeLabel(ms) {
    return new Date(ms).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  }

  function colorOf(pid) {
    const p = state?.players.find((x) => x.id === pid);
    return p ? Avatar.COLORS[p.avatar.color].dark : '#141A4A';
  }

  function addChat(m) {
    const log = $('#chat-log');
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const row = document.createElement('p');
    if (m.kind === 'system') {
      row.className = `msg sys tone-${m.tone || 'info'}`;
      row.innerHTML = `<span class="msg-text">${esc(m.text)}</span><time>${timeLabel(m.at)}</time>`;
    } else {
      row.className = `msg${m.playerId === socket.id ? ' mine' : ''}`;
      row.innerHTML = `<b style="color:${colorOf(m.playerId)}">${esc(m.nickname)}</b><span class="msg-text">${esc(m.text)}</span><time>${timeLabel(m.at)}</time>`;
      showBubble(m.playerId, m.text, 2600);
    }
    log.appendChild(row);
    while (log.children.length > 200) log.firstChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
  }

  const bubbleTimers = {};
  function showBubble(pid, text, ms) {
    const seat = document.querySelector(`.seat[data-pid="${CSS.escape(pid)}"] .bubble`);
    if (!seat) return;
    seat.textContent = text;
    seat.hidden = false;
    clearTimeout(bubbleTimers[pid]);
    bubbleTimers[pid] = setTimeout(() => {
      const b = document.querySelector(`.seat[data-pid="${CSS.escape(pid)}"] .bubble`);
      if (b) b.hidden = true;
    }, ms);
  }

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    input.value = '';
  });

  $('#btn-skip').addEventListener('click', () => socket.emit('game:skip'));

  document.addEventListener('keydown', (e) => {
    if ($('#view-room').hidden) return;
    const typing = document.activeElement === $('#chat-input');
    if (e.key === 'Escape' && typing) { $('#chat-input').blur(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === 'k' || e.key === 'K' || e.key === 'ㅏ') {
      e.preventDefault();
      socket.emit('game:skip');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      $('#chat-input').focus();
    }
  });

  // ---------- 알림 ----------
  let toastTimer = null;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  renderProfile();
})();

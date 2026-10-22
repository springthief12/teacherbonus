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
    soundOn: { title: '노래 소리', fmt: (v) => ({ host: '방장 기기만', all: '모든 기기' }[v]) },
  };
  const OPTION_ORDER = ['songCount', 'roundTime', 'startMode', 'soundOn', 'skipRule', 'scoring', 'revealTime'];
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
    $('#avatar-preview').innerHTML = Avatar.svg(profile.avatar);
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

  // 기기 열쇠: 이 기기를 알아보는 비밀 값 (끊겼다 다시 와도 같은 자리·점수, 방을 만든 사람은 방장 복귀)
  const randomHex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const deviceKey = (() => {
    try {
      let k = localStorage.getItem('songquiz.key');
      if (!k) { k = randomHex(); localStorage.setItem('songquiz.key', k); }
      return k;
    } catch {
      return randomHex();
    }
  })();

  // 이 탭이 들어가 있던 방 (새로고침·재연결 때 자동으로 다시 들어감)
  const savedRoom = {
    get() { try { return sessionStorage.getItem('songquiz.room'); } catch { return null; } },
    set(id) { try { sessionStorage.setItem('songquiz.room', id); } catch { /* 무시 */ } },
    clear() { try { sessionStorage.removeItem('songquiz.room'); } catch { /* 무시 */ } },
  };

  // ---------- 연결 ----------
  // 처음부터 웹소켓으로 바로 연결한다 (예전 방식은 HTTP 요청을 몇 번 주고받은 뒤에야 웹소켓으로 바뀜).
  // 학교망처럼 웹소켓이 막힌 곳에서는 자동으로 예전 방식(HTTP 폴링)으로 바꿔 연결한다.
  const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
  socket.on('connect_error', () => { socket.io.opts.transports = ['polling', 'websocket']; });
  let myId = null; // 방 안에서 내 공개 id
  let state = null; // room:state
  let clockOffset = 0; // 서버시각 - 내시각
  let years = [];
  let lastRevealKey = null;
  let inviteRoom = new URLSearchParams(location.search).get('room');
  let inviteChecked = false;

  function enterLobby() {
    return new Promise((resolve) => {
      socket.emit('lobby:enter', { ...profile, key: deviceKey }, (res) => {
        if (res?.ok) {
          years = res.years;
          renderRooms(res.rooms);
          if (res.renamed) {
            // 닉네임에 비속어가 있으면 서버가 가린 이름으로 바꾼다
            profile.nickname = res.profile.nickname;
            saveProfile();
            $('#nickname').value = profile.nickname;
            toast('닉네임에 쓸 수 없는 표현이 있어서 바꿨어요.');
          }
        }
        resolve(res);
      });
    });
  }

  const emitJoin = (roomId) => new Promise((resolve) => socket.emit('room:join', { roomId }, resolve));

  socket.on('connect', async () => {
    $('#conn-state').textContent = '연결됨';
    $('#conn-state').dataset.on = 'true';
    $('#net-banner').hidden = true;
    const wasInRoom = Boolean(state);
    await enterLobby();

    // 끊기기 전에 있던 방(또는 새로고침 전의 방)으로 자동 복귀
    const target = state?.id || savedRoom.get();
    if (target && (!inviteRoom || inviteRoom === target)) {
      const res = await emitJoin(target);
      if (res?.ok) {
        myId = res.you;
        savedRoom.set(target);
        if (inviteRoom === target) clearInvite();
        showView('room');
        renderRoom();
        if (wasInRoom) toast('다시 연결됐어요.');
        return;
      }
      savedRoom.clear();
      if (wasInRoom) toast('방이 닫혀서 로비로 돌아왔어요.');
    }
    if (wasInRoom) {
      state = null;
      QuizPlayer.stop();
      showView('lobby');
    }
  });
  socket.on('disconnect', () => {
    $('#conn-state').textContent = '연결 끊김 · 다시 연결 중';
    $('#conn-state').dataset.on = 'false';
    if (state) $('#net-banner').hidden = false;
  });

  socket.on('room:replaced', () => {
    state = null;
    myId = null;
    savedRoom.clear();
    QuizPlayer.stop();
    showView('lobby');
    toast('다른 창에서 이 방에 들어와서, 이 창은 로비로 나왔어요.');
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
    renderHints();
  });

  socket.on('round:video', (d) => {
    if (!state?.round) return;
    clockOffset = d.serverNow - Date.now();
    state.round.videoId = d.videoId;
    syncPlayer();
    renderStatusLine();
  });

  socket.on('round:reveal', (d) => {
    lastRevealKey = null; // renderReveal에서 연출 다시 실행
    pendingReveal = d;
    celebrateNext = d.reason === 'correct' ? d.winnerId : null; // 바로 뒤에 오는 방 정보를 그린 다음 폭죽
    if (hearsMusic()) Sfx.play({ correct: 'correct', skip: 'skip', timeout: 'timeout' }[d.reason]);
    // 학생 휴대폰: 내가 맞히면 짧게 진동 (안드로이드)
    if (d.reason === 'correct' && d.winnerId === myId && navigator.vibrate) navigator.vibrate(60);
  });
  let pendingReveal = null;
  let celebrateNext = null;

  socket.on('chat', addChat);

  // ---------- 로비 ----------
  function renderInvite(list) {
    if (!inviteRoom) { $('#invite').hidden = true; return; }
    const room = (list || []).find((r) => r.id === inviteRoom);
    if (!room) {
      $('#invite').hidden = true;
      if (!inviteChecked && list) toast('초대받은 방이 이미 닫혔어요. 열린 방 목록에서 골라 주세요.');
      inviteChecked = true;
      return;
    }
    if (!inviteChecked) {
      inviteChecked = true;
      $('#nickname').focus();
    }
    $('#invite-room').textContent = `[${room.id}] ${room.title}`;
    $('#invite').hidden = false;
  }

  function clearInvite() {
    inviteRoom = null;
    $('#invite').hidden = true;
    if (location.search) history.replaceState(null, '', location.pathname);
  }

  async function joinRoom(roomId) {
    QuizPlayer.unlock(); // 휴대폰: 버튼을 누른 순간 소리 재생을 허락받아 둔다
    await enterLobby();
    $('#chat-log').innerHTML = '';
    const res = await emitJoin(roomId);
    if (res?.error) return toast(res.error);
    if (roomId === inviteRoom) clearInvite();
    openRoom(res);
  }

  $('#invite-join').addEventListener('click', () => { if (inviteRoom) joinRoom(inviteRoom); });

  function renderRooms(list) {
    renderInvite(list);
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
    joinRoom(btn.dataset.join);
  });

  $('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    QuizPlayer.unlock();
    await enterLobby();
    $('#chat-log').innerHTML = '';
    socket.emit('room:create', { title: $('#room-title').value }, (res) => {
      if (res?.error) return toast(res.error);
      $('#room-title').value = '';
      clearInvite();
      openRoom(res);
    });
  });

  function openRoom(res) {
    myId = res.you;
    savedRoom.set(res.roomId);
    showView('room');
    qrOpen = null;
    qrShownFor = null;
    prevStatus = null;
    soundMark = null;
    prevScores = {};
    renderRoom(); // 방 정보가 '내 번호'보다 먼저 도착하므로 다시 그린다
    // 휴대폰에서는 들어오자마자 키보드가 올라오지 않게 한다
    if (!isTouch) $('#chat-input').focus();
  }

  // ---------- 접속 QR (대기실에서 펼치기/접기) ----------
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
  let joinInfo = null;
  let qrOpen = null; // null이면 기본값: 방장 + 대기 중일 때 펼침
  let qrShownFor = null;
  let prevStatus = null;
  let qrUrl = '';

  const qrIsOpen = () => (qrOpen === null ? isHost() && state.status === 'waiting' : qrOpen);

  async function loadJoinInfo() {
    if (joinInfo) return joinInfo;
    try {
      joinInfo = await (await fetch('/api/join-info')).json();
    } catch {
      joinInfo = { lan: [], port: Number(location.port) || null };
    }
    return joinInfo;
  }

  // 선생님 PC에서 localhost로 열었으면 학생용 주소는 같은 와이파이 IP로 바꾼다
  function joinBase() {
    if (!LOCAL_HOSTS.includes(location.hostname)) return { base: location.origin, kind: 'public' };
    const ip = $('#qr-lan').value || (joinInfo.lan || [])[0];
    if (!ip) return { base: location.origin, kind: 'local-only' };
    const port = location.port || joinInfo.port;
    return { base: `${location.protocol}//${ip}${port ? `:${port}` : ''}`, kind: 'lan' };
  }

  async function renderQr() {
    if (!state) return;
    const open = qrIsOpen();
    $('#qr-panel').hidden = !open;
    $('#btn-qr').setAttribute('aria-expanded', String(open));
    $('#btn-qr').textContent = open ? 'QR 접기' : '접속 QR';
    if (!open) return;

    await loadJoinInfo();
    const lan = joinInfo.lan || [];
    const showLan = LOCAL_HOSTS.includes(location.hostname) && lan.length > 1;
    $('#qr-lan-wrap').hidden = !showLan;
    if (showLan && $('#qr-lan').options.length !== lan.length) {
      $('#qr-lan').innerHTML = lan.map((ip) => `<option>${esc(ip)}</option>`).join('');
    }

    const { base, kind } = joinBase();
    qrUrl = `${base}/?room=${encodeURIComponent(state.id)}`;
    $('#qr-room').textContent = `[${state.id}] ${state.title}`;
    $('#qr-url').textContent = qrUrl;
    $('#qr-note').textContent = {
      lan: '선생님 PC와 같은 와이파이에 연결된 기기만 들어올 수 있어요.',
      'local-only': '이 PC의 와이파이 주소를 찾지 못했어요. 네트워크 연결을 확인하세요.',
      public: '',
    }[kind];

    const key = `${state.id}|${qrUrl}`;
    if (qrShownFor !== key) {
      qrShownFor = key;
      $('#qr-code').innerHTML = `<img src="/api/qr?text=${encodeURIComponent(qrUrl)}" width="220" height="220" alt="이 방 접속 QR 코드">`;
    }
  }

  $('#btn-qr').addEventListener('click', () => { qrOpen = !qrIsOpen(); renderQr(); });
  $('#qr-close').addEventListener('click', () => { qrOpen = false; renderQr(); $('#btn-qr').focus(); });
  $('#qr-lan').addEventListener('change', () => renderQr());
  $('#qr-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(qrUrl);
    } catch {
      // http 주소에서는 clipboard API가 막혀 있을 수 있어 예전 방식으로 복사
      const t = document.createElement('textarea');
      t.value = qrUrl;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    toast('주소를 복사했어요.');
  });

  $('#btn-leave').addEventListener('click', () => {
    socket.emit('room:leave', null, (res) => {
      state = null;
      myId = null;
      savedRoom.clear();
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
  const isHost = () => Boolean(state && myId && state.hostId === myId);
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  function renderRoom() {
    if (!state) return;
    const s = state;
    $('#room-no').textContent = s.id;
    $('#room-title-text').textContent = s.title;
    $('#room-meta').textContent = `${s.settings.years.join(', ') || '연도 미정'} · ${s.players.length}/8명 · ${STATUS_TEXT[s.status]}`;

    const r = s.round;
    const votes = s.players.filter((p) => p.skipVote).length;

    // 진행과 정답 공개는 같은 힌트 화면을 쓴다 (공개 때 세 칸이 모두 채워짐)
    const pane = { waiting: 'waiting', loading: 'play', playing: 'play', reveal: 'play', ended: 'ended' }[s.status];
    $('#view-room').dataset.mode = pane === 'play' ? 'game' : 'room';
    for (const name of ['waiting', 'play', 'ended']) $(`#pane-${name}`).hidden = name !== pane;
    $('#screen').dataset.status = s.status;

    if (pane === 'waiting') renderWaiting();
    if (pane === 'play') { renderHints(); renderResult(); renderStatusLine(); }
    if (pane === 'ended') renderEnded();

    renderSeats();
    renderBoard();
    if (celebrateNext && s.status === 'reveal' && r && r.winnerId === celebrateNext) {
      celebrateNext = null;
      celebrate(r.winnerId);
    }
    syncPlayer();
    playEventSounds();
    $('#volume-wrap').hidden = !hearsMusic();

    // 게임이 시작되면 QR을 자동으로 접는다 (다시 펼칠 수 있음)
    if (prevStatus === 'waiting' && s.status !== 'waiting' && qrOpen !== false) qrOpen = false;
    prevStatus = s.status;
    renderQr();

    const me = s.players.find((p) => p.id === myId);
    const canSkip = s.status === 'playing' || s.status === 'reveal';
    for (const btn of [$('#btn-skip'), $('#btn-skip-mini')]) {
      btn.setAttribute('aria-pressed', String(Boolean(me?.skipVote)));
      btn.disabled = !canSkip;
    }
    $('#mini-meta').textContent = r && canSkip ? `넘기기 ${votes}/${r.skipNeeded}` : '';
  }

  function renderWaiting() {
    const host = isHost();
    // 학생 화면: 설정 버튼 대신 읽기 전용 요약만 보여 준다
    $('#year-grid').hidden = !host;
    $('#options').hidden = !host;
    $('#settings-summary').hidden = host;
    $('#pick-title').textContent = host ? '연도 고르기' : '방장이 게임을 준비하고 있어요';
    if (!host) {
      const st = state.settings;
      const items = [
        ['연도', st.years.length ? st.years.map((y) => `${y}년`).join(', ') : '아직 안 정함'],
        ...OPTION_ORDER.map((k) => [LABELS[k].title, LABELS[k].fmt(st[k])]),
      ];
      $('#settings-summary').innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(String(v))}</dd></div>`).join('');
    }
    const chosen = new Set(state.settings.years);
    // 2008~2026년을 한 줄로 (데이터가 없는 해는 '준비 중'으로 눌리지 않음)
    $('#year-grid').innerHTML = years.slice().sort((a, b) => a.year - b.year).map((y) => `
      <button type="button" class="year" data-year="${y.year}"
        aria-pressed="${chosen.has(y.year)}" ${!y.count || !host ? 'disabled' : ''}
        title="${y.count ? `${y.count}곡` : '데이터 준비 중'}">${y.year}</button>`).join('');

    $('#options').innerHTML = OPTION_ORDER.map((key) => `
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
      : '설정은 방장만 바꿀 수 있어요. 시작되면 바로 노래가 나와요.';
    $('#start-note').textContent = !host ? '' : chosen.size
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

  // 힌트 3칸: 연도 → 가수 → 제목 초성. 아직 안 열린 칸은 '곧 공개'
  // 정답이 공개되면 같은 세 칸이 모두 채워진다 (제목 칸은 초성 대신 전체 제목)
  const HINT_SLOTS = [
    { key: 'year', label: '연도' },
    { key: 'artist', label: '가수' },
    { key: 'chosung', label: '제목 초성', revealLabel: '제목' },
  ];
  let hintMark = '';
  function renderHints() {
    const r = state?.round;
    if (!r) return;
    const loading = state.status === 'loading';
    const a = state.status === 'reveal' ? r.answer : null;
    const got = new Map((r.hints || []).map((h) => [h.key, h]));
    const latest = r.hints && r.hints.length ? r.hints[r.hints.length - 1].key : null;
    const mark = `${r.index}|${(r.hints || []).length}|${a ? 'reveal' : ''}`;
    const fresh = mark !== hintMark; // 새로 열린 칸만 살짝 나타나게
    hintMark = mark;

    const revealed = a ? {
      year: `${a.year}년<small>${a.rank ? `${a.rank}위` : ''}</small>`,
      artist: esc(a.artist),
      chosung: esc(a.title),
    } : null;

    $('#hints').innerHTML = HINT_SLOTS.map((slot) => {
      if (revealed) {
        const answerRow = slot.key === 'chosung';
        const cls = ['hint', 'open', answerRow ? 'answer' : '', answerRow && fresh ? 'fresh' : ''].join(' ');
        return `<div class="${cls}"><dt>${slot.revealLabel || slot.label}</dt><dd>${revealed[slot.key]}</dd></div>`;
      }
      const h = got.get(slot.key);
      const cls = ['hint', h ? 'open' : 'locked', h && slot.key === latest ? 'latest' : '', h && slot.key === latest && fresh ? 'fresh' : ''].join(' ');
      return `<div class="${cls}"><dt>${slot.label}</dt><dd>${h ? esc(h.value) : (loading ? '준비 중' : '곧 공개')}</dd></div>`;
    }).join('');
    $('#song-no').textContent = String(r.index + 1);
    $('#song-total').textContent = `/ ${r.total}`;
    $('#q-progress').innerHTML = Array.from({ length: r.total }, (_, i) =>
      `<i class="${i < r.index ? 'done' : i === r.index ? 'now' : ''}"></i>`).join('');
  }

  function revealStatusText() {
    const r = state.round;
    if (!r || !r.revealEndsAt) return '';
    const leftMs = Math.max(0, r.revealEndsAt - (Date.now() + clockOffset));
    return `${r.index + 1 >= r.total ? '결과 발표' : '다음 곡'}까지 ${Math.ceil(leftMs / 1000)}초`;
  }

  function renderStatusLine() {
    const r = state?.round;
    if (!r) return;
    let text = '';
    if (state.status === 'loading') text = '다음 곡을 준비하고 있어요';
    else if (state.status === 'reveal') text = revealStatusText(); // 비워 두면 한 프레임 동안 줄이 접혀 화면이 튄다
    else if (!r.videoId && !r.audioUrl) text = '음원 없이 힌트로만 진행하는 곡이에요';
    else if (!hearsMusic()) text = '방장 화면에서 나오는 노래를 듣고 제목을 입력하세요';
    else text = '들리는 노래의 제목을 채팅으로 입력하세요';
    $('#screen-status').textContent = text;
  }

  // 머리줄의 결과 표시: 정답 공개 때 맞힌 사람(+점수) 또는 '아무도 못 맞혔어요'
  function renderResult() {
    const el = $('#q-result');
    const r = state.round;
    if (state.status !== 'reveal' || !r) { el.innerHTML = ''; el.className = 'q-result'; lastRevealKey = null; return; }
    const winner = state.players.find((p) => p.id === r.winnerId);
    const pts = pendingReveal && pendingReveal.points ? pendingReveal.points : null;
    el.className = `q-result ${winner ? 'won' : 'none'}`;
    el.innerHTML = winner
      ? `<span class="q-result-avatar">${Avatar.svg(winner.avatar)}</span><strong>${esc(winner.nickname)}</strong>${pts ? `<span class="points">+${pts}</span>` : ''}`
      : `<span>${pendingReveal?.reason === 'skip' ? '넘겼어요' : '아무도 못 맞혔어요'}</span>`;
    const key = `${r.index}`;
    if (lastRevealKey !== key) {
      lastRevealKey = key;
      el.classList.remove('pop');
      void el.offsetWidth; // 애니메이션 다시 시작
      el.classList.add('pop');
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
        <span class="rank-score">${p.score}<small>점</small></span>
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
        p.id === myId ? 'me' : '',
        p.away ? 'away' : '',
        state.round && state.round.winnerId === p.id && state.status === 'reveal' ? 'winner' : '',
        p.skipVote ? 'voted' : '',
        playing ? 'live' : '',
      ].join(' ');
      seats.push(`
        <div class="${cls}" data-pid="${p.id}">
          <div class="bubble" hidden></div>
          ${p.skipVote ? '<span class="tag-skip">넘김</span>' : ''}
          ${p.away ? '<span class="tag-away">연결 끊김</span>' : ''}
          <div class="seat-avatar">${Avatar.svg(p.avatar)}</div>
          <div class="seat-name">${p.id === state.hostId ? '<span class="host" title="방장">방장</span>' : ''}${esc(p.nickname)}</div>
          <div class="seat-score">${p.score}<small>점</small></div>
        </div>`);
    }
    $('#seats').innerHTML = seats.join('');
    for (const pid of Object.keys(bubbles)) paintBubble(pid, false);
  }

  // ---------- 왼쪽 순위판 ----------
  let prevScores = {};
  function renderBoard() {
    const players = state.players.slice().sort((x, y) => y.score - x.score || y.correct - x.correct);
    let place = 0;
    let lastScore = null;
    const rows = players.map((p, i) => {
      if (p.score !== lastScore) { place = i + 1; lastScore = p.score; }
      const gained = prevScores[p.id] !== undefined && p.score > prevScores[p.id];
      return `
        <li class="board-row${p.id === myId ? ' me' : ''}${p.away ? ' away' : ''}${gained ? ' up' : ''}" data-place="${place}">
          <span class="board-place">${place}</span>
          <span class="board-avatar">${Avatar.svg(p.avatar)}</span>
          <span class="board-name">${esc(p.nickname)}</span>
          <span class="board-score">${p.score}</span>
        </li>`;
    });
    $('#board-list').innerHTML = rows.join('');
    prevScores = Object.fromEntries(state.players.map((p) => [p.id, p.score]));
  }

  // ---------- 효과음 ----------
  // 정답·넘기기·다음 곡 소리는 노래가 나오는 기기에서만, 버튼 소리는 누른 기기에서
  let soundMark = null;
  function playEventSounds() {
    const s = state;
    const votes = s.players.filter((p) => p.skipVote).length;
    const mark = { status: s.status, index: s.round ? s.round.index : -1, votes };
    const prev = soundMark;
    soundMark = mark;
    if (!prev || !hearsMusic()) return;
    if (s.status === 'playing' && (prev.status !== 'playing' || prev.index !== mark.index)) {
      Sfx.play(mark.index === 0 ? 'start' : 'next');
    } else if (s.status === 'ended' && prev.status !== 'ended') {
      Sfx.play('end');
    } else if (votes > prev.votes && prev.index === mark.index && prev.status === s.status) {
      Sfx.play('vote');
    }
  }

  function renderSfxToggle() {
    const on = Sfx.enabled;
    $('#btn-sfx').setAttribute('aria-pressed', String(on));
    $('#btn-sfx').textContent = on ? '효과음 켬' : '효과음 끔';
  }
  $('#btn-sfx').addEventListener('click', () => { Sfx.setEnabled(!Sfx.enabled); renderSfxToggle(); });
  Sfx.onDuck((ms) => QuizPlayer.duck(ms));
  renderSfxToggle();

  // 모든 버튼: 누를 때 작은 '톡'
  document.addEventListener('click', (e) => {
    if (e.target.closest('button:not(:disabled)')) Sfx.play('click');
  }, true);

  // ---------- 재생 동기화 ----------
  // 이 기기에서 노래를 틀지: 기본은 방장 기기(전자칠판)만, 설정에서 '모든 기기'로 바꿀 수 있음
  const hearsMusic = () => Boolean(state) && (state.settings.soundOn === 'all' || isHost());

  // 소리만 재생한다 (영상은 화면에 나오지 않음)
  function syncPlayer() {
    if (!state) return;
    const r = state.round;
    const live = hearsMusic() && (state.status === 'playing' || state.status === 'reveal') && r && (r.audioUrl || r.videoId);
    if (!live) {
      if (QuizPlayer.current) QuizPlayer.stop();
      return;
    }
    QuizPlayer.play({
      audioUrl: r.audioUrl,
      videoId: r.videoId,
      startSeconds: r.startSeconds,
      startedAt: r.startedAt,
      clockOffset,
    });
  }

  QuizPlayer.init({
    onError: (src) => { if (src.videoId) socket.emit('video:error', { videoId: src.videoId }); },
    onBlocked: () => { $('#sound-gate').hidden = false; },
    onPlaying: () => { $('#sound-gate').hidden = true; },
  });
  $('#sound-gate').addEventListener('click', () => {
    QuizPlayer.resume();
    $('#sound-gate').hidden = true;
  });
  $('#volume').addEventListener('input', (e) => QuizPlayer.setVolume(Number(e.target.value)));

  // ---------- 정답 축하: 정답자 자리에서 폭죽 + 캐릭터 춤 ----------
  // 춤은 CSS(.seat.winner)가 맡고, 여기서는 폭죽 조각을 화면 맨 위 층에 뿌린다
  // (자리 카드는 방 정보가 올 때마다 다시 그려지므로 그 안에 넣으면 폭죽이 중간에 끊긴다)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const FX_COLORS = ['#FFD84A', '#F2C318', '#2E9C6A', '#D9634B', '#9CCBF5', '#F7AFCB', '#C7B6F5'];
  let fxLayer = null;

  function shownRect(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) return null;
    return r;
  }

  function celebrate(pid) {
    if (reduceMotion.matches) return;
    // 자리 카드가 안 보이면(휴대폰에서 키보드가 올라와 있을 때) 위쪽 '정답자' 표시에서 터뜨린다
    const at = shownRect(document.querySelector(`.seat[data-pid="${CSS.escape(pid)}"] .seat-avatar`))
      || shownRect(document.querySelector('#q-result .q-result-avatar'));
    if (!at) return;
    if (!fxLayer) {
      fxLayer = document.createElement('div');
      fxLayer.className = 'fx-layer';
      fxLayer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(fxLayer);
    }
    const p = state.players.find((x) => x.id === pid);
    const own = p && Avatar.COLORS[p.avatar.color] ? Avatar.COLORS[p.avatar.color].body : null;
    const colors = own ? [own, ...FX_COLORS] : FX_COLORS;
    const size = Math.max(30, at.width);
    const x = at.left + at.width / 2;
    const y = at.top + at.height / 2;
    burst(x, y, size, colors, 0); // 팡
    burst(x + size * 0.45 * (Math.random() < 0.5 ? -1 : 1), y - size * 0.35, size * 0.75, colors.slice(1), 280); // 팡
    if (hearsMusic()) Sfx.play('pop');
  }

  function burst(x, y, size, colors, delay) {
    const g = document.createElement('div');
    g.className = 'fx-burst';
    g.style.left = `${Math.round(x)}px`;
    g.style.top = `${Math.round(y)}px`;
    const n = isTouch ? 16 : 26;
    const unit = Math.max(5, size * 0.1); // 조각 크기는 캐릭터 크기에 맞춘다 (전자칠판에서는 크게)
    let html = `<i class="fx-ring" style="--s:${Math.round(size * 2.4)}px;--c:${colors[0]};--delay:${delay}ms"></i>`;
    for (let i = 0; i < n; i += 1) {
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const dist = size * (0.9 + Math.random() * 1.1);
      const ribbon = i % 3 === 0; // 셋 중 하나는 길쭉한 종이 조각
      const w = ribbon ? unit * 0.75 : unit * (1 + Math.random() * 0.7);
      const h = ribbon ? unit * (2.2 + Math.random() * 0.8) : w;
      html += `<i class="fx-bit" style="--dx:${(Math.cos(angle) * dist).toFixed(1)}px;--dy:${(Math.sin(angle) * dist * 0.8 - size * 0.25).toFixed(1)}px;`
        + `--fall:${Math.round(size * (0.45 + Math.random() * 0.5))}px;--rot:${Math.round(Math.random() * 540 - 270)}deg;`
        + `--c:${colors[i % colors.length]};--w:${w.toFixed(1)}px;--h:${h.toFixed(1)}px;--br:${ribbon ? '2px' : '50%'};`
        + `--dur:${Math.round(950 + Math.random() * 450)}ms;--delay:${delay}ms"></i>`;
    }
    g.innerHTML = html;
    fxLayer.appendChild(g);
    setTimeout(() => g.remove(), delay + 1700);
  }

  // ---------- 시계 (매 프레임) ----------
  const TIMER_LEN = 2 * Math.PI * 19; // 원형 타이머 둘레
  function tick() {
    requestAnimationFrame(tick);
    if (!state || !state.round) return;
    const r = state.round;
    const now = Date.now() + clockOffset;
    if (state.status === 'playing') {
      const elapsed = Math.max(0, (now - r.startedAt) / 1000);
      const remain = Math.max(0, r.roundTime - elapsed);
      const p = Math.min(1, elapsed / r.roundTime);
      $('#countdown').textContent = now < r.startedAt ? '…' : String(Math.ceil(remain));
      $('#timer').dataset.mode = remain <= 5 ? 'low' : 'play';
      $('#timer-arc').style.strokeDashoffset = String(TIMER_LEN * p);
    } else if (state.status === 'loading') {
      $('#countdown').textContent = '…';
      $('#timer').dataset.mode = 'play';
      $('#timer-arc').style.strokeDashoffset = '0';
    } else if (state.status === 'reveal' && r.revealEndsAt) {
      // 정답 공개 중: 원형 타이머는 다음 곡까지 남은 시간
      const leftMs = Math.max(0, r.revealEndsAt - now);
      const hold = r.winnerId ? state.settings.revealTime * 1000 : 4000;
      $('#countdown').textContent = String(Math.ceil(leftMs / 1000));
      $('#timer').dataset.mode = 'next';
      $('#timer-arc').style.strokeDashoffset = String(TIMER_LEN * (1 - Math.min(1, leftMs / hold)));
      $('#screen-status').textContent = revealStatusText();
    }
  }
  requestAnimationFrame(tick);

  // ---------- 채팅 ----------
  function timeLabel(ms) {
    return new Date(ms).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  }

  function colorOf(pid) {
    const p = state?.players.find((x) => x.id === pid);
    return p ? Avatar.COLORS[p.avatar.color].dark : '#5A4632';
  }

  function addChat(m) {
    const log = $('#chat-log');
    // 내가 보낸 글이 서버를 거쳐 돌아오면, 미리 띄워 둔 '보내는 중' 줄을 확정한다 (두 번 나오지 않게)
    const waiting = m.cid && m.playerId === myId ? sentChats.get(m.cid) : null;
    if (waiting) {
      sentChats.delete(m.cid);
      clearTimeout(waiting.timer);
      waiting.row.className = `msg mine${m.blinded ? ' blinded' : ''}`;
      waiting.row.querySelector('.msg-text').textContent = m.text; // 비속어는 가려진 글로 바뀜
      showBubble(m.playerId, m.text);
      return waiting.row;
    }
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const row = document.createElement('p');
    if (m.kind === 'system') {
      row.className = `msg sys tone-${m.tone || 'info'}`;
      row.innerHTML = `<span class="msg-text">${esc(m.text)}</span><time>${timeLabel(m.at)}</time>`;
    } else {
      row.className = `msg${m.playerId === myId ? ' mine' : ''}${m.blinded ? ' blinded' : ''}${m.pending ? ' pending' : ''}`;
      row.innerHTML = `<b style="color:${colorOf(m.playerId)}">${esc(m.nickname)}</b><span class="msg-text">${esc(m.text)}</span><time>${timeLabel(m.at)}</time>`;
      if (!m.pending) showBubble(m.playerId, m.text);
    }
    log.appendChild(row);
    while (log.children.length > 200) log.firstChild.remove();
    if (stick || m.pending) log.scrollTop = log.scrollHeight;
    return row;
  }

  // 말풍선: 채팅이 캐릭터 위에 5초 동안 보이고 사라짐. 그 사이 새 채팅이 오면 바로 바뀌고 5초를 다시 셈
  const BUBBLE_MS = 5000;
  const bubbles = {}; // pid -> { text, until, timer }

  function bubbleEl(pid) {
    return document.querySelector(`.seat[data-pid="${CSS.escape(pid)}"] .bubble`);
  }

  function paintBubble(pid, fresh) {
    const b = bubbles[pid];
    const el = bubbleEl(pid);
    if (!b || !el) return;
    if (Date.now() >= b.until) { el.hidden = true; return; }
    el.textContent = b.text;
    el.hidden = false;
    if (fresh) {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  function showBubble(pid, text) {
    const prev = bubbles[pid];
    if (prev) clearTimeout(prev.timer);
    const entry = { text, until: Date.now() + BUBBLE_MS };
    entry.timer = setTimeout(() => {
      if (bubbles[pid] !== entry) return;
      delete bubbles[pid];
      const el = bubbleEl(pid);
      if (el) el.hidden = true;
    }, BUBBLE_MS);
    bubbles[pid] = entry;
    paintBubble(pid, true);
  }

  // 보낸 글: 서버 확인을 기다리는 동안 흐리게 먼저 보여 준다
  const sentChats = new Map(); // cid -> { row, timer }
  let cidSeq = 0;

  function settleChat(cid, res, text) {
    const entry = sentChats.get(cid);
    if (!entry) return; // 이미 채팅으로 돌아와 확정됨
    sentChats.delete(cid);
    clearTimeout(entry.timer);
    const row = entry.row;
    if (res && res.ok && res.correct) {
      row.className = 'msg mine correct'; // 정답은 채팅으로 퍼지지 않고 내 화면에만 초록색으로 남는다
    } else if (res && res.ok && res.kind === 'skip') {
      row.remove();
    } else if (res && res.reason === 'fast') {
      row.className = 'msg mine failed';
      toast('너무 빨리 보내고 있어요. 잠깐 쉬었다가 다시 보내 주세요.');
      const input = $('#chat-input');
      if (!input.value) input.value = text; // 한 번만 다시 누르면 되게 입력창에 되돌려 둔다
    } else if (res && res.ok) {
      row.classList.remove('pending');
    } else {
      row.remove();
    }
  }

  function sendChat() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    cidSeq += 1;
    const cid = `${Date.now().toString(36)}${cidSeq.toString(36)}`;
    const me = state?.players.find((p) => p.id === myId);
    const row = addChat({ kind: 'player', playerId: myId, nickname: me ? me.nickname : profile.nickname, text, at: Date.now(), pending: true });
    // 응답이 늦으면(연결 불안정) '확인 중' 표시
    const timer = setTimeout(() => row.classList.add('slow'), 2500);
    sentChats.set(cid, { row, timer });
    socket.emit('chat', { text, cid }, (res) => settleChat(cid, res, text));
    input.value = '';
    guardLeftover(text);
  }

  // 한글 키보드(특히 안드로이드)는 보내고 입력창을 비운 직후 마지막 글자를 다시 넣는 경우가 있다.
  // 보낸 직후 잠깐 동안, 방금 보낸 글의 끝부분이 저절로 다시 들어오면 지운다.
  let leftover = null;
  function guardLeftover(text) { leftover = { text, until: Date.now() + 700 }; }
  $('#chat-input').addEventListener('input', (e) => {
    if (!leftover) return;
    if (Date.now() > leftover.until) { leftover = null; return; }
    const v = e.target.value;
    if (v && v.length < leftover.text.length && leftover.text.endsWith(v)) e.target.value = '';
  });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat();
  });

  $('#btn-skip').addEventListener('click', () => socket.emit('game:skip'));
  $('#btn-skip-mini').addEventListener('click', () => socket.emit('game:skip'));
  // 보내기·넘기기 버튼을 눌러도 입력창 포커스(휴대폰 키보드)가 유지되게
  document.querySelectorAll('#chat-form button').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      if (document.activeElement === $('#chat-input')) e.preventDefault();
    });
    // 아이폰: 버튼을 손가락으로 누르면 입력창 선택이 풀려 키보드가 닫힌다 → 터치를 직접 처리
    btn.addEventListener('touchend', (e) => {
      if (document.activeElement !== $('#chat-input')) return;
      e.preventDefault();
      Sfx.play('click');
      if (btn.type === 'submit') sendChat();
      else socket.emit('game:skip');
      $('#chat-input').focus();
    });
  });
  // 방 안에서 처음 화면을 누를 때 소리 재생 허락
  document.addEventListener('pointerdown', () => { QuizPlayer.unlock(); Sfx.unlock(); }, { once: true, capture: true });

  // 휴대폰 키보드: 게임 화면을 '지금 실제로 보이는 영역'에 고정해서 입력창이 키보드 바로 위에 오게 한다
  // (아이폰은 키보드가 올라오면 화면을 위로 밀어 올리므로, 그 위치·높이를 그대로 따라간다)
  function fitViewport() {
    const vv = window.visualViewport;
    const root = document.documentElement.style;
    root.setProperty('--app-h', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    root.setProperty('--vv-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
    // 터치 기기에서 입력창을 누르고 있으면 키보드가 올라와 있는 것으로 보고 화면을 좁게 쓴다
    const typing = isTouch && document.activeElement === $('#chat-input');
    document.body.classList.toggle('kb-open', typing);
  }
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  window.addEventListener('resize', fitViewport);
  $('#chat-input').addEventListener('focus', () => { fitViewport(); setTimeout(fitViewport, 300); });
  $('#chat-input').addEventListener('blur', () => { setTimeout(fitViewport, 50); });
  fitViewport();

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

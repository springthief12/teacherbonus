// 음원 관리 페이지
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let years = [];
  let year = null;
  let songs = [];
  let filter = 'all';
  const open = new Set();
  let pollTimer = null;

  async function api(path, body) {
    const res = await fetch(`/api/admin${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (data.storage) renderStorage(data.storage);
    if (res.status === 401 && path !== '/login') { showLogin(); throw new Error(data.error || '로그인이 필요해요.'); }
    if (!res.ok) { const err = new Error(data.error || `오류 ${res.status}`); err.data = data; throw err; }
    return data;
  }

  // ---------- 로그인 ----------
  async function boot() {
    const me = await api('/me');
    if (!me.authed) return showLogin(me);
    $('#login').hidden = true;
    $('#workspace').hidden = false;
    years = await api('/years');
    year = year || (years[0] && years[0].year);
    renderYears();
    await loadSongs();
  }

  function showLogin(me) {
    $('#workspace').hidden = true;
    $('#login').hidden = false;
    const note = $('#login-note');
    if (me && !me.passwordSet) {
      note.textContent = '서버에 관리자 비밀번호(ADMIN_PASSWORD)가 아직 없어요. 서버를 켠 PC에서 http://localhost 주소로 열면 비밀번호 없이 들어올 수 있어요.';
      $('#login-form').hidden = true;
    } else {
      note.textContent = '서버를 켤 때 정한 ADMIN_PASSWORD를 입력하세요.';
      $('#login-form').hidden = false;
      $('#password').focus();
    }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/login', { password: $('#password').value });
      $('#password').value = '';
      boot();
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------- 연도·필터 ----------
  function renderYears() {
    $('#years').innerHTML = years.map((y) =>
      `<button type="button" data-year="${y.year}" aria-pressed="${y.year === year}">${y.year}년</button>`).join('');
  }

  $('#years').addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]');
    if (!b) return;
    year = Number(b.dataset.year);
    open.clear();
    renderYears();
    loadSongs();
  });

  $('#filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    document.querySelectorAll('#filter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderSongs();
  });

  async function loadSongs() {
    const data = await api(`/songs?year=${year}`);
    songs = data.songs;
    renderStorage(data.storage);
    renderSongs();
    renderProgress(data.checking);
  }

  function renderStorage(info) {
    const el = $('#storage');
    el.classList.toggle('warn', Boolean(info.ephemeral || info.lastError));
    if (info.github) {
      el.innerHTML = `저장 위치: 깃허브 <b>${esc(info.repo)}</b>. 저장 완료된 설정은 서버가 다시 시작돼도 유지돼요.${info.lastError ? ` <span class="bad">${esc(info.lastError)}</span> <a href="/api/admin/export">현재 수정 내용 내려받기</a>` : ''}`;
    } else if (info.ephemeral) {
      el.innerHTML = '주의: 이 서버(Render 무료)는 잠들거나 다시 시작하면 여기서 고친 내용이 사라져요. 오래 쓰려면 설명서의 "깃허브에 저장하기"를 설정하세요. <a href="/api/admin/export">지금까지 고친 내용 내려받기</a>';
    } else {
      el.textContent = '저장 위치: 이 컴퓨터 (data/overrides.json). 고치면 바로 저장되고 다음 곡부터 반영돼요.';
    }
  }

  function renderProgress(job) {
    const el = $('#progress');
    clearTimeout(pollTimer);
    if (!job) { el.hidden = true; $('#check-all').disabled = false; return; }
    el.hidden = false;
    el.textContent = `검사 중… ${job.done} / ${job.total}곡`;
    $('#check-all').disabled = true;
    pollTimer = setTimeout(loadSongs, 2000);
  }

  $('#check-all').addEventListener('click', async () => {
    try {
      const res = await api('/check', { year });
      if (!res.checking || !res.checking.total) toast('검사할 곡이 없어요. 확인했거나 이미 검사한 곡은 건너뛰어요.');
      renderProgress(res.checking);
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------- 곡 목록 ----------
  // 확인함: 관리자가 음원을 고정한 곡 (다시 검색·검사하지 않음)
  // 확인 전: 자동 검색으로 찾은 음원을 쓰는 중 (서버가 다시 시작되면 다시 검색함)
  function state(s) {
    if (s.disabled) return { cls: 'idle', text: '제외함', problem: false, done: true };
    if (s.audioFile) return { cls: 'ok', text: '음원 파일', problem: false, done: true };
    if (s.source === 'override') {
      const blocked = (s.bad || []).includes(s.youtubeId);
      return blocked ? { cls: 'bad', text: '확인함 · 재생 안 됨', problem: true, done: true } : { cls: 'ok', text: '확인함', problem: false, done: true };
    }
    if (s.source === 'data') return { cls: 'ok', text: '차트 파일', problem: false, done: true };
    if (s.source === 'search') return { cls: 'pick', text: '자동 · 확인 전', problem: false, done: false };
    if (s.source === 'missing') return { cls: 'bad', text: '못 찾음 · 셔플 제외', problem: true, done: false };
    return { cls: 'idle', text: '검사 전', problem: false, done: false };
  }

  function nowLine(s) {
    if (s.disabled) return '관리자가 셔플에서 뺀 곡이에요.';
    if (s.audioFile) return 'data/audio 폴더의 음원 파일로 재생해요.';
    const video = s.videoTitle ? `${s.videoTitle}${s.videoChannel ? ` · ${s.videoChannel}` : ''}` : `영상 ${s.youtubeId}`;
    if (s.source === 'override') return `확인한 음원: ${video}`;
    if (s.source === 'search') return `자동으로 찾은 음원: ${video}`;
    if (s.youtubeId) return `현재: ${video}`;
    if (s.source === 'missing') return '음원 버전을 찾지 못해 셔플에서 빠져 있어요. 후보에서 고르거나 링크를 붙여 넣으세요.';
    return '아직 검사 전이에요. 게임에서 처음 나올 때 자동으로 찾아요.';
  }

  const fmtTime = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');

  function renderSummary() {
    const counts = { done: 0, auto: 0, bad: 0, idle: 0, off: 0 };
    for (const s of songs) {
      const st = state(s);
      if (s.disabled) counts.off += 1;
      else if (st.problem) counts.bad += 1;
      else if (st.done) counts.done += 1;
      else if (s.source === 'search') counts.auto += 1;
      else counts.idle += 1;
    }
    $('#summary').innerHTML = `확인함 <b>${counts.done}</b> · 확인 전 <b>${counts.auto}</b> · <span class="bad">문제 <b>${counts.bad}</b></span> · 검사 전 <b>${counts.idle}</b> · 제외 <b>${counts.off}</b>`;
  }

  const FILTERS = {
    all: () => true,
    todo: (s) => !state(s).done, // 아직 확인 안 한 곡
    problem: (s) => state(s).problem,
  };
  const EMPTY = { all: '곡이 없어요.', todo: '모든 곡을 확인했어요.', problem: '문제 있는 곡이 없어요.' };

  function renderSongs() {
    renderSummary();
    const list = songs.filter(FILTERS[filter] || FILTERS.all);
    if (!list.length) {
      $('#song-list').innerHTML = `<li class="song"><div class="song-row"><span></span><span class="muted">${EMPTY[filter] || EMPTY.all}</span></div></li>`;
      return;
    }
    $('#song-list').innerHTML = list.map((s) => {
      const st = state(s);
      const expanded = open.has(s.key);
      return `
      <li class="song${st.problem ? ' is-problem' : ''}${s.disabled ? ' is-disabled' : ''}" data-key="${esc(s.key)}">
        <div class="song-row">
          <span class="song-rank">${s.rank}</span>
          <div class="song-main">
            <div class="song-title">${esc(s.title)}</div>
            <div class="song-artist">${esc(s.artist)}</div>
            <div class="song-now">${esc(nowLine(s))}</div>
          </div>
          <span class="pill ${st.cls}">${st.text}</span>
          <div class="song-actions">
            ${s.youtubeId ? `<button class="btn small" data-act="play" data-id="${s.youtubeId}">미리 듣기</button>` : ''}
            ${canConfirm(s) ? '<button class="btn small primary" data-act="confirm" title="이 음원으로 고정하고 더는 검사하지 않아요">확인</button>' : ''}
            <button class="btn small" data-act="toggle" aria-expanded="${expanded}">${expanded ? '접기' : '고치기'}</button>
          </div>
        </div>
        ${expanded ? editor(s) : ''}
      </li>`;
    }).join('');
  }

  const canConfirm = (s) => s.source === 'search' && Boolean(s.youtubeId) && !s.disabled && !s.audioFile;

  function editor(s) {
    const cands = s.candidates.length
      ? `<ul class="cands">${s.candidates.map((c) => {
        const blocked = s.bad.includes(c.id);
        const current = c.id === s.youtubeId;
        return `
          <li class="cand${current ? ' current' : ''}${blocked ? ' blocked' : ''}">
            <img src="https://i.ytimg.com/vi/${c.id}/mqdefault.jpg" alt="" loading="lazy">
            <div style="min-width:0">
              <div class="cand-title">${esc(c.title)}</div>
              <div class="cand-sub">
                <span>${esc(c.channel || '')}</span>
                ${c.seconds ? `<span>${fmtTime(c.seconds)}</span>` : ''}
                <span class="cand-tag ${c.ok ? 'ok' : 'no'}">${c.ok ? '음원 버전' : '음원 버전 아님'}</span>
                ${blocked ? '<span class="cand-tag no">재생 불가로 표시됨</span>' : ''}
                ${current ? '<span class="cand-tag ok">지금 사용 중</span>' : ''}
              </div>
            </div>
            <div class="cand-actions">
              <button class="btn small" data-act="play" data-id="${c.id}" data-title="${esc(c.title)}">미리 듣기</button>
              ${current ? '' : `<button class="btn small primary" data-act="pick" data-id="${c.id}">이걸로 선택</button>`}
            </div>
          </li>`;
      }).join('')}</ul>`
      : '<p class="edit-note">아직 검색 후보가 없어요. 다시 검색하거나 아래에 링크를 붙여 넣으세요.</p>';

    return `
      <div class="song-edit">
        <div class="edit-block">
          <div class="edit-row" style="justify-content:space-between">
            <h3>유튜브 검색 후보</h3>
            <button class="btn small" data-act="search">다시 검색</button>
          </div>
          ${cands}
        </div>
        <div class="edit-block">
          <h3>링크 직접 넣기</h3>
          <div class="edit-row">
            <input data-field="youtube" placeholder="유튜브 주소 또는 영상 ID (예: https://youtu.be/…)" autocomplete="off">
            <button class="btn small primary" data-act="save-link">저장</button>
          </div>
          <p class="edit-note">음원 영상(채널 이름이 "가수 - Topic"인 것)이나 Official Audio를 고르면 노래가 바로 시작해요. 후보에서 고르거나 링크를 저장하면 확인한 것으로 고정돼요.</p>
          ${s.source === 'override' ? `
          <div class="edit-row">
            <button class="btn small" data-act="reset">확인 취소</button>
            <span class="edit-note">고정을 풀고 자동 검색 결과로 돌아가요. 그 뒤로는 다시 검사해요.</span>
          </div>` : ''}
        </div>
        <div class="edit-block">
          <h3>시작 위치</h3>
          <div class="edit-row">
            <input class="short" data-field="start" type="number" min="0" max="600" inputmode="numeric" value="${s.start ?? ''}" placeholder="0">
            <span>초부터</span>
            <button class="btn small" data-act="save-start">저장</button>
          </div>
          <p class="edit-note">'전주부터' 모드에서 이 위치부터 재생해요. 앞에 무음이나 말소리가 있을 때 쓰세요.</p>
        </div>
        <label class="switch">
          <input type="checkbox" data-act="disable" ${s.disabled ? 'checked' : ''}>
          셔플에서 빼기
        </label>
      </div>`;
  }

  function replaceSong(next) {
    songs = songs.map((s) => (s.key === next.key ? next : s));
    renderSongs();
  }

  $('#song-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    const li = btn.closest('.song');
    const key = li && li.dataset.key;
    const song = songs.find((s) => s.key === key);
    const act = btn.dataset.act;

    try {
      if (act === 'toggle') {
        if (open.has(key)) open.delete(key); else open.add(key);
        renderSongs();
      } else if (act === 'play') {
        preview(btn.dataset.id, btn.dataset.title || song.title, song);
      } else if (act === 'confirm') {
        btn.disabled = true;
        const res = await api('/song', { key, confirm: true });
        replaceSong(res.song);
        if ($('#preview-confirm').dataset.key === key) $('#preview-confirm').hidden = true;
        toast('확인했어요. 이 음원으로 고정하고 더는 검사하지 않아요.');
      } else if (act === 'pick') {
        const res = await api('/song', { key, youtube: btn.dataset.id });
        replaceSong(res.song);
        toast('이 영상으로 고정했어요.');
      } else if (act === 'save-link') {
        const value = $('[data-field="youtube"]', li).value;
        const res = await api('/song', { key, youtube: value });
        replaceSong(res.song);
        toast('링크를 저장하고 고정했어요.');
      } else if (act === 'reset') {
        const res = await api('/song', { key, youtube: null });
        replaceSong(res.song);
        toast('확인을 취소했어요. 자동 검색 결과로 돌아가요.');
      } else if (act === 'save-start') {
        const value = $('[data-field="start"]', li).value;
        const res = await api('/song', { key, start: value === '' ? null : Number(value) });
        replaceSong(res.song);
        toast('시작 위치를 저장했어요.');
      } else if (act === 'search') {
        btn.disabled = true;
        btn.textContent = '검색 중…';
        try {
          const res = await api('/search', { key });
          replaceSong(res.song);
        } catch (err) {
          if (err.data && err.data.song) replaceSong(err.data.song);
          throw err;
        }
      }
    } catch (err) {
      toast(err.message);
    }
  });

  $('#song-list').addEventListener('change', async (e) => {
    const box = e.target.closest('[data-act="disable"]');
    if (!box) return;
    const key = box.closest('.song').dataset.key;
    try {
      const res = await api('/song', { key, disabled: box.checked });
      replaceSong(res.song);
      toast(box.checked ? '셔플에서 뺐어요.' : '셔플에 다시 넣었어요.');
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------- 미리 듣기 ----------
  function preview(id, title, song) {
    const start = song && song.start ? `&start=${song.start}` : '';
    $('#preview-frame').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0${start}" allow="autoplay; encrypted-media" title="미리 듣기"></iframe>`;
    $('#preview-title').textContent = title;
    $('#preview-sub').textContent = song ? `${song.rank}위 · ${song.artist} - ${song.title}` : '';
    // 지금 자동으로 쓰는 음원을 듣는 중이면 여기서 바로 확인할 수 있게
    const confirmBtn = $('#preview-confirm');
    const can = song && canConfirm(song) && song.youtubeId === id;
    confirmBtn.hidden = !can;
    confirmBtn.disabled = false;
    confirmBtn.dataset.key = can ? song.key : '';
    $('#preview').hidden = false;
  }
  $('#preview-confirm').addEventListener('click', async () => {
    const btn = $('#preview-confirm');
    const key = btn.dataset.key;
    if (!key) return;
    btn.disabled = true;
    try {
      const res = await api('/song', { key, confirm: true });
      replaceSong(res.song);
      btn.hidden = true;
      toast('확인했어요. 이 음원으로 고정하고 더는 검사하지 않아요.');
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
  $('#preview-close').addEventListener('click', () => {
    $('#preview-frame').innerHTML = '';
    $('#preview').hidden = true;
  });

  // ---------- 알림 ----------
  let toastTimer = null;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  boot().catch((err) => toast(err.message));
})();


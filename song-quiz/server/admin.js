// 관리자 페이지 API: 곡별 유튜브 음원 확인·수정
// 접근: 서버를 켠 PC에서 localhost로 열면 바로, 그 밖에는 ADMIN_PASSWORD 필요
const crypto = require('crypto');
const express = require('express');
const { songsOf, yearCatalog, audioFileFor } = require('./charts');
const yt = require('./youtube');
const overrides = require('./overrides');

const PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE = 'sq_admin';
const SECRET = crypto.randomBytes(32);
const TOKEN = crypto.createHmac('sha256', SECRET).update(`admin:${PASSWORD}`).digest('hex');

function isLocal(req) {
  const addr = req.socket.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  return loopback && !req.headers['x-forwarded-for'];
}

function cookieOf(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const authed = (req) => isLocal(req) || (Boolean(PASSWORD) && safeEqual(cookieOf(req, COOKIE) || '', TOKEN));

/** 유튜브 주소 여러 형태 → 영상 ID */
function parseYoutube(input) {
  const text = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function allSongs() {
  return yearCatalog().filter((y) => y.count > 0).flatMap((y) => songsOf(y.year));
}

function findSong(key) {
  return allSongs().find((s) => overrides.keyOf(s) === key) || null;
}

function view(song) {
  const o = overrides.get(song) || {};
  return {
    key: overrides.keyOf(song),
    year: song.year,
    rank: song.rank,
    title: song.title,
    artist: song.artist,
    audioFile: Boolean(audioFileFor(song)),
    disabled: Boolean(o.disabled),
    start: Number.isFinite(o.start) ? o.start : null,
    ...yt.status(song),
  };
}

// 연도 전체 검사 (검사 안 한 곡만, 두 곡씩)
// 확인한 곡(음원 고정)·음원 파일이 있는 곡·셔플에서 뺀 곡은 검사하지 않는다
const checking = new Map(); // year -> { total, done }
async function checkYear(year) {
  if (checking.has(year)) return;
  const targets = songsOf(year).filter((s) => !audioFileFor(s) && !(overrides.get(s) || {}).disabled && yt.status(s).source === 'unchecked');
  const job = { total: targets.length, done: 0 };
  checking.set(year, job);
  const queue = targets.slice();
  const worker = async () => {
    while (queue.length) {
      const song = queue.shift();
      try { await yt.searchCandidates(song); } catch (err) { console.warn(`[admin] 검사 실패 ${song.title}: ${err.message}`); }
      job.done += 1;
      await new Promise((r) => setTimeout(r, 400)); // 유튜브에 부담 주지 않게 천천히
    }
  };
  await Promise.all([worker(), worker()]);
  checking.delete(year);
}

const loginTries = new Map(); // ip -> { count, until }

function router() {
  const r = express.Router();
  r.use(express.json({ limit: '20kb' }));

  r.get('/me', (req, res) => {
    res.json({
      authed: authed(req),
      local: isLocal(req),
      passwordSet: Boolean(PASSWORD),
      storage: overrides.info(),
    });
  });

  r.post('/login', (req, res) => {
    const ip = req.socket.remoteAddress || 'x';
    const now = Date.now();
    const t = loginTries.get(ip) || { count: 0, until: 0 };
    if (t.until > now) return res.status(429).json({ error: '잠시 뒤에 다시 시도하세요.' });
    if (!PASSWORD) return res.status(400).json({ error: '서버에 관리자 비밀번호(ADMIN_PASSWORD)가 설정되지 않았어요.' });
    if (!safeEqual(req.body?.password || '', PASSWORD)) {
      t.count += 1;
      if (t.count >= 5) { t.until = now + 60 * 1000; t.count = 0; }
      loginTries.set(ip, t);
      return res.status(401).json({ error: '비밀번호가 맞지 않아요.' });
    }
    loginTries.delete(ip);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', `${COOKIE}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`);
    return res.json({ ok: true });
  });

  r.post('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // 여기부터는 관리자만
  r.use((req, res, next) => (authed(req) ? next() : res.status(401).json({ error: '관리자 로그인이 필요해요.' })));

  r.get('/years', (_req, res) => {
    res.json(yearCatalog().filter((y) => y.count > 0).map((y) => ({ year: y.year, count: y.count })));
  });

  r.get('/songs', (req, res) => {
    const year = Number(req.query.year);
    const job = checking.get(year);
    res.json({
      year,
      checking: job ? { total: job.total, done: job.done } : null,
      songs: songsOf(year).map(view),
      storage: overrides.info(),
    });
  });

  r.post('/song', async (req, res) => {
    const song = findSong(req.body?.key);
    if (!song) return res.status(404).json({ error: '곡을 찾지 못했어요.' });
    const patch = {};
    const now = yt.status(song);
    // 영상 제목·채널도 함께 저장해 둔다 (서버가 다시 시작돼 검색 기록이 지워져도 관리자 화면에 무슨 영상인지 보이게)
    const remember = (id) => {
      const c = (now.candidates || []).find((x) => x.id === id);
      patch.videoTitle = c ? c.title : null;
      patch.videoChannel = c ? c.channel : null;
    };
    if (req.body.confirm) {
      // 확인: 지금 자동으로 고른 음원을 그대로 고정 → 이 곡은 더는 검색·검사하지 않는다
      if (now.source === 'override') return res.json({ ok: true, song: view(song), storage: overrides.info() });
      if (now.source !== 'search' || !now.youtubeId) {
        return res.status(400).json({ error: '확인할 음원이 없어요. 후보에서 고르거나 링크를 넣어 주세요.' });
      }
      patch.youtubeId = now.youtubeId;
      remember(now.youtubeId);
    } else if ('youtube' in req.body) {
      if (req.body.youtube === null || req.body.youtube === '') {
        // 확인 취소 → 자동 검색으로 되돌리기
        patch.youtubeId = null;
        patch.videoTitle = null;
        patch.videoChannel = null;
      } else {
        const id = parseYoutube(req.body.youtube);
        if (!id) return res.status(400).json({ error: '유튜브 주소나 영상 ID를 확인해 주세요.' });
        patch.youtubeId = id; // 직접 고른 음원도 확인한 것으로 본다 (고정)
        remember(id);
        yt.clearBad(song);
      }
    }
    if ('start' in req.body) {
      const n = req.body.start === null || req.body.start === '' ? null : Math.round(Number(req.body.start));
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 600)) return res.status(400).json({ error: '시작 위치는 0~600초 사이로 적어 주세요.' });
      patch.start = n;
    }
    if ('disabled' in req.body) patch.disabled = req.body.disabled ? true : null;
    try {
      await overrides.set(song, patch);
      return res.json({ ok: true, song: view(song), storage: overrides.info() });
    } catch (err) {
      const storage = overrides.info();
      const error = storage.github
        ? `깃허브 저장을 완료하지 못했어요. 변경 내용은 이 서버에 임시로 남아 있으니 다시 저장해 주세요. (${err.message})`
        : `파일 저장을 완료하지 못했어요. 다시 저장해 주세요. (${err.message})`;
      return res.status(storage.github ? 502 : 500).json({ error, song: view(song), storage });
    }
  });

  r.post('/search', async (req, res) => {
    const song = findSong(req.body?.key);
    if (!song) return res.status(404).json({ error: '곡을 찾지 못했어요.' });
    try {
      await yt.searchCandidates(song);
      return res.json({ ok: true, song: view(song) });
    } catch (err) {
      return res.status(502).json({ error: `유튜브 검색에 실패했어요. (${err.message})`, song: view(song) });
    }
  });

  r.post('/check', (req, res) => {
    const year = Number(req.body?.year);
    if (!songsOf(year).length) return res.status(404).json({ error: '그 연도 차트가 없어요.' });
    checkYear(year);
    const job = checking.get(year);
    return res.json({ ok: true, checking: job ? { total: job.total, done: job.done } : null });
  });

  r.get('/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="overrides.json"');
    res.json(overrides.exportAll());
  });

  return r;
}

module.exports = { router, parseYoutube };


// 방 하나의 상태와 게임 진행
const { buildPlaylist, hasYear } = require('./charts');
const { isCorrect, chosungHint } = require('./answer');
const { resolveVideo, markBad } = require('./youtube');

const MAX_PLAYERS = 8;
const LOAD_TIMEOUT_MS = 6000;
const SKIP_REVEAL_MS = 4000; // 정답 전에 스킵했을 때 정답을 보여주는 시간

const DEFAULT_SETTINGS = {
  years: [],
  songCount: 20,
  roundTime: 30, // 초: 정답을 받는 시간
  revealTime: 15, // 초: 정답 공개 뒤 노래를 더 듣는 시간 (스킵하면 바로 다음 곡)
  startMode: 'intro', // intro: 전주부터, highlight: 중간(후렴 근처)부터
  skipRule: 'majority', // majority: 과반수, anyone: 한 명이라도, host: 방장만
  scoring: 'flat', // flat: 정답 10점, speed: 빨리 맞힐수록 더 많이
};

const OPTIONS = {
  songCount: [10, 20, 30, 50],
  roundTime: [20, 30, 45, 60],
  revealTime: [5, 10, 15, 30],
  startMode: ['intro', 'highlight'],
  skipRule: ['majority', 'anyone', 'host'],
  scoring: ['flat', 'speed'],
};

class Room {
  constructor(io, { id, title, defaultYear, onEmpty }) {
    this.io = io;
    this.id = id;
    this.title = title;
    this.onEmpty = onEmpty;
    this.players = new Map(); // socketId -> player
    this.hostId = null;
    this.status = 'waiting'; // waiting | loading | playing | reveal | ended
    this.settings = { ...DEFAULT_SETTINGS, years: defaultYear ? [defaultYear] : [] };
    this.playlist = [];
    this.index = -1;
    this.round = null;
    this.timers = [];
    this.generation = 0; // 오래된 타이머 콜백 무시용
    this.lastResults = null;
  }

  // ---------- 공용 ----------
  emit(event, payload) {
    this.io.to(this.id).emit(event, payload);
  }

  system(text, tone = 'info') {
    this.emit('chat', { kind: 'system', tone, text, at: Date.now() });
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  later(ms, fn) {
    const gen = this.generation;
    this.timers.push(setTimeout(() => {
      if (gen === this.generation) fn();
    }, ms));
  }

  summary() {
    return {
      id: this.id,
      title: this.title,
      count: this.players.size,
      max: MAX_PLAYERS,
      status: this.status,
      years: this.settings.years,
    };
  }

  publicState() {
    const r = this.round;
    return {
      id: this.id,
      title: this.title,
      hostId: this.hostId,
      status: this.status,
      settings: this.settings,
      options: OPTIONS,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        score: p.score,
        correct: p.correct,
        skipVote: p.skipVote,
      })),
      round: r
        ? {
          index: this.index,
          total: this.playlist.length,
          year: r.song.year,
          hints: r.hints,
          videoId: r.videoId,
          startSeconds: r.startSeconds,
          startedAt: r.startedAt,
          roundTime: this.settings.roundTime,
          revealEndsAt: r.revealEndsAt,
          winnerId: r.winnerId,
          answer: this.status === 'reveal' || this.status === 'ended' ? this.answerOf(r.song) : null,
          skipNeeded: this.skipNeeded(),
        }
        : null,
      results: this.lastResults,
      serverNow: Date.now(),
    };
  }

  broadcastState() {
    this.emit('room:state', this.publicState());
  }

  answerOf(song) {
    return { title: song.title, artist: song.artist, year: song.year, rank: song.rank };
  }

  // ---------- 입장/퇴장 ----------
  isFull() {
    return this.players.size >= MAX_PLAYERS;
  }

  addPlayer(socket, profile) {
    const player = {
      id: socket.id,
      nickname: profile.nickname,
      avatar: profile.avatar,
      score: 0,
      correct: 0,
      skipVote: false,
      chatTimes: [],
    };
    this.players.set(socket.id, player);
    if (!this.hostId) this.hostId = socket.id;
    socket.join(this.id);
    this.system(`${player.nickname} 님이 들어왔어요.`);
    this.broadcastState();
    return player;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;
    this.players.delete(socketId);
    if (this.players.size === 0) {
      this.generation += 1;
      this.clearTimers();
      this.onEmpty(this);
      return;
    }
    if (this.hostId === socketId) {
      this.hostId = this.players.keys().next().value;
      const host = this.players.get(this.hostId);
      this.system(`${player.nickname} 님이 나가서 ${host.nickname} 님이 방장이 되었어요.`);
    } else {
      this.system(`${player.nickname} 님이 나갔어요.`);
    }
    if (this.status === 'playing' || this.status === 'reveal') this.checkSkip();
    this.broadcastState();
  }

  // ---------- 설정 ----------
  updateSettings(socketId, patch) {
    if (socketId !== this.hostId || this.status !== 'waiting') return;
    const next = { ...this.settings };
    if (Array.isArray(patch.years)) {
      next.years = [...new Set(patch.years.map(Number))].filter(hasYear).sort((a, b) => b - a);
    }
    for (const key of Object.keys(OPTIONS)) {
      if (patch[key] !== undefined && OPTIONS[key].includes(patch[key])) next[key] = patch[key];
    }
    this.settings = next;
    this.broadcastState();
  }

  // ---------- 게임 진행 ----------
  start(socketId) {
    if (socketId !== this.hostId) return { error: '방장만 시작할 수 있어요.' };
    if (this.status !== 'waiting' && this.status !== 'ended') return { error: '이미 진행 중이에요.' };
    if (!this.settings.years.length) return { error: '연도를 하나 이상 고르세요.' };
    this.playlist = buildPlaylist(this.settings.years, this.settings.songCount);
    if (!this.playlist.length) return { error: '고른 연도에 곡이 없어요.' };

    for (const p of this.players.values()) {
      p.score = 0;
      p.correct = 0;
      p.skipVote = false;
    }
    this.lastResults = null;
    this.index = -1;
    this.system(`게임 시작! ${this.settings.years.join(', ')}년 차트에서 ${this.playlist.length}곡을 섞었어요.`, 'accent');
    this.nextRound();
    return { ok: true };
  }

  async nextRound() {
    this.generation += 1;
    this.clearTimers();
    this.index += 1;
    if (this.index >= this.playlist.length) {
      this.endGame();
      return;
    }

    const song = this.playlist[this.index];
    this.status = 'loading';
    this.round = {
      song,
      hints: [],
      videoId: null,
      startSeconds: 0,
      startedAt: null,
      revealEndsAt: null,
      winnerId: null,
    };
    for (const p of this.players.values()) p.skipVote = false;
    this.broadcastState();

    const gen = this.generation;
    const videoId = await Promise.race([
      resolveVideo(song),
      new Promise((resolve) => setTimeout(() => resolve(null), LOAD_TIMEOUT_MS)),
    ]);
    if (gen !== this.generation) return; // 그 사이 방이 바뀜

    // 다음 곡을 미리 찾아 둔다
    const upcoming = this.playlist[this.index + 1];
    if (upcoming) resolveVideo(upcoming).catch(() => {});

    const startSeconds = this.settings.startMode === 'highlight'
      ? (song.highlight ?? 45 + Math.floor(Math.random() * 30))
      : (song.start ?? 0);

    Object.assign(this.round, {
      videoId,
      startSeconds,
      startedAt: Date.now() + 800, // 모두가 영상을 불러올 여유
      hints: [song.rank ? `${song.year}년 ${song.rank}위` : `${song.year}년 차트`],
    });
    this.status = 'playing';
    if (!videoId) this.system('이 곡은 음원을 찾지 못했어요. 힌트로 맞혀 보세요.', 'warn');
    this.broadcastState();

    const total = this.settings.roundTime * 1000 + 800;
    this.later(total * 0.35, () => this.addHint(`가수: ${song.artist}`));
    this.later(total * 0.65, () => this.addHint(`제목: ${chosungHint(song.title)}`));
    this.later(total, () => this.reveal('timeout'));
  }

  addHint(text) {
    if (this.status !== 'playing') return;
    this.round.hints.push(text);
    this.emit('round:hint', { hints: this.round.hints });
  }

  reveal(reason, winner) {
    if (this.status !== 'playing') return;
    this.generation += 1;
    this.clearTimers();
    for (const p of this.players.values()) p.skipVote = false;

    const song = this.round.song;
    const holdMs = reason === 'correct' ? this.settings.revealTime * 1000 : SKIP_REVEAL_MS;
    this.status = 'reveal';
    this.round.revealEndsAt = Date.now() + holdMs;
    this.round.winnerId = winner ? winner.id : null;

    const answer = `${song.artist} - ${song.title}`;
    if (reason === 'timeout') this.system(`시간 끝! 정답은 ${answer}`, 'warn');
    if (reason === 'skip') this.system(`넘어갑니다. 정답은 ${answer}`, 'warn');

    this.emit('round:reveal', {
      reason,
      winnerId: this.round.winnerId,
      points: winner ? winner.lastPoints : 0,
      answer: this.answerOf(song),
    });
    this.broadcastState();
    this.later(holdMs, () => this.nextRound());
  }

  endGame() {
    this.generation += 1;
    this.clearTimers();
    this.status = 'ended';
    const ranking = [...this.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ place: i + 1, id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score, correct: p.correct }));
    this.lastResults = { ranking, total: this.playlist.length };
    this.system('게임 끝! 방장이 다시 시작할 수 있어요.', 'accent');
    this.broadcastState();
  }

  backToWaiting(socketId) {
    if (socketId !== this.hostId || this.status !== 'ended') return;
    this.status = 'waiting';
    this.round = null;
    this.broadcastState();
  }

  // ---------- 채팅 = 정답 입력 ----------
  chat(socketId, rawText) {
    const player = this.players.get(socketId);
    if (!player) return;
    const text = String(rawText || '').trim().slice(0, 120);
    if (!text) return;

    const now = Date.now();
    player.chatTimes = player.chatTimes.filter((t) => now - t < 3000);
    if (player.chatTimes.length >= 6) return; // 도배 방지
    player.chatTimes.push(now);

    if (/^!(스킵|skip|s|ㄴ)$/i.test(text)) {
      this.voteSkip(socketId);
      return;
    }

    if (this.status === 'playing' && !this.round.winnerId && isCorrect(this.round.song, text)) {
      const elapsed = (now - this.round.startedAt) / 1000;
      const remaining = Math.max(0, Math.ceil(this.settings.roundTime - elapsed));
      const points = this.settings.scoring === 'speed' ? 5 + remaining : 10;
      player.score += points;
      player.correct += 1;
      player.lastPoints = points;
      this.system(`${player.nickname} 님 정답! +${points}점`, 'success');
      this.reveal('correct', player);
      return;
    }

    // 정답이 아닌 글은 모두에게 보인다 (스타 노래맞히기처럼 오답도 채팅에 남음)
    this.emit('chat', {
      kind: 'player',
      playerId: player.id,
      nickname: player.nickname,
      text,
      at: now,
    });
  }

  // ---------- 스킵 ----------
  skipNeeded() {
    const n = this.players.size;
    if (this.settings.skipRule === 'anyone') return 1;
    if (this.settings.skipRule === 'host') return 1;
    return Math.floor(n / 2) + 1;
  }

  voteSkip(socketId) {
    if (this.status !== 'playing' && this.status !== 'reveal') return;
    const player = this.players.get(socketId);
    if (!player) return;
    if (this.settings.skipRule === 'host' && socketId !== this.hostId) {
      this.io.to(socketId).emit('toast', { text: '이 방은 방장만 넘길 수 있어요.' });
      return;
    }
    player.skipVote = !player.skipVote;
    this.broadcastState();
    this.checkSkip();
  }

  checkSkip() {
    const votes = [...this.players.values()].filter((p) => p.skipVote).length;
    if (votes < this.skipNeeded() || votes === 0) return;
    if (this.status === 'playing') this.reveal('skip');
    else if (this.status === 'reveal') this.nextRound();
  }

  // ---------- 재생 오류 ----------
  videoFailed(socketId, videoId) {
    if (!this.round || this.round.videoId !== videoId) return;
    const replacement = markBad(this.round.song, videoId);
    this.round.videoId = replacement;
    if (!replacement) this.system('이 곡은 재생할 수 있는 영상이 없어요. 힌트로 맞혀 보세요.', 'warn');
    this.emit('round:video', { videoId: replacement, startSeconds: this.round.startSeconds, startedAt: this.round.startedAt, serverNow: Date.now() });
  }
}

module.exports = { Room, MAX_PLAYERS };

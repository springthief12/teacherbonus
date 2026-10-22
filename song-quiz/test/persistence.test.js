// GitHub 저장 완료 응답·실패·동시 저장 검증. 외부 요청이나 추가 패키지 없이 실행한다.
// 실행: node test/persistence.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const first = { year: 2010, rank: 1, artist: '가수', title: '노래' };
const second = { year: 2010, rank: 2, artist: '다른가수', title: '다른노래' };
const pause = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => JSON.parse(JSON.stringify(value));

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

function github(initial = null) {
  const state = { data: initial, sha: initial ? 1 : 0, active: 0, maxActive: 0, writes: [], fail: null, beforePut: null };
  const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
  state.fetch = async (_url, options) => {
    if (options.method === 'GET') {
      return state.data
        ? response(200, { sha: String(state.sha), content: Buffer.from(JSON.stringify(state.data)).toString('base64') })
        : response(404, {});
    }
    assert.equal(options.method, 'PUT');
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    try {
      if (state.beforePut) await state.beforePut();
      if (state.fail) return response(state.fail, {});
      const body = JSON.parse(options.body);
      if ((body.sha || null) !== (state.data ? String(state.sha) : null)) return response(409, {});
      state.data = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      state.sha += 1;
      state.writes.push(clone(state.data));
      return response(200, { content: { sha: String(state.sha) } });
    } finally {
      state.active -= 1;
    }
  };
  return state;
}

function fixture(t, remote, { token = true, render = false, timeoutMs } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-persistence-'));
  fs.mkdirSync(path.join(dir, 'data'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { GITHUB_TOKEN: token ? 'test-only-token' : '', GITHUB_REPO: 'example/test', ADMIN_PASSWORD: 'test-only-password', RENDER: render ? 'true' : '' };
  function load(file, replacements, dirname) {
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'server', file), 'utf8'), {
      module: mod, exports: mod.exports,
      require: (name) => Object.prototype.hasOwnProperty.call(replacements, name) ? replacements[name] : require(name),
      __dirname: dirname, process: { env }, Buffer, fetch: remote.fetch,
      AbortSignal: timeoutMs === undefined ? AbortSignal : { timeout(ms) {
        assert.equal(ms, 15000);
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error('GitHub timeout')), timeoutMs);
        return controller.signal;
      } },
      console: { warn() {} }, setTimeout, clearTimeout,
    }, { filename: file });
    return mod.exports;
  }
  const overrides = load('overrides.js', { './answer': require('../server/answer') }, path.join(dir, 'server'));
  const routes = new Map();
  const router = { use() {}, get(p, fn) { routes.set(`GET ${p}`, fn); }, post(p, fn) { routes.set(`POST ${p}`, fn); } };
  load('admin.js', {
    express: { Router: () => router, json: () => (_req, _res, next) => next() },
    './charts': { songsOf: () => [first, second], yearCatalog: () => [{ year: 2010, count: 2 }], audioFileFor: () => null },
    './youtube': { clearBad() {}, status: (song) => ({ source: overrides.get(song)?.youtubeId ? 'override' : 'unchecked' }) },
    './overrides': overrides,
  }, path.join(ROOT, 'server')).router();
  return {
    overrides,
    local: () => JSON.parse(fs.readFileSync(path.join(dir, 'data', 'overrides.json'), 'utf8')),
    async save(song, body) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
      await routes.get('POST /song')({ body: { key: overrides.keyOf(song), ...body } }, res);
      return res;
    },
  };
}

test('API success waits for GitHub acknowledgement and survives a fresh process', async (t) => {
  const remote = github();
  const wait = gate();
  const entered = gate();
  remote.beforePut = async () => { entered.open(); await wait.promise; };
  const app = fixture(t, remote);
  let finished = false;
  const request = app.save(first, { youtube: 'AAAAAAAAAAA', start: 7 }).then((res) => { finished = true; return res; });
  await entered.promise;
  assert.equal(finished, false);
  assert.equal(remote.data, null);
  wait.open();
  const res = await request;
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.storage.remote, 'ready');
  assert.ok(res.data.storage.lastSave);
  const key = app.overrides.keyOf(first);
  assert.equal(remote.data.songs[key].youtubeId, 'AAAAAAAAAAA');
  const restarted = fixture(t, remote);
  await restarted.overrides.ready;
  assert.equal(restarted.overrides.get(first).youtubeId, 'AAAAAAAAAAA');
  assert.equal(restarted.overrides.get(first).start, 7);
});

test('GitHub failure returns HTTP 502 and preserves edits for export and retry', async (t) => {
  const remote = github();
  remote.fail = 403;
  const app = fixture(t, remote);
  const res = await app.save(first, { youtube: 'BBBBBBBBBBB' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.data.ok, undefined);
  assert.match(res.data.error, /저장을 완료하지 못/);
  assert.equal(res.data.storage.remote, 'error');
  assert.match(res.data.storage.lastError, /GitHub 403/);
  const key = app.overrides.keyOf(first);
  assert.equal(app.local().songs[key].youtubeId, 'BBBBBBBBBBB');
  assert.equal(app.overrides.exportAll().songs[key].youtubeId, 'BBBBBBBBBBB');
  remote.fail = null;
  const retry = await app.save(first, { start: 9 });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.data.storage.lastError, null);
  assert.equal(remote.data.songs[key].youtubeId, 'BBBBBBBBBBB');
  assert.equal(remote.data.songs[key].start, 9);
});

test('concurrent requests write in order without losing either song', async (t) => {
  const remote = github();
  remote.beforePut = pause;
  const app = fixture(t, remote);
  const responses = await Promise.all([
    app.save(first, { youtube: 'CCCCCCCCCCC' }),
    app.save(second, { youtube: 'DDDDDDDDDDD', disabled: true }),
  ]);
  assert.ok(responses.every((res) => res.statusCode === 200));
  assert.equal(remote.maxActive, 1);
  assert.equal(remote.writes.length, 2);
  assert.equal(remote.data.songs[app.overrides.keyOf(first)].youtubeId, 'CCCCCCCCCCC');
  assert.equal(remote.data.songs[app.overrides.keyOf(second)].disabled, true);
});

test('resetting the final override stays deleted after a GitHub conflict', async (t) => {
  const remote = github();
  const app = fixture(t, remote);
  await app.save(first, { youtube: 'EEEEEEEEEEE' });
  const key = app.overrides.keyOf(first);
  const otherKey = app.overrides.keyOf(second);
  remote.data.songs[otherKey] = { title: second.title, artist: second.artist, start: 11, updatedAt: Date.now() + 1000 };
  remote.sha += 1; // another editor saved since this server's last SHA
  const res = await app.save(first, { youtube: null });
  assert.equal(res.statusCode, 200);
  assert.equal(remote.data.songs[key], undefined);
  assert.equal(app.local().songs[key], undefined);
  assert.equal(remote.data.songs[otherKey].start, 11);
});

test('removing start/excluded settings preserves the configured song link', async (t) => {
  const remote = github();
  const app = fixture(t, remote);
  await app.save(first, { youtube: 'FFFFFFFFFFF', start: 20, disabled: true });
  await app.save(first, { start: null, disabled: false });
  const song = remote.data.songs[app.overrides.keyOf(first)];
  assert.equal(song.youtubeId, 'FFFFFFFFFFF');
  assert.equal(song.start, undefined);
  assert.equal(song.disabled, undefined);
});

test('local PC use still saves without a GitHub token', async (t) => {
  const remote = github();
  remote.fetch = async () => { throw new Error('GitHub must not be called'); };
  const app = fixture(t, remote, { token: false });
  const res = await app.save(first, { youtube: 'GGGGGGGGGGG' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.storage.github, false);
  assert.equal(res.data.storage.ephemeral, false);
  assert.equal(app.local().songs[app.overrides.keyOf(first)].youtubeId, 'GGGGGGGGGGG');
});

test('Render without GitHub reports its storage as temporary', async (t) => {
  const app = fixture(t, github(), { token: false, render: true });
  const res = await app.save(first, { youtube: 'HHHHHHHHHHH' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.storage.github, false);
  assert.equal(res.data.storage.ephemeral, true);
});

test('a stalled GitHub request times out and the next save can retry', async (t) => {
  const remote = github();
  const normalFetch = remote.fetch;
  let hang = true;
  remote.fetch = async (url, options) => {
    if (hang && options.method === 'PUT') {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    return normalFetch(url, options);
  };
  const app = fixture(t, remote, { timeoutMs: 5 });
  const failed = await app.save(first, { youtube: 'IIIIIIIIIII' });
  assert.equal(failed.statusCode, 502);
  assert.match(failed.data.storage.lastError, /timeout/);
  hang = false;
  const retried = await app.save(first, { start: 3 });
  assert.equal(retried.statusCode, 200);
  assert.equal(remote.data.songs[app.overrides.keyOf(first)].youtubeId, 'IIIIIIIIIII');
});

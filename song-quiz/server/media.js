// 음원 파일을 라운드마다 무작위 주소로 내보낸다 (주소만 보고 곡을 알 수 없게)
const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000;
const tokens = new Map(); // token -> { file, at }

function register(file) {
  const now = Date.now();
  for (const [t, v] of tokens) if (now - v.at > TTL_MS) tokens.delete(t);
  const token = crypto.randomBytes(12).toString('hex');
  tokens.set(token, { file, at: now });
  return `/media/${token}`;
}

function lookup(token) {
  const hit = tokens.get(token);
  return hit ? hit.file : null;
}

module.exports = { register, lookup };

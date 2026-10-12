import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

const PURPOSE = new Set(['register', 'login']);

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function hashCode(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
}

function textLength(value) {
  return Array.from(String(value ?? '')).length;
}

export function assertNickname(nickname) {
  const name = String(nickname ?? '').replace(/\u0000/g, '').trim();
  const len = textLength(name);
  if (len < 1 || len > 20) throw new HttpError(400, '昵称需要 1 到 20 个字');
  if (/[\u0000-\u001f<>]/.test(name)) throw new HttpError(400, '昵称包含不能使用的字符');
  return name;
}

export function assertPassword(password) {
  const value = String(password ?? '');
  if (value.length < 8 || value.length > 72) throw new HttpError(400, '密码需要 8 到 72 个字符');
  return value;
}

export function issueCode(db, config, { email, purpose }) {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new HttpError(400, '请填写有效的邮箱');
  if (!PURPOSE.has(purpose)) throw new HttpError(400, '验证码用途无效');
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (purpose === 'register' && existing) throw new HttpError(409, '这个邮箱已经注册');
  if (purpose === 'login' && !existing) throw new HttpError(404, '这个邮箱还没有注册');
  const last = db.prepare(`
    SELECT created_at FROM email_codes
    WHERE email = ? AND purpose = ?
    ORDER BY id DESC LIMIT 1
  `).get(normalized, purpose);
  if (last && Date.now() - last.created_at < config.codeCooldownMs) {
    throw new HttpError(429, '验证码发送太频繁，请稍后再试');
  }
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE email_codes SET consumed_at = ?
      WHERE email = ? AND purpose = ? AND consumed_at IS NULL
    `).run(now, normalized, purpose);
    db.prepare(`
      INSERT INTO email_codes (email, purpose, code_hash, attempts, expires_at, created_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(normalized, purpose, hashCode(code), now + config.codeTtlMs, now);
    if (config.devMailbox) {
      db.prepare('DELETE FROM mailbox WHERE created_at < ?').run(now - 24 * 60 * 60 * 1000);
      db.prepare('INSERT INTO mailbox (email, purpose, code, created_at) VALUES (?, ?, ?, ?)').run(normalized, purpose, code, now);
    }
  });
  tx();
  return { email: normalized, purpose, code };
}

export function consumeCode(db, { email, purpose, code }) {
  const normalized = normalizeEmail(email);
  const row = db.prepare(`
    SELECT * FROM email_codes
    WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(normalized, purpose, Date.now());
  if (!row) throw new HttpError(400, '验证码不正确或已过期');
  if (row.code_hash !== hashCode(String(code ?? '').trim())) {
    const attempts = row.attempts + 1;
    if (attempts >= 5) {
      db.prepare('UPDATE email_codes SET attempts = ?, consumed_at = ? WHERE id = ?').run(attempts, Date.now(), row.id);
      throw new HttpError(400, '验证码已失效，请重新获取');
    }
    db.prepare('UPDATE email_codes SET attempts = ? WHERE id = ?').run(attempts, row.id);
    throw new HttpError(400, '验证码不正确或已过期');
  }
  const info = db.prepare('UPDATE email_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(Date.now(), row.id);
  if (info.changes !== 1) throw new HttpError(400, '验证码不正确或已过期');
  return normalized;
}

function newCustomerId() {
  return `QLC${randomBytes(8).toString('hex').toUpperCase()}`;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    qinglanCustomerId: row.qinglan_customer_id,
    createdAt: row.created_at,
  };
}

export function registerUser(db, { email, password, nickname }) {
  const passwordHash = hashPassword(assertPassword(password));
  const name = assertNickname(nickname);
  const now = Date.now();
  try {
    const info = db.prepare(`
      INSERT INTO users (email, password_hash, nickname, qinglan_customer_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(email, passwordHash, name, newCustomerId(), now);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE') && String(err.message).includes('email')) {
      throw new HttpError(409, '这个邮箱已经注册');
    }
    throw err;
  }
}

export function loginUser(db, { email, password }) {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new HttpError(400, '密码不正确，请重新获取验证码');
  }
  return row;
}

export function createSession(db, config, userId) {
  const id = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    now + config.sessionDays * 86400000,
    now,
  );
  return id;
}

export function destroySession(db, sessionId) {
  if (!sessionId) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function attachUser(db) {
  return (req, _res, next) => {
    req.user = null;
    req.sessionId = null;
    const sid = req.cookies?.ncstar_sid;
    if (!sid || !/^[a-f0-9]{64}$/.test(sid)) return next();
    const row = db.prepare(`
      SELECT sessions.id AS sid, sessions.expires_at,
             users.id, users.email, users.nickname, users.qinglan_customer_id, users.created_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = ?
    `).get(sid);
    if (!row) return next();
    if (row.expires_at <= Date.now()) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      return next();
    }
    req.sessionId = row.sid;
    req.user = publicUser(row);
    return next();
  };
}

export function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicBaseUrl.startsWith('https://'),
    maxAge: config.sessionDays * 86400000,
    path: '/',
  };
}

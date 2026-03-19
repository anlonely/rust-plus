const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { getConfigDir } = require('../utils/runtime-paths');

const scryptAsync = promisify(crypto.scrypt);
const AUTH_DB_FILE = path.join(getConfigDir(), 'auth-users.json');
const ROOT_CREDENTIAL_FILE = path.join(getConfigDir(), 'root-admin-credentials.txt');
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const GUIDE_VERSION = 'chrome-bridge-v1';
const SESSION_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

class JsonDb {
  constructor(filePath, defaults) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.data = JSON.parse(JSON.stringify(defaults));
    this._queue = Promise.resolve();
  }

  async read() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.data = JSON.parse(JSON.stringify(this.defaults));
        return;
      }
      throw err;
    }
  }

  async write() {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.promises.rename(tmp, this.filePath);
  }

  async withLock(task) {
    const run = this._queue.then(() => task(), () => task());
    this._queue = run.catch(() => {});
    return run;
  }
}

const db = new JsonDb(AUTH_DB_FILE, {
  users: [],
  emailProvider: {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    username: '',
    password: '',
    fromEmail: '',
    fromName: 'Rust 工具箱',
  },
  meta: {
    guideVersion: GUIDE_VERSION,
  },
});

const sessions = new Map();
let sweepTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase().slice(0, 254);
}

function isValidEmail(raw) {
  const email = normalizeEmail(raw);
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email);
}

function generateStrongPassword(length = 20) {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '23456789';
  const special = '!@#$%^&*()-_=+[]{}:,.?';
  const all = lower + upper + nums + special;
  const chars = [
    lower[randomInt(lower.length)],
    upper[randomInt(upper.length)],
    nums[randomInt(nums.length)],
    special[randomInt(special.length)],
  ];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  return shuffle(chars).join('');
}

function randomInt(max) {
  return crypto.randomInt(0, max);
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function validateStrongPassword(password) {
  const value = String(password || '');
  const errors = [];
  if (value.length > 256) errors.push('密码长度不能超过 256 位');
  if (value.length < 12) errors.push('密码长度至少 12 位');
  if (!/[a-z]/.test(value)) errors.push('至少包含 1 个小写字母');
  if (!/[A-Z]/.test(value)) errors.push('至少包含 1 个大写字母');
  if (!/[0-9]/.test(value)) errors.push('至少包含 1 个数字');
  if (!/[^A-Za-z0-9]/.test(value)) errors.push('至少包含 1 个特殊字符');
  if (/\s/.test(value)) errors.push('密码不能包含空格');
  return {
    ok: errors.length === 0,
    errors,
  };
}

function normalizeNickname(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function validateNickname(raw) {
  const value = normalizeNickname(raw);
  if (value.length < 2 || value.length > 24) throw new Error('昵称长度需在 2-24 个字符之间');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('昵称包含非法控制字符');
  return value;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scryptAsync(String(password || ''), salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, storedHash = '') {
  const raw = String(storedHash || '');
  const [scheme, salt, expectedHex] = raw.split('$');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  const derived = await scryptAsync(String(password || ''), salt, 64);
  const actual = Buffer.from(derived.toString('hex'), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function ensureSweepTimer() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepSessions, SESSION_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

function sweepSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (!session || session.expiresAtMs <= now) sessions.delete(token);
  }
}

function sanitizeAvatarDataUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value)) {
    throw new Error('头像格式仅支持图片 Data URL');
  }
  if (value.length > 1_000_000) throw new Error('头像图片过大');
  return value;
}

function normalizeConfigField(raw, maxLength = 255) {
  return String(raw || '').trim().slice(0, maxLength);
}

function validateEmailProviderConfigPayload(payload = {}, current = {}) {
  const enabled = payload.enabled === true;
  const host = normalizeConfigField(payload.host, 255);
  const port = Number(payload.port || 465);
  const secure = payload.secure !== false;
  const username = normalizeConfigField(payload.username, 254);
  const incomingPassword = normalizeConfigField(payload.password, 512);
  const password = incomingPassword || normalizeConfigField(current.password, 512);
  const fromEmail = normalizeEmail(payload.fromEmail || '');
  const fromName = normalizeConfigField(payload.fromName || 'Rust 工具箱', 80) || 'Rust 工具箱';

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('邮箱服务端口不合法');
  }
  if (host && /\s/.test(host)) throw new Error('邮箱服务地址格式不合法');
  if (enabled) {
    if (!host) throw new Error('请填写邮箱服务地址');
    if (!username) throw new Error('请填写邮箱账号');
    if (!password) throw new Error('请填写邮箱密码');
    if (!isValidEmail(fromEmail)) throw new Error('发件邮箱格式不正确');
  } else if (fromEmail && !isValidEmail(fromEmail)) {
    throw new Error('发件邮箱格式不正确');
  }

  return {
    enabled,
    host,
    port,
    secure,
    username,
    password,
    fromEmail,
    fromName,
  };
}

function publicUser(user = {}, { includeAdminFields = false } = {}) {
  const activeSession = getLatestActiveSessionForUser(user.id);
  const lastSeenAt = activeSession?.updatedAtMs
    ? new Date(activeSession.updatedAtMs).toISOString()
    : (user.lastSeenAt || null);
  const payload = {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    avatarDataUrl: user.avatarDataUrl || '',
    role: user.role || 'user',
    disabled: user.disabled === true,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    lastSeenAt,
    hasAcceptedGuide: user.guideAcceptedVersion === GUIDE_VERSION,
    guideAcceptedAt: user.guideAcceptedAt || null,
    steamBinding: user.steamBinding || null,
  };
  if (includeAdminFields) {
    payload.username = user.username || '';
    payload.online = !!activeSession;
  }
  return payload;
}

function findUserById(userId) {
  return (db.data.users || []).find((item) => String(item.id) === String(userId)) || null;
}

function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  return (db.data.users || []).find((item) => normalizeEmail(item.email) === normalized) || null;
}

function findUserByIdentifier(identifier) {
  const input = String(identifier || '').trim();
  if (!input) return null;
  const normalized = normalizeEmail(input);
  return (db.data.users || []).find((item) => {
    const username = String(item.username || '').trim().toLowerCase();
    return normalizeEmail(item.email) === normalized || username === normalized;
  }) || null;
}

function hasActiveSessionForUser(userId) {
  return !!getLatestActiveSessionForUser(userId);
}

function getLatestActiveSessionForUser(userId) {
  const now = Date.now();
  let latest = null;
  for (const session of sessions.values()) {
    if (!session) continue;
    if (session.expiresAtMs <= now) continue;
    if (String(session.userId) !== String(userId)) continue;
    if (!latest || Number(session.updatedAtMs || 0) > Number(latest.updatedAtMs || 0)) {
      latest = session;
    }
  }
  return latest;
}

async function saveDb() {
  await db.write();
}

async function writeRootCredentialFile(password, createdAt, rotatedAt = '') {
  await fs.promises.mkdir(path.dirname(ROOT_CREDENTIAL_FILE), { recursive: true });
  const suffix = rotatedAt ? `rotatedAt: ${rotatedAt}\n` : '';
  await fs.promises.writeFile(
    ROOT_CREDENTIAL_FILE,
    `Root login\nusername: root\nemail: root@rustplus.local\npassword: ${password}\ncreatedAt: ${createdAt}\n${suffix}`,
    'utf8',
  );
}

async function ensureRootUser() {
  const users = db.data.users || [];
  const existing = users.find((item) => String(item.role || '') === 'root');
  if (existing) {
    const credentialText = await readRootCredentialFile();
    if (!String(credentialText || '').trim()) {
      const rotatedAt = nowIso();
      const password = generateStrongPassword(22);
      existing.passwordHash = await hashPassword(password);
      existing.updatedAt = rotatedAt;
      await writeRootCredentialFile(password, existing.createdAt || rotatedAt, rotatedAt);
    }
    return existing;
  }

  const password = generateStrongPassword(22);
  const passwordHash = await hashPassword(password);
  const createdAt = nowIso();
  const root = {
    id: `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    username: 'root',
    email: 'root@rustplus.local',
    nickname: 'Root Admin',
    avatarDataUrl: '',
    passwordHash,
    role: 'root',
    disabled: false,
    createdAt,
    updatedAt: createdAt,
    lastLoginAt: null,
    lastSeenAt: null,
    guideAcceptedAt: createdAt,
    guideAcceptedVersion: GUIDE_VERSION,
    steamBinding: null,
  };
  users.push(root);
  await writeRootCredentialFile(password, createdAt);
  return root;
}

async function initAuthStore() {
  await db.read();
  db.data.users ||= [];
  db.data.emailProvider ||= {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    username: '',
    password: '',
    fromEmail: '',
    fromName: 'Rust 工具箱',
  };
  db.data.meta ||= {};
  db.data.meta.guideVersion = GUIDE_VERSION;
  await ensureRootUser();
  await saveDb();
  ensureSweepTimer();
}

async function registerUser({ email, password, nickname }) {
  return db.withLock(async () => {
    await db.read();
    const user = await buildNewUserRecord({ email, password, nickname });
    db.data.users.push(user);
    await saveDb();
    return publicUser(user);
  });
}

async function adminCreateUser({ email, password, nickname, disabled = false }) {
  return db.withLock(async () => {
    await db.read();
    const target = await buildNewUserRecord({ email, password, nickname });
    target.disabled = disabled === true;
    db.data.users.push(target);
    await saveDb();
    return publicUser(target, { includeAdminFields: true });
  });
}

async function buildNewUserRecord({ email, password, nickname }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw new Error('邮箱格式不正确');
  if (findUserByEmail(normalizedEmail)) throw new Error('该邮箱已注册');
  const pwd = validateStrongPassword(password);
  if (!pwd.ok) throw new Error(`密码强度不足：${pwd.errors.join('，')}`);
  const displayName = validateNickname(nickname);

  const createdAt = nowIso();
  return {
    id: `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    username: '',
    email: normalizedEmail,
    nickname: displayName,
    avatarDataUrl: '',
    passwordHash: await hashPassword(password),
    role: 'user',
    disabled: false,
    createdAt,
    updatedAt: createdAt,
    lastLoginAt: null,
    lastSeenAt: null,
    guideAcceptedAt: null,
    guideAcceptedVersion: '',
    steamBinding: null,
  };
}

async function authenticateUser({ identifier, password, requireRoot = false }) {
  return db.withLock(async () => {
    await db.read();
    const lookup = String(identifier || '').trim().slice(0, 254);
    const secret = String(password || '');
    if (!lookup || !secret || secret.length > 256) throw new Error('账号或密码错误');
    const user = findUserByIdentifier(lookup);
    if (!user) throw new Error('账号或密码错误');
    if (requireRoot && String(user.role || '') !== 'root') throw new Error('账号或密码错误');
    if (user.disabled === true) throw new Error('账号已被禁用');
    const ok = await verifyPassword(secret, user.passwordHash);
    if (!ok) throw new Error('账号或密码错误');
    user.lastLoginAt = nowIso();
    user.lastSeenAt = user.lastLoginAt;
    user.updatedAt = nowIso();
    await saveDb();
    return publicUser(user, { includeAdminFields: true });
  });
}

async function createSession(userId, { kind = 'user' } = {}) {
  await db.read();
  const user = findUserById(userId);
  if (!user || user.disabled === true) throw new Error('账号不可用');
  const token = crypto.randomBytes(32).toString('base64url');
  const nowMs = Date.now();
  sessions.set(token, {
    token,
    userId: user.id,
    kind,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + SESSION_TTL_MS,
  });
  ensureSweepTimer();
  return {
    token,
    expiresAtMs: nowMs + SESSION_TTL_MS,
    user: publicUser(user, { includeAdminFields: true }),
  };
}

async function getSession(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const session = sessions.get(raw);
  if (!session) return null;
  if (session.expiresAtMs <= Date.now()) {
    sessions.delete(raw);
    return null;
  }
  const user = findUserById(session.userId);
  if (!user || user.disabled === true) {
    sessions.delete(raw);
    return null;
  }
  session.updatedAtMs = Date.now();
  user.lastSeenAt = nowIso();
  return {
    token: raw,
    kind: session.kind,
    user: publicUser(user, { includeAdminFields: true }),
  };
}

function destroySession(token) {
  sessions.delete(String(token || '').trim());
}

function destroySessionsForUser(userId) {
  for (const [token, session] of sessions.entries()) {
    if (String(session.userId) === String(userId)) sessions.delete(token);
  }
}

async function getPublicSession(token) {
  const session = await getSession(token);
  if (!session) return { authenticated: false, user: null };
  return {
    authenticated: true,
    user: session.user,
  };
}

async function updateOwnProfile(userId, { nickname, avatarDataUrl }) {
  return db.withLock(async () => {
    await db.read();
    const user = findUserById(userId);
    if (!user) throw new Error('用户不存在');
    const nextNickname = validateNickname(nickname);
    user.nickname = nextNickname;
    user.avatarDataUrl = sanitizeAvatarDataUrl(avatarDataUrl);
    user.updatedAt = nowIso();
    await saveDb();
    return publicUser(user, { includeAdminFields: true });
  });
}

async function changeOwnPassword(userId, { currentPassword, nextPassword }) {
  return db.withLock(async () => {
    await db.read();
    const user = findUserById(userId);
    if (!user) throw new Error('用户不存在');
    const currentSecret = String(currentPassword || '');
    if (!currentSecret || currentSecret.length > 256) throw new Error('当前密码错误');
    const ok = await verifyPassword(currentSecret, user.passwordHash);
    if (!ok) throw new Error('当前密码错误');
    const pwd = validateStrongPassword(nextPassword);
    if (!pwd.ok) throw new Error(`密码强度不足：${pwd.errors.join('，')}`);
    user.passwordHash = await hashPassword(nextPassword);
    user.updatedAt = nowIso();
    await saveDb();
    destroySessionsForUser(userId);
    return true;
  });
}

async function acceptGuide(userId) {
  return db.withLock(async () => {
    await db.read();
    const user = findUserById(userId);
    if (!user) throw new Error('用户不存在');
    user.guideAcceptedAt = nowIso();
    user.guideAcceptedVersion = GUIDE_VERSION;
    user.updatedAt = nowIso();
    await saveDb();
    return publicUser(user, { includeAdminFields: true });
  });
}

async function setUserSteamBinding(userId, steam = null) {
  return db.withLock(async () => {
    await db.read();
    const user = findUserById(userId);
    if (!user) return null;
    const profile = steam?.steamProfile || {};
    user.steamBinding = steam ? {
      steamId: steam?.tokenMeta?.steamId || '',
      steamName: profile.steamName || '',
      avatarUrl: profile.avatarFull || profile.avatarMedium || steam?.avatarUrl || '',
      stateMessage: profile.stateMessage || profile.onlineState || '',
      boundAt: nowIso(),
    } : null;
    user.updatedAt = nowIso();
    await saveDb();
    return publicUser(user, { includeAdminFields: true });
  });
}

async function listUsersForAdmin() {
  await db.read();
  return (db.data.users || [])
    .map((user) => publicUser(user, { includeAdminFields: true }))
    .sort((a, b) => {
      if (a.role === 'root' && b.role !== 'root') return -1;
      if (a.role !== 'root' && b.role === 'root') return 1;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
}

async function adminUpdateUser(userId, updates = {}) {
  return db.withLock(async () => {
    await db.read();
    const user = findUserById(userId);
    if (!user) throw new Error('用户不存在');
    if (String(user.role || '') === 'root') {
      throw new Error('root 账号只读，不可在后台修改');
    }
    if (updates.email != null) {
      const nextEmail = normalizeEmail(updates.email);
      if (!isValidEmail(nextEmail)) throw new Error('邮箱格式不正确');
      const duplicate = (db.data.users || []).find((item) => item.id !== user.id && normalizeEmail(item.email) === nextEmail);
      if (duplicate) throw new Error('邮箱已被其他账号使用');
      user.email = nextEmail;
    }
    if (updates.nickname != null) {
      const nextNickname = validateNickname(updates.nickname);
      user.nickname = nextNickname;
    }
    if (updates.avatarDataUrl != null) {
      user.avatarDataUrl = sanitizeAvatarDataUrl(updates.avatarDataUrl);
    }
    if (updates.disabled != null) {
      user.disabled = updates.disabled === true;
      if (user.disabled) destroySessionsForUser(user.id);
    }
    if (updates.password != null && String(updates.password || '').trim()) {
      const pwd = validateStrongPassword(updates.password);
      if (!pwd.ok) throw new Error(`密码强度不足：${pwd.errors.join('，')}`);
      user.passwordHash = await hashPassword(updates.password);
      destroySessionsForUser(user.id);
    }
    if (updates.clearSteamBinding === true) {
      user.steamBinding = null;
    }
    user.updatedAt = nowIso();
    await saveDb();
    return publicUser(user, { includeAdminFields: true });
  });
}

async function adminDeleteUser(userId) {
  return db.withLock(async () => {
    await db.read();
    const target = findUserById(userId);
    if (!target) throw new Error('用户不存在');
    if (String(target.role || '') === 'root') throw new Error('root 账号不可删除');
    db.data.users = (db.data.users || []).filter((item) => String(item.id) !== String(userId));
    destroySessionsForUser(userId);
    await saveDb();
    return true;
  });
}

async function getEmailProviderConfig() {
  await db.read();
  return {
    enabled: db.data.emailProvider?.enabled === true,
    host: String(db.data.emailProvider?.host || ''),
    port: Number(db.data.emailProvider?.port || 465) || 465,
    secure: db.data.emailProvider?.secure !== false,
    username: String(db.data.emailProvider?.username || ''),
    fromEmail: String(db.data.emailProvider?.fromEmail || ''),
    fromName: String(db.data.emailProvider?.fromName || 'Rust 工具箱'),
    passwordConfigured: !!String(db.data.emailProvider?.password || '').trim(),
    hasCompleteConfig: !!(
      db.data.emailProvider?.enabled
      && String(db.data.emailProvider?.host || '').trim()
      && String(db.data.emailProvider?.username || '').trim()
      && String(db.data.emailProvider?.password || '').trim()
      && String(db.data.emailProvider?.fromEmail || '').trim()
    ),
  };
}

async function updateEmailProviderConfig(payload = {}) {
  return db.withLock(async () => {
    await db.read();
    db.data.emailProvider = {
      ...db.data.emailProvider,
      ...validateEmailProviderConfigPayload(payload, db.data.emailProvider || {}),
    };
    await saveDb();
    return getEmailProviderConfig();
  });
}

async function sendVerificationCodeStub(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw new Error('邮箱格式不正确');
  await db.read();
  return {
    success: false,
    configured: !!(
      db.data.emailProvider?.enabled
      && String(db.data.emailProvider?.host || '').trim()
      && String(db.data.emailProvider?.username || '').trim()
      && String(db.data.emailProvider?.password || '').trim()
      && String(db.data.emailProvider?.fromEmail || '').trim()
    ),
    message: '邮箱验证码通道尚未配置，接口已预留',
  };
}

async function readRootCredentialFile() {
  try {
    return await fs.promises.readFile(ROOT_CREDENTIAL_FILE, 'utf8');
  } catch (_) {
    return '';
  }
}

module.exports = {
  GUIDE_VERSION,
  ROOT_CREDENTIAL_FILE,
  initAuthStore,
  validateStrongPassword,
  registerUser,
  authenticateUser,
  createSession,
  getSession,
  getPublicSession,
  destroySession,
  updateOwnProfile,
  changeOwnPassword,
  acceptGuide,
  setUserSteamBinding,
  listUsersForAdmin,
  adminCreateUser,
  adminUpdateUser,
  adminDeleteUser,
  getEmailProviderConfig,
  updateEmailProviderConfig,
  sendVerificationCodeStub,
  readRootCredentialFile,
};

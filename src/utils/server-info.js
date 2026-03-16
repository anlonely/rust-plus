function pickNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

function normalizeServerName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '未知服务器';
  return raw;
}

function extractServerInfo(source = {}) {
  if (!source || source.error) return null;
  return source.info || source.serverInfo || source;
}

function normalizeTimePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { time: payload };
  const direct = payload;
  const response = (direct.response && typeof direct.response === 'object' && !Array.isArray(direct.response))
    ? direct.response
    : {};
  const directTimeObj = (direct.time && typeof direct.time === 'object' && !Array.isArray(direct.time))
    ? direct.time
    : {};
  const responseTimeObj = (response.time && typeof response.time === 'object' && !Array.isArray(response.time))
    ? response.time
    : {};
  return {
    ...response,
    ...direct,
    ...responseTimeObj,
    ...directTimeObj,
  };
}

function extractTimeScalar(value, depth = 0) {
  if (value == null || depth > 4) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const probeKeys = ['time', 'gameTime', 'currentTime', 'clockTime', 'value'];
  for (const k of probeKeys) {
    const nested = extractTimeScalar(value?.[k], depth + 1);
    if (nested != null) return nested;
  }
  return null;
}

function parseGameSeconds(raw) {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const fromClock = parseClockSeconds(raw, null);
  if (fromClock != null) return fromClock;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 24) return Math.floor(n * 3600);
  if (n > 24 && n <= 1440) return Math.floor(n * 60);
  if (n > 1440 && n <= 86400) return Math.floor(n);
  return null;
}

function normalizeGameSeconds(raw) {
  const sec = parseGameSeconds(raw);
  if (sec == null) return 0;
  return sec;
}

function parseClockSeconds(raw, fallbackSeconds) {
  const text = String(raw || '').trim();
  const m = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return fallbackSeconds;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallbackSeconds;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallbackSeconds;
  return hh * 3600 + mm * 60;
}

const FIXED_DAY_START_SECONDS = parseClockSeconds(process.env.RUST_DAY_START_HHMM, 7 * 3600 + 30 * 60);   // 07:30
const FIXED_NIGHT_START_SECONDS = parseClockSeconds(process.env.RUST_NIGHT_START_HHMM, 19 * 3600 + 30 * 60); // 19:30

function toHourSeconds(raw, fallbackHour = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.floor(fallbackHour * 3600);
  if (n >= 0 && n <= 24) return Math.floor(n * 3600);
  if (n > 24 && n <= 1440) return Math.floor(n * 60);
  if (n > 1440 && n <= 86400) return Math.floor(n);
  return Math.floor(fallbackHour * 3600);
}

function formatHHMM(totalSeconds) {
  const sec = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDayNight(gameSeconds, sunriseRaw = null, sunsetRaw = null) {
  const sec = ((Math.floor(gameSeconds) % 86400) + 86400) % 86400;
  const dayStart = FIXED_DAY_START_SECONDS || toHourSeconds(sunriseRaw, 7.5);
  const nightStart = FIXED_NIGHT_START_SECONDS || toHourSeconds(sunsetRaw, 19.5);
  const isDay = sec >= dayStart && sec < nightStart;
  const target = isDay ? nightStart : dayStart;
  const remain = isDay
    ? (target - sec)
    : (sec < dayStart ? dayStart - sec : (86400 - sec + dayStart));
  const minutes = Math.floor(remain / 60);
  const seconds = remain % 60;
  return {
    period: isDay ? '白天' : '黑夜',
    phaseTarget: isDay ? '日落' : '天亮',
    remainMinutes: minutes,
    remainSeconds: seconds,
  };
}

function formatRemainText(remainSeconds) {
  const total = Math.max(0, Math.floor(Number(remainSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
  return `${minutes}分${seconds}秒`;
}

function formatRemainClock(remainSeconds) {
  const total = Math.max(0, Math.floor(Number(remainSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatServerInfoText(serverPayload, timePayload) {
  const s = buildServerInfoSnapshot(serverPayload, timePayload);
  const remain = s.realRemainText || s.remainText;
  return `${s.name} 人数:${s.players}/${s.maxPlayers}排队:[${s.queued}] 时间:${s.hhmm} ${s.phase} - 距离${s.phaseTarget}还有约${remain}`;
}

function extractGameSecondsFromPayload(timePayload, serverPayload = null) {
  const server = extractServerInfo(serverPayload) || {};
  const appTime = normalizeTimePayload(timePayload);
  const timeRaw = extractTimeScalar(appTime) ?? extractTimeScalar(server?.time) ?? extractTimeScalar(server?.gameTime);
  return parseGameSeconds(timeRaw);
}

function buildServerInfoSnapshot(serverPayload, timePayload) {
  const server = extractServerInfo(serverPayload) || {};
  const appTime = normalizeTimePayload(timePayload);
  const name = normalizeServerName(server.name);
  const players = pickNumber(server.players, server.onlinePlayers, server.currentPlayers);
  const maxPlayers = pickNumber(server.maxPlayers, server.maxplayers, server.slots);
  const queued = pickNumber(server.queuedPlayers, server.queue, server.queueSize, server.queued);
  const mapSize = pickNumber(server.mapSize, server.worldSize);

  const gameSeconds = extractGameSecondsFromPayload(timePayload, serverPayload) ?? 0;
  const hhmm = formatHHMM(gameSeconds);
  const phase = formatDayNight(gameSeconds, appTime?.sunrise, appTime?.sunset);
  const remainSec = phase.remainMinutes * 60 + phase.remainSeconds;
  const dayLengthMinutes = Number(appTime?.dayLengthMinutes);
  const timeScale = Number(appTime?.timeScale);
  let realRemainSec = null;
  if (Number.isFinite(dayLengthMinutes) && dayLengthMinutes > 0 && Number.isFinite(timeScale) && timeScale > 0) {
    const realSecondsPerGameDay = (dayLengthMinutes * 60) / timeScale;
    realRemainSec = remainSec * (realSecondsPerGameDay / 86400);
  } else {
    // Rust 默认：1 个游戏日约 60 分钟现实时间（可通过环境变量覆盖）
    const fallbackRealDaySeconds = Number(process.env.RUST_REAL_DAY_SECONDS || 3600);
    if (Number.isFinite(fallbackRealDaySeconds) && fallbackRealDaySeconds > 0) {
      realRemainSec = remainSec * (fallbackRealDaySeconds / 86400);
    }
  }

  const wipeTime = pickNumber(server.wipeTime);
  const seed = pickNumber(server.seed);
  const salt = pickNumber(server.salt);

  return {
    name,
    players,
    maxPlayers,
    queued,
    mapSize,
    wipeTime: wipeTime > 0 ? wipeTime : null,
    seed: seed > 0 ? seed : null,
    salt: salt > 0 ? salt : null,
    gameSeconds,
    hhmm,
    phase: phase.period,
    phaseTarget: phase.phaseTarget,
    phaseTargetShort: phase.phaseTarget === '日落' ? '天黑' : '天亮',
    remainMinutes: phase.remainMinutes,
    remainSeconds: phase.remainSeconds,
    remainText: formatRemainText(remainSec),
    remainClock: formatRemainClock(remainSec),
    realRemainSeconds: realRemainSec != null ? Math.max(0, Math.round(realRemainSec)) : null,
    realRemainText: realRemainSec != null ? formatRemainText(realRemainSec) : '',
    dayLengthMinutes: Number.isFinite(dayLengthMinutes) ? dayLengthMinutes : null,
    timeScale: Number.isFinite(timeScale) ? timeScale : null,
  };
}

module.exports = {
  buildServerInfoSnapshot,
  formatServerInfoText,
  extractGameSecondsFromPayload,
};

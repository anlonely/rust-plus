const { markerToGrid } = require('./map-grid');

const DEEP_SEA_COUNTDOWN_SECONDS = Number(process.env.DEEP_SEA_COUNTDOWN_SECONDS || 3 * 60 * 60);
const DEEP_SEA_REOPEN_INTERVAL_SECONDS = process.env.DEEP_SEA_REOPEN_INTERVAL_SECONDS != null
  ? Number(process.env.DEEP_SEA_REOPEN_INTERVAL_SECONDS)
  : null;
const DEEP_SEA_STATE_STALE_SECONDS = Number(process.env.DEEP_SEA_STATE_STALE_SECONDS || 48 * 60 * 60);

let countdownCloseAtMs = null;

function formatDurationFixedHms(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(1, '0')}小时${String(m).padStart(2, '0')}分钟${String(s).padStart(2, '0')}秒`;
}

function formatMinutesSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}小时${m}分${s}秒`;
  return `${m}分${s}秒`;
}

function formatDurationClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDurationHms(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}时${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`;
  return `${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`;
}

function detectDeepSeaMarkers(markers = [], mapSize) {
  const size = Number(mapSize);
  if (!Number.isFinite(size) || size <= 0) {
    return {
      markerActive: false,
      matchedCount: 0,
      matchedNames: [],
      npcCenter: null,
      direction: null,
      entryGrid: null,
      entryCoord: null,
    };
  }

  const deepSea = (Array.isArray(markers) ? markers : []).filter((m) => {
    if (!m) return false;
    if (Number(m.type) !== 3) return false;
    const x = Number(m.x);
    const y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x < 0 || y < 0 || x > size || y > size;
  });

  if (!deepSea.length) {
    return {
      markerActive: false,
      matchedCount: 0,
      matchedNames: [],
      npcCenter: null,
      direction: null,
      entryGrid: null,
      entryCoord: null,
    };
  }

  const cx = deepSea.reduce((acc, m) => acc + Number(m.x || 0), 0) / deepSea.length;
  const cy = deepSea.reduce((acc, m) => acc + Number(m.y || 0), 0) / deepSea.length;

  const overshoot = {
    南: Math.max(0, -cx),
    北: Math.max(0, cx - size),
    西: Math.max(0, -cy),
    东: Math.max(0, cy - size),
  };
  const direction = Object.entries(overshoot).sort((a, b) => b[1] - a[1])[0][0];

  let entryMarker = null;
  if (direction === '南') entryMarker = { x: 0, y: cy };
  else if (direction === '北') entryMarker = { x: size, y: cy };
  else if (direction === '西') entryMarker = { x: cx, y: 0 };
  else entryMarker = { x: cx, y: size };

  const entryGrid = markerToGrid(entryMarker, size);
  const entryCoord = `x=${Math.round(entryMarker.x)}, y=${Math.round(entryMarker.y)}`;

  return {
    markerActive: true,
    matchedCount: deepSea.length,
    matchedNames: deepSea.map((m) => String(m?.name || '')).filter(Boolean).slice(0, 5),
    npcCenter: { x: Math.round(cx), y: Math.round(cy) },
    direction,
    entryGrid,
    entryCoord,
  };
}

function startDeepSeaCountdown(seconds = DEEP_SEA_COUNTDOWN_SECONDS) {
  const sec = Math.max(1, Math.floor(Number(seconds) || 0));
  countdownCloseAtMs = Date.now() + sec * 1000;
}

function stopDeepSeaCountdown() {
  countdownCloseAtMs = null;
}

function getDeepSeaCountdownSeconds() {
  if (!countdownCloseAtMs) return null;
  const left = Math.max(0, Math.round((countdownCloseAtMs - Date.now()) / 1000));
  if (left <= 0) {
    countdownCloseAtMs = null;
    return null;
  }
  return left;
}

function isTimestampValid(ts, staleSeconds, now = Date.now()) {
  const ms = Date.parse(ts || '');
  if (!Number.isFinite(ms)) return null;
  if (!Number.isFinite(staleSeconds) || staleSeconds <= 0) return ms;
  return now - ms <= staleSeconds * 1000 ? ms : null;
}

function computeInferredOpenSeconds({ lastOpenAt, lastCloseAt, durationSeconds, now }) {
  const openMs = isTimestampValid(lastOpenAt, durationSeconds * 2, now);
  if (!openMs) return null;
  const closeMs = isTimestampValid(lastCloseAt, durationSeconds * 2, now);
  if (closeMs && closeMs >= openMs) return null;
  const endMs = openMs + durationSeconds * 1000;
  if (now >= endMs) return null;
  return Math.max(1, Math.round((endMs - now) / 1000));
}

function computeNextOpenSeconds({ lastCloseAt, intervalSeconds, staleSeconds, now }) {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return null;
  const closeMs = isTimestampValid(lastCloseAt, staleSeconds, now);
  if (!closeMs) return null;
  const target = closeMs + intervalSeconds * 1000;
  return Math.max(0, Math.round((target - now) / 1000));
}

function analyzeDeepSeaStatus({
  markers = [],
  timeInfo = {},
  mapSize = null,
  lastOpenAt = null,
  lastCloseAt = null,
  reopenIntervalSeconds = DEEP_SEA_REOPEN_INTERVAL_SECONDS,
  now = Date.now(),
  durationSeconds = DEEP_SEA_COUNTDOWN_SECONDS,
} = {}) {
  const detection = detectDeepSeaMarkers(markers, mapSize);
  const signalOpen = detection.markerActive;

  const countdownLeft = getDeepSeaCountdownSeconds();
  const inferredRemain = !countdownLeft && signalOpen
    ? computeInferredOpenSeconds({ lastOpenAt, lastCloseAt, durationSeconds, now })
    : null;

  const isOpen = countdownLeft != null || inferredRemain != null;
  const countdownSeconds = countdownLeft != null ? countdownLeft : inferredRemain;

  const realSecondsUntilNext = isOpen
    ? countdownSeconds
    : computeNextOpenSeconds({
        lastCloseAt,
        intervalSeconds: reopenIntervalSeconds,
        staleSeconds: Number.isFinite(DEEP_SEA_STATE_STALE_SECONDS) && DEEP_SEA_STATE_STALE_SECONDS > 0
          ? DEEP_SEA_STATE_STALE_SECONDS
          : (reopenIntervalSeconds || 1) * 6,
        now,
      });

  const remainForFormat = Number.isFinite(realSecondsUntilNext) ? Math.max(0, realSecondsUntilNext) : 0;

  return {
    ...detection,
    isOpen,
    signalOpen,
    countdownSeconds,
    nextTarget: isOpen ? '关闭' : '开启',
    realSecondsUntilNext: Number.isFinite(realSecondsUntilNext) ? Math.max(0, realSecondsUntilNext) : null,
    realRemainText: formatDuration(remainForFormat),
    realRemainClock: formatDurationClock(remainForFormat),
    realRemainHms: formatDurationHms(remainForFormat),
    shouldResumeCountdown: countdownLeft == null && inferredRemain != null,
    inferredRemainSeconds: inferredRemain,
  };
}

module.exports = {
  analyzeDeepSeaStatus,
  detectDeepSeaMarkers,
  formatDuration,
  formatDurationClock,
  formatDurationHms,
  formatDurationFixedHms,
  formatMinutesSeconds,
  startDeepSeaCountdown,
  stopDeepSeaCountdown,
  getDeepSeaCountdownSeconds,
};

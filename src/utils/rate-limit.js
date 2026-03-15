const buckets = new Map();

// 每 10 分钟清理一次已过期的空桶，防止 Map 无限增长
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, arr] of buckets) {
    // 清除窗口内已过期的时间戳
    while (arr.length && now - arr[0] >= CLEANUP_INTERVAL_MS) arr.shift();
    // 空桶直接删除
    if (arr.length === 0) buckets.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref(); // unref 确保不阻止进程退出

class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitError';
    this.code = 'RATE_LIMIT';
  }
}

function consumeRateLimit(bucketKey, { limit = 15, windowMs = 60_000, message = '' } = {}) {
  const key = String(bucketKey || 'default');
  const max = Math.max(1, parseInt(limit, 10) || 1);
  const window = Math.max(1_000, parseInt(windowMs, 10) || 60_000);
  const now = Date.now();
  const arr = Array.isArray(buckets.get(key)) ? buckets.get(key) : [];
  while (arr.length && now - arr[0] >= window) arr.shift();
  if (arr.length >= max) {
    throw new RateLimitError(message || `请求过于频繁：每分钟最多 ${max} 次，请稍后再试`);
  }
  arr.push(now);
  buckets.set(key, arr);
  return { used: arr.length, limit: max, windowMs: window };
}

module.exports = {
  consumeRateLimit,
  RateLimitError,
};

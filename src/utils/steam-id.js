function normalizeSteamId64(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    try {
      if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
        const raw = String(value.toString()).trim();
        if (raw && raw !== '[object Object]') return raw;
      }
    } catch (_) {
      // ignore
    }
    const low = Number(value.low ?? value.lo ?? value.lowBits ?? value.valueLow);
    const high = Number(value.high ?? value.hi ?? value.highBits ?? value.valueHigh);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      try {
        const lo = BigInt(low >>> 0);
        const hi = BigInt(high >>> 0);
        return ((hi << 32n) | lo).toString();
      } catch (_) {
        // ignore
      }
    }
    if (value.value != null && value.value !== value) return normalizeSteamId64(value.value);
  }
  return '';
}

module.exports = {
  normalizeSteamId64,
};

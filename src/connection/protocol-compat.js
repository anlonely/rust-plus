const COMPATIBILITY_PATTERNS = [
  'invalid wire type',
  'missing required',
  'protocolerror',
  'index out of range',
  'out of range',
  'out of bounds',
  'illegal buffer',
  'truncated',
  'index overrun',
];

function normalizeErrorText(error) {
  return String(error?.message || error || '').trim();
}

function isRustProtocolCompatibilityError(error) {
  const lower = normalizeErrorText(error).toLowerCase();
  return COMPATIBILITY_PATTERNS.some((pattern) => lower.includes(pattern));
}

function getRustProtocolCompatibilityMessage() {
  return '当前服务器返回了非标准 Rust+ 消息，部分队伍、标记或事件数据可能缺失，但基础连接会继续保持。';
}

module.exports = {
  normalizeErrorText,
  isRustProtocolCompatibilityError,
  getRustProtocolCompatibilityMessage,
};

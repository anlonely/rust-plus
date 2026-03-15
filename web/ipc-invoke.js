function createIpcInvoker(handlers = {}) {
  const table = handlers && typeof handlers === 'object' ? handlers : {};

  return async function invoke(payload = {}) {
    const channel = String(payload.channel || '').trim();
    const args = Array.isArray(payload.args) ? payload.args : [];
    if (!channel) throw new Error('channel 不能为空');

    const handler = table[channel];
    if (typeof handler !== 'function') {
      throw new Error(`未知 IPC 通道: ${channel}`);
    }
    return handler(args);
  };
}

module.exports = { createIpcInvoker };


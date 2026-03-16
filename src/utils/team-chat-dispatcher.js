function wait(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTeamChatDispatcher({ sendMessage, normalizeMessage = (value) => String(value || '').trim(), getIntervalMs = () => 3000, onSent = null } = {}) {
  if (typeof sendMessage !== 'function') {
    throw new TypeError('sendMessage must be a function');
  }
  let queue = Promise.resolve();
  let lastSentAt = 0;

  return async function dispatch(rawMessage) {
    const run = queue.then(async () => {
      const message = normalizeMessage(rawMessage);
      if (!message) throw new Error('消息不能为空');
      const intervalMs = Math.max(0, Number(getIntervalMs?.() ?? 3000) || 3000);
      const now = Date.now();
      const waitMs = Math.max(0, intervalMs - Math.max(0, now - lastSentAt));
      if (waitMs > 0) await wait(waitMs);
      await sendMessage(message);
      lastSentAt = Date.now();
      if (typeof onSent === 'function') {
        await onSent(message);
      }
      return { success: true, message };
    });
    queue = run.catch(() => {});
    return run;
  };
}

module.exports = {
  createTeamChatDispatcher,
};

async function withRetry(subscribeFn, entityId, source = 'manual', { attempts = 3, delayMs = 1200 } = {}) {
  const totalAttempts = Math.max(1, Number(attempts) || 1);
  const waitMs = Math.max(0, Number(delayMs) || 0);
  for (let index = 0; index < totalAttempts; index += 1) {
    if (await subscribeFn(entityId, `${source}#${index + 1}`)) return true;
    if (index < totalAttempts - 1 && waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return false;
}

async function ensureAll(listDevicesFn, subscribeFn, serverId, source, logger) {
  const sid = String(serverId || '').trim();
  if (!sid) return;
  const devices = await listDevicesFn(sid).catch(() => []);
  if (!Array.isArray(devices) || !devices.length) return;
  const results = await Promise.allSettled(
    devices.map((device) => withRetry(subscribeFn, device?.entityId, `${source}:${sid}`)),
  );
  const failed = results.filter((result) => (result.status === 'fulfilled' ? !result.value : true)).length;
  if (failed > 0 && logger) {
    logger.warn(`设备广播补订阅未完全成功: ${devices.length - failed}/${devices.length}`);
  }
}

module.exports = {
  withRetry,
  ensureAll,
};

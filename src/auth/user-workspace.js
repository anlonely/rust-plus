const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../utils/runtime-paths');

const SERVICE_CONTEXT_ID = '__web_service__';

function sanitizeUserScopeSegment(raw = '') {
  const text = String(raw || '').trim();
  return text.replace(/[^a-zA-Z0-9_-]/g, '_') || 'anonymous';
}

function getWebUserConfigDir(userId = '') {
  const bucket = String(userId || '').trim() ? sanitizeUserScopeSegment(userId) : SERVICE_CONTEXT_ID;
  return path.join(getConfigDir(), 'web-users', bucket);
}

function getWebUserRustplusConfigFile(userId = '') {
  return path.join(getWebUserConfigDir(userId), 'rustplus.config.json');
}

async function removeWebUserWorkspace(userId = '') {
  const normalized = String(userId || '').trim();
  if (!normalized || normalized === SERVICE_CONTEXT_ID) return false;
  await fs.promises.rm(getWebUserConfigDir(normalized), { recursive: true, force: true });
  return true;
}

async function clearWebUserRustplusConfig(userId = '') {
  const normalized = String(userId || '').trim();
  if (!normalized || normalized === SERVICE_CONTEXT_ID) return false;
  await fs.promises.rm(getWebUserRustplusConfigFile(normalized), { force: true });
  return true;
}

module.exports = {
  SERVICE_CONTEXT_ID,
  sanitizeUserScopeSegment,
  getWebUserConfigDir,
  getWebUserRustplusConfigFile,
  removeWebUserWorkspace,
  clearWebUserRustplusConfig,
};

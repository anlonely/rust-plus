const DEFAULT_AI_SETTINGS = Object.freeze({
  provider: 'anthropic',
  baseUrl: '',
  authToken: '',
  model: '',
  modelName: 'Custom AI Model',
  modelDescription: 'Anthropic-compatible endpoint for ai/fy commands.',
  disableExperimentalBetas: true,
  timeoutMs: 30000,
});

let settingsProvider = null;

function normalizeAiSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    provider: String(source.provider || DEFAULT_AI_SETTINGS.provider).trim() || DEFAULT_AI_SETTINGS.provider,
    baseUrl: String(source.baseUrl || DEFAULT_AI_SETTINGS.baseUrl).trim() || DEFAULT_AI_SETTINGS.baseUrl,
    authToken: String(source.authToken || DEFAULT_AI_SETTINGS.authToken).trim() || DEFAULT_AI_SETTINGS.authToken,
    model: String(source.model || DEFAULT_AI_SETTINGS.model).trim() || DEFAULT_AI_SETTINGS.model,
    modelName: String(source.modelName || DEFAULT_AI_SETTINGS.modelName).trim() || DEFAULT_AI_SETTINGS.modelName,
    modelDescription: String(source.modelDescription || DEFAULT_AI_SETTINGS.modelDescription).trim() || DEFAULT_AI_SETTINGS.modelDescription,
    disableExperimentalBetas: source.disableExperimentalBetas !== false,
    timeoutMs: Math.max(3000, parseInt(source.timeoutMs, 10) || DEFAULT_AI_SETTINGS.timeoutMs),
  };
}

function maskSecret(secret = '') {
  const value = String(secret || '').trim();
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

function isMaskedSecret(secret = '') {
  return /^••••.+$/.test(String(secret || ''));
}

function maskAiSettingsForDisplay(raw = {}) {
  const settings = normalizeAiSettings(raw);
  return {
    ...settings,
    authToken: maskSecret(settings.authToken),
  };
}

function setAiSettingsProvider(provider) {
  settingsProvider = typeof provider === 'function' ? provider : null;
}

async function getAiSettings() {
  if (!settingsProvider) return normalizeAiSettings();
  try {
    return normalizeAiSettings(await settingsProvider());
  } catch (_) {
    return normalizeAiSettings();
  }
}

module.exports = {
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  maskAiSettingsForDisplay,
  isMaskedSecret,
  setAiSettingsProvider,
  getAiSettings,
};

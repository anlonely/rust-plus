const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CATALOG_PATH = path.resolve(__dirname, '../../config/item-catalog.json');

let cache = null;
let warned = false;

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_./-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompact(value = '') {
  return normalizeText(value).replace(/\s+/g, '');
}

function splitTokens(value = '') {
  const text = normalizeText(value);
  if (!text) return [];
  return text.split(' ').map((s) => s.trim()).filter(Boolean);
}

function loadCatalog() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const itemsRaw = Array.isArray(parsed?.items) ? parsed.items : [];
    const byId = new Map();
    const items = [];
    for (const item of itemsRaw) {
      const id = Number(item?.id);
      const shortName = String(item?.shortName || '').trim();
      const nameEn = String(item?.nameEn || '').trim();
      const nameZh = String(item?.nameZh || '').trim();
      if (!Number.isFinite(id) || !shortName) continue;
      const aliasNames = [shortName, nameEn, nameZh].filter(Boolean);
      const tokenSet = new Set();
      aliasNames.forEach((name) => splitTokens(name).forEach((token) => tokenSet.add(token)));
      const searchBlob = aliasNames.join(' ');
      const normalized = normalizeCompact(searchBlob);
      const normalizedWords = splitTokens(searchBlob);
      const normalizedShortName = normalizeCompact(shortName);
      const normalizedNameEn = normalizeCompact(nameEn);
      const normalizedNameZh = normalizeCompact(nameZh);
      const normalizedShortWords = splitTokens(shortName);
      const entry = {
        id,
        shortName,
        nameEn,
        nameZh,
        normalized,
        normalizedWords,
        normalizedShortName,
        normalizedNameEn,
        normalizedNameZh,
        normalizedShortWords,
        tokens: Array.from(tokenSet),
      };
      items.push(entry);
      byId.set(String(id), entry);
    }
    cache = { meta: parsed?.meta || {}, items, byId };
    return cache;
  } catch (err) {
    if (!warned) {
      warned = true;
      logger.warn(`[ItemCatalog] 加载失败: ${err.message}`);
    }
    cache = { meta: {}, items: [], byId: new Map() };
    return cache;
  }
}

function getItemById(itemId) {
  const { byId } = loadCatalog();
  const id = Number(itemId);
  if (!Number.isFinite(id)) return null;
  const item = byId.get(String(id));
  if (!item) return null;
  return {
    id: item.id,
    shortName: item.shortName,
    nameEn: item.nameEn,
    nameZh: item.nameZh,
  };
}

function matchItems(query, { limit = 50 } = {}) {
  const tokenRaw = String(query || '').trim();
  if (!tokenRaw) return [];
  const catalog = loadCatalog();
  if (!catalog.items.length) return [];

  const qCompact = normalizeCompact(tokenRaw);
  const qWords = splitTokens(tokenRaw);
  if (!qCompact && !qWords.length) return [];

  const scored = [];
  for (const item of catalog.items) {
    let score = 0;
    if (qCompact) {
      if (item.normalizedShortName === qCompact) score = Math.max(score, 320);
      if (item.normalizedNameZh === qCompact) score = Math.max(score, 300);
      if (item.normalizedNameEn === qCompact) score = Math.max(score, 290);
      if (item.normalized.startsWith(qCompact)) score = Math.max(score, 240);
      if (item.normalized.includes(qCompact)) score = Math.max(score, 210);
    }

    if (qWords.length) {
      const allInWords = qWords.every((word) => item.normalizedWords.some((w) => w.includes(word)));
      if (allInWords) score = Math.max(score, 200 + Math.min(40, qWords.length * 8));
      const allInTokens = qWords.every((word) => item.tokens.some((t) => t.includes(word)));
      if (allInTokens) score = Math.max(score, 180 + Math.min(30, qWords.length * 6));
      const shortWordPrefix = qWords.every((word) => item.normalizedShortWords.some((w) => w.startsWith(word)));
      if (shortWordPrefix) score = Math.max(score, 230);
    }

    if (score > 0) scored.push({ item, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.item.shortName.length !== b.item.shortName.length) return a.item.shortName.length - b.item.shortName.length;
    return a.item.id - b.item.id;
  });

  return scored.slice(0, Math.max(1, limit)).map(({ item }) => ({
    id: item.id,
    shortName: item.shortName,
    nameEn: item.nameEn,
    nameZh: item.nameZh,
  }));
}

module.exports = {
  loadCatalog,
  getItemById,
  matchItems,
  normalizeText,
  normalizeCompact,
  splitTokens,
};

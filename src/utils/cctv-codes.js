const fs = require('node:fs');
const path = require('node:path');

const CCTV_CODES_PATH = path.resolve(__dirname, '../../config/cctv-codes.json');

let cachedData = null;

function loadCctvCodes() {
  if (!cachedData) {
    cachedData = JSON.parse(fs.readFileSync(CCTV_CODES_PATH, 'utf8'));
  }
  return cachedData;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_+=[\]{};:'"\\|,.<>/?\s-]+/g, '');
}

function scoreTextMatch(queryNorm, candidateNorm) {
  if (!queryNorm || !candidateNorm) return -1;
  if (queryNorm === candidateNorm) return 120;
  if (candidateNorm.startsWith(queryNorm)) return 100;
  if (candidateNorm.includes(queryNorm)) return 80;
  if (queryNorm.includes(candidateNorm)) return 60;
  return -1;
}

function matchCctvEntries(query) {
  const data = loadCctvCodes();
  const queryNorm = normalizeText(query);
  if (!queryNorm) return [];

  return (data.entries || [])
    .map((entry) => {
      const texts = [
        entry.nameZh,
        entry.nameEn,
        entry.slug,
        ...(Array.isArray(entry.aliases) ? entry.aliases : []),
        ...(Array.isArray(entry.codes)
          ? entry.codes.flatMap((code) => [code?.id, code?.location])
          : []),
      ];
      let bestScore = -1;
      for (const text of texts) {
        const score = scoreTextMatch(queryNorm, normalizeText(text));
        if (score > bestScore) bestScore = score;
      }
      return bestScore >= 0 ? { ...entry, _score: bestScore } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return String(a.nameZh || a.nameEn).localeCompare(String(b.nameZh || b.nameEn), 'zh-Hans-CN');
    });
}

module.exports = {
  loadCctvCodes,
  matchCctvEntries,
};

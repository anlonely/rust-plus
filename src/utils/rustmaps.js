const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const PAGE_DATA_RE = /window\.pageData\s*=\s*(\{.*?\})\s*;<\/script>/s;
const CACHE_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.RUSTMAPS_CACHE_TTL_MS || 12 * 60 * 60 * 1000));

const DEFAULT_CUSTOM_HINTS = [
  {
    id: 'rusty-moose-hapis',
    url: 'https://rustmaps.com/map/186d52787b9442b6927ec4976ed94550',
    mapSize: 4096,
    serverNameIncludes: ['rusty moose', 'hapis'],
  },
];

const cache = new Map();
const PROCEDURAL_SIZE_STEP = Math.max(1, Number(process.env.RUSTMAPS_PROCEDURAL_SIZE_STEP || 50));

function safeLower(value) {
  return String(value || '').trim().toLowerCase();
}

function parseCustomHints() {
  const raw = String(process.env.RUSTMAPS_CUSTOM_HINTS_JSON || '').trim();
  if (!raw) return DEFAULT_CUSTOM_HINTS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_CUSTOM_HINTS;
  } catch (_) {
    return DEFAULT_CUSTOM_HINTS;
  }
}

function centeredToMapCoord(value, mapSize) {
  const num = Number(value);
  const size = Number(mapSize);
  if (!Number.isFinite(num) || !Number.isFinite(size) || size <= 0) return null;
  return num + (size / 2);
}

function parseRustMapsPageData(html = '') {
  const text = String(html || '');
  const match = text.match(PAGE_DATA_RE);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed?.data || null;
  } catch (_) {
    return null;
  }
}

function normalizeRustMapsMonument(monument = {}, mapSize = 0) {
  const size = Number(mapSize || 0);
  const cx = Number(monument?.coordinates?.x);
  const cy = Number(monument?.coordinates?.y);
  const x = centeredToMapCoord(cx, size);
  const y = centeredToMapCoord(cy, size);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const label = String(monument?.nameOverride || monument?.type || '').trim();
  if (!label) return null;
  return {
    x,
    y,
    token: String(monument?.iconPath || monument?.type || label),
    label,
    type: String(monument?.type || '').trim(),
    source: 'rustmaps',
  };
}

function normalizeProceduralMapSize(mapSize = 0) {
  const size = Number(mapSize || 0);
  if (!Number.isFinite(size) || size <= 0) return 0;
  const step = Math.max(1, PROCEDURAL_SIZE_STEP);
  return Math.round(size / step) * step;
}

function buildProceduralUrl(size, seed) {
  const normalizedSize = Number(size || 0);
  const normalizedSeed = Number(seed);
  if (!Number.isFinite(normalizedSize) || normalizedSize <= 0 || !Number.isFinite(normalizedSeed)) return '';
  return `https://rustmaps.com/map/${normalizedSize}_${normalizedSeed}`;
}

function buildRustMapsUrlCandidates(serverMeta = {}) {
  const mapSize = Number(serverMeta?.mapSize || 0);
  const seed = Number(serverMeta?.seed);
  const normalizedSize = normalizeProceduralMapSize(mapSize);
  const variants = [];
  const push = (size) => {
    const url = buildProceduralUrl(size, seed);
    if (url && !variants.includes(url)) variants.push(url);
  };
  push(normalizedSize);
  push(mapSize);
  push(Math.ceil(mapSize / 100) * 100);
  push(Math.floor(mapSize / 100) * 100);
  push(Math.ceil(mapSize / 50) * 50);
  push(Math.floor(mapSize / 50) * 50);
  return variants.filter(Boolean);
}

function resolveRustMapsUrl(serverMeta = {}) {
  const mapSize = Number(serverMeta?.mapSize || 0);
  const seed = Number(serverMeta?.seed);
  const serverName = safeLower(serverMeta?.serverName);
  const mapName = safeLower(serverMeta?.mapName);
  const customHints = parseCustomHints();

  for (const hint of customHints) {
    const hintSize = Number(hint?.mapSize || 0);
    const mustMatchSize = Number.isFinite(hintSize) && hintSize > 0;
    if (mustMatchSize && hintSize !== mapSize) continue;
    const needles = Array.isArray(hint?.serverNameIncludes) ? hint.serverNameIncludes : [];
    if (needles.length && !needles.every((token) => serverName.includes(safeLower(token)))) continue;
    const mapNeedles = Array.isArray(hint?.mapNameIncludes) ? hint.mapNameIncludes : [];
    if (mapNeedles.length && !mapNeedles.every((token) => mapName.includes(safeLower(token)))) continue;
    const url = String(hint?.url || '').trim();
    if (url) return url;
  }

  const candidates = buildRustMapsUrlCandidates(serverMeta);
  return candidates[0] || '';
}

async function fetchRustMapsMonuments(serverMeta = {}) {
  const customUrl = resolveRustMapsUrl(serverMeta);
  const urls = customUrl && !customUrl.includes('/map/')
    ? [customUrl]
    : (customUrl && customUrl.includes('/map/') && String(serverMeta?.serverName || '').toLowerCase().includes('hapis')
      ? [customUrl]
      : buildRustMapsUrlCandidates(serverMeta));
  if (!urls.length) return null;

  for (const url of urls) {
    const now = Date.now();
    const cached = cache.get(url);
    if (cached && (now - cached.at) < CACHE_TTL_MS && cached.data) return cached.data;
    if (cached?.promise) {
      const data = await cached.promise;
      if (data?.monuments?.length) return data;
      continue;
    }

    const promise = (async () => {
      try {
        const res = await fetch(url, {
          headers: {
            'user-agent': DEFAULT_USER_AGENT,
            'accept': 'text/html,application/xhtml+xml',
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const pageData = parseRustMapsPageData(html);
        const pageMapSize = Number(pageData?.size || serverMeta?.mapSize || 0);
        const monumentsRaw = Array.isArray(pageData?.monuments) ? pageData.monuments : [];
        const monuments = monumentsRaw
          .map((row) => normalizeRustMapsMonument(row, pageMapSize))
          .filter(Boolean);
        const data = { url, monuments };
        cache.set(url, { at: Date.now(), data });
        return data;
      } catch (_) {
        cache.delete(url);
        return null;
      }
    })();

    cache.set(url, { at: now, data: null, promise });
    const data = await promise;
    if (data?.monuments?.length) return data;
  }
  return null;
}

async function enrichMapDataWithRustMaps(mapData = {}, serverMeta = {}) {
  const enriched = { ...(mapData || {}) };
  const rustmaps = await fetchRustMapsMonuments(serverMeta);
  if (!rustmaps?.monuments?.length) return enriched;
  enriched.externalMonuments = rustmaps.monuments;
  enriched.externalMapUrl = rustmaps.url;
  return enriched;
}

module.exports = {
  centeredToMapCoord,
  parseRustMapsPageData,
  normalizeRustMapsMonument,
  normalizeProceduralMapSize,
  buildRustMapsUrlCandidates,
  resolveRustMapsUrl,
  fetchRustMapsMonuments,
  enrichMapDataWithRustMaps,
};

// rustplus 风格: GRID_DIAMETER = 1024/7, 无偏移
const GRID_SIZE_REF = Number(process.env.RUST_GRID_SIZE || 146.28571428571428);

function toColumnLabel(idx) {
  let n = Math.max(0, Math.floor(idx));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function resolveGridMeta(mapSize) {
  const size = Number(mapSize);
  if (!Number.isFinite(size) || size <= 0) return null;
  const ref = Number.isFinite(GRID_SIZE_REF) && GRID_SIZE_REF > 0 ? GRID_SIZE_REF : 146.3;
  const cols = Math.max(1, Math.floor(size / ref));
  const cellSize = size / cols;
  return { cols, rows: cols, cellSize };
}

function toMapAxis(value, mapSize) {
  const v = Number(value);
  const size = Number(mapSize);
  if (!Number.isFinite(v) || !Number.isFinite(size) || size <= 0) return null;
  // Prefer already-map coordinates first: (0 ~ size)
  if (v >= 0 && v <= size) return v;
  const half = size / 2;
  // Fallback: Rust world coordinates (-size/2 ~ size/2)
  if (v >= -half && v <= half) return v + half;
  // Some marker streams may use wrapped map coordinates (-size ~ 0 / size ~ 2*size)
  if (v >= -size && v < 0) return v + size;
  if (v > size && v <= size * 2) return v - size;
  return null;
}

function toNearestMapAxis(value, mapSize) {
  const distanceToRange = (num, min, max) => {
    if (num < min) return min - num;
    if (num > max) return num - max;
    return 0;
  };
  const v = Number(value);
  const size = Number(mapSize);
  if (!Number.isFinite(v) || !Number.isFinite(size) || size <= 0) return null;

  const direct = toMapAxis(v, size);
  if (direct != null) return direct;

  const half = size / 2;
  const candidates = [
    {
      value: clamp(v, 0, size),
      delta: distanceToRange(v, 0, size),
    },
    {
      value: clamp(v + half, 0, size),
      delta: distanceToRange(v, -half, half),
    },
    {
      value: clamp(v + size, 0, size),
      delta: distanceToRange(v, -size, 0),
    },
    {
      value: clamp(v - size, 0, size),
      delta: distanceToRange(v, size, size * 2),
    },
  ];
  candidates.sort((a, b) => a.delta - b.delta);
  return candidates[0].value;
}

function markerToGrid(marker = {}, mapSize) {
  const size = Number(mapSize);
  if (!Number.isFinite(size) || size <= 0) return '-';
  const meta = resolveGridMeta(size);
  if (!meta) return '-';

  const mapX = toNearestMapAxis(marker?.x, size); // 东西轴（列）
  const mapY = toNearestMapAxis(marker?.y, size); // 南北轴（行）
  if (mapX == null || mapY == null) return '-';

  const cols = meta.cols;
  const rows = meta.rows;
  const cell = meta.cellSize;
  // rustplus 风格: col = floor(x / cellSize), row = floor((mapSize - y) / cellSize)
  const colIndex = clamp(Math.floor(mapX / cell), 0, cols - 1);
  const rowNumber = clamp(Math.floor((size - mapY) / cell), 0, rows - 1);

  return `${toColumnLabel(colIndex)}${rowNumber}`;
}

function markerToGrid9(marker = {}, mapSize, options = {}) {
  const size = Number(mapSize);
  if (!Number.isFinite(size) || size <= 0) return '-';
  const meta = resolveGridMeta(size);
  if (!meta) return '-';
  const colOffset = Number(options.colOffset || 0);
  const rowOffset = Number(options.rowOffset || 0);
  const subXOffset = Number(options.subXOffset || 0);
  const subYOffset = Number(options.subYOffset || 0);

  const mapX = toNearestMapAxis(marker?.x, size); // 东西（列）
  const mapY = toNearestMapAxis(marker?.y, size); // 南北（行）
  if (mapX == null || mapY == null) return '-';

  const cols = meta.cols;
  const rows = meta.rows;
  const cell = meta.cellSize;

  // rustplus 风格: col = floor(x / cellSize), row = floor((mapSize - y) / cellSize)
  const gx = mapX / cell;
  const gy = (size - mapY) / cell;
  const colIndex = clamp(Math.floor(gx) + colOffset, 0, cols - 1);
  const rowNumber = clamp(Math.floor(gy) + rowOffset, 0, rows - 1);
  const base = `${toColumnLabel(colIndex)}${rowNumber}`;

  const fracX = clamp(gx - Math.floor(gx), 0, 0.999999);
  const fracY = clamp(gy - Math.floor(gy), 0, 0.999999);

  const fracXAdj = ((fracX + subXOffset) % 1 + 1) % 1;
  const fracYAdj = ((fracY + subYOffset) % 1 + 1) % 1;
  const subCol = clamp(Math.floor(fracXAdj * 3), 0, 2);
  const subRow = clamp(Math.floor(fracYAdj * 3), 0, 2);
  const sub = subRow * 3 + subCol + 1;

  return `${base}-${sub}`;
}

function markerToNearestEdgeDirection(marker = {}, mapSize) {
  const size = Number(mapSize);
  if (!Number.isFinite(size) || size <= 0) return '';
  const mapX = toNearestMapAxis(marker?.x, size);
  const mapY = toNearestMapAxis(marker?.y, size);
  if (mapX == null || mapY == null) return '';

  const distances = [
    { dir: 'W', dist: mapX },
    { dir: 'E', dist: size - mapX },
    { dir: 'S', dist: mapY },
    { dir: 'N', dist: size - mapY },
  ];
  distances.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.dir.localeCompare(b.dir);
  });
  return distances[0]?.dir || '';
}

module.exports = {
  markerToGrid,
  markerToGrid9,
  markerToNearestEdgeDirection,
};

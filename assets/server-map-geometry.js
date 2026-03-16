(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.ServerMapGeometry = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const GRID_SIZE = 1024 / 7;
  const REFERENCE_CROP_MARGIN = 500;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clamp01(value) {
    return clamp(Number(value) || 0, 0, 1);
  }

  function toFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function toColumnLabel(idx) {
    let n = Math.max(0, Math.floor(Number(idx) || 0));
    let out = '';
    do {
      out = String.fromCharCode(65 + (n % 26)) + out;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
  }

  function getGridMeta(worldSize) {
    const size = toFiniteNumber(worldSize, 0);
    if (size <= 0) return null;
    const cols = Math.max(1, Math.floor(size / GRID_SIZE));
    return {
      cols,
      rows: cols,
      cellSize: size / cols,
    };
  }

  function toMapAxis(value, mapSize) {
    const v = toFiniteNumber(value, NaN);
    const size = toFiniteNumber(mapSize, 0);
    if (!Number.isFinite(v) || size <= 0) return null;
    if (v >= 0 && v <= size) return v;
    const half = size / 2;
    if (v >= -half && v <= half) return v + half;
    if (v >= -size && v < 0) return v + size;
    if (v > size && v <= size * 2) return v - size;
    return null;
  }

  function distanceToRange(value, min, max) {
    if (value < min) return min - value;
    if (value > max) return value - max;
    return 0;
  }

  function toNearestMapAxis(value, mapSize) {
    const size = toFiniteNumber(mapSize, 0);
    const direct = toMapAxis(value, size);
    if (direct != null) return direct;
    const v = toFiniteNumber(value, NaN);
    if (!Number.isFinite(v) || size <= 0) return null;
    const half = size / 2;
    const candidates = [
      { value: clamp(v, 0, size), delta: distanceToRange(v, 0, size) },
      { value: clamp(v + half, 0, size), delta: distanceToRange(v, -half, half) },
      { value: clamp(v + size, 0, size), delta: distanceToRange(v, -size, 0) },
      { value: clamp(v - size, 0, size), delta: distanceToRange(v, size, size * 2) },
    ];
    candidates.sort((a, b) => a.delta - b.delta);
    return candidates[0].value;
  }

  function inferCropMargin(width, height, worldSize, rawMargin) {
    const w = Math.max(0, Math.round(toFiniteNumber(width, 0)));
    const h = Math.max(0, Math.round(toFiniteNumber(height, 0)));
    const size = Math.max(0, Math.round(toFiniteNumber(worldSize, 0)));
    const maxAllowed = Math.max(0, Math.floor((Math.min(w, h) - 1) / 2));
    const payloadMargin = clamp(Math.round(toFiniteNumber(rawMargin, 0)), 0, maxAllowed);
    if (payloadMargin > 0 && payloadMargin * 2 < w && payloadMargin * 2 < h) {
      return payloadMargin;
    }
    if (size > 0) {
      const inferredX = w > size ? Math.round((w - size) / 2) : 0;
      const inferredY = h > size ? Math.round((h - size) / 2) : 0;
      const inferred = [inferredX, inferredY].filter((value) => value > 0);
      if (inferred.length) return clamp(Math.min.apply(null, inferred), 0, maxAllowed);
    }
    const looksLikeReferenceExport = (
      size > 0
      && Math.abs((w - (REFERENCE_CROP_MARGIN * 2)) - size) <= 8
      && Math.abs((h - (REFERENCE_CROP_MARGIN * 2)) - size) <= 8
    );
    if (looksLikeReferenceExport) return clamp(REFERENCE_CROP_MARGIN, 0, maxAllowed);
    return 0;
  }

  function resolveMapContext(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input)
      ? input
      : { worldSize: input };
    const width = Math.max(0, Math.round(toFiniteNumber(
      source.width || source.imageWidth || source.rawWidth,
      0,
    )));
    const height = Math.max(0, Math.round(toFiniteNumber(
      source.height || source.imageHeight || source.rawHeight,
      0,
    )));
    const worldSize = Math.max(0, Math.round(toFiniteNumber(
      source.worldSize || source.mapSize || source.coordinateSize || source.size,
      0,
    )));
    const cropMargin = inferCropMargin(
      width,
      height,
      worldSize,
      source.cropMargin ?? source.margin ?? source.oceanMargin,
    );
    const cropWidth = cropMargin > 0 && width > cropMargin * 2 ? width - (cropMargin * 2) : width;
    const cropHeight = cropMargin > 0 && height > cropMargin * 2 ? height - (cropMargin * 2) : height;
    const normalizedWorldSize = worldSize > 0 ? worldSize : Math.min(cropWidth, cropHeight);

    return {
      width,
      height,
      worldSize: normalizedWorldSize,
      coordinateSize: normalizedWorldSize,
      cropMargin,
      cropWidth: cropWidth || normalizedWorldSize,
      cropHeight: cropHeight || normalizedWorldSize,
      cropMode: cropMargin > 0 ? 'reference_margin' : 'none',
    };
  }

  function getImageLayout(containerWidth, containerHeight, mapContext) {
    const context = resolveMapContext(mapContext);
    const cw = toFiniteNumber(containerWidth, 0);
    const ch = toFiniteNumber(containerHeight, 0);
    if (cw <= 0 || ch <= 0 || context.cropWidth <= 0 || context.cropHeight <= 0) return null;
    const scale = Math.min(cw / context.cropWidth, ch / context.cropHeight);
    const renderedWidth = context.cropWidth * scale;
    const renderedHeight = context.cropHeight * scale;
    const renderedLeft = (cw - renderedWidth) / 2;
    const renderedTop = (ch - renderedHeight) / 2;
    const imageWidth = context.width > 0 ? context.width * scale : renderedWidth;
    const imageHeight = context.height > 0 ? context.height * scale : renderedHeight;
    const imageLeft = renderedLeft - (context.cropMargin * scale);
    const imageTop = renderedTop - (context.cropMargin * scale);
    return {
      renderedRect: {
        left: renderedLeft,
        top: renderedTop,
        width: renderedWidth,
        height: renderedHeight,
        containerWidth: cw,
        containerHeight: ch,
      },
      imageRect: {
        left: imageLeft,
        top: imageTop,
        width: imageWidth,
        height: imageHeight,
      },
      scale,
    };
  }

  function markerToGridLabel(marker, worldSize, mapContext) {
    const context = mapContext && typeof mapContext === 'object'
      ? resolveMapContext(mapContext)
      : resolveMapContext({ worldSize });
    const size = toFiniteNumber(context.worldSize || worldSize, 0);
    const meta = getGridMeta(size);
    if (!meta) return '';
    const x = toNearestMapAxis(marker && marker.x, size);
    const y = toNearestMapAxis(marker && marker.y, size);
    if (x == null || y == null) return '';
    const colIndex = clamp(Math.floor(x / meta.cellSize), 0, meta.cols - 1);
    const rowIndex = clamp(Math.floor((size - y) / meta.cellSize), 0, meta.rows - 1);
    return toColumnLabel(colIndex) + String(rowIndex);
  }

  function worldToNormalized(x, y, mapContext) {
    const context = resolveMapContext(mapContext);
    const size = toFiniteNumber(context.worldSize, 0);
    if (size <= 0) return null;
    const mapX = toNearestMapAxis(x, size);
    const mapY = toNearestMapAxis(y, size);
    if (mapX == null || mapY == null) return null;
    return {
      x: clamp01(mapX / size),
      y: clamp01(1 - (mapY / size)),
      clamped: false,
    };
  }

  function monumentToNormalized(x, y, mapContext) {
    const context = resolveMapContext(mapContext);
    const size = toFiniteNumber(context.worldSize, 0);
    const rawX = toFiniteNumber(x, NaN);
    const rawY = toFiniteNumber(y, NaN);
    if (size <= 0 || !Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
    const projectedX = clamp(rawX, 0, size);
    const projectedY = clamp(rawY, 0, size);
    return {
      x: projectedX / size,
      y: 1 - (projectedY / size),
      outside: rawX < 0 || rawX > size || rawY < 0 || rawY > size,
      clamped: false,
    };
  }

  function normalizedToWorld(normalizedX, normalizedY, mapContext) {
    const context = resolveMapContext(mapContext);
    const size = toFiniteNumber(context.worldSize, 0);
    if (size <= 0) return null;
    const nx = clamp01(normalizedX);
    const ny = clamp01(normalizedY);
    return {
      x: clamp(nx * size, 0, size),
      y: clamp((1 - ny) * size, 0, size),
    };
  }

  return {
    GRID_SIZE,
    REFERENCE_CROP_MARGIN,
    clamp,
    clamp01,
    toColumnLabel,
    toMapAxis,
    toNearestMapAxis,
    getGridMeta,
    inferCropMargin,
    resolveMapContext,
    getImageLayout,
    markerToGridLabel,
    worldToNormalized,
    monumentToNormalized,
    normalizedToWorld,
  };
}));

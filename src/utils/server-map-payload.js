const REFERENCE_CROP_MARGIN = 500;

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveWorldSize(mapData = {}, options = {}) {
  const candidates = [
    options.worldSize,
    options.mapSize,
    options.serverInfo?.mapSize,
    options.serverInfo?.worldSize,
    options.serverInfo?.size,
    mapData.worldSize,
    mapData.mapSize,
    mapData.size,
  ];
  for (const candidate of candidates) {
    const num = toFiniteNumber(candidate, 0);
    if (num > 0) return num;
  }
  return 0;
}

function inferCropMargin(width, height, worldSize, rawMargin = 0) {
  const maxAllowed = Math.max(0, Math.floor((Math.min(width, height) - 1) / 2));
  const payloadMargin = clamp(Math.round(toFiniteNumber(rawMargin, 0)), 0, maxAllowed);
  if (payloadMargin > 0 && payloadMargin * 2 < width && payloadMargin * 2 < height) {
    return payloadMargin;
  }

  if (worldSize > 0) {
    const inferredX = width > worldSize ? Math.round((width - worldSize) / 2) : 0;
    const inferredY = height > worldSize ? Math.round((height - worldSize) / 2) : 0;
    const inferred = [inferredX, inferredY].filter((value) => value > 0);
    if (inferred.length) {
      return clamp(Math.min(...inferred), 0, maxAllowed);
    }
  }

  const looksLikeReferenceExport = (
    worldSize > 0
    && Math.abs((width - (REFERENCE_CROP_MARGIN * 2)) - worldSize) <= 8
    && Math.abs((height - (REFERENCE_CROP_MARGIN * 2)) - worldSize) <= 8
  );
  if (looksLikeReferenceExport) {
    return clamp(REFERENCE_CROP_MARGIN, 0, maxAllowed);
  }

  return 0;
}

function normalizeServerMapPayload(rawMap = {}, options = {}) {
  const mapData = rawMap?.map || rawMap || {};
  const width = Math.max(0, Math.round(toFiniteNumber(mapData.width, 0)));
  const height = Math.max(0, Math.round(toFiniteNumber(mapData.height, 0)));
  const worldSize = Math.max(0, Math.round(resolveWorldSize(mapData, options)));
  const cropMargin = inferCropMargin(
    width,
    height,
    worldSize,
    mapData.cropMargin ?? mapData.margin ?? mapData.oceanMargin,
  );
  const cropWidth = cropMargin > 0 && width > cropMargin * 2 ? width - (cropMargin * 2) : width;
  const cropHeight = cropMargin > 0 && height > cropMargin * 2 ? height - (cropMargin * 2) : height;
  const normalizedWorldSize = worldSize > 0 ? worldSize : Math.min(cropWidth, cropHeight);
  const result = {
    ...mapData,
    width,
    height,
    worldSize: normalizedWorldSize,
    mapSize: normalizedWorldSize,
    cropMargin,
    cropWidth,
    cropHeight,
    cropMode: cropMargin > 0 ? 'reference_margin' : 'none',
  };

  if (mapData.jpgImage) {
    result.imageBase64 = Buffer.from(mapData.jpgImage).toString('base64');
    delete result.jpgImage;
  }

  if (!Array.isArray(result.monuments)) {
    result.monuments = [];
  }

  return result;
}

module.exports = {
  REFERENCE_CROP_MARGIN,
  inferCropMargin,
  normalizeServerMapPayload,
};

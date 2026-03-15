const test = require('node:test');
const assert = require('node:assert/strict');

const geometry = require('../assets/server-map-geometry.js');

test('server map context infers reference crop margin from raw image size', () => {
  const ctx = geometry.resolveMapContext({
    worldSize: 3499,
    width: 4499,
    height: 4499,
  });

  assert.equal(ctx.worldSize, 3499);
  assert.equal(ctx.cropMargin, 500);
  assert.equal(ctx.cropWidth, 3499);
  assert.equal(ctx.cropHeight, 3499);
  assert.equal(ctx.cropMode, 'reference_margin');
});

test('server map layout crops raw image but keeps rendered rect aligned to world size', () => {
  const ctx = geometry.resolveMapContext({
    worldSize: 3500,
    width: 4500,
    height: 4500,
  });
  const layout = geometry.getImageLayout(1000, 800, ctx);

  assert.ok(layout);
  assert.equal(Math.round(layout.renderedRect.width), 800);
  assert.equal(Math.round(layout.renderedRect.height), 800);
  assert.equal(Math.round(layout.renderedRect.left), 100);
  assert.equal(Math.round(layout.imageRect.left), -14);
});

test('server map normalization uses direct world coordinates after crop', () => {
  const ctx = geometry.resolveMapContext({ worldSize: 4096, width: 5096, height: 5096 });
  const point = geometry.worldToNormalized(1840.1484375, 1599.7177734375, ctx);

  assert.ok(point);
  assert.ok(Math.abs(point.x - (1840.1484375 / 4096)) < 1e-9);
  assert.ok(Math.abs(point.y - (1 - (1599.7177734375 / 4096))) < 1e-9);
});

test('server map grid label follows rustplus.py floor conversion', () => {
  const ctx = geometry.resolveMapContext({ worldSize: 4096 });
  const grid = geometry.markerToGridLabel({ x: 1835, y: 1603 }, 4096, ctx);

  assert.equal(grid, 'M17');
});

test('server map normalization is reversible', () => {
  const ctx = geometry.resolveMapContext({ worldSize: 3700, width: 4700, height: 4700 });
  const normalized = geometry.worldToNormalized(2650, 925, ctx);
  const world = geometry.normalizedToWorld(normalized.x, normalized.y, ctx);

  assert.ok(world);
  assert.ok(Math.abs(world.x - 2650) < 1e-9);
  assert.ok(Math.abs(world.y - 925) < 1e-9);
});

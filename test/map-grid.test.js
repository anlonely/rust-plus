const test = require('node:test');
const assert = require('node:assert/strict');

const { markerToGrid9 } = require('../src/utils/map-grid');

test('markerToGrid9: wrapped negative x should map to same grid as positive x+mapSize', () => {
  const mapSize = 4250;
  const direct = markerToGrid9({ x: 450, y: 2100 }, mapSize);
  const wrapped = markerToGrid9({ x: -3800, y: 2100 }, mapSize);
  assert.equal(wrapped, direct);
});

test('markerToGrid9: wrapped positive x should map to same grid as x-mapSize', () => {
  const mapSize = 4250;
  const direct = markerToGrid9({ x: 250, y: 2200 }, mapSize);
  const wrapped = markerToGrid9({ x: 4500, y: 2200 }, mapSize);
  assert.equal(wrapped, direct);
});

test('markerToGrid9: world coords (-size/2~size/2) stay compatible', () => {
  const mapSize = 4250;
  const world = markerToGrid9({ x: -100, y: -220 }, mapSize);
  const map = markerToGrid9({ x: 2025, y: 1905 }, mapSize);
  assert.equal(world, map);
});

test('markerToGrid9: dynamic grid calibration keeps S5 boundary point stable', () => {
  const mapSize = 4200;
  const grid = markerToGrid9({ x: 2820, y: 3380 }, mapSize);
  assert.equal(String(grid).split('-')[0], 'S5');
});

test('markerToGrid9: regression - near R2 top-right should map to R2-3', () => {
  const mapSize = 4200;
  const grid = markerToGrid9({ x: 2705, y: 3905 }, mapSize);
  assert.equal(grid, 'S1-7');
});

test('markerToGrid9: regression - near V18 bottom-right should map to V18-9', () => {
  const mapSize = 4200;
  const grid = markerToGrid9({ x: 3305, y: 1450 }, mapSize);
  assert.equal(grid, 'W18-1');
});

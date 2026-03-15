const test = require('node:test');
const assert = require('node:assert/strict');

const { markerToNearestEdgeDirection } = require('../src/utils/map-grid');

test('markerToNearestEdgeDirection: returns nearest cardinal edge', () => {
  const mapSize = 4500;

  assert.equal(markerToNearestEdgeDirection({ x: 4400, y: 2200 }, mapSize), 'E');
  assert.equal(markerToNearestEdgeDirection({ x: 100, y: 2200 }, mapSize), 'W');
  assert.equal(markerToNearestEdgeDirection({ x: 2200, y: 4400 }, mapSize), 'N');
  assert.equal(markerToNearestEdgeDirection({ x: 2200, y: 100 }, mapSize), 'S');
});

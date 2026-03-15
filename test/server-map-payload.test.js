const test = require('node:test');
const assert = require('node:assert/strict');

const { inferCropMargin, normalizeServerMapPayload } = require('../src/utils/server-map-payload');

test('server map payload infers 500px crop margin from rustplus raw image', () => {
  assert.equal(inferCropMargin(4499, 4499, 3499, 0), 500);
});

test('server map payload prefers explicit payload margin when valid', () => {
  assert.equal(inferCropMargin(4500, 4500, 3500, 500), 500);
});

test('server map payload normalizes map response with world size and crop metadata', () => {
  const payload = normalizeServerMapPayload({
    width: 4500,
    height: 4500,
    monuments: [{ token: 'airfield_1', x: 100, y: 200 }],
    jpgImage: Buffer.from('abc'),
  }, {
    serverInfo: { mapSize: 3500 },
  });

  assert.equal(payload.width, 4500);
  assert.equal(payload.height, 4500);
  assert.equal(payload.worldSize, 3500);
  assert.equal(payload.mapSize, 3500);
  assert.equal(payload.cropMargin, 500);
  assert.equal(payload.cropWidth, 3500);
  assert.equal(payload.cropHeight, 3500);
  assert.equal(payload.imageBase64, Buffer.from('abc').toString('base64'));
  assert.deepEqual(payload.monuments, [{ token: 'airfield_1', x: 100, y: 200 }]);
});

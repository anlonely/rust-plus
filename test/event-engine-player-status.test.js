const test = require('node:test');
const assert = require('node:assert/strict');

const EventEngine = require('../src/events/engine');

test('event-engine: _emitPlayerStatus only emits integrated player_status event', () => {
  const engine = new EventEngine();
  const fired = [];
  engine._fire = (event, context) => {
    fired.push({ event, context });
  };

  engine._emitPlayerStatus('online', { member: { name: 'Rooney' } });

  assert.equal(fired.length, 1);
  assert.equal(fired[0].event, 'player_status');
  assert.equal(fired[0].context.playerStatus, 'online');
  assert.equal(fired[0].context.playerStatusEvent, 'player_online');
});


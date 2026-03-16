const test = require('node:test');
const assert = require('node:assert/strict');

const EventEngine = require('../src/events/engine');

test('event-engine: _emitPlayerStatus fires both integrated player_status and individual event', () => {
  const engine = new EventEngine();
  const fired = [];
  engine._fire = (event, context) => {
    fired.push({ event, context });
  };

  engine._emitPlayerStatus('online', { member: { name: 'Rooney' } });

  assert.equal(fired.length, 2);
  assert.equal(fired[0].event, 'player_status');
  assert.equal(fired[0].context.playerStatus, 'online');
  assert.equal(fired[0].context.playerStatusEvent, 'player_online');
  assert.equal(fired[1].event, 'player_online');
  assert.equal(fired[1].context.playerStatus, 'online');
  assert.equal(fired[1].context.playerStatusEvent, 'player_online');
});

test('event-engine: _emitPlayerStatus fires player_afk_recover', () => {
  const engine = new EventEngine();
  const fired = [];
  engine._fire = (event, context) => {
    fired.push({ event, context });
  };

  engine._emitPlayerStatus('afk_recover', { member: { name: 'TestPlayer' }, idleMs: 900000 });

  assert.equal(fired.length, 2);
  assert.equal(fired[0].event, 'player_status');
  assert.equal(fired[0].context.playerStatus, 'afk_recover');
  assert.equal(fired[0].context.playerStatusEvent, 'player_afk_recover');
  assert.equal(fired[1].event, 'player_afk_recover');
  assert.equal(fired[1].context.playerStatus, 'afk_recover');
});

test('event-engine: getAfkThresholdMs returns custom value from rule', () => {
  const engine = new EventEngine();
  engine.rules = [
    { event: 'player_afk', enabled: true, trigger: { afkMinutes: 10 } },
  ];
  assert.equal(engine.getAfkThresholdMs(), 10 * 60 * 1000);
});

test('event-engine: getAfkThresholdMs falls back to default when no rule', () => {
  const engine = new EventEngine();
  engine.rules = [];
  assert.equal(engine.getAfkThresholdMs(), 15 * 60 * 1000);
});

test('event-engine: getAfkThresholdMs ignores disabled rules', () => {
  const engine = new EventEngine();
  engine.rules = [
    { event: 'player_afk', enabled: false, trigger: { afkMinutes: 5 } },
  ];
  assert.equal(engine.getAfkThresholdMs(), 15 * 60 * 1000);
});

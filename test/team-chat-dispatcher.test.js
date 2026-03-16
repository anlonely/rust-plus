const test = require('node:test');
const assert = require('node:assert/strict');

const { createTeamChatDispatcher } = require('../src/utils/team-chat-dispatcher');

test('team-chat-dispatcher: serializes sends with global interval', async () => {
  const sent = [];
  const dispatcher = createTeamChatDispatcher({
    getIntervalMs: () => 25,
    normalizeMessage: (value) => String(value || '').trim(),
    sendMessage: async (message) => {
      sent.push({ message, at: Date.now() });
    },
  });

  await Promise.all([
    dispatcher('第一条'),
    dispatcher('第二条'),
    dispatcher('第三条'),
  ]);

  assert.equal(sent.length, 3);
  assert.equal(sent[0].message, '第一条');
  assert.equal(sent[1].message, '第二条');
  assert.equal(sent[2].message, '第三条');
  assert.ok(sent[1].at - sent[0].at >= 20, `expected spacing >=20ms, got ${sent[1].at - sent[0].at}`);
  assert.ok(sent[2].at - sent[1].at >= 20, `expected spacing >=20ms, got ${sent[2].at - sent[1].at}`);
});

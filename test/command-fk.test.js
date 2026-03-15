const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const CommandParser = require('../src/commands/parser');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.sent = [];
  }

  async sendTeamMessage(message) {
    this.sent.push(String(message || ''));
  }
}

test('fk: when no paired smart switch exists, returns pairing hint', async () => {
  const client = new FakeClient();
  const parser = new CommandParser();
  parser.bind(client);

  await parser._onTeamMessage({
    steamId: '76561198000000000',
    message: { message: 'fk' },
  });

  assert.deepEqual(client.sent, ['暂无配对智能开关,请确认配对状态。']);
});

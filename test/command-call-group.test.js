const test = require('node:test');
const assert = require('node:assert/strict');

const CommandParser = require('../src/commands/parser');

test('command-parser: supports call_group type in setCommandRule', () => {
  const parser = new CommandParser();
  const ok = parser.setCommandRule({
    keyword: 'hj1',
    type: 'call_group',
    name: '告警联动',
    permission: 'all',
    enabled: true,
    meta: {
      groupId: 'group_1',
      channels: ['phone', 'kook'],
      message: '测试告警',
    },
  });

  assert.equal(ok, true);
  const cmd = parser.getCommands().find((item) => item.keyword === 'hj1');
  assert.ok(cmd);
  assert.equal(cmd.type, 'call_group');
  assert.equal(cmd.enabled, true);
  assert.equal(cmd.meta.groupId, 'group_1');
});

test('command-parser: call_group rule invokes bound runner with channels', async () => {
  const calls = [];
  const parser = new CommandParser({
    callGroupRunner: async (groupId, message, options) => {
      calls.push({ groupId, message, options });
      return { success: true };
    },
  });

  const ok = parser.setCommandRule({
    keyword: 'hj2',
    type: 'call_group',
    name: '呼叫组测试',
    permission: 'all',
    enabled: true,
    meta: {
      groupId: 'group_2',
      channels: ['kook', 'discord'],
      message: '默认告警',
    },
  });
  assert.equal(ok, true);

  const cmd = parser._commands.hj2;
  assert.ok(cmd);
  const ret = await cmd.handler(['覆盖消息'], {
    command: cmd,
    keyword: 'hj2',
    parser,
  });

  assert.equal(ret, '呼叫组[group_2]已触发');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].groupId, 'group_2');
  assert.equal(calls[0].message, '覆盖消息');
  assert.deepEqual(calls[0].options, { channels: ['kook', 'discord'] });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createIpcInvoker } = require('../web/ipc-invoke');

test('web-ipc-invoke: dispatches known channels with original args', async () => {
  const calls = [];
  const invoke = createIpcInvoker({
    'app:init': async (args) => {
      calls.push(['app:init', args]);
      return { ok: true };
    },
    'server:connect': async (args) => {
      calls.push(['server:connect', args]);
      return { success: true };
    },
  });

  const init = await invoke({ channel: 'app:init', args: [] });
  const conn = await invoke({ channel: 'server:connect', args: [{ id: 's1' }] });

  assert.deepEqual(init, { ok: true });
  assert.deepEqual(conn, { success: true });
  assert.deepEqual(calls, [
    ['app:init', []],
    ['server:connect', [{ id: 's1' }]],
  ]);
});

test('web-ipc-invoke: rejects unknown channels', async () => {
  const invoke = createIpcInvoker({});
  await assert.rejects(
    () => invoke({ channel: 'unknown:channel', args: [] }),
    /未知 IPC 通道/,
  );
});

test('web-ipc-invoke: rejects empty channel', async () => {
  const invoke = createIpcInvoker({});
  await assert.rejects(
    () => invoke({ channel: '   ', args: [] }),
    /channel 不能为空/,
  );
});


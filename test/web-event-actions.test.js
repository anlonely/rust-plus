const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderMessageTemplate,
  buildActionsFromMeta,
  hydrateRule,
} = require('../web/event-actions');

test('web-event-actions: renderMessageTemplate replaces known vars', () => {
  const text = renderMessageTemplate('队友:{member} 坐标:{marker_grid}', {
    member: { name: 'Rooney' },
    marker: { x: 0, y: 0 },
  }, {
    mapSize: 3000,
  });
  assert.match(text, /队友:Rooney/);
  assert.match(text, /坐标:[A-Z]+\d+/);
});

test('web-event-actions: renderMessageTemplate resolves cargo and ch47 status messages', () => {
  const cargoText = renderMessageTemplate('{cargo_status_message}', {
    cargoStage: 'active',
    grid: 'R3',
  }, {
    mapSize: 3000,
  });
  const ch47Text = renderMessageTemplate('{ch47_status_message}', {
    ch47Stage: 'enter',
    marker: { x: 0, y: 0 },
  }, {
    mapSize: 3000,
  });

  assert.equal(cargoText, '货船航行中｜当前位置:R3');
  assert.match(ch47Text, /^军用运输直升机进入地图｜当前位置:[A-Z]+\d+$/);
});

test('web-event-actions: renderMessageTemplate resolves oil status direction', () => {
  const text = renderMessageTemplate('{oil_status_message}', {
    oilStage: 'large_heavy',
    rig: { x: 4400, y: 2200 },
    grid: 'X1',
  }, {
    mapSize: 4500,
  });

  assert.equal(text, '大石油重装已呼叫｜方向：E');
});

test('web-event-actions: buildActionsFromMeta generates team_chat action from fallback flags', async () => {
  const sent = [];
  const actions = buildActionsFromMeta({
    doChat: true,
    message: 'hello {member}',
  }, 'player_online', {
    mapSize: 3000,
    sendTeamMessage: async (msg) => sent.push(msg),
  });

  assert.equal(actions.length, 1);
  await actions[0]({ member: { name: 'W' } });
  assert.deepEqual(sent, ['hello W']);
});

test('web-event-actions: fallback defaults to team_chat and no desktop notify', async () => {
  const sent = [];
  let notified = 0;
  const actions = buildActionsFromMeta({
    message: '默认消息',
  }, 'alarm_on', {
    mapSize: 3000,
    sendTeamMessage: async (msg) => sent.push(msg),
    notifyDesktop: () => { notified += 1; },
    sendWsNotification: () => { notified += 1; },
  });

  assert.equal(actions.length, 1);
  await actions[0]({});
  assert.deepEqual(sent, ['默认消息']);
  assert.equal(notified, 0);
});

test('web-event-actions: hydrateRule attaches executable actions', () => {
  const rule = hydrateRule({
    id: 'r1',
    event: 'alarm_on',
    _meta: { doNotify: true, message: 'm' },
  }, {
    mapSize: 3000,
    notifyDesktop: () => {},
    sendWsNotification: () => {},
  });
  assert.equal(rule.id, 'r1');
  assert.ok(Array.isArray(rule.actions));
  assert.equal(typeof rule.actions[0], 'function');
});

test('web-event-actions: call_group action forwards channels', async () => {
  const calls = [];
  const actions = buildActionsFromMeta({
    actions: [{
      type: 'call_group',
      groupId: 'group_event_1',
      channels: ['phone', 'kook'],
      message: '事件告警',
    }],
  }, 'alarm_on', {
    mapSize: 3000,
    callGroup: async (groupId, message, options) => {
      calls.push({ groupId, message, options });
      return { success: true };
    },
  });

  assert.equal(actions.length, 1);
  await actions[0]({});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].groupId, 'group_event_1');
  assert.equal(calls[0].message, '事件告警');
  assert.deepEqual(calls[0].options, { channels: ['phone', 'kook'] });
});

test('web-event-actions: cargo/ch47 team_chat actions use stage templates', async () => {
  const sent = [];
  const cargoActions = buildActionsFromMeta({
    actions: [{ type: 'team_chat' }],
    message: '{cargo_status_message}',
  }, 'cargo_ship_status', {
    mapSize: 3000,
    sendTeamMessage: async (msg) => sent.push(msg),
  });
  const ch47Actions = buildActionsFromMeta({
    actions: [{ type: 'team_chat' }],
    message: '{ch47_status_message}',
  }, 'ch47_status', {
    mapSize: 3000,
    sendTeamMessage: async (msg) => sent.push(msg),
  });

  await cargoActions[0]({ cargoStage: 'active', grid: 'R3' });
  await ch47Actions[0]({ ch47Stage: 'leave', marker: { x: 0, y: 0 } });

  assert.equal(sent[0], '货船航行中｜当前位置:R3');
  assert.match(sent[1], /^军用运输直升机已离开地图｜最后位置:[A-Z]+\d+$/);
});

test('web-event-actions: oil team_chat action upgrades legacy oil_grid templates to direction text', async () => {
  const sent = [];
  const oilActions = buildActionsFromMeta({
    actions: [{ type: 'team_chat' }],
    message: '{oil_status_message}',
    oilMessages: {
      large_heavy: '大石油重装已呼叫｜位置:{oil_grid}',
    },
  }, 'oil_rig_status', {
    mapSize: 4500,
    sendTeamMessage: async (msg) => sent.push(msg),
  });

  await oilActions[0]({ oilStage: 'large_heavy', rig: { x: 4400, y: 2200 }, grid: 'X1' });

  assert.deepEqual(sent, ['大石油重装已呼叫｜方向：E']);
});

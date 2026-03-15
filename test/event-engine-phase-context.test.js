const test = require('node:test');
const assert = require('node:assert/strict');

const EventEngine = require('../src/events/engine');
const { buildServerInfoSnapshot } = require('../src/utils/server-info');

function findFiveMinuteWindowPayload() {
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 1) {
      const hh = String(hour).padStart(2, '0');
      const mm = String(minute).padStart(2, '0');
      const payload = {
        time: `${hh}:${mm}`,
        dayLengthMinutes: 60,
        timeScale: 1,
      };
      const snap = buildServerInfoSnapshot(null, payload);
      const remain = Number(snap.realRemainSeconds);
      if (Number.isFinite(remain) && remain <= 300 && remain > 60) {
        return { payload, snap };
      }
    }
  }
  throw new Error('无法找到 5 分钟提醒窗口测试样本');
}

test('event-engine: hourly_tick should carry realtime phase context', () => {
  const payload = { time: '16:10', dayLengthMinutes: 60, timeScale: 1 };
  const snapshot = buildServerInfoSnapshot(null, payload);
  const engine = new EventEngine();
  const fired = [];
  engine._fire = (event, context) => fired.push({ event, context });
  engine._lastHourlyGameHour = 15;

  engine._checkHourlyTick(payload);

  assert.equal(fired.length, 1);
  assert.equal(fired[0].event, 'hourly_tick');
  assert.equal(fired[0].context.hourly_time, '16:00');
  assert.equal(fired[0].context.day_phase, snapshot.phase);
  assert.equal(fired[0].context.phase_target, snapshot.phaseTarget);
  assert.equal(fired[0].context.phase_target_short, snapshot.phaseTargetShort);
  assert.equal(fired[0].context.time_to_phase_real, snapshot.realRemainText || snapshot.remainText);
});

test('event-engine: day_phase_notice should carry realtime phase context', () => {
  const { payload, snap } = findFiveMinuteWindowPayload();
  const engine = new EventEngine();
  const fired = [];
  engine._fire = (event, context) => fired.push({ event, context });

  engine._checkDayPhaseNotice(payload);

  assert.equal(fired.length, 1);
  assert.equal(fired[0].event, 'day_phase_notice');
  assert.equal(fired[0].context.hourly_time, snap.hhmm);
  assert.equal(fired[0].context.day_phase, snap.phase);
  assert.equal(fired[0].context.phase_target, snap.phaseTarget);
  assert.equal(fired[0].context.phase_target_short, snap.phaseTargetShort);
  assert.equal(fired[0].context.phase_reminder_minute, 5);
  assert.equal(fired[0].context.time_to_phase_real, snap.realRemainText || snap.remainText);
});

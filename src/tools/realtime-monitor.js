#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { markerToGrid9 } = require('../utils/map-grid');
const { getDefaultServer } = require('../storage/config');
const RustClient = require('../connection/client');
const EventEngine = require('../events/engine');
const CommandParser = require('../commands/parser');

const ACTIVE_INTERVAL_MS = Number(process.env.REAL_MONITOR_ACTIVE_INTERVAL_MS || 60_000);
const COMMAND_GAP_MS = Number(process.env.REAL_MONITOR_COMMAND_GAP_MS || 8_000);
const STATUS_INTERVAL_MS = Number(process.env.REAL_MONITOR_STATUS_INTERVAL_MS || 300_000);
const MAX_ACTIVE_ROUNDS = Number(process.env.REAL_MONITOR_MAX_ROUNDS || 720);
const MAX_EVENT_SAMPLES = Number(process.env.REAL_MONITOR_MAX_EVENT_SAMPLES || 500);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const rootDir = path.resolve(__dirname, '../..');
const logsDir = path.join(rootDir, 'logs');
const logFile = path.join(logsDir, `realtime-monitor-${runId}.log`);
const reportFile = path.join(logsDir, `realtime-monitor-${runId}.report.json`);

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const state = {
  runId,
  startedAt: new Date().toISOString(),
  endedAt: null,
  endReason: '',
  activeIntervalMs: ACTIVE_INTERVAL_MS,
  commandGapMs: COMMAND_GAP_MS,
  maxActiveRounds: MAX_ACTIVE_ROUNDS,
  activeRounds: 0,
  latestMapSize: 0,
  currentPlayer: null,
  eventCounts: {},
  eventSamples: [],
  commandStats: {},
  commandRounds: [],
  errors: [],
  files: {
    logFile,
    reportFile,
  },
};

let server = null;
let client = null;
let engine = null;
let parser = null;
let activeTimer = null;
let statusTimer = null;
let stopping = false;
let commandReplyCollector = null;

const commandPlan = [
  ['fwq', 'hc', 'wz'],
  ['sh', 'help', 'fk'],
  ['shj diesel', 'fk', 'dz'],
  ['ai rust status', 'fy hello world', 'hc', 'wz'],
];

function nowIso() {
  return new Date().toISOString();
}

function line(text) {
  const out = `[${nowIso()}] ${text}`;
  fs.appendFileSync(logFile, `${out}\n`);
  process.stdout.write(`${out}\n`);
}

function compact(text, max = 260) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

function updateReport() {
  const report = {
    ...state,
    lastUpdatedAt: nowIso(),
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function incEvent(eventType) {
  state.eventCounts[eventType] = (state.eventCounts[eventType] || 0) + 1;
}

function recordEvent(eventType, context = {}) {
  incEvent(eventType);
  const marker = context.marker || {};
  const member = context.member || {};
  const gridRaw = context.grid || '';
  const baseGrid = String(gridRaw).split('-')[0] || '';
  const mapSize = Number(state.latestMapSize || 0);
  const markerGrid = Number.isFinite(mapSize) && mapSize > 0 ? markerToGrid9(marker, mapSize) : '-';
  const memberGrid = Number.isFinite(mapSize) && mapSize > 0 ? markerToGrid9(member, mapSize) : '-';
  const sample = {
    at: nowIso(),
    eventType,
    grid: baseGrid || '-',
    markerGrid,
    memberGrid,
    markerId: marker?.id != null ? String(marker.id) : '',
    member: member?.name || '',
    playerStatus: context.playerStatus || '',
    speed: context.speed != null ? Number(context.speed) : null,
  };
  if (state.eventSamples.length < MAX_EVENT_SAMPLES) state.eventSamples.push(sample);
  line(`[event] ${eventType} | grid=${sample.grid || '-'} | marker=${sample.markerGrid || '-'} | member=${sample.memberGrid || '-'}`);
}

function recordError(stage, err) {
  const item = {
    at: nowIso(),
    stage,
    message: err?.message || String(err),
  };
  state.errors.push(item);
  line(`[error] ${stage}: ${item.message}`);
}

async function refreshMapSnapshot() {
  if (!client?.connected) return;
  const [infoRes, teamRes, markersRes] = await Promise.all([
    client.getServerInfo().catch(() => null),
    client.getTeamInfo().catch(() => null),
    client.getMapMarkers().catch(() => null),
  ]);

  const mapSize = Number(
    infoRes?.info?.mapSize
    ?? infoRes?.mapSize
    ?? infoRes?.response?.info?.mapSize
    ?? 0,
  );
  if (Number.isFinite(mapSize) && mapSize > 0) state.latestMapSize = mapSize;

  const teamInfo = teamRes?.teamInfo || teamRes || {};
  const members = Array.isArray(teamInfo?.members)
    ? teamInfo.members
    : (teamInfo?.members && typeof teamInfo.members === 'object' ? Object.values(teamInfo.members) : []);
  const pid = String(server?.playerId || '').trim();
  const me = members.find((m) => String(m?.steamId || m?.id || '').trim() === pid) || members[0] || null;
  if (me) {
    const x = Number(me?.x);
    const y = Number(me?.y);
    const grid9 = Number.isFinite(state.latestMapSize) && state.latestMapSize > 0
      ? markerToGrid9({ x, y }, state.latestMapSize)
      : '-';
    state.currentPlayer = {
      name: me?.name || '',
      x: Number.isFinite(x) ? Number(x.toFixed(3)) : null,
      y: Number.isFinite(y) ? Number(y.toFixed(3)) : null,
      grid9,
    };
    line(`[snapshot] me=${state.currentPlayer.name || '-'} x=${state.currentPlayer.x} y=${state.currentPlayer.y} grid=${grid9}`);
  }

  const markers = Array.isArray(markersRes?.mapMarkers?.markers) ? markersRes.mapMarkers.markers : [];
  const typeCount = {};
  for (const m of markers) {
    const k = String(m?.type);
    typeCount[k] = (typeCount[k] || 0) + 1;
  }
  line(`[snapshot] markers=${markers.length} typeCount=${JSON.stringify(typeCount)}`);
}

async function runCommandCase(rawText) {
  if (!parser || !client?.connected) return;
  const keyword = String(rawText || '').trim().split(/\s+/)[0].toLowerCase();
  const sink = [];
  commandReplyCollector = sink;
  const started = Date.now();
  let ok = true;
  let errMsg = '';
  try {
    await parser._onTeamMessage({
      message: rawText,
      steamId: String(server?.playerId || ''),
      name: 'monitor',
      displayName: 'monitor',
      time: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    ok = false;
    errMsg = e?.message || String(e);
    recordError(`command:${rawText}`, e);
  } finally {
    commandReplyCollector = null;
  }

  const output = sink.join(' | ').trim() || '(no-reply)';
  if (ok && /^失败:/.test(output)) ok = false;
  const elapsedMs = Date.now() - started;

  if (!state.commandStats[keyword]) {
    state.commandStats[keyword] = {
      runs: 0,
      ok: 0,
      fail: 0,
      lastAt: null,
      lastOutput: '',
      lastElapsedMs: 0,
    };
  }
  const stat = state.commandStats[keyword];
  stat.runs += 1;
  stat.ok += ok ? 1 : 0;
  stat.fail += ok ? 0 : 1;
  stat.lastAt = nowIso();
  stat.lastOutput = compact(ok ? output : `${errMsg || output}`);
  stat.lastElapsedMs = elapsedMs;

  line(`[command] ${rawText} | ok=${ok} | ${compact(output, 220)}`);
  return { rawText, ok, output: compact(output, 600), elapsedMs };
}

async function runActiveRound() {
  if (stopping) return;
  if (!client?.connected) {
    line('[active] client not connected, skip this round');
    updateReport();
    return;
  }

  state.activeRounds += 1;
  const idx = (state.activeRounds - 1) % commandPlan.length;
  const cases = commandPlan[idx];
  const round = {
    at: nowIso(),
    index: state.activeRounds,
    cases: [],
  };

  line(`[active] round=${state.activeRounds} begin`);
  try {
    await refreshMapSnapshot();
    const teamRes = await client.getTeamInfo().catch(() => null);
    if (teamRes && engine) engine.ingestTeamSnapshot(teamRes?.teamInfo || teamRes || {});
    for (const rawText of cases) {
      const result = await runCommandCase(rawText);
      if (result) round.cases.push(result);
      await sleep(COMMAND_GAP_MS);
    }
  } catch (e) {
    recordError(`active-round:${state.activeRounds}`, e);
  }
  state.commandRounds.push(round);
  if (state.commandRounds.length > 120) state.commandRounds.shift();
  line(`[active] round=${state.activeRounds} end`);
  updateReport();

  if (state.activeRounds >= MAX_ACTIVE_ROUNDS) {
    line(`[guard] reached max rounds(${MAX_ACTIVE_ROUNDS}), generating report and stopping`);
    await stop('max_rounds_guard');
  }
}

async function stop(reason = 'manual') {
  if (stopping) return;
  stopping = true;
  state.endedAt = nowIso();
  state.endReason = reason;
  line(`[stop] reason=${reason}`);

  if (activeTimer) clearInterval(activeTimer);
  if (statusTimer) clearInterval(statusTimer);

  try {
    if (engine) engine.unbind();
  } catch (e) {
    recordError('engine.unbind', e);
  }
  try {
    if (client) client.disconnect();
  } catch (e) {
    recordError('client.disconnect', e);
  }

  updateReport();
  line(`[report] ${reportFile}`);
  process.exit(0);
}

async function main() {
  line('[boot] realtime monitor starting');
  updateReport();

  server = await getDefaultServer();
  if (!server) {
    line('[fatal] no default server pairing found');
    state.endReason = 'no_default_server';
    state.endedAt = nowIso();
    updateReport();
    process.exit(1);
  }

  client = new RustClient(server);
  client.on('connected', () => line('[client] connected'));
  client.on('disconnected', () => line('[client] disconnected'));
  client.on('error', (e) => recordError('client', e));

  await client.connect();

  engine = new EventEngine();
  const originalFire = engine._fire.bind(engine);
  engine._fire = async (eventType, context = {}) => {
    recordEvent(eventType, context);
    return originalFire(eventType, context);
  };
  engine.bind(client);

  parser = new CommandParser({ leaderId: String(server?.playerId || '') });
  parser._client = client;
  parser._reply = async (message) => {
    const lines = String(message || '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (commandReplyCollector) commandReplyCollector.push(...lines);
    line(`[reply] ${compact(lines.join(' | ') || message, 320)}`);
  };

  await refreshMapSnapshot();
  updateReport();
  line(`[boot] log=${logFile}`);
  line(`[boot] report=${reportFile}`);
  line(`[boot] active interval=${ACTIVE_INTERVAL_MS}ms, max rounds=${MAX_ACTIVE_ROUNDS}`);

  await runActiveRound();
  activeTimer = setInterval(() => {
    runActiveRound().catch((e) => recordError('activeTimer', e));
  }, ACTIVE_INTERVAL_MS);

  statusTimer = setInterval(() => {
    line(`[status] rounds=${state.activeRounds} events=${Object.keys(state.eventCounts).length} errors=${state.errors.length}`);
    updateReport();
  }, STATUS_INTERVAL_MS);
}

process.on('SIGINT', () => {
  stop('sigint').catch(() => process.exit(0));
});

process.on('SIGTERM', () => {
  stop('sigterm').catch(() => process.exit(0));
});

main().catch((e) => {
  recordError('main', e);
  state.endReason = 'fatal';
  state.endedAt = nowIso();
  updateReport();
  process.exit(1);
});

// src/index.js
// ─────────────────────────────────────────────
// Rust 工具箱 · 主入口
//
// 用法:
//   node src/index.js         - 默认启动（连接 + 监听）
//   node src/index.js pair    - 配对模式（注册 FCM + 等待游戏内配对）
//   node src/index.js listen  - 仅监听事件（需已配对）
//   node src/index.js status  - 查看已保存的服务器和设备
// ─────────────────────────────────────────────

require('dotenv').config();

const chalk        = require('chalk');
const Table        = require('cli-table3');
const logger       = require('./utils/logger');
const { initDbs, saveServer, listServers, listDevices, getDefaultServer } = require('./storage/config');
const { registerFCM, listenForPairing } = require('./pairing/fcm');
const RustClient   = require('./connection/client');
const EventEngine  = require('./events/engine');
const CommandParser= require('./commands/parser');
const { notify, render } = require('./notify/service');
const { getSteamProfileStatus } = require('./steam/profile');

// ── 版本信息 ─────────────────────────────────
const VERSION = '1.2.0';

function printBanner() {
  console.log(chalk.blueBright(`
╔══════════════════════════════════════╗
║   安静的Rust工具箱  v${VERSION}        ║
║     Rust+ 智能设备管理平台            ║
╚══════════════════════════════════════╝
`));
}

// ════════════════════════════════════════════
// 命令：pair（配对模式）
// ════════════════════════════════════════════
async function cmdPair() {
  console.log(chalk.yellow('\n[P0] 启动配对流程...\n'));

  // 步骤 1：注册 FCM（如未注册）
  console.log(chalk.cyan('步骤 1/3: 注册 FCM 推送通道'));
  await registerFCM();

  // 步骤 2：等待游戏内配对
  console.log(chalk.cyan('\n步骤 2/3: 等待游戏内配对'));
  console.log(chalk.gray('  → 打开 Rust 游戏'));
  console.log(chalk.gray('  → 按 ESC → Rust+ → Pair with Server'));
  console.log(chalk.gray('  → 等待推送通知...\n'));

  await new Promise((resolve) => {
    const stop = listenForPairing(async (data) => {
      const pairingType = String(data?.type || '').toLowerCase();
      const isServerPairing = !!(
        data?.ip
        && data?.port
        && data?.playerId
        && data?.playerToken
        && !data?.entityId
        && pairingType !== 'entity'
      );

      if (!isServerPairing) {
        console.log(chalk.yellow('\n⚠ 收到设备配对推送，已忽略（CLI pair 仅保存服务器配对）'));
        return;
      }

      stop(); // 收到服务器配对后停止监听

      console.log(chalk.green('\n✓ 配对数据已接收！'));
      console.log(chalk.gray(`  服务器: ${data.name || data.ip}`));
      console.log(chalk.gray(`  IP:Port: ${data.ip}:${data.port}`));

      // 步骤 3：保存配对信息
      console.log(chalk.cyan('\n步骤 3/3: 保存配对信息'));
      const saved = await saveServer(data);
      console.log(chalk.green(`✓ 已保存！服务器 ID: ${saved.id}`));
      console.log(chalk.yellow('\n现在可以运行: node src/index.js\n'));
      resolve();
    });
  });
}

// ════════════════════════════════════════════
// 命令：status（查看状态）
// ════════════════════════════════════════════
async function cmdStatus() {
  const servers = await listServers();
  const devices = await listDevices();

  console.log(chalk.blueBright('\n── 已配对服务器 ──'));
  if (servers.length === 0) {
    console.log(chalk.gray('  暂无（运行 node src/index.js pair 进行配对）'));
  } else {
    const t = new Table({
      head: ['ID', '名称', 'IP', 'Port', '配对时间'],
      style: { head: ['cyan'] },
    });
    servers.forEach(s => t.push([
      s.id.slice(-8), s.name, s.ip, s.port,
      new Date(s.addedAt).toLocaleString('zh-CN'),
    ]));
    console.log(t.toString());
  }

  console.log(chalk.blueBright('\n── 已绑定设备 ──'));
  if (devices.length === 0) {
    console.log(chalk.gray('  暂无（在游戏中用 Wire Tool 配对设备）'));
  } else {
    const t = new Table({
      head: ['Entity ID', '别名', '类型', '最后状态', '服务器'],
      style: { head: ['cyan'] },
    });
    devices.forEach(d => t.push([
      d.entityId, d.alias, d.type,
      d.lastState === null ? '-' : String(d.lastState),
      d.serverId?.slice(-8) || '-',
    ]));
    console.log(t.toString());
  }
  console.log('');
}

// ════════════════════════════════════════════
// 命令：steam（Steam 登录状态与资料）
// ════════════════════════════════════════════
async function cmdSteam() {
  const info = await getSteamProfileStatus();

  console.log(chalk.blueBright('\n── Steam 登录状态 ──'));
  if (!info.hasLogin) {
    console.log(chalk.red('  未检测到 rustplus_auth_token，请先运行: node src/index.js pair'));
    return;
  }

  console.log(chalk.gray(`  配置文件: ${info.configFile}`));
  console.log(chalk.gray(`  SteamId: ${info.tokenMeta?.steamId || '-'}`));
  console.log(chalk.gray(`  Token 过期: ${info.tokenMeta?.expiresAt || '-'} (${info.tokenMeta?.isExpired ? '已过期' : '有效'})`));
  console.log(chalk.gray(`  头像 URL: ${info.avatarUrl || '-'}`));

  if (info.steamProfile) {
    const p = info.steamProfile;
    console.log(chalk.blueBright('\n── Steam 资料 ──'));
    console.log(chalk.gray(`  昵称: ${p.steamName || '-'}`));
    console.log(chalk.gray(`  状态: ${p.onlineState || '-'} (${p.stateMessage || '-'})`));
    console.log(chalk.gray(`  可见性: ${p.privacyState || '-'} / ${p.visibilityState || '-'}`));
    console.log(chalk.gray(`  头像: ${p.avatarFull || p.avatarMedium || p.avatarIcon || '-'}`));
  } else {
    console.log(chalk.yellow('\n⚠ 无法获取 Steam 公开资料（网络或隐私设置限制）'));
    console.log(chalk.gray(`  原因: ${info.steamProfileError || '未知'}`));
  }
  console.log('');
}

// ════════════════════════════════════════════
// 命令：listen / start（主监听模式）
// ════════════════════════════════════════════
async function cmdListen() {
  const server = await getDefaultServer();
  if (!server) {
    console.log(chalk.red('\n❌ 未找到配对的服务器，请先运行: node src/index.js pair\n'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n正在连接服务器: ${server.name} (${server.ip}:${server.port})`));

  // 建立连接
  const client = new RustClient(server);
  await client.connect();

  // 初始化事件引擎
  const engine = new EventEngine();
  engine.bind(client);

  // 初始化指令解析器
  const parser = new CommandParser();
  parser.bind(client);

  // ── 示例规则：警报器通电时发送通知 ─────────
  // ⚙️  用户可在此处添加自己的规则，或通过 UI 配置后加载
  engine.addRule({
    id:      'default_alarm_on',
    name:    '警报器触发通知',
    event:   'alarm_on',
    trigger: { cooldownMs: 30_000 },
    enabled: true,
    actions: [
      async ({ entityId }) => {
        notify('both', {
          title:   '⚠️ 基地警报触发！',
          message: `警报器 ${entityId} 已触发，请注意！`,
        });
      }
    ],
  });

  engine.addRule({
    id:      'patrol_heli_notify',
    name:    '武装直升机进入通知',
    event:   'patrol_heli_enter',
    trigger: { cooldownMs: 60_000 },
    enabled: true,
    actions: [
      async () => {
        notify('both', {
          title:   '🚁 武装直升机进入地图！',
          message: 'Patrol Helicopter 已进入地图，注意隐蔽',
        });
      }
    ],
  });

  engine.addRule({
    id:      'cargo_ship_notify',
    name:    '货船进入通知',
    event:   'cargo_ship_enter',
    trigger: { cooldownMs: 60_000 },
    enabled: true,
    actions: [
      async () => {
        notify('both', {
          title:   '🚢 货船进入地图！',
          message: 'Cargo Ship 已出现，准备前往！',
        });
      }
    ],
  });

  engine.addRule({
    id:      'hourly_report',
    name:    '整点报时',
    event:   'hourly_tick',
    trigger: {},
    enabled: true,
    actions: [
      async ({ time }, client) => {
        if (client?.connected) {
          await client.sendTeamMessage(`⏰ 整点报时: ${time}`);
        }
      }
    ],
  });

  console.log(chalk.green('\n✓ 监听已启动！按 Ctrl+C 退出\n'));

  // 优雅退出
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n正在断开连接...'));
    engine.unbind();
    client.disconnect();
    process.exit(0);
  });
}

// ════════════════════════════════════════════
// 入口分发
// ════════════════════════════════════════════
async function main() {
  await initDbs();
  printBanner();

  const cmd = process.argv[2] || 'listen';

  try {
    switch (cmd) {
      case 'pair':   await cmdPair();   break;
      case 'status': await cmdStatus(); break;
      case 'steam':  await cmdSteam();  break;
      case 'listen':
      default:       await cmdListen(); break;
    }
  } catch (err) {
    logger.error('运行错误: ' + err.message);
    console.error(chalk.red('\n❌ 错误: ' + err.message));
    process.exit(1);
  }
}

main();

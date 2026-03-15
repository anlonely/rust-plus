// src/notify/service.js
// ─────────────────────────────────────────────
// 通知服务：桌面通知 + Discord Webhook
// ─────────────────────────────────────────────

const notifier = require('node-notifier');
const https    = require('https');
const logger   = require('../utils/logger');

/**
 * 变量替换：将模板中的 {key} 替换为 vars 中对应的值
 * 示例: render("警报 {name} 触发", { name: "油库" }) → "警报 油库 触发"
 */
function render(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/**
 * 发送桌面通知（Windows / macOS / Linux）
 */
function sendDesktop(title, message) {
  notifier.notify({
    title:   title   || 'Rust 工具箱',
    message: message || '',
    icon:    undefined,
    sound:   true,
    wait:    false,
  });
  logger.info(`[Notify] 桌面通知: ${title} - ${message}`);
}

/**
 * 发送 Discord Webhook Embed 消息
 * @param {string} webhookUrl
 * @param {object} embed  - Discord Embed 对象
 */
function sendDiscord(webhookUrl, embed) {
  if (!webhookUrl) {
    logger.debug('[Notify] Discord Webhook URL 未配置，跳过');
    return;
  }

  const payload = JSON.stringify({ embeds: [embed] });
  const url     = new URL(webhookUrl);

  const req = https.request({
    hostname: url.hostname,
    path:     url.pathname + url.search,
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  }, (res) => {
    if (res.statusCode >= 400) {
      logger.error(`[Notify] Discord 发送失败: HTTP ${res.statusCode}`);
    } else {
      logger.debug(`[Notify] Discord 发送成功`);
    }
  });

  req.on('error', e => logger.error('[Notify] Discord 请求错误: ' + e.message));
  req.write(payload);
  req.end();
}

/**
 * 构建常用 Discord Embed
 */
function buildEmbed({ title, description, color = 0xFF4444, fields = [], footer = 'Rust 工具箱' }) {
  return {
    title,
    description,
    color,
    fields,
    footer: { text: footer },
    timestamp: new Date().toISOString(),
  };
}

/** 
 * 统一通知发送入口
 * @param {'desktop'|'discord'|'both'} channel
 * @param {object} opts
 */
function notify(channel, { title, message, webhookUrl, embed }) {
  if (channel === 'desktop' || channel === 'both') {
    sendDesktop(title, message);
  }
  if (channel === 'discord' || channel === 'both') {
    const discordUrl = webhookUrl || process.env.DISCORD_WEBHOOK_URL;
    const discordEmbed = embed || buildEmbed({ title, description: message });
    sendDiscord(discordUrl, discordEmbed);
  }
}

module.exports = { notify, sendDesktop, sendDiscord, buildEmbed, render };

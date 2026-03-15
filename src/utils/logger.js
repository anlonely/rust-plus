// src/utils/logger.js
// ─────────────────────────────────────────────
// 统一日志输出模块（Winston）
// ─────────────────────────────────────────────

const winston = require('winston');
const path    = require('path');
const { getLogsDir } = require('./runtime-paths');

const logsDir = getLogsDir();

const fmt = winston.format;

// 控制台彩色格式
const consoleFormat = fmt.combine(
  fmt.colorize(),
  fmt.timestamp({ format: 'HH:mm:ss' }),
  fmt.printf(({ timestamp, level, message }) =>
    `[${timestamp}] ${level}: ${message}`)
);

// 文件纯文本格式
const fileFormat = fmt.combine(
  fmt.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  fmt.printf(({ timestamp, level, message }) =>
    `[${timestamp}] [${level.toUpperCase()}] ${message}`)
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,  // 5MB 自动滚动
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
    }),
  ],
});

module.exports = logger;

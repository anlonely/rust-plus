#!/usr/bin/env node

require('dotenv').config();

const { submitVoiceNotice } = require('../call/ihuyi-vm');

async function main() {
  const mobile = String(process.argv[2] || process.env.IHUYI_VM_TEST_MOBILE || '').trim();
  const content = String(
    process.argv.slice(3).join(' ')
    || process.env.IHUYI_VM_TEST_CONTENT
    || 'Rust 工具箱测试语音通知，请忽略本次测试来电。'
  ).trim();

  if (!mobile) {
    console.error('缺少手机号，用法: node src/tools/test-ihuyi-vm.js 186xxxxxxxx [内容]');
    process.exitCode = 2;
    return;
  }

  const result = await submitVoiceNotice({ mobile, content });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});

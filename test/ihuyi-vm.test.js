const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('node:events');
const https = require('https');

const ihuyi = require('../src/call/ihuyi-vm');

test('ihuyi-vm: returns skipped when config is missing', async () => {
  const result = await ihuyi.submitVoiceNotice({
    mobile: '18600000000',
    content: '测试',
    account: '',
    password: '',
  });

  assert.equal(result.skipped, true);
  assert.equal(result.provider, 'ihuyi-vm');
});

test('ihuyi-vm: parses successful JSON response', async () => {
  const original = https.request;
  https.request = (options, handler) => {
    const req = new events.EventEmitter();
    req.setTimeout = () => {};
    req.write = () => {};
    req.end = () => {
      const res = new events.EventEmitter();
      res.statusCode = 200;
      handler(res);
      res.emit('data', Buffer.from(JSON.stringify({ code: 2, msg: '提交成功', smsid: '123' })));
      res.emit('end');
    };
    req.destroy = (err) => req.emit('error', err);
    return req;
  };

  try {
    const result = await ihuyi.submitVoiceNotice({
      account: 'VM123',
      password: 'secret',
      mobile: '18600000000',
      content: '测试',
    });
    assert.equal(result.provider, 'ihuyi-vm');
    assert.equal(result.parsed.code, 2);
    assert.equal(result.parsed.msg, '提交成功');
  } finally {
    https.request = original;
  }
});

test('ihuyi-vm: rejects non-success response', async () => {
  const original = https.request;
  https.request = (options, handler) => {
    const req = new events.EventEmitter();
    req.setTimeout = () => {};
    req.write = () => {};
    req.end = () => {
      const res = new events.EventEmitter();
      res.statusCode = 200;
      handler(res);
      res.emit('data', Buffer.from(JSON.stringify({ code: 405, msg: '内容过长' })));
      res.emit('end');
    };
    req.destroy = (err) => req.emit('error', err);
    return req;
  };

  try {
    await assert.rejects(
      ihuyi.submitVoiceNotice({
        account: 'VM123',
        password: 'secret',
        mobile: '18600000000',
        content: '测试',
      }),
      /互亿无线发送失败 \[405\]: 内容过长|互亿无线发送失败\[405\]: 内容过长/,
    );
  } finally {
    https.request = original;
  }
});

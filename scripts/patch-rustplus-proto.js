#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const protoPath = path.join(projectRoot, 'node_modules', '@liamcottle', 'rustplus.js', 'rustplus.proto');
const canonicalProtoPath = path.join(projectRoot, 'vendor', 'rustplus.proto');
const runtimePath = path.join(projectRoot, 'node_modules', '@liamcottle', 'rustplus.js', 'rustplus.js');

function main() {
  if (!fs.existsSync(protoPath)) {
    console.warn(`[patch-rustplus-proto] skip: ${protoPath} 不存在`);
    return;
  }

  if (!fs.existsSync(canonicalProtoPath)) {
    throw new Error(`缺少 canonical proto: ${canonicalProtoPath}`);
  }

  const expected = fs.readFileSync(canonicalProtoPath, 'utf8');
  const current = fs.readFileSync(protoPath, 'utf8');
  if (current === expected) {
    console.log('[patch-rustplus-proto] rustplus.proto 已是项目内兼容版本，无需修改');
  } else {
    fs.writeFileSync(protoPath, expected, 'utf8');
    console.log('[patch-rustplus-proto] 已覆盖为项目内兼容 rustplus.proto');
  }

  if (fs.existsSync(runtimePath)) {
    const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
    const replacementEmit = [
      "                    if (this.listenerCount('error') > 0) {",
      "                        try {",
      "                            this.emit('error', e);",
      "                        } catch (_) {}",
      "                    } else {",
      "                        console.warn('[rustplus.js] message decode failed:', e && e.message ? e.message : e);",
      "                    }",
      "                    return;",
    ].join('\n');
    let patchedRuntime = runtimeSource;
    const catchMarker = "                    this.emit('error', e);\n                    return;";
    if (patchedRuntime.includes(catchMarker) && !patchedRuntime.includes("[rustplus.js] message decode failed:")) {
      patchedRuntime = patchedRuntime.replace(catchMarker, replacementEmit);
    }
    const directDecodePattern = /(\s*\/\/ decode received message\s*\n)(\s*)var message = this\.AppMessage\.decode\(data\);\s*\n/;
    if (directDecodePattern.test(patchedRuntime) && !patchedRuntime.includes("[rustplus.js] message decode failed:")) {
      patchedRuntime = patchedRuntime.replace(directDecodePattern, (_, comment, indent) => {
        const emitted = replacementEmit.split('\n').map((line) => `${indent}${line.trimStart()}`).join('\n');
        return [
          comment.replace(/\n$/, ''),
          `${indent}var message;`,
          `${indent}try {`,
          `${indent}    message = this.AppMessage.decode(data);`,
          `${indent}} catch (e) {`,
          emitted,
          `${indent}}`,
          '',
        ].join('\n');
      });
    }
    if (patchedRuntime !== runtimeSource) {
      fs.writeFileSync(runtimePath, patchedRuntime, 'utf8');
      console.log('[patch-rustplus-proto] 已修正 rustplus.js 的解码异常处理');
    }
  }
}

main();

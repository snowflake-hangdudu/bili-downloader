import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('packaged Blob worker boots without relative imports and handles merge errors', async () => {
  const messages = [];
  let handler;
  const context = vm.createContext({ Blob, ReadableStream, TextDecoder, TextEncoder,
    setTimeout, clearTimeout, console,
    postMessage: (message) => messages.push(message),
    addEventListener: (_type, listener) => { handler = listener; },
    importScripts: () => { throw new Error('Blob worker must not use relative imports'); }
  });
  context.self = context;
  const sources = await Promise.all(['mp4-remux.iife.js', 'm4s-mux.js', 'm4s-mux-worker.js']
    .map((file) => readFile(new URL('../lib/' + file, import.meta.url), 'utf8')));
  vm.runInContext(sources.join('\n;\n'), context);
  assert.equal(messages[0].type, 'READY');
  assert.equal(typeof context.BiliM4sMux.mergeM4s, 'function');
  await handler({ data: { type: 'MERGE', jobId: 'bad-input', videoBlob: new Blob(['bad']), audioBlob: new Blob(['bad']) } });
  assert.equal(messages.at(-1).type, 'ERROR');
  assert.equal(messages.at(-1).jobId, 'bad-input');
});

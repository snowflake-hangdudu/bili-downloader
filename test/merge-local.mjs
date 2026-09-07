// Local, existing fixture only; no network requests or user media uploads.
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
const root = new URL('../', import.meta.url);
const worker = new Worker(`
  const { parentPort } = require('node:worker_threads');
  const fs = require('node:fs');
  const vm = require('node:vm');
  parentPort.on('message', async ({ root, video, audio }) => {
    try {
      vm.runInThisContext(fs.readFileSync(root + '/lib/mp4-remux.iife.js', 'utf8'));
      vm.runInThisContext(fs.readFileSync(root + '/lib/m4s-mux.js', 'utf8'));
      const blob = await BiliM4sMux.mergeM4s(video, audio, mp4Remux);
      parentPort.postMessage({ blob });
    } catch (error) { parentPort.postMessage({ error: error.message }); }
  });
`, { eval: true });
const started = performance.now();
let ticks = 0, last = started, maxDelay = 0;
const timer = setInterval(() => { const now = performance.now(); maxDelay = Math.max(maxDelay, now - last); last = now; ticks++; }, 10);
const video = new Blob([await readFile(new URL('test/_out/video.m4s', root))]);
const audio = new Blob([await readFile(new URL('test/_out/audio.m4s', root))]);
try {
  const result = await new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    worker.postMessage({ root: decodeURIComponent(root.pathname).replace(/^\//, ''), video, audio });
  });
  if (result.error) throw new Error(result.error);
  await writeFile(new URL('test/_out/merged-audit.mp4', root), new Uint8Array(await result.blob.arrayBuffer()));
  console.log(JSON.stringify({ inputBytes: video.size + audio.size, outputBytes: result.blob.size, elapsedMs: Math.round(performance.now() - started), ticks, maxMainLoopGapMs: Math.round(maxDelay) }));
} finally { clearInterval(timer); await worker.terminate(); }

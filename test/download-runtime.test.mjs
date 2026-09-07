import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const agent = await readFile(new URL('../content/page-agent.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
function harness(fetch) {
  const messages = [];
  const context = vm.createContext({ Blob, AbortController, performance, fetch,
    window: { postMessage: (m) => messages.push(m) }, AGENT: 'agent', PROGRESS_REPORT_INTERVAL_MS: 150,
    location: { href: 'https://www.bilibili.com/video/BVtest' },
    pickWorkingUrl: async (url) => url, isDownloadableCdnUrl: () => true,
    rememberMirrorHost() {}, hostFromUrl: () => 'cdn', log() {}, sendProgress() {} });
  vm.runInContext(agent.slice(agent.indexOf('  const sessions ='), agent.indexOf('  function mergeM4sInWorker')), context);
  return { context, messages, session: context.createSession('test') };
}
const response = (bytes, headers = {}, status = 200) => new Response(new Uint8Array(bytes), { headers, status });

test('audio and video share pause gate and both resume', async () => {
  const { context: c, session: s } = harness();
  c.pauseDownloadControl(s.jobId);
  const a = c.waitWhilePaused(s), b = c.waitWhilePaused(s);
  assert.equal(a, b);
  c.resumeDownloadControl(s.jobId);
  await Promise.all([a, b]);
  assert.equal(s.pauseWait, null);
});
test('cancel wakes paused tracks and cancels merge; pause never cancels merge', async () => {
  const { context: c, session: s, messages } = harness();
  c.pauseDownloadControl(s.jobId);
  assert.equal(messages.length, 0);
  const waiting = c.waitWhilePaused(s);
  c.cancelDownloadControl(s.jobId);
  await waiting;
  assert.equal(messages[0].type, 'MERGE_CANCEL');
  assert.throws(() => c.throwIfCancelled(s), /已取消/);
});
test('destroying failed session releases all waiting tracks', async () => {
  const { context: c, session: s } = harness();
  c.pauseDownloadControl(s.jobId);
  const waiting = c.waitWhilePaused(s);
  c.destroySession(s.jobId);
  await waiting;
  assert.equal(s.cancelled, true);
});
test('reject truncated file instead of reporting success', async () => {
  const { context: c, session: s } = harness(async () => response(2048, { 'content-length': '4096' }));
  await assert.rejects(c.pageDownload(s, ['cdn']), /不完整/);
});
test('reject mismatched partial response', async () => {
  const { context: c, session: s } = harness(async () => response(2048, { 'content-range': 'bytes 1024-3071/3072' }, 206));
  await assert.rejects(c.pageDownload(s, ['cdn']), /范围不一致/);
});
test('pausing before CDN selection prevents network activity', async () => {
  let calls = 0;
  const { context: c, session: s } = harness(async () => { calls++; return response(2048); });
  c.pauseDownloadControl(s.jobId);
  const pending = c.pageDownload(s, ['cdn']);
  await Promise.resolve();
  assert.equal(calls, 0);
  c.resumeDownloadControl(s.jobId);
  assert.equal((await pending).size, 2048);
});
test('ignored resume Range restarts without duplicating bytes', async () => {
  let c, s, calls = 0;
  const h = harness(async (_url, options) => {
    if (++calls === 2) {
      assert.equal(options.headers.Range, 'bytes=1024-');
      return response(2048, { 'content-length': '2048' });
    }
    let reads = 0;
    return { ok: true, status: 200, headers: new Headers({ 'content-length': '2048' }), body: {
      getReader: () => ({ async read() {
        if (++reads === 1) return { done: false, value: new Uint8Array(1024) };
        c.pauseDownloadControl(s.jobId);
        setTimeout(() => c.resumeDownloadControl(s.jobId), 0);
        throw new Error('aborted');
      }, releaseLock() {} }) } };
  });
  c = h.context; s = h.session;
  assert.equal((await c.pageDownload(s, ['cdn'])).size, 2048);
  assert.equal(calls, 2);
});

function saveHarness(results) {
  const calls = [], revoked = [];
  const c = vm.createContext({ URL: { createObjectURL: () => 'blob:test', revokeObjectURL: (u) => revoked.push(u) },
    setTimeout: (fn) => setTimeout(fn, 0),
    EXT: { runtime: { sendMessage: async (msg) => { calls.push(msg); return results.shift(); } } } });
  vm.runInContext(content.slice(content.indexOf('  async function downloadBlob'), content.indexOf('  function formatView')), c);
  return { save: c.downloadBlob, calls, revoked };
}
test('native save waits for complete, then releases Blob URL', async () => {
  const h = saveHarness([{ ok: true, downloadId: 1 }, { ok: true, state: 'in_progress' }, { ok: true, state: 'complete' }]);
  assert.equal(await h.save(new Blob(['a']), 'a.mp4'), 1);
  assert.equal(h.calls.length, 3);
  assert.equal(h.revoked.length, 1);
});
test('native interruption is failure, not successful download', async () => {
  const h = saveHarness([{ ok: true, downloadId: 1 }, { ok: true, state: 'interrupted', error: 'FILE_NO_SPACE' }]);
  await assert.rejects(h.save(new Blob(['a']), 'a.mp4'), /FILE_NO_SPACE/);
  assert.equal(h.revoked.length, 1);
});
test('cancel before saving never creates browser download', async () => {
  const h = saveHarness([]);
  await assert.rejects(h.save(new Blob(['a']), 'a.mp4', () => true), /已取消/);
  assert.equal(h.calls.length, 0);
});

test('background rejects external Blob origin and unrelated browser downloads', async () => {
  const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
  let listener, created = 0;
  const c = vm.createContext({ URL, console, chrome: {
    runtime: { id: 'extension', onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    downloads: { download: async () => { created++; return 5; }, search: async () => [{ id: 5, byExtensionId: 'other', state: 'complete' }] }
  } });
  vm.runInContext(source, c);
  const sender = { id: 'extension', tab: { id: 1 }, url: 'https://www.bilibili.com/video/BVtest' };
  const call = (msg) => new Promise((resolve) => listener(msg, sender, resolve));
  assert.equal((await call({ type: 'BILI_DL_SAVE_MEDIA', url: 'blob:https://evil.test/id', filename: 'a.mp4' })).ok, false);
  assert.equal(created, 0);
  assert.equal((await call({ type: 'BILI_DL_MEDIA_STATE', downloadId: 5 })).ok, false);
  assert.equal((await call({ type: 'BILI_DL_SAVE_MEDIA', url: 'blob:https://www.bilibili.com/id', filename: 'a.mp4' })).downloadId, 5);
});

test('merge rejects missing indexes and truncated boxes before entering remuxer', async () => {
  const c = vm.createContext({ Blob, ReadableStream, setTimeout });
  vm.runInContext(await readFile(new URL('../lib/m4s-mux.js', import.meta.url), 'utf8'), c);
  const box = (type, size = 8) => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setUint32(0, size);
    bytes.set([...type].map((char) => char.charCodeAt(0)), 4);
    return bytes;
  };
  await assert.rejects(c.BiliM4sMux.validateFragmentedInput(new Blob([box('moov'), box('moof'), box('mdat')])), /索引不匹配/);
  await assert.rejects(c.BiliM4sMux.validateFragmentedInput(new Blob([box('mdat', 100)])), /不完整/);
});

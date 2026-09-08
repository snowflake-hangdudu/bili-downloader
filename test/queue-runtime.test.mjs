import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
function queueHarness(overrides = {}) {
  const calls = [], states = [], actions = [];
  const c = vm.createContext({
    queueRunning: false, queueCancelled: false, queuePaused: false, operationMode: null,
    activeJobs: new Map(), videoInfo: { pages: [{}, {}, {}] }, location: { href: 'https://www.bilibili.com/video/BVoriginal' },
    selectedQn: 64, selectedFormat: 'mp4', streamPreference: 'high-bitrate', qualities: [],
    startBtn: {}, queueBtn: {}, queueLabelEl: {}, statusEl: { classList: { add() {} } },
    canStartCurrentDownload: () => true, isMultiPartVideo: () => true, getSelectedQualityLabel: () => '720P',
    syncJobListVisibility() {}, ensureMuxReady: async () => true, waitWhileQueuePaused: async () => {},
    createDownloadTask: (seed) => ({ ...seed, jobId: `p${seed.pageIndex}`, attempts: 0 }),
    mountJobCard() {}, updateProgress() {},
    agentCall: async (_type, args) => { calls.push(args); return { info: { title: `P${args.pageIndex}`, cid: args.pageIndex + 1 } }; },
    runSingleDownload: async () => {}, addHistory: async () => {},
    setTaskState: (_job, state) => states.push(state),
    TASK_STATE: { completed: 'completed', failed: 'failed', cancelled: 'cancelled' },
    classifyDownloadError: (e) => ({ type: /保存/.test(e.message) ? 'save' : /取消/.test(e.message) ? 'cancelled' : 'network', message: e.message }),
    debugLog() {}, setTimeout: (fn) => setTimeout(fn, 0),
    showStatus: (type, text) => states.push({ type, text }),
    appendTextElement: (_el, _tag, _class, text) => { const action = { text }; actions.push(action); return action; },
    noteDownloadSuccessForRating() {}, resetQueueCancelButton() {}, setQueueLabel() {}, refreshStartBtnForParallel() {},
    ...overrides
  });
  c.removeJobCard = (id) => c.activeJobs.delete(id);
  vm.runInContext(source.slice(source.indexOf('    async function startQueueDownload('), source.indexOf('    async function startListDownload(')), c);
  return { c, calls, states, actions };
}
test('queue is serial and snapshots origin before SPA navigation', async () => {
  let active = 0, max = 0;
  const h = queueHarness({ runSingleDownload: async () => {
    max = Math.max(max, ++active);
    h.c.location.href = 'https://www.bilibili.com/video/BVother';
    await Promise.resolve(); active--;
  } });
  await h.c.startQueueDownload();
  assert.equal(max, 1);
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every((call) => call.href.endsWith('BVoriginal')));
  assert.equal(h.c.queueRunning, false);
});
test('double click while preparing cannot start a second queue', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const h = queueHarness({ ensureMuxReady: () => pending });
  const first = h.c.startQueueDownload();
  await h.c.startQueueDownload();
  release(true); await first;
  assert.equal(h.calls.length, 3);
});
test('failed-only retry excludes saved parts; save failures are not retried automatically', async () => {
  let rejectPart = true;
  const attempts = [];
  const h = queueHarness({ runSingleDownload: async (info) => {
    attempts.push(info.cid);
    if (info.cid === 2 && rejectPart) throw new Error('浏览器保存失败');
  } });
  await h.c.startQueueDownload();
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(h.actions.length, 1);
  rejectPart = false;
  await h.actions[0].onclick();
  assert.deepEqual(attempts, [1, 2, 3, 2]);
  assert.equal(h.c.activeJobs.size, 0);
});
test('cancel during parsing never starts a download', async () => {
  let downloads = 0;
  const h = queueHarness({ agentCall: async () => { h.c.queueCancelled = true; return { info: { title: 'part' } }; },
    runSingleDownload: async () => { downloads++; } });
  await h.c.startQueueDownload();
  assert.equal(downloads, 0);
  assert.equal(h.c.queueRunning, false);
  assert.equal(h.c.activeJobs.size, 0);
});
test('startup failure always releases queue lock', async () => {
  const h = queueHarness({ ensureMuxReady: async () => { throw new Error('启动失败'); } });
  await h.c.startQueueDownload();
  assert.equal(h.c.queueRunning, false);
});

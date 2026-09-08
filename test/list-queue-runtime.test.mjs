import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
function harness(saveFailure = false) {
  let active = 0, peak = 0, calls = 0;
  const items = Array.from({length: 35}, (_, i) => ({ bvid: 'BV' + i, aid: i + 1, cid: i + 1, title: 'video' + i }));
  const c = vm.createContext({ listItems: items, selectedListBvids: new Set(items.map(i => i.bvid)),
    queueRunning: false, queueCancelled: false, queuePaused: false, operationMode: null,
    selectedQn: 80, qualityStrategy: 'exact', streamPreference: 'high-bitrate', activeJobs: new Map(),
    listStartBtn: {}, lastListFailures: [],
    updateListRetryFailed() {}, setListStatus() {}, waitWhileQueuePaused: async () => {},
    getSelectedQualityLabel: () => '1080P', createDownloadTask: x => x, mountJobCard() {}, updateProgress() {},
    agentCall: async () => ({ qualities: [{ qn: 80, label: '1080P' }] }),
    runSingleDownload: async () => { calls++; peak = Math.max(peak, ++active); await Promise.resolve(); active--; if(saveFailure) throw new Error('保存失败'); return {}; },
    TASK_STATE: {}, setTaskState() {}, addHistory: async () => {}, debugLog() {},
    classifyDownloadError: e => ({ type: 'save', message: e.message }), resetQueueCancelButton() {},
    updateListSelection() {}, refreshStartBtnForParallel() {}, noteDownloadSuccessForRating() {},
    setTimeout: fn => setTimeout(fn, 0)
  });
  c.removeJobCard = id => c.activeJobs.delete(id);
  vm.runInContext(source.slice(source.indexOf('    async function startListDownload('), source.indexOf('    function openMenuShell(')), c);
  return { c, stats: () => ({calls, peak}) };
}
test('35 selected videos save serially and release active jobs', async () => {
  const h = harness(); await h.c.startListDownload();
  assert.deepEqual(h.stats(), { calls: 35, peak: 1 });
  assert.equal(h.c.activeJobs.size, 0); assert.equal(h.c.queueRunning, false);
});
test('disk save failure stops subsequent downloads and preserves unfinished items for retry', async () => {
  const h = harness(true); await h.c.startListDownload();
  assert.equal(h.stats().calls, 1); assert.equal(h.c.lastListFailures.length, 35);
  assert.equal(h.c.queueRunning, false); assert.equal(h.c.activeJobs.size, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
function harness(saveFailure = false, listDownloadKind = 'video') {
  let active = 0, peak = 0, calls = 0;
  const items = Array.from({length: 35}, (_, i) => ({ bvid: 'BV' + i, aid: i + 1, cid: i + 1, title: 'video' + i }));
  const c = vm.createContext({ listItems: items, selectedListBvids: new Set(items.map(i => i.bvid)),
    queueRunning: false, queueCancelled: false, queuePaused: false, operationMode: null,
    selectedQn: 80, qualityStrategy: 'exact', streamPreference: 'high-bitrate', listDownloadKind, activeJobs: new Map(),
    listStartBtn: {}, listItemsEl: { querySelectorAll: () => [] }, lastListFailures: [],
    updateListRetryFailed() {}, setListStatus() {}, waitWhileQueuePaused: async () => {},
    listDownloadKindLabel: (kind) => ({ video: '仅视频', audio: '仅音频', both: '视频+音频' })[kind] || '仅视频',
    filenameTemplate: '{title}', buildFilenameBase: (item, _quality, format) => `${item.title}-${format}`,
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
test('cancel before first item retains all pending items for retry', async () => {
  const h = harness();
  h.c.waitWhileQueuePaused = async () => { h.c.queueCancelled = true; };
  await h.c.startListDownload();
  assert.equal(h.stats().calls, 0);
  assert.equal(h.c.lastListFailures.length, 35);
  assert.equal(h.c.queueRunning, false);
});
test('successful queue deselects saved videos to avoid repeating them', async () => {
  const h = harness(); await h.c.startListDownload();
  assert.equal(h.c.selectedListBvids.size, 0);
});

test('视频+音频复用 MP4 合成阶段的音频，不再次拉取 M4A', async () => {
  const h = harness(false, 'both');
  const formats = [];
  let reused = 0;
  h.c.runSingleDownload = async (_item, options) => {
    formats.push(options.format);
    return options.format === 'mp4' ? { audioBlob: { size: 1024 } } : {};
  };
  h.c.saveReusedAudio = async (result) => {
    assert.equal(result.audioBlob.size, 1024);
    reused += 1;
    return { audioOnly: true, reusedAudio: true };
  };
  await h.c.startListDownload();
  assert.equal(formats.filter((format) => format === 'mp4').length, 35);
  assert.equal(formats.filter((format) => format === 'm4a').length, 0);
  assert.equal(reused, 35);
});

test('没有独立音轨可复用时，视频+音频仍回退下载 M4A', async () => {
  const h = harness(false, 'both');
  const formats = [];
  h.c.runSingleDownload = async (_item, options) => {
    formats.push(options.format);
    return {};
  };
  h.c.saveReusedAudio = async () => null;
  await h.c.startListDownload();
  assert.equal(formats.filter((format) => format === 'mp4').length, 35);
  assert.equal(formats.filter((format) => format === 'm4a').length, 35);
});

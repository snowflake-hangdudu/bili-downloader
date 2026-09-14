import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../content/page-agent.js', import.meta.url), 'utf8');
function harness(probe) {
  const context = vm.createContext({ AbortController, PROBE_PARALLEL: 3,
    buildCdnCandidates: () => ['slow', 'fast', 'bad', 'backup'],
    prioritizeCandidates: (items) => items, probeCdn: probe,
    rememberMirrorHost() {}, log() {}, hostFromUrl: (url) => url });
  vm.runInContext(source.slice(source.indexOf('  async function pickWorkingUrl('), source.indexOf('  async function apiGet(')), context);
  return context;
}
test('healthy CDN wins without waiting for stalled peers and cancels probes', async () => {
  const signals = [];
  const c = harness((url, controller) => {
    signals.push(controller.signal);
    if (url === 'fast') return Promise.resolve(true);
    return new Promise((resolve) => controller.signal.addEventListener('abort', () => resolve(false)));
  });
  assert.equal(await c.pickWorkingUrl('source'), 'fast');
  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal.aborted));
});
test('failed batch falls back and excluded CDN is never probed', async () => {
  const seen = [];
  const c = harness(async (url) => { seen.push(url); return url === 'backup'; });
  assert.equal(await c.pickWorkingUrl('source', null, new Set(['fast'])), 'backup');
  assert.ok(!seen.includes('fast'));
  assert.equal(await harness(async () => false).pickWorkingUrl('source'), null);
});

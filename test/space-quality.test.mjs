import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../content/content.css', import.meta.url), 'utf8');
const snippet = source.slice(source.indexOf('function chooseSpaceQuality('), source.indexOf('  // 图标资源缓存破坏'));
const context = vm.createContext({});
vm.runInContext(`${snippet}\nthis.test = { chooseSpaceQuality };`, context);
const { chooseSpaceQuality } = context.test;

const available = [
  { qn: 16, label: '360P' },
  { qn: 32, label: '480P' },
  { qn: 64, label: '720P' },
  { qn: 80, label: '1080P' },
  { qn: 116, label: '1080P60' },
  { qn: 120, label: '4K' }
];

assert.equal(chooseSpaceQuality(available, 'highest').qn, 120);
assert.equal(chooseSpaceQuality(available, '1080').qn, 116);
assert.equal(chooseSpaceQuality(available, '720').qn, 64);
assert.equal(chooseSpaceQuality([{ qn: 32, label: '480P' }], '720').qn, 32);
assert.equal(chooseSpaceQuality([{ qn: 120, label: '4K' }], '1080'), undefined);

const js = source;
assert.match(js, /function syncSpaceDownloadAllVisibility\(/);
assert.match(js, /if \(isSpacePage\(\)\) \{[\s\S]*renderSpaceQuality\(\);[\s\S]*return;/);
assert.match(js, /spaceQualityTierHighest/);
assert.match(js, /spaceQualityTier1080/);
assert.match(js, /spaceQualityTier720/);
assert.match(js, /bili-dl-space-profile-meta/);
assert.match(js, /function readSpaceAvatarUrl\(/);
assert.match(js, /function refreshSpaceCurrentPage\(/);
assert.match(js, /bili-dl-list-refresh-page/);
assert.doesNotMatch(js, /bili-dl-space-profile-sign/);
assert.match(js, /function mutationTouchesExtension\(/);
assert.match(js, /listQueueLayout = queueRunning && operationMode === 'list' && !queueCancelled/);
assert.match(js, /if \(!el \|\| job\.cancelRequested \|\| queueCancelled\) return;/);
assert.match(js, /async function ensureListItemVideoIds\(item\)/);
assert.match(js, /item\.aid = String\(resolved\.info\.aid/);
assert.doesNotMatch(css, /\.bili-dl-footer-links \[data-sheet="notice"\]/);
assert.match(css, /\.bili-dl-footer-links \[data-sheet="plugins"\][\s\S]*display:\s*none/);
assert.match(css, /\.bili-dl-footer-links \[data-sheet="diagnostics"\][\s\S]*display:\s*none/);
assert.match(css, /\.bili-dl-footer-links \[data-sheet="tasks"\][\s\S]*display:\s*none/);
assert.match(js, /const HIDDEN_FOOTER_SHEETS = new Set\(\['plugins', 'diagnostics', 'tasks'\]\)/);
assert.match(js, /notice: \{ enabled: true/);
assert.match(js, /const REMOTE_CONTENT_DEBUG_REFRESH = false;/);

console.log('Space quality tiers, profile, and download-all visibility checks passed');


import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../content/page-agent.js', import.meta.url), 'utf8');
const requests = [];
let fail = false;
let guest = false;
const location = { hostname: 'space.bilibili.com', pathname: '/360791158/upload/video', origin: 'https://space.bilibili.com', href: 'https://space.bilibili.com/360791158/upload/video' };
const context = vm.createContext({
  window: { addEventListener() {}, postMessage() {} }, location,
  console: { log() {} }, TextEncoder, URLSearchParams, URL, AbortController, setTimeout, clearTimeout,
  document: { cookie: '' },
  fetch: async (url) => {
    requests.push(url);
    if (url.endsWith('/nav')) return { ok: true, json: async () => ({ code: guest ? -101 : 0, data: { wbi_img: { img_url: 'https://example.test/' + 'a'.repeat(32) + '.png', sub_url: 'https://example.test/' + 'b'.repeat(32) + '.png' } } }) };
    const query = new URL(url).searchParams;
    const signature = query.get('w_rid');
    const sorted = url.split('?')[1].split('&w_rid=')[0];
    // Independently compare the implementation's MD5 with Node's crypto.
    const mixin = context.test.key();
    assert.equal(signature, createHash('md5').update(sorted + mixin).digest('hex'));
    if (fail) return { ok: true, json: async () => ({ code: -412, message: '稍后重试' }) };
    const pn = Number(query.get('pn'));
    return { ok: true, json: async () => ({ code: 0, data: { page: { count: 31 }, list: { vlist: Array.from({ length: pn === 1 ? 30 : 1 }, (_, index) => ({ bvid: 'BVtest' + (pn * 100 + index), aid: pn * 100 + index, title: '投稿', author: 'UP', length: '1:10', pic: 'https://example.test/cover.jpg' })) } } }) };
  }
});
vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.test = { spaceMd5, resolveList, loadListPage, key: () => spaceWbiKey }; })();'), context);
context.test = context.window.test;
for (const input of ['', 'abc', '中文投稿', 'x'.repeat(1000)]) {
  assert.equal(context.test.spaceMd5(input), createHash('md5').update(input).digest('hex'));
}
const first = await context.test.resolveList();
assert.equal(first.items.length, 30);
assert.equal(first.total, 31);
assert.equal(first.hasMore, true);
assert.equal(first.items[0].duration, 70);
assert.equal(first.items[0].cid, ''); // Resolved only when its download starts.
const second = await context.test.loadListPage(first.cursor);
assert.equal(second.items.length, 1);
assert.equal(second.hasMore, false);
assert.equal(requests.filter((url) => url.endsWith('/nav')).length, 1);
location.pathname = '/123/upload/video';
await assert.rejects(context.test.loadListPage(first.cursor), /UP 主已切换/);
location.pathname = '/360791158/upload/video';
fail = true;
await assert.rejects(context.test.resolveList(), /API code=-412/);
assert.equal(context.test.key(), '');
fail = false;
guest = true;
assert.equal((await context.test.resolveList()).items.length, 30);
console.log('Space uploads: MD5, signed pagination, lazy CID, route isolation, guest keys and API errors passed');

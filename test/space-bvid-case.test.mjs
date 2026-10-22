import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const ids = ['BV1Hki7B5EDM', 'BV1MRirBWEnW', 'BV1hki7B5EDM'];
const links = [...ids, ids[0]].map((id) => ({
  href: `https://www.bilibili.com/video/${id}`,
  closest: () => null,
  getAttribute: () => id
}));
const context = vm.createContext({
  document: { querySelector: () => null, body: { querySelectorAll: () => links } },
  readSpaceDomMeta: () => ({ name: '作者' }), listItems: []
});
for (const [name, next] of [
  ['scrapeSpaceVisibleVideos', 'syncSpaceListTools'],
  ['mergeSpacePageItems', 'ensureListItemVideoIds']
]) {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf(`    ${next === 'ensureListItemVideoIds' ? 'async ' : ''}function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
}
const scraped = context.scrapeSpaceVisibleVideos();
assert.deepEqual(Array.from(scraped, (item) => item.bvid), ids,
  '保留 BV 号大小写，去除同一链接的重复项，不合并不同大小写的标识');
const merged = context.mergeSpacePageItems([
  { bvid: ids[0], aid: '1', cid: '2' }
], scraped);
assert.equal(merged[0].cid, '2');
assert.equal(merged[1].bvid, ids[1]);
assert.equal(merged[2].aid, '', '大小写不同的视频不能误用其他视频的信息');
assert.equal(context.mergeSpacePageItems([{ bvid: 'bv' + ids[0].slice(2), cid: '3' }], scraped)[0].cid, '3');
console.log('投稿页 BV 大小写回归检查通过');

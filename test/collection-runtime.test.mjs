import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../content/page-agent.js', import.meta.url), 'utf8');
const c = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function normalizeCollection('), source.indexOf('  function getListContext(')), c);
test('video collection flattens sections, preserves order and removes duplicate videos', () => {
  const episode = { aid: 1, bvid: 'BVone', page: { cid: 2, duration: 42 }, arc: { title: 'One', pic: 'cover' } };
  const result = c.normalizeCollection({ title: '合集', ep_count: 2, sections: [
    { episodes: [episode] }, { episodes: [episode, { aid: 3, bvid: 'BVtwo', cid: 4, title: 'Two' }] }
  ] });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].cid, '2');
  assert.equal(result.items[0].duration, 42);
  assert.equal(result.items[1].bvid, 'BVtwo');
  assert.equal(result.hasMore, false);
  assert.equal(result.collection, true);
});
test('ordinary video does not become a collection and invalid entries are excluded', () => {
  assert.equal(c.normalizeCollection(undefined), null);
  assert.equal(c.normalizeCollection({ sections: [{ episodes: [{ title: 'bad' }] }] }), null);
});

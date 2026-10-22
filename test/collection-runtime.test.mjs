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

const expansion = source.slice(source.indexOf('  async function expandCollectionParts('), source.indexOf('  async function resolveList('));
function expander(apiGet) {
  const context = vm.createContext({ apiGet, log() {} });
  vm.runInContext(expansion, context);
  return context.expandCollectionParts;
}

test('collection expands every part without collapsing shared BV IDs', async () => {
  const pages = [{ cid: 101, page: 1, part: 'First', duration: 10 }, { cid: 102, page: 2, part: 'Second', duration: 20 }];
  const collection = c.normalizeCollection({ sections: [{ episodes: [
    { aid: 1, bvid: 'BVone', title: 'Series', pages },
    { aid: 2, bvid: 'BVtwo', cid: 201, title: 'Other', pages: [{ cid: 201, page: 1, part: 'Other' }] }
  ] }] });
  const result = await expander(async () => { throw new Error('unexpected metadata request'); })(collection, {});
  assert.equal(result.total, 3);
  assert.equal(result.archiveTotal, 2);
  assert.equal(new Set(result.items.map(item => item.listKey)).size, 3);
  assert.equal(result.items[1].cid, '102');
  assert.equal(result.items[1].pageIndex, 1);
  assert.equal(result.items[1].part, 2);
  assert.match(result.items[1].title, /P2 Second/);
  assert.equal(result.items[2].bvid, 'BVtwo');
  assert.ok(result.items.every(item => !('collectionPages' in item)));
});

test('missing embedded pages use the full page-list endpoint', async () => {
  const requests = [];
  const result = await expander(async path => {
    requests.push(path);
    return [{ cid: 10, page: 1 }, { cid: 20, page: 2 }];
  })({ items: [{ aid: '1', bvid: 'BVone', title: 'Series' }] }, {});
  assert.equal(requests[0], '/x/player/pagelist?bvid=BVone');
  assert.equal(result.total, 2);
});

test('failed expansion rejects rather than silently presenting only first parts', async () => {
  await assert.rejects(expander(async () => [])({ items: [{ bvid: 'BVone', title: 'Series' }] }, {}));
});

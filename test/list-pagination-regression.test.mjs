import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const agent = await readFile(new URL('../content/page-agent.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../content/content.css', import.meta.url), 'utf8');

assert.match(agent, /function normalizeListItem\(/);
assert.match(agent, /function getListContext\(/);
assert.match(agent, /function listApiPath\(/);
assert.match(agent, /\/x\/v2\/medialist\/resource\/list\?/);
assert.match(agent, /case 'LOAD_LIST_PAGE'/);
assert.match(agent, /hasMore: data\.has_more === true/);
assert.match(content, /id="bili-dl-list-load-more"/);
assert.doesNotMatch(content, /listItemsEl\.addEventListener\('scroll', scheduleListAutoLoad/);
assert.match(content, /请先向下滚动 B 站页面列表，再点“刷新”/);
assert.match(content, /id="bili-dl-list-search"/);
assert.match(content, /data-list-filter="selected"/);
assert.match(content, /listFilter === 'selected'/);
assert.match(content, /selectedListBvids = new Set\(\)/, '刷新列表应清空选择；分页加载不可清空选择');
assert.match(content, /function mergeListItems\(/);
assert.match(css, /#bili-dl-list-load-more/);
assert.match(css, /\.bili-dl-list-tools,[\s\S]*#bili-dl-list-load-more \{ display: none !important; \}/);

console.log('list pagination regression checks passed');

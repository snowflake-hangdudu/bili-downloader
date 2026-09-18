import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const chromiumPacker = await readFile(new URL('../scripts/pack.py', import.meta.url), 'utf8');
const firefoxPacker = await readFile(new URL('../scripts/pack_firefox.py', import.meta.url), 'utf8');

assert.match(source, /const FEATURE_FLAGS_URL = `\$\{CONFIG_BASE_URL\}\/api\/feature-flags`/);
assert.match(source, /const PLUGINS_JSON_URL = `\$\{CONFIG_BASE_URL\}\/api\/plugins`/);
assert.match(source, /const PLUGIN_CATALOG_CACHE_KEY = 'biliDlPluginCatalog_v2'/);
assert.match(source, /const REMOTE_CATALOG_DEBUG_REFRESH = true;/);
assert.match(source, /Date\.now\(\) - cached\.fetchedAt < CONTENT_CACHE_TTL_MS/);
assert.match(source, /Promise\.all\(\[\s*EXT\.runtime\.sendMessage\(\{ type: 'BILI_DL_FETCH_JSON', url: FEATURE_FLAGS_URL \}\),\s*EXT\.runtime\.sendMessage\(\{ type: 'BILI_DL_FETCH_JSON', url: PLUGINS_JSON_URL \}\)/);
assert.match(source, /function isRelatedPluginsMasterOn\(/);
assert.match(source, /flags\.relatedPluginsVisible === true/);
assert.match(source, /flags\.bilibiliSeriesVisible === true/);
assert.match(source, /plugin\.visible === true && plugin\.id !== 'bilibili'/);
assert.match(source, /infoTitle\.textContent = '相关插件'/);
assert.match(source, /classList\.toggle\('is-plugins', key === 'plugins'\)/);
assert.match(source, /label: '前往安装'/);
assert.doesNotMatch(source, /label: '搜索安装'/);
assert.doesNotMatch(source, /is-page-fit/);
assert.match(source, /当前没有可展示的相关插件/);
assert.match(source, /正在读取相关插件目录/);
assert.doesNotMatch(source, /infoTitle\.textContent = 'B站系列插件'/);
assert.doesNotMatch(source, /flags\?\.bilibiliSeriesVisible !== true/);
assert.match(source, /infoDate\.classList\.add\('hidden'\)/);
assert.match(source, /bili-dl-plugin-action/);
assert.match(source, /bili-dl-plugin-icon-wrap/);
assert.match(source, /bili-dl-plugin-icon-fallback/);
assert.match(source, /type: 'BILI_DL_FETCH_ASSET'/);
assert.match(background, /api\/feature-flags/);
assert.match(background, /api\/plugins/);
assert.match(background, /BILI_DL_FETCH_ASSET/);
assert.match(background, /bytes\.length > 2 \* 1024 \* 1024/);
assert.match(background, /assets\\\/\[A-Za-z0-9\._-\]+\+/);
for (const packer of [chromiumPacker, firefoxPacker]) {
  assert.match(packer, /DEBUG_CATALOG_MARKER = 'const REMOTE_CATALOG_DEBUG_REFRESH = true;'/);
  assert.match(packer, /RELEASE_CATALOG_MARKER = 'const REMOTE_CATALOG_DEBUG_REFRESH = false;'/);
  assert.match(packer, /source\.replace\(DEBUG_CATALOG_MARKER, RELEASE_CATALOG_MARKER, 1\)/);
}

console.log('plugin catalog integration checks passed');

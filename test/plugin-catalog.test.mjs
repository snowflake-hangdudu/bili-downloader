import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const chromiumPacker = await readFile(new URL('../scripts/pack.py', import.meta.url), 'utf8');
const firefoxPacker = await readFile(new URL('../scripts/pack_firefox.py', import.meta.url), 'utf8');

assert.match(source, /const FEATURE_FLAGS_URL = `\$\{CONFIG_BASE_URL\}\/api\/feature-flags`/);
assert.match(source, /const PLUGINS_JSON_URL = `\$\{CONFIG_BASE_URL\}\/api\/plugins`/);
assert.match(source, /const PLUGIN_CATALOG_CACHE_KEY = 'biliDlPluginCatalog_v2'/);
assert.match(source, /const REMOTE_CATALOG_DEBUG_REFRESH = true;/);
assert.match(source, /const REMOTE_CONTENT_DEBUG_REFRESH = false;/);
assert.match(source, /!REMOTE_CATALOG_DEBUG_REFRESH && cached\?\.fetchedAt && Date\.now\(\) - cached\.fetchedAt < CONTENT_CACHE_TTL_MS/);
assert.match(source, /!REMOTE_CONTENT_DEBUG_REFRESH && cached\?\.fetchedAt && Date\.now\(\) - cached\.fetchedAt < CONTENT_CACHE_TTL_MS/);
assert.match(source, /调试模式：忽略本地缓存并立即刷新公告\/合作配置/);
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
assert.match(source, /当前浏览器暂无可安装的相关插件/);
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
  assert.match(packer, /DEBUG_REFRESH_MARKERS = \(/);
  assert.match(packer, /const REMOTE_CATALOG_DEBUG_REFRESH = true;/);
  assert.match(packer, /const REMOTE_CONTENT_DEBUG_REFRESH = true;/);
  assert.match(packer, /const REMOTE_CATALOG_DEBUG_REFRESH = false;/);
  assert.match(packer, /const REMOTE_CONTENT_DEBUG_REFRESH = false;/);
}
assert.match(firefoxPacker, /FIREFOX_RELEASE_VERSION = '1\.2\.2'/);
assert.match(firefoxPacker, /manifest\['version'\] = FIREFOX_RELEASE_VERSION/);

const browserHelpers = source.slice(source.indexOf('    function detectBrowserStore()'), source.indexOf('    function pluginIconUrl('));
const catalogHelpers = source.slice(source.indexOf('    function isRelatedPluginsMasterOn('), source.indexOf('    function applyPluginCatalog('));
const plugins = [
  { id: 'bilibili', visible: true, stores: { edge: 'https://edge.example/self' } },
  { id: 'edge-only', visible: true, stores: { edge: 'https://edge.example/plugin' } },
  { id: 'chrome-only', visible: true, stores: { chrome: 'https://chrome.example/plugin' } },
  { id: 'firefox-only', visible: true, stores: { firefox: 'https://firefox.example/plugin' } },
  { id: 'invalid-link', visible: true, stores: { edge: 'http://edge.example/plugin' } },
  { id: 'hidden', visible: false, stores: { edge: 'https://edge.example/hidden' } }
];
for (const [browser, userAgent, gecko] of [
  ['edge', 'Mozilla/5.0 Chrome/140.0 Edg/140.0', false],
  ['chrome', 'Mozilla/5.0 Chrome/140.0', false],
  ['firefox', 'Mozilla/5.0 Chrome/140.0', true]
]) {
  const context = vm.createContext({
    navigator: { userAgent },
    EXT: { runtime: { getManifest: () => gecko ? { browser_specific_settings: { gecko: {} } } : {} } }
  });
  vm.runInContext(browserHelpers + catalogHelpers, context);
  assert.equal(context.detectBrowserStore(), browser);
  assert.deepEqual(Array.from(context.normalizeRelatedPlugins({ relatedPluginsVisible: true }, plugins), (plugin) => plugin.id), [`${browser}-only`]);
  assert.equal(context.pluginStoreUrl(plugins.find((plugin) => plugin.id === 'edge-only'))?.url || null,
    browser === 'edge' ? 'https://edge.example/plugin' : null);
  assert.equal(context.normalizeRelatedPlugins({ relatedPluginsVisible: false }, plugins).length, 0);
}

console.log('plugin catalog integration checks passed');

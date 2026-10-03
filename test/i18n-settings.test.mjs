import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const content = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const popup = await readFile(new URL('../popup/popup.js', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../manifest.json', import.meta.url), 'utf8');
const i18nSrc = await readFile(new URL('../shared/i18n.js', import.meta.url), 'utf8');
const i18nExtraSrc = await readFile(new URL('../shared/i18n-extra.js', import.meta.url), 'utf8');

assert.match(manifest, /shared\/i18n\.js/);
assert.match(manifest, /shared\/i18n-extra\.js/);
assert.match(content, /function applyLanguage\(/);
assert.match(content, /function refreshDynamicUi\(/);
assert.match(content, /BiliDlI18n\?\.save/);
assert.doesNotMatch(content, /followBrowser/);
assert.match(content, /data-i18n="appTitle"/);
assert.match(content, /function translateUserError\(/);
assert.match(popup, /applyPopupLanguage/);
assert.match(popup, /BiliDlI18n\?\.onChange/);

const browser = {
  i18n: { getUILanguage: () => 'en-US' },
  storage: {
    local: {
      get(key, cb) {
        if (typeof cb === 'function') cb({ 'biliDlLanguage_v1': 'auto' });
      },
      set(_value, cb) { cb?.(); }
    },
    onChanged: { addListener() {} }
  }
};
const context = vm.createContext({
  globalThis: { browser },
  browser,
  navigator: { language: 'en-US' }
});
vm.runInContext(i18nSrc, context);
vm.runInContext(i18nExtraSrc, context);
const I18n = context.globalThis.BiliDlI18n;
assert.ok(I18n);
assert.equal(typeof I18n.mergeMessages, 'function');
await I18n.ready;
assert.equal(I18n.preference(), 'auto');
assert.equal(I18n.language(), 'en');
assert.equal(I18n.t('startDownload'), 'Start download');
assert.equal(I18n.t('stepPrepare'), 'Preparing');
assert.equal(I18n.t('ratingTextStore', { store: 'Chrome' }), 'If this extension helps, a quick rating on the Chrome store would mean a lot. Totally optional.');
await I18n.save('zh-CN');
assert.equal(I18n.preference(), 'zh-CN');
assert.equal(I18n.t('startDownload'), '开始下载');
assert.equal(I18n.t('listSelectHint'), '可勾选投稿，或点击“读取全部投稿”加载并全选。');
await I18n.save('zh-TW');
assert.equal(I18n.preference(), 'zh-TW');
assert.equal(I18n.t('startDownload'), '開始下載');
assert.equal(I18n.t('traditionalChinese'), '繁體中文');
assert.equal(I18n.t('stepPrepare'), '準備下載');

console.log('i18n settings checks passed');

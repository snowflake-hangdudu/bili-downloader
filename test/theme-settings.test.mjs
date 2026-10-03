import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const content = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const popup = await readFile(new URL('../popup/popup.js', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../manifest.json', import.meta.url), 'utf8');
const themeManagerSrc = await readFile(new URL('../shared/theme-manager.js', import.meta.url), 'utf8');
const themesJson = JSON.parse(await readFile(new URL('../shared/themes-ambient-full.json', import.meta.url), 'utf8'));
const ambientCss = await readFile(new URL('../shared/ambient-themes.css', import.meta.url), 'utf8');
const settingsCss = await readFile(new URL('../content/content.css', import.meta.url), 'utf8');

assert.match(content, /const THEME_PREF_KEY = 'biliDlTheme_v1'/);
assert.match(content, /Theme\?\.listEntries\?\.\(\)/);
assert.match(content, /Theme\.applyToRoot\(themedPanel, value\)/);
assert.match(content, /option\.onclick = async/);
assert.match(content, /EXT\.storage\.local\.set\(\{ \[THEME_PREF_KEY\]: themeId \}\)/);
assert.match(content, /globalThis\.BiliDlTheme\?\.loadThemes\?\.\(\)/);
assert.match(content, /changes\[THEME_PREF_KEY\].*applyTheme/);
assert.match(popup, /const THEME_PREF_KEY = 'biliDlTheme_v1'/);
assert.match(popup, /BiliDlTheme\?\.loadThemes/);
assert.match(popup, /Theme\.applyToRoot\(document\.body, value\)/);
assert.match(manifest, /shared\/theme-manager\.js/);
assert.match(manifest, /shared\/ambient-themes\.css/);
assert.match(manifest, /shared\/themes-ambient-full\.json/);
assert.match(ambientCss, /data-theme-kind="ambient"/);
assert.match(settingsCss, /data-theme-kind="ambient"/);
assert.doesNotMatch(settingsCss, /data-theme="tokyo-love"/);

const themeIds = themesJson.themes.map((theme) => theme.id);
assert.equal(themeIds.length, 9);
for (const id of ['cyan-mist', 'violet-haze', 'ember', 'bronze-smoke', 'deep-ocean', 'obsidian', 'tokyo-love', 'manchester-sea', 'chinese-odyssey']) {
  assert.ok(themeIds.includes(id), `missing theme ${id}`);
}

const vars = {};
const themedPanel = {
  dataset: {},
  style: {
    setProperty(key, value) { vars[key] = value; },
    removeProperty(key) { delete vars[key]; }
  },
  removeAttribute(name) {
    delete this.dataset[name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    if (name === 'data-theme-mode') delete this.dataset.themeMode;
    if (name === 'data-theme-kind') delete this.dataset.themeKind;
  }
};
const themeOptions = [];
const currentLabel = { textContent: '' };
const currentSwatch = { dataset: {}, style: {} };
const themeControl = {
  querySelector(selector) {
    if (selector.startsWith('[data-theme-option=')) return themeOptions.find((option) => selector.includes(option.dataset.themeOption));
    if (selector === '.bili-dl-settings-theme-current-label') return currentLabel;
    if (selector === '.bili-dl-settings-theme-current-swatch') return currentSwatch;
    return null;
  },
  querySelectorAll() { return themeOptions; }
};
const panel = { querySelector: () => themeControl };

const context = vm.createContext({
  globalThis: {},
  browser: { runtime: { getURL: () => 'themes.json' } },
  fetch: async () => ({
    ok: true,
    json: async () => themesJson
  })
});
vm.runInContext(themeManagerSrc, context);
const Theme = context.globalThis.BiliDlTheme;
assert.ok(Theme);

await Theme.loadThemes();
const entries = Theme.listEntries();
assert.equal(entries[0][0], 'bilibili');
assert.equal(entries[0][1], '默认');
assert.equal(entries.length, 10);

entries.forEach(([id, label]) => {
  themeOptions.push({
    dataset: { themeOption: id, label },
    setAttribute(name, value) { this[name] = value; }
  });
});

context.globalThis.BiliDlTheme = Theme;
context.themedPanel = themedPanel;
context.panel = panel;
vm.runInContext(content.slice(content.indexOf('    function applyTheme(value)'), content.indexOf('    const toggleBtn =')), context);
const applyTheme = context.applyTheme;

assert.equal(applyTheme('unknown'), 'bilibili');
assert.equal(themedPanel.dataset.theme, 'bilibili');
assert.equal(themedPanel.dataset.themeKind, undefined);

assert.equal(applyTheme('tokyo-love'), 'tokyo-love');
assert.equal(themedPanel.dataset.theme, 'tokyo-love');
assert.equal(themedPanel.dataset.themeKind, 'ambient');

applyTheme('cyan-mist');
assert.equal(themedPanel.dataset.theme, 'cyan-mist');
assert.ok(vars['--theme-gradient-background']);
assert.ok(vars['--bg']);

applyTheme('bilibili');
assert.equal(themedPanel.dataset.theme, 'bilibili');
assert.equal(themedPanel.dataset.themeKind, undefined);
assert.equal(vars['--bg'], undefined);

console.log('theme settings checks passed');

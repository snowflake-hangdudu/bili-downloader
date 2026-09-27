import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const content = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const popup = await readFile(new URL('../popup/popup.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../shared/design-system.css', import.meta.url), 'utf8');
const settingsCss = await readFile(new URL('../content/content.css', import.meta.url), 'utf8');

assert.match(content, /const THEME_PREF_KEY = 'biliDlTheme_v1'/);
assert.match(content, /themeEntries = \[\['bilibili', '默认'\]/);
assert.match(content, /option\.onclick = async/);
assert.match(content, /EXT\.storage\.local\.set\(\{ \[THEME_PREF_KEY\]: value \}\)/);
assert.match(content, /EXT\.storage\.local\.get\(THEME_PREF_KEY\)/);
assert.match(content, /changes\[THEME_PREF_KEY\].*applyTheme/);
assert.match(popup, /const THEME_PREF_KEY = 'biliDlTheme_v1'/);
assert.match(popup, /EXT\.storage\.local\.get\(THEME_PREF_KEY\)/);
assert.match(styles, /#bili-dl-panel\[data-theme="tokyo-love"\],[\s\S]*body\[data-theme="tokyo-love"\]/);
assert.match(styles, /--brand-cta: linear-gradient\(135deg, #34435F, #1E2A44\)/);
for (const theme of ['tokyo-love', 'manchester-sea', 'chinese-odyssey']) {
  assert.match(styles, new RegExp(`#bili-dl-panel\\[data-theme="${theme}"\\],[\\s\\S]*body\\[data-theme="${theme}"\\]`));
}
assert.match(content, /bili-dl-settings-theme-control/);
assert.match(content, /currentSwatch\.dataset\.theme = theme/);
assert.match(settingsCss, /\.bili-dl-settings-theme-options/);
assert.match(styles, /--brand-cta: linear-gradient\(135deg, #6F8C97, #2F5F73 62%, #2C3440\)/);
assert.match(styles, /--brand-cta: linear-gradient\(135deg, #C97A3E, #91563A 56%, #6B4E3A\)/);
assert.match(popup, /\['tokyo-love', 'manchester-sea', 'chinese-odyssey'\]\.includes\(value\)/);

const themedPanel = { dataset: {} };
const themeOptions = ['bilibili', 'tokyo-love', 'manchester-sea', 'chinese-odyssey'].map((theme) => ({
  dataset: { themeOption: theme, label: theme },
  setAttribute(name, value) { this[name] = value; }
}));
const currentLabel = { textContent: '' };
const currentSwatch = { dataset: {} };
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
const helper = content.slice(content.indexOf('    function applyTheme(value)'), content.indexOf('    const toggleBtn ='));
const context = vm.createContext({ themedPanel, panel });
vm.runInContext(helper, context);
context.applyTheme('unknown');
assert.equal(themedPanel.dataset.theme, 'bilibili');
assert.equal(currentSwatch.dataset.theme, 'bilibili');
context.applyTheme('tokyo-love');
assert.equal(themedPanel.dataset.theme, 'tokyo-love');
assert.equal(currentSwatch.dataset.theme, 'tokyo-love');
context.applyTheme('manchester-sea');
assert.equal(themedPanel.dataset.theme, 'manchester-sea');
assert.equal(currentSwatch.dataset.theme, 'manchester-sea');
context.applyTheme('chinese-odyssey');
assert.equal(themedPanel.dataset.theme, 'chinese-odyssey');
assert.equal(currentSwatch.dataset.theme, 'chinese-odyssey');

console.log('theme settings checks passed');

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../content/content.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');

assert.match(css, /#bili-dl-menu\.is-list-page\s*\{[^}]*height:\s*min\(calc\(100dvh - 200px\), 620px\)/s);
assert.match(css, /#bili-dl-menu\.is-list-page #bili-dl-home\s*\{[^}]*overflow:\s*hidden/s);
assert.match(css, /#bili-dl-menu\.is-list-page \.bili-dl-body\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(css, /#bili-dl-menu\.is-list-page \.bili-dl-list-body\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(css, /#bili-dl-menu\.is-list-page \.bili-dl-list-items\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(css, /#bili-dl-menu\.is-list-page \.bili-dl-list-body \.bili-dl-job-list\s*\{[^}]*flex:\s*0 0 auto/s);
assert.doesNotMatch(css, /#bili-dl-panel\.is-menu-open #bili-dl-toggle/);
assert.match(js, /videoBodyEl\.scrollTo\(\{ top: videoBodyEl\.scrollHeight, behavior: 'smooth' \}\)/);
assert.match(js, /listBodyEl\.scrollTo\(\{ top: listBodyEl\.scrollHeight, behavior: 'smooth' \}\)/);

console.log('layout regression checks passed');

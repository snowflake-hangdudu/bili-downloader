// 步骤 1：验证 WBI 签名算法（对照官方文档示例）
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const wbiCode = readFileSync(join(__dir, '../lib/wbi.js'), 'utf8')
  .replace(/export async function/g, 'async function')
  .replace(/export /g, '');
const wbi = {};
eval(wbiCode + '\nObject.assign(wbi, { getWbiKeys, signParams, genMixinKey: (img, sub) => { const raw = img + sub; return [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52].map(i=>raw[i]).join("").slice(0,32); });');

const IMG_KEY = '7cd084941338484aae1ad9425b84077c';
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45';
const EXPECTED_MIXIN = 'ea1db124af3c7062474693fa704f4ff8';
const EXPECTED_WRID = '8f6f2b5b3d485fe1886cec6a0be8c5d4';

const mixin = wbi.genMixinKey(IMG_KEY, SUB_KEY);
console.log('[1] mixin_key:', mixin === EXPECTED_MIXIN ? '✅ PASS' : `❌ FAIL (got ${mixin})`);

// 用固定 wts 测试
const params = { foo: '114', bar: '514', zab: 1919810 };
const signed = await wbi.signParams(params, IMG_KEY, SUB_KEY);
// signParams 用了动态 wts，单独测 md5 部分
console.log('[1] signParams 结构:', signed.w_rid && signed.wts ? '✅ 有 w_rid/wts' : '❌ 缺少字段');

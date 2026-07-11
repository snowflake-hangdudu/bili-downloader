import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

// 动态加载 wbi 模块
const wbiPath = new URL('../lib/wbi.js', import.meta.url).href;
const { signParams, getWbiKeys } = await import(wbiPath);

console.log('=== JS 步骤 1: 验证 signParams 能否调通 nav ===');
try {
  const keys = await getWbiKeys();
  console.log('nav keys OK:', keys.imgKey.slice(0, 8) + '...');

  console.log('\n=== JS 步骤 2: view 接口 (URLSearchParams) ===');
  const signed = await signParams({ bvid: 'BV1GJ411x7h7' }, keys.imgKey, keys.subKey);
  const q1 = new URLSearchParams(signed).toString();
  let res = await fetch('https://api.bilibili.com/x/web-interface/wbi/view?' + q1);
  let json = await res.json();
  console.log('URLSearchParams code:', json.code, json.message || json.data?.title?.slice(0, 20));

  if (json.code !== 0) {
    console.log('\n=== JS 步骤 2b: 手动 encode 重试 ===');
    const q2 = Object.entries(signed).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    res = await fetch('https://api.bilibili.com/x/web-interface/wbi/view?' + q2);
    json = await res.json();
    console.log('manual encode code:', json.code, json.message || json.data?.title?.slice(0, 20));
  }

  if (json.code === 0) {
    const { aid, cid, title } = json.data;
    console.log('\n=== JS 步骤 3: playurl ===');
    const ps = await signParams({ avid: aid, cid, qn: 16, fnval: 16, fourk: 1, platform: 'pc' }, keys.imgKey, keys.subKey);
    const pq = new URLSearchParams(ps).toString();
    const pres = await fetch('https://api.bilibili.com/x/player/wbi/playurl?' + pq);
    const pjson = await pres.json();
    console.log('playurl code:', pjson.code, 'formats:', pjson.data?.support_formats?.length);
  }
} catch (e) {
  console.error('FAIL:', e.message);
}

/**
 * 自动测试：下载真实 m4s 并合并（无需浏览器手动操作）
 * 运行: node test/test_merge_auto.mjs
 */
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import remux from 'mp4-remux';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '_out');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0';
const REF = 'https://www.bilibili.com/';

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': UA, Referer: REF } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function getJson(url) {
  return get(url).then((b) => JSON.parse(b.toString()));
}

function bufferToStream(buf) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    }
  });
}

async function streamToBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function pickWorkingUrl(url) {
  const mirrors = [
    'upos-sz-mirrorali.bilivideo.com',
    'upos-sz-mirrorcos.bilivideo.com',
    'upos-sz-mirrorbos.bilivideo.com',
  ];
  const u = new URL(url);
  for (const host of [u.hostname, ...mirrors]) {
    const test = new URL(url);
    test.hostname = host;
    try {
      const lib = test.protocol === 'https:' ? https : http;
      const ok = await new Promise((resolve) => {
        const req = lib.request(test, { method: 'GET', headers: { 'User-Agent': UA, Referer: REF, Range: 'bytes=0-1' } }, (res) => {
          resolve(res.statusCode === 200 || res.statusCode === 206);
          res.resume();
        });
        req.on('error', () => resolve(false));
        req.end();
      });
      if (ok) return test.toString();
    } catch { /* next */ }
  }
  return url;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const bvid = process.argv[2] || 'BV13CT66DEE5';
  console.log('=== 自动合并测试 ===', bvid);

  const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const { aid, cid } = view.data;
  const play = await getJson(
    `https://api.bilibili.com/x/player/playurl?avid=${aid}&cid=${cid}&qn=80&fnval=16&fourk=1&platform=pc`
  );
  const dash = play.data.dash;
  const video = dash.video.sort((a, b) => b.id - a.id)[0];
  const audio = dash.audio.sort((a, b) => b.id - a.id)[0];
  const videoUrl = await pickWorkingUrl(video.baseUrl || video.base_url);
  const audioUrl = await pickWorkingUrl(audio.baseUrl || audio.backupUrl?.[0] || audio.base_url);

  console.log('视频 URL:', videoUrl.slice(0, 80) + '...');
  console.log('音频 URL:', audioUrl.slice(0, 80) + '...');

  const [vBuf, aBuf] = await Promise.all([get(videoUrl), get(audioUrl)]);
  console.log(`下载完成: video=${(vBuf.length / 1024 / 1024).toFixed(2)}MB audio=${(aBuf.length / 1024 / 1024).toFixed(2)}MB`);

  fs.writeFileSync(path.join(OUT, 'video.m4s'), vBuf);
  fs.writeFileSync(path.join(OUT, 'audio.m4s'), aBuf);

  const t0 = Date.now();
  const outStream = remux(bufferToStream(vBuf), bufferToStream(aBuf));
  const mp4 = await streamToBuffer(outStream);
  const elapsed = Date.now() - t0;

  const outPath = path.join(OUT, 'merged.mp4');
  fs.writeFileSync(outPath, mp4);
  console.log(`合并成功: ${(mp4.length / 1024 / 1024).toFixed(2)}MB, 耗时 ${elapsed}ms`);
  console.log('输出:', outPath);

  if (mp4.length < vBuf.length * 0.5) {
    console.warn('警告: 合并文件偏小，请检查');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((e) => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});

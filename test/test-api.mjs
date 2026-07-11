// 步骤 2：验证 B 站 API 调用链（Node 环境，无 Cookie）
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

async function loadModule(relPath) {
  const code = readFileSync(join(__dir, relPath), 'utf8');
  const blob = new Blob([code], { type: 'text/javascript' });
  return import(URL.createObjectURL(blob));
}

const wbi = await loadModule('../lib/wbi.js');

console.log('\n=== 步骤 2：测试 B 站 nav 接口（获取 WBI 密钥）===');
try {
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav');
  const json = await res.json();
  console.log('nav code:', json.code, json.message || 'OK');
  const wbiImg = json.data?.wbi_img;
  if (wbiImg) {
    console.log('✅ 获取到 wbi_img');
    const imgKey = wbiImg.img_url.match(/\/([^/]+)\.\w+$/)?.[1];
    const subKey = wbiImg.sub_url.match(/\/([^/]+)\.\w+$/)?.[1];
    console.log('  img_key:', imgKey?.slice(0, 8) + '...');
    console.log('  sub_key:', subKey?.slice(0, 8) + '...');

    console.log('\n=== 步骤 3：测试视频信息接口 ===');
    const bvid = 'BV1GJ411x7h7'; // 经典测试视频
    const viewParams = await wbi.signParams({ bvid }, imgKey, subKey);
    const viewQuery = new URLSearchParams(viewParams).toString();
    const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/wbi/view?${viewQuery}`);
    const viewJson = await viewRes.json();
    console.log('view code:', viewJson.code, viewJson.message || viewJson.data?.title);

    if (viewJson.code !== 0) {
      console.log('❌ 视频信息获取失败，可能是 URLSearchParams 编码与签名不一致');
      // 尝试手动构建 query
      const manualQuery = Object.entries(viewParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      const viewRes2 = await fetch(`https://api.bilibili.com/x/web-interface/wbi/view?${manualQuery}`);
      const viewJson2 = await viewRes2.json();
      console.log('  重试 manual query code:', viewJson2.code, viewJson2.message || viewJson2.data?.title);
    } else {
      const { aid, cid, title } = viewJson.data;
      console.log('✅ 视频:', title);
      console.log('  aid:', aid, 'cid:', cid);

      console.log('\n=== 步骤 4：测试 playurl 接口 ===');
      const playParams = await wbi.signParams({
        avid: aid, cid, qn: 16, fnval: 16, fourk: 1, platform: 'pc'
      }, imgKey, subKey);
      const playQuery = new URLSearchParams(playParams).toString();
      const playRes = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${playQuery}`);
      const playJson = await playRes.json();
      console.log('playurl code:', playJson.code, playJson.message || 'OK');

      if (playJson.code === 0) {
        const data = playJson.data;
        console.log('✅ 播放地址获取成功');
        console.log('  support_formats:', data.support_formats?.length || 0, '种');
        console.log('  dash.video:', data.dash?.video?.length || 0, '条');
        console.log('  durl:', data.durl?.length || 0, '条');
        if (data.dash?.video?.[0]) {
          const v = data.dash.video[0];
          console.log('  示例视频流 URL:', (v.baseUrl || v.base_url)?.slice(0, 60) + '...');
        }
      } else {
        console.log('❌ playurl 失败');
      }
    }
  } else {
    console.log('❌ 未获取到 wbi_img');
  }
} catch (err) {
  console.error('❌ 请求异常:', err.message);
}

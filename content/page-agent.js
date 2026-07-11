/**
 * 页面上下文代理（MAIN world）
 * 在 B 站页面内发起请求，绕过扩展后台 fetch 的 CDN 403
 * 参考：BiliKit / bilibili-cdn-switcher 的 CDN 镜像替换思路
 */
(function () {
  'use strict';
  if (window.__BILI_DL_AGENT__) return;
  window.__BILI_DL_AGENT__ = true;

  const PANEL = 'bili-dl-panel';
  const AGENT = 'bili-dl-agent';

  const REFERER = 'https://www.bilibili.com/';
  // 社区常用镜像节点；签名与主机名无关，可替换（BiliKit / cdn-switcher 思路）
  const MIRRORS = [
    'upos-sz-mirrorali.bilivideo.com',
    'upos-sz-mirrorcos.bilivideo.com',
    'upos-sz-mirrorbos.bilivideo.com',
    'upos-sz-mirrorhw.bilivideo.com',
    'upos-sz-mirror08c.bilivideo.com',
    'upos-sz-mirrorhwo1.bilivideo.com'
  ];

  // playurl 常返回的节点，在扩展/脚本环境易 403，下载时跳过或置后
  const BAD_HOST_PATTERNS = [
    /akamaized/i,
    /estgoss/i,
    /mcdn\.bilibili\.cn/i,
    /data\.bilibili/i,
    /api\.bilibili/i
  ];

  const QUALITY_MAP = {
    127: '8K', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P',
    64: '720P', 32: '480P', 16: '360P', 6: '240P'
  };

  function reply(id, payload) {
    window.postMessage({ source: AGENT, id, ...payload }, '*');
  }

  function log(step, msg) {
    reply(null, { type: 'LOG', step, msg });
    console.log('[BiliDL-Agent]', step, msg);
  }

  function parseVideoId(href) {
    let path = '';
    try { path = new URL(href).pathname; } catch { path = href; }
    let m = path.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
    if (m) return { kind: 'bvid', value: m[1] };
    m = path.match(/\/video\/av(\d+)/i);
    if (m) return { kind: 'aid', value: m[1] };
    m = href.match(/(BV[a-zA-Z0-9]{10})/i);
    if (m) return { kind: 'bvid', value: m[1] };
    return null;
  }

  /** CDN 签名与主机名无关，可换镜像节点（B站社区共识） */
  function rewriteCdnUrl(url, mirrorHost) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('akamaized')) return null;
      if (u.pathname.startsWith('/v1/resource')) return null;
      if (/mcdn\.bilivideo\.cn/i.test(u.hostname)) return null;
      if (!u.hostname.includes('upos')) return null;
      u.hostname = mirrorHost;
      u.protocol = 'https:';
      return u.toString();
    } catch {
      return null;
    }
  }

  function isDownloadableCdnUrl(url) {
    try {
      const u = new URL(url);
      if (BAD_HOST_PATTERNS.some((re) => re.test(u.hostname))) return false;
      if (u.pathname.startsWith('/v1/resource')) return false;
      if (/mcdn\.bilivideo\.cn:\d+/i.test(u.host)) return false;
      return u.hostname.includes('upos') && u.hostname.includes('bilivideo');
    } catch {
      return false;
    }
  }

  function urlScore(url) {
    if (!url) return 0;
    if (/mirrorali|mirrorcos|mirrorbos/.test(url)) return 100;
    if (/upos-sz-mirror/.test(url)) return 95;
    if (/upos/.test(url) && !/estgoss/.test(url)) return 80;
    if (/upos/.test(url)) return 60;
    return 0;
  }

  function extractStreamUrls(item) {
    if (!item) return [];
    const urls = [];
    const main = item.baseUrl || item.base_url;
    if (main) urls.push(main);
    const backups = item.backupUrl || item.backup_url;
    if (Array.isArray(backups)) urls.push(...backups);
    else if (backups) urls.push(backups);
    return [...new Set(urls)].filter(isDownloadableCdnUrl)
      .sort((a, b) => urlScore(b) - urlScore(a));
  }

  function pickBestStreamUrl(item) {
    return extractStreamUrls(item)[0] || null;
  }

  function isBadHost(hostname) {
    return BAD_HOST_PATTERNS.some((re) => re.test(hostname || ''));
  }

  function buildCdnCandidates(url, preferHost) {
    const ordered = [];
    const seen = new Set();

    function push(u) {
      if (!u || seen.has(u)) return;
      seen.add(u);
      ordered.push(u);
    }

    // 1. 播放器实际在用的节点（嗅探）最可靠
    if (preferHost) {
      const preferred = rewriteCdnUrl(url, preferHost);
      push(preferred);
    }

    // 2. 已知可用镜像
    for (const host of MIRRORS) {
      push(rewriteCdnUrl(url, host));
    }

    // 3. 原始 URL 仅当不是高风险节点时才尝试
    try {
      const host = new URL(url).hostname;
      if (!isBadHost(host)) push(url);
    } catch { /* ignore */ }

    return ordered;
  }

  async function probeCdn(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        referrer: location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        headers: { Referer: REFERER, Range: 'bytes=0-1' },
        signal: controller.signal
      });
      return res.ok || res.status === 206;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function pickWorkingUrl(url, preferHost) {
    const candidates = buildCdnCandidates(url, preferHost);
    for (const u of candidates) {
      const host = new URL(u).hostname;
      log('探测', host);
      if (await probeCdn(u)) {
        log('探测', '可用 ' + host);
        return u;
      }
      log('探测', '不可用 ' + host);
    }
    return null;
  }

  async function apiGet(apiPath) {
    const res = await fetch('https://api.bilibili.com' + apiPath, {
      credentials: 'include',
      headers: { Referer: REFERER }
    });
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message || 'API code=' + json.code);
    return json.data;
  }

  async function resolveVideo(href, pageIndex) {
    const id = parseVideoId(href);
    if (!id) throw new Error('无法识别视频 URL');

    let data;
    if (id.kind === 'bvid') data = await apiGet('/x/web-interface/view?bvid=' + id.value);
    else data = await apiGet('/x/web-interface/view?aid=' + id.value);

    const pages = data.pages || [];
    const page = pages[pageIndex] || pages[0];
    const cid = page ? page.cid : data.cid;
    let title = data.title || 'video';
    if (pages.length > 1 && page) title += ` - P${page.page} ${page.part || ''}`;

    return {
      bvid: data.bvid,
      aid: String(data.aid),
      cid: String(cid),
      title: title.trim(),
      pages,
      pic: data.pic || '',
      author: data.owner?.name || data.staff || '',
      view: data.stat?.view ?? 0,
      pubdate: data.pubdate || 0
    };
  }

  async function getQualities(aid, cid) {
    const data = await apiGet(
      `/x/player/playurl?avid=${aid}&cid=${cid}&qn=80&fnval=16&fourk=1&platform=pc`
    );

    const dashIds = new Set();
    for (const v of data.dash?.video || []) {
      if (pickBestStreamUrl(v)) dashIds.add(v.id);
    }
    const maxDashQn = dashIds.size ? Math.max(...dashIds) : 0;

    const qualities = [];
    for (const fmt of data.support_formats || []) {
      const qn = fmt.quality;
      const inDash = dashIds.has(qn);
      const viaDurl = qn <= 64;
      // 无对应片源且无法走 durl 单文件 → 不展示（如虚假的 1080P/4K）
      if (!inDash && !viaDurl) continue;
      qualities.push({
        qn,
        label: fmt.new_description || QUALITY_MAP[qn] || qn + 'P',
        mode: viaDurl ? 'durl' : 'dash'
      });
    }

    if (!qualities.length && dashIds.size) {
      for (const qn of [...dashIds].sort((a, b) => b - a)) {
        qualities.push({ qn, label: QUALITY_MAP[qn] || qn + 'P', mode: qn <= 64 ? 'durl' : 'dash' });
      }
    }
    if (!qualities.length) {
      const d = await apiGet(`/x/player/playurl?avid=${aid}&cid=${cid}&qn=16&fnval=1&platform=pc`);
      for (const fmt of d.support_formats || []) {
        if (fmt.quality <= 64) {
          qualities.push({
            qn: fmt.quality,
            label: fmt.new_description || fmt.quality + 'P',
            mode: 'durl'
          });
        }
      }
    }

    return {
      qualities: qualities.sort((a, b) => b.qn - a.qn),
      maxQn: maxDashQn,
      maxLabel: QUALITY_MAP[maxDashQn] || (maxDashQn ? maxDashQn + 'P' : '')
    };
  }

  async function getStreams(aid, cid, qn) {
    // 720P 及以下优先 durl：单文件含音视频，无需拆轨合并
    if (qn <= 64) {
      try {
        const durl = await apiGet(
          `/x/player/playurl?avid=${aid}&cid=${cid}&qn=${qn}&fnval=1&platform=pc`
        );
        if (durl.durl?.length) {
          log('步骤3', `低清 ${qn}P 使用 durl 单文件 (${(durl.durl[0].size / 1024 / 1024).toFixed(1)}MB)`);
          return { type: 'durl', url: durl.durl[0].url };
        }
      } catch (e) {
        log('步骤3', 'durl 获取失败，回退 DASH: ' + e.message);
      }
    }

    try {
      const dash = await apiGet(
        `/x/player/playurl?avid=${aid}&cid=${cid}&qn=${qn}&fnval=16&fourk=1&platform=pc`
      );
      if (dash.dash?.video?.length) {
        const videos = dash.dash.video.filter((v) => v.id === qn);
        if (!videos.length) {
          const maxId = Math.max(...dash.dash.video.map((v) => v.id));
          throw new Error(`该视频无 ${QUALITY_MAP[qn] || qn + 'P'} 片源（源最高 ${QUALITY_MAP[maxId] || maxId + 'P'}）`);
        }
        const video = videos.sort((a, b) => urlScore(pickBestStreamUrl(b)) - urlScore(pickBestStreamUrl(a)))[0];
        const audio = (dash.dash.audio || []).sort((a, b) => b.id - a.id)[0]
          || dash.dash.flac?.[0];
        const videoUrl = pickBestStreamUrl(video);
        const audioUrl = audio ? pickBestStreamUrl(audio) : null;
        if (!videoUrl) throw new Error('无法解析视频 CDN 地址');
        log('步骤3', `DASH ${qn}P 视频=${hostFromUrl(videoUrl)} 音频=${audioUrl ? hostFromUrl(audioUrl) : '无'}`);
        return {
          type: 'dash',
          video: videoUrl,
          videoUrls: extractStreamUrls(video),
          audio: audioUrl,
          audioUrls: audio ? extractStreamUrls(audio) : []
        };
      }
    } catch (e) {
      log('步骤3', 'DASH 获取失败: ' + e.message);
    }

    const durl = await apiGet(
      `/x/player/playurl?avid=${aid}&cid=${cid}&qn=${qn}&fnval=1&platform=pc`
    );
    if (durl.durl?.length) return { type: 'durl', url: durl.durl[0].url };
    throw new Error('无法获取播放流');
  }

  /** 从页面已播放的资源中嗅探 CDN 地址（兜底） */
  function sniffPlayingUrls() {
    const entries = performance.getEntriesByType('resource') || [];
    const videos = [];
    const audios = [];
    for (const e of entries) {
      const u = e.name || '';
      if (!isDownloadableCdnUrl(u)) continue;
      if (u.includes('30280') || u.includes('30232') || u.includes('-30216')) audios.push(u);
      else if (u.includes('.m4s') || u.includes('.flv') || u.includes('upgcxcode')) videos.push(u);
    }
    return { video: videos.pop(), audio: audios.pop() };
  }

  function hostFromUrl(url) {
    try { return new URL(url).hostname; } catch { return null; }
  }

  async function pageDownload(urls, onProgress, preferHost) {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(isDownloadableCdnUrl);
    if (!list.length) throw new Error('无有效 CDN 地址');

    let lastErr;
    for (const src of list) {
      try {
        const working = await pickWorkingUrl(src, preferHost);
        if (!working) {
          lastErr = new Error('CDN 探测失败: ' + hostFromUrl(src));
          continue;
        }

        log('下载', '使用 ' + hostFromUrl(working));
        const res = await fetch(working, {
          credentials: 'include',
          referrer: location.href,
          referrerPolicy: 'strict-origin-when-cross-origin',
          headers: { Referer: REFERER }
        });
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status + ' (' + hostFromUrl(working) + ')');
          continue;
        }

        const total = parseInt(res.headers.get('content-length') || '0', 10);
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (onProgress) {
            onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : 0 });
          }
        }

        log('下载', '成功 ' + (received / 1024 / 1024).toFixed(1) + 'MB');
        if (received < 1024) {
          lastErr = new Error('下载内容为空');
          continue;
        }
        return new Blob(chunks);
      } catch (e) {
        lastErr = e;
        log('下载', '失败 ' + (e.message || e));
      }
    }
    throw lastErr || new Error('所有 CDN 镜像均不可用，请先播放几秒视频后重试');
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 5000);
  }

  async function mergeM4sInPage(videoBuffer, audioBuffer) {
    if (!videoBuffer?.byteLength) throw new Error('视频数据为空');
    if (!audioBuffer?.byteLength) throw new Error('音频数据为空');

    const totalMB = (videoBuffer.byteLength + audioBuffer.byteLength) / 1024 / 1024;
    if (totalMB > 1500) {
      throw new Error(`文件过大 (${totalMB.toFixed(0)}MB)，请选低清晰度`);
    }

    if (typeof window.mp4Remux !== 'function') {
      throw new Error('合并库未加载，请刷新页面重试');
    }
    if (!window.BiliM4sMux?.mergeM4s) {
      throw new Error('合并模块未加载，请刷新页面重试');
    }

    log('合并', `纯JS合并中 (${totalMB.toFixed(1)}MB)...`);
    const t0 = Date.now();
    const blob = await window.BiliM4sMux.mergeM4s(videoBuffer, audioBuffer, window.mp4Remux);
    log('合并', `完成 ${(blob.size / 1024 / 1024).toFixed(1)}MB (${Date.now() - t0}ms)`);
    return blob;
  }

  async function handleDownload(aid, cid, qn, title) {
    const base = (title || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    let streams = await getStreams(aid, cid, qn);

    if (streams.type === 'durl') {
      const sniffed = sniffPlayingUrls();
      const preferHost = hostFromUrl(sniffed.video);
      reply(null, { type: 'PROGRESS', phase: '下载视频', progress: 0 });
      const blob = await pageDownload(streams.url, (p) => {
        reply(null, { type: 'PROGRESS', phase: '下载中', progress: p.percent });
      }, preferHost);
      saveBlob(blob, base + '.mp4');
      return { dash: false };
    }

    const sniffed = sniffPlayingUrls();
    const preferHost = hostFromUrl(sniffed.video || sniffed.audio);
    let videoUrl = streams.video || sniffed.video;
    let audioUrl = streams.audio || sniffed.audio;
    const videoUrls = streams.videoUrls?.length
      ? streams.videoUrls
      : [videoUrl, sniffed.video].filter(Boolean);
    const audioUrls = streams.audioUrls?.length
      ? streams.audioUrls
      : [audioUrl, sniffed.audio].filter(Boolean);

    if (!videoUrl) throw new Error('无视频流，请先点击播放视频再下载');
    if (preferHost) log('步骤3', '嗅探到播放节点 ' + preferHost);

    reply(null, { type: 'PROGRESS', phase: '下载视频流', progress: 0 });
    const vBlob = await pageDownload(videoUrls, (p) => {
      reply(null, { type: 'PROGRESS', phase: `视频 ${p.percent}%`, progress: Math.floor(p.percent / 2) });
    }, preferHost);
    log('下载', `视频轨 ${(vBlob.size / 1024 / 1024).toFixed(1)}MB`);

    let aBlob = null;
    if (audioUrls.length) {
      reply(null, { type: 'PROGRESS', phase: '下载音频流', progress: 50 });
      try {
        aBlob = await pageDownload(audioUrls, (p) => {
          reply(null, { type: 'PROGRESS', phase: `音频 ${p.percent}%`, progress: 50 + Math.floor(p.percent / 2) });
        }, preferHost);
        if (aBlob.size < 1024) {
          log('下载', '音频流为空');
          aBlob = null;
        } else {
          log('下载', `音频轨 ${(aBlob.size / 1024 / 1024).toFixed(1)}MB`);
        }
      } catch (e) {
        log('下载', '音频下载失败: ' + e.message);
      }
    }

    if (aBlob) {
      reply(null, { type: 'PROGRESS', phase: '合并音视频', progress: 80 });
      const mp4Blob = await mergeM4sInPage(
        await vBlob.arrayBuffer(),
        await aBlob.arrayBuffer()
      );
      return {
        merged: true,
        filename: base + '.mp4',
        mp4: await mp4Blob.arrayBuffer()
      };
    }

    saveBlob(vBlob, base + '_video.m4s');
    return { dash: true, videoOnly: true };
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== PANEL) return;
    const { id, type } = e.data;

    try {
      switch (type) {
        case 'PARSE_URL':
          reply(id, { type: 'OK', data: { idInfo: parseVideoId(e.data.href) } });
          break;
        case 'RESOLVE_VIDEO':
          reply(id, { type: 'OK', data: { info: await resolveVideo(e.data.href, e.data.pageIndex || 0) } });
          break;
        case 'GET_QUALITIES':
          reply(id, { type: 'OK', data: await getQualities(e.data.aid, e.data.cid) });
          break;
        case 'START_DOWNLOAD': {
          const result = await handleDownload(e.data.aid, e.data.cid, e.data.qn, e.data.title);
          reply(id, { type: 'OK', data: result });
          break;
        }
        default:
          reply(id, { type: 'ERR', error: '未知请求: ' + type });
      }
    } catch (err) {
      reply(id, { type: 'ERR', error: err.message || String(err) });
    }
  });

  log('初始化', '页面代理已就绪 (MAIN world)');
})();

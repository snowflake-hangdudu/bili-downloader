/**
 * B站下载 — 页面内下载代理（MAIN world）
 */
(function () {
  'use strict';
  if (window.__BILI_DL_AGENT__) return;
  window.__BILI_DL_AGENT__ = true;

  const PANEL = 'bili-dl-panel';
  const AGENT = 'bili-dl-agent';

  const REFERER = 'https://www.bilibili.com/';
  // 常用镜像节点
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

  const PROBE_TIMEOUT_MS = 4000;
  const PROBE_PARALLEL = 3;
  /** 会话内缓存探测成功的镜像 hostname，同页后续下载优先复用 */
  const sessionMirrorCache = new Set();

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

  /** 换镜像节点 */
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
      // upos DASH 节点 + 低清 durl 的 cn-* 节点
      return /\.bilivideo\.(com|cn)$/i.test(u.hostname);
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
    if (/\.bilivideo\.(com|cn)/i.test(url)) return 50;
    return 0;
  }

  function extractDurlUrls(item) {
    if (!item) return [];
    const urls = [];
    if (item.url) urls.push(item.url);
    const backups = item.backup_url || item.backupUrl;
    if (Array.isArray(backups)) urls.push(...backups);
    else if (backups) urls.push(backups);
    return [...new Set(urls)].filter(isDownloadableCdnUrl)
      .sort((a, b) => urlScore(b) - urlScore(a));
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

  function rememberMirrorHost(url) {
    const host = hostFromUrl(url);
    if (host) sessionMirrorCache.add(host);
  }

  function prioritizeCandidates(candidates) {
    return [...candidates].sort((a, b) => {
      const ca = sessionMirrorCache.has(hostFromUrl(a)) ? 1 : 0;
      const cb = sessionMirrorCache.has(hostFromUrl(b)) ? 1 : 0;
      return cb - ca;
    });
  }

  async function probeCdn(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
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
    const candidates = prioritizeCandidates(buildCdnCandidates(url, preferHost));
    const tried = new Set();

    async function tryOne(u, tag) {
      if (!u || tried.has(u)) return null;
      tried.add(u);
      const host = hostFromUrl(u);
      log('探测', tag ? `${host} (${tag})` : host);
      if (await probeCdn(u)) {
        rememberMirrorHost(u);
        log('探测', '可用 ' + host);
        return u;
      }
      log('探测', '不可用 ' + host);
      return null;
    }

    if (preferHost) {
      const hit = await tryOne(rewriteCdnUrl(url, preferHost), '嗅探');
      if (hit) return hit;
    }

    for (const host of sessionMirrorCache) {
      const hit = await tryOne(rewriteCdnUrl(url, host), '缓存');
      if (hit) return hit;
    }

    const rest = candidates.filter((u) => !tried.has(u));
    for (let i = 0; i < rest.length; i += PROBE_PARALLEL) {
      const batch = rest.slice(i, i + PROBE_PARALLEL);
      const results = await Promise.all(batch.map((u) => tryOne(u, null)));
      const hit = results.find(Boolean);
      if (hit) return hit;
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
      pubdate: data.pubdate || 0,
      duration: page?.duration || data.duration || 0
    };
  }

  function isLoggedIn() {
    return /(?:^|;\s*)DedeUserID=\d+/i.test(document.cookie || '');
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function buildLoginHint(maxDashQn) {
    const loggedIn = isLoggedIn();
    if (!loggedIn && maxDashQn <= 64) {
      return '未登录时 B 站通常仅提供低清。登录并刷新页面后，可尝试更高清晰度';
    }
    if (!loggedIn && maxDashQn > 0 && maxDashQn < 80) {
      return '登录 B 站账号后，可能解锁 1080P 等更高清晰度（视视频与账号而定）';
    }
    if (loggedIn && maxDashQn > 0 && maxDashQn <= 64) {
      return '当前账号在该视频最高约 ' + (QUALITY_MAP[maxDashQn] || maxDashQn + 'P') + '，大会员可解锁更高（若片源支持）';
    }
    return null;
  }

  async function estimateDownloadSize(aid, cid, qn, durationSec) {
    const dur = Math.max(Number(durationSec) || 0, 1);

    if (qn <= 64) {
      try {
        const durl = await apiGet(
          `/x/player/playurl?avid=${aid}&cid=${cid}&qn=${qn}&fnval=1&platform=pc`
        );
        if (durl.durl?.[0]?.size) {
          const sizeBytes = durl.durl[0].size;
          return {
            sizeBytes,
            sizeLabel: formatSize(sizeBytes),
            estimateNote: '单文件含音视频'
          };
        }
      } catch { /* fallback to dash estimate */ }
    }

    try {
      const dash = await apiGet(
        `/x/player/playurl?avid=${aid}&cid=${cid}&qn=${qn}&fnval=16&fourk=1&platform=pc`
      );
      if (dash.dash?.video?.length) {
        const video = dash.dash.video.find((v) => v.id === qn) || dash.dash.video[0];
        const audio = (dash.dash.audio || []).sort((a, b) => b.id - a.id)[0];
        let bytes = 0;
        if (video?.bandwidth) bytes += (video.bandwidth * dur) / 8;
        if (audio?.bandwidth) bytes += (audio.bandwidth * dur) / 8;
        if (bytes > 0) {
          return {
            sizeBytes: Math.round(bytes),
            sizeLabel: formatSize(bytes),
            estimateNote: '约数，仅供参考'
          };
        }
      }
      if (dash.durl?.[0]?.size) {
        return {
          sizeBytes: dash.durl[0].size,
          sizeLabel: formatSize(dash.durl[0].size),
          estimateNote: null
        };
      }
    } catch { /* ignore */ }

    return { sizeBytes: 0, sizeLabel: '未知', estimateNote: null };
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
      maxLabel: QUALITY_MAP[maxDashQn] || (maxDashQn ? maxDashQn + 'P' : ''),
      loginHint: buildLoginHint(maxDashQn)
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
          const urls = extractDurlUrls(durl.durl[0]);
          if (urls.length) {
            log('步骤3', `低清 ${qn}P 使用 durl 单文件 (${(durl.durl[0].size / 1024 / 1024).toFixed(1)}MB)`);
            return { type: 'durl', urls };
          }
          log('步骤3', 'durl 地址不可用，回退 DASH');
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
    if (durl.durl?.length) {
      const urls = extractDurlUrls(durl.durl[0]);
      if (urls.length) return { type: 'durl', urls };
    }
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

  const dlCtrl = {
    paused: false,
    cancelled: false,
    abortController: null,
    controllers: {},
    trackProgress: {},
    pauseWait: null,
    lastProgress: null
  };

  function initDownloadControl() {
    dlCtrl.paused = false;
    dlCtrl.cancelled = false;
    dlCtrl.abortController = null;
    dlCtrl.controllers = {};
    dlCtrl.trackProgress = {};
    dlCtrl.pauseWait = null;
    dlCtrl.lastProgress = null;
  }

  function abortAllControllers() {
    Object.values(dlCtrl.controllers).forEach((c) => c?.abort());
    dlCtrl.abortController?.abort();
  }

  function combineTrackProgress() {
    let received = 0;
    let total = 0;
    for (const p of Object.values(dlCtrl.trackProgress)) {
      received += p.received || 0;
      total += p.total || 0;
    }
    return {
      received,
      total,
      percent: total ? Math.round((received / total) * 100) : 0
    };
  }

  function getDisplayProgress() {
    const vp = dlCtrl.trackProgress.video;
    if (vp?.total && vp.received < vp.total) {
      return {
        received: vp.received,
        total: vp.total,
        percent: Math.round((vp.received / vp.total) * 100)
      };
    }
    const ap = dlCtrl.trackProgress.audio;
    if (ap) {
      return {
        received: ap.received || 0,
        total: ap.total || 0,
        percent: ap.total ? Math.round((ap.received / ap.total) * 100) : 0
      };
    }
    return combineTrackProgress();
  }

  function pauseDownloadControl() {
    if (dlCtrl.cancelled || dlCtrl.paused) return;
    dlCtrl.paused = true;
    const p = getDisplayProgress();
    sendProgress('paused', p.percent || 0, { received: p.received, total: p.total });
    abortAllControllers();
  }

  function resumeDownloadControl() {
    if (dlCtrl.cancelled || !dlCtrl.paused) return;
    dlCtrl.paused = false;
    if (dlCtrl.pauseWait) {
      dlCtrl.pauseWait.resolve();
      dlCtrl.pauseWait = null;
    }
  }

  function cancelDownloadControl() {
    dlCtrl.cancelled = true;
    dlCtrl.paused = false;
    if (dlCtrl.pauseWait) {
      dlCtrl.pauseWait.resolve();
      dlCtrl.pauseWait = null;
    }
    abortAllControllers();
  }

  function waitWhilePaused() {
    if (!dlCtrl.paused || dlCtrl.cancelled) return Promise.resolve();
    return new Promise((resolve) => {
      dlCtrl.pauseWait = { resolve };
    });
  }

  function throwIfCancelled() {
    if (dlCtrl.cancelled) throw new Error('下载已取消');
  }

  function formatDownloadError(err) {
    const msg = err?.message || String(err);
    if (msg === '下载已取消') return msg;
    if (/合并库|合并模块|mp4-remux|BiliM4sMux|合并组件/.test(msg)) {
      return '请刷新页面后重试';
    }
    if (/无视频流|请先点击播放|请先播放/.test(msg)) {
      return '请先播放视频 5～10 秒，再点下载';
    }
    if (/文件过大/.test(msg)) {
      return '文件过大，请改选较低清晰度';
    }
    if (/403|CDN|镜像|探测|HTTP 4|所有 CDN|无有效 CDN/.test(msg)) {
      return '下载失败。请先播放 5～10 秒，或改选 720P 后重试';
    }
    if (/超时/.test(msg)) {
      return '请求超时，请刷新页面后重试';
    }
    return msg;
  }

  async function pageDownload(urls, onProgress, preferHost, trackId = 'default') {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(isDownloadableCdnUrl);
    if (!list.length) throw new Error('无有效 CDN 地址');

    let lastErr;
    for (const src of list) {
      let working = null;
      let chunks = [];
      let received = 0;
      let total = 0;

      try {
        working = await pickWorkingUrl(src, preferHost);
        if (!working) {
          lastErr = new Error('CDN 探测失败: ' + hostFromUrl(src));
          continue;
        }

        rememberMirrorHost(working);
        log('下载', '使用 ' + hostFromUrl(working));

        while (true) {
          throwIfCancelled();
          dlCtrl.abortController = new AbortController();
          dlCtrl.controllers[trackId] = dlCtrl.abortController;
          const headers = { Referer: REFERER };
          if (received > 0) headers.Range = `bytes=${received}-`;

          let res;
          try {
            res = await fetch(working, {
              credentials: 'include',
              referrer: location.href,
              referrerPolicy: 'strict-origin-when-cross-origin',
              headers,
              signal: dlCtrl.abortController.signal
            });
          } catch (e) {
            if (dlCtrl.cancelled) throw new Error('下载已取消');
            if (dlCtrl.paused) {
              await waitWhilePaused();
              throwIfCancelled();
              continue;
            }
            throw e;
          }

          if (!res.ok && !(received > 0 && res.status === 206)) {
            lastErr = new Error('HTTP ' + res.status + ' (' + hostFromUrl(working) + ')');
            break;
          }

          if (received === 0) {
            const contentRange = res.headers.get('content-range');
            if (contentRange) {
              const m = contentRange.match(/\/(\d+)\s*$/);
              if (m) total = parseInt(m[1], 10);
            }
            if (!total) total = parseInt(res.headers.get('content-length') || '0', 10);
          }

          const reader = res.body.getReader();
          let needResume = false;

          try {
            while (true) {
              throwIfCancelled();
              let readResult;
              try {
                readResult = await reader.read();
              } catch (e) {
                if (dlCtrl.cancelled) throw new Error('下载已取消');
                if (dlCtrl.paused) {
                  needResume = true;
                  break;
                }
                throw e;
              }

              const { done, value } = readResult;
              if (done) break;

              chunks.push(value);
              received += value.length;
              const progress = { received, total, percent: total ? Math.round((received / total) * 100) : 0 };
              dlCtrl.trackProgress[trackId] = progress;
              dlCtrl.lastProgress = progress;
              if (onProgress) onProgress(progress);
            }
          } finally {
            try { reader.releaseLock(); } catch { /* ignore */ }
          }

          if (needResume) {
            await waitWhilePaused();
            throwIfCancelled();
            continue;
          }

          log('下载', '成功 ' + (received / 1024 / 1024).toFixed(1) + 'MB');
          if (received < 1024) {
            lastErr = new Error('下载内容为空');
            break;
          }
          return new Blob(chunks);
        }
      } catch (e) {
        if (e.message === '下载已取消') throw e;
        lastErr = e;
        log('下载', '失败 ' + (e.message || e));
      }
    }
    throw new Error(formatDownloadError(lastErr || { message: '所有 CDN 镜像均不可用' }));
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

  async function mergeM4sInPage(videoBlob, audioBlob) {
    if (!videoBlob?.size) throw new Error('视频数据为空');
    if (!audioBlob?.size) throw new Error('音频数据为空');

    const totalMB = (videoBlob.size + audioBlob.size) / 1024 / 1024;
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
    const videoBuffer = await videoBlob.arrayBuffer();
    const audioBuffer = await audioBlob.arrayBuffer();
    const blob = await window.BiliM4sMux.mergeM4s(videoBuffer, audioBuffer, window.mp4Remux);
    log('合并', `完成 ${(blob.size / 1024 / 1024).toFixed(1)}MB (${Date.now() - t0}ms)`);
    return blob;
  }

  function sendProgress(step, percent, extra) {
    reply(null, { type: 'PROGRESS', step, percent, ...extra });
  }

  async function handleDownload(aid, cid, qn, title) {
    initDownloadControl();
    try {
    const base = (title || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    let streams = await getStreams(aid, cid, qn);

    if (streams.type === 'durl') {
      const urls = streams.urls || [];
      if (!urls.length) throw new Error('无有效 CDN 地址');
      const sniffed = sniffPlayingUrls();
      const preferHost = hostFromUrl(sniffed.video);
      sendProgress('download', 0);
      const blob = await pageDownload(urls, (p) => {
        sendProgress('download', p.percent, { received: p.received, total: p.total });
      }, preferHost);
      sendProgress('save', 100);
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

    const vTrack = { received: 0, total: 0, done: false };
    const aTrack = { received: 0, total: 0, done: false };
    const hasAudio = audioUrls.length > 0;

    /** 并行下载，但 UI 分阶段：先视频流，视频完成后再显示音频流 */
    function sendDashProgress() {
      const vPct = vTrack.total
        ? Math.min(100, Math.round((vTrack.received / vTrack.total) * 100))
        : 0;

      if (!vTrack.done) {
        sendProgress('video', vPct, { received: vTrack.received, total: vTrack.total });
        return;
      }
      if (hasAudio) {
        const aPct = aTrack.total
          ? Math.min(100, Math.round((aTrack.received / aTrack.total) * 100))
          : (aTrack.done ? 100 : 0);
        sendProgress('audio', aPct, { received: aTrack.received, total: aTrack.total });
      }
    }

    sendProgress('video', 0);

    const videoPromise = pageDownload(videoUrls, (p) => {
      Object.assign(vTrack, p);
      sendDashProgress();
    }, preferHost, 'video').then((blob) => {
      vTrack.done = true;
      sendDashProgress();
      return blob;
    });

    const audioPromise = hasAudio
      ? pageDownload(audioUrls, (p) => {
          Object.assign(aTrack, p);
          if (vTrack.done) sendDashProgress();
        }, preferHost, 'audio').then((blob) => {
          aTrack.done = true;
          if (vTrack.done) sendDashProgress();
          return blob;
        }).catch((e) => {
          if (e.message === '下载已取消') throw e;
          log('下载', '音频下载失败: ' + e.message);
          return null;
        })
      : Promise.resolve(null);

    const [vBlob, aBlobRaw] = await Promise.all([videoPromise, audioPromise]);
    log('下载', `视频轨 ${(vBlob.size / 1024 / 1024).toFixed(1)}MB`);

    let aBlob = aBlobRaw;
    if (aBlob && aBlob.size < 1024) {
      log('下载', '音频流为空');
      aBlob = null;
    } else if (aBlob) {
      log('下载', `音频轨 ${(aBlob.size / 1024 / 1024).toFixed(1)}MB`);
    }

    if (aBlob) {
      const mergeBytes = vBlob.size + aBlob.size;
      sendProgress('merge', 0, { received: mergeBytes, total: mergeBytes });
      const mp4Blob = await mergeM4sInPage(vBlob, aBlob);
      sendProgress('save', 100);
      return {
        merged: true,
        filename: base + '.mp4',
        blob: mp4Blob
      };
    }

    saveBlob(vBlob, base + '_video.m4s');
    return { dash: true, videoOnly: true };
    } finally {
      initDownloadControl();
    }
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
        case 'GET_ESTIMATE':
          reply(id, {
            type: 'OK',
            data: await estimateDownloadSize(
              e.data.aid,
              e.data.cid,
              e.data.qn,
              e.data.duration
            )
          });
          break;
        case 'START_DOWNLOAD': {
          const result = await handleDownload(e.data.aid, e.data.cid, e.data.qn, e.data.title);
          reply(id, { type: 'OK', data: result });
          break;
        }
        case 'PAUSE_DOWNLOAD':
          pauseDownloadControl();
          break;
        case 'RESUME_DOWNLOAD':
          resumeDownloadControl();
          break;
        case 'CANCEL_DOWNLOAD':
          cancelDownloadControl();
          break;
        default:
          reply(id, { type: 'ERR', error: '未知请求: ' + type });
      }
    } catch (err) {
      reply(id, { type: 'ERR', error: formatDownloadError(err) });
    }
  });

  log('初始化', '页面代理已就绪 (MAIN world)');
})();

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
  // 网络分片到达频率很高时，频繁跨 world 通信和重绘进度条会反过来占用主线程。
  // 仅节流展示，不节流 reader.read() 或网络读取；结束时始终立即上报。
  const PROGRESS_REPORT_INTERVAL_MS = 150;
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

  function isUposStylePath(url) {
    try {
      const u = new URL(url);
      return /upgcxcode|\.m4s($|\?)/i.test(u.pathname);
    } catch {
      return false;
    }
  }

  /** 换镜像节点。akamaized / mcdn 只要是标准 upos 路径，也可以改写到国内镜像 */
  function rewriteCdnUrl(url, mirrorHost) {
    try {
      const u = new URL(url);
      if (u.pathname.startsWith('/v1/resource')) return null;
      const host = u.hostname || '';
      const known = /upos|akamaized|mcdn\.bilivideo/i.test(host);
      if (!known && !isUposStylePath(url)) return null;
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

  /** 当前节点不可直连时，仍可拿来改写镜像 */
  function isRewriteableStreamUrl(url) {
    try {
      const u = new URL(url);
      if (u.pathname.startsWith('/v1/resource')) return false;
      if (!isUposStylePath(url) && !/upos/i.test(u.hostname || '')) return false;
      return /upos|akamaized|mcdn\.bilivideo|\.bilivideo\.(com|cn)$/i.test(u.hostname || '');
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

  function collectRawStreamUrls(item) {
    if (!item) return [];
    const urls = [];
    const main = item.baseUrl || item.base_url;
    if (main) urls.push(main);
    const backups = item.backupUrl || item.backup_url;
    if (Array.isArray(backups)) urls.push(...backups);
    else if (backups) urls.push(backups);
    return [...new Set(urls.filter(Boolean))];
  }

  function extractStreamUrls(item) {
    const raw = collectRawStreamUrls(item);
    const preferred = raw.filter(isDownloadableCdnUrl)
      .sort((a, b) => urlScore(b) - urlScore(a));
    if (preferred.length) return preferred;
    // 登录后常只给 akamaized / mcdn：先留下，后面改写到国内镜像
    return raw.filter(isRewriteableStreamUrl);
  }

  function asAudioList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value.baseUrl || value.base_url || value.backupUrl || value.backup_url) return [value];
    if (value.audio) return asAudioList(value.audio);
    return [];
  }

  /** dash.audio + flac.audio + dolby.audio，按音质 id 从高到低 */
  function collectAudioItems(dash) {
    const items = [
      ...asAudioList(dash?.audio),
      ...asAudioList(dash?.flac),
      ...asAudioList(dash?.dolby)
    ];
    const seen = new Set();
    const uniq = [];
    for (const item of items) {
      const key = String(item.id || item.baseUrl || item.base_url || '');
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      uniq.push(item);
    }
    return uniq.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  }

  function collectAudioUrls(dash) {
    const urls = [];
    const seen = new Set();
    for (const item of collectAudioItems(dash)) {
      for (const url of extractStreamUrls(item)) {
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
    return urls;
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

    // 3. 原始 URL：国内节点优先；akamaized 作为最后兜底（需 credentials omit）
    try {
      const host = new URL(url).hostname;
      if (!isBadHost(host) || /akamaized/i.test(host)) push(url);
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
        credentials: 'omit',
        referrer: location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        headers: { Range: 'bytes=0-1' },
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

  function normalizeListItem(item) {
    if (!item) return null;
    const bvid = String(item.bvid || item.bv_id || '').trim();
    const aid = String(item.aid || item.oid || item.id || '').trim();
    const firstPage = Array.isArray(item.pages) ? item.pages[0] : null;
    const cid = String(item.cid || firstPage?.cid || firstPage?.id || '').trim();
    if (!bvid || !aid || !cid) return null;
    return {
      bvid,
      aid,
      cid,
      title: String(item.title || '未命名视频'),
      cover: String(item.cover || ''),
      duration: Number(firstPage?.duration || item.duration || 0),
      views: String(item.views || item.cnt_info?.view_text_1 || item.cnt_info?.play || ''),
      pubtime: Number(item.pubtime || item.ctime || 0),
      sourceId: String(item.oid || item.id || aid)
    };
  }

  function getListContext() {
    const state = window.__INITIAL_STATE__ || {};
    const playlist = state.playlist || {};
    const type = Number(playlist.type);
    const bizId = String(playlist.id || '').trim();
    if (!type || !bizId) throw new Error('未识别到列表分页参数，请刷新 B 站页面后重试');
    return {
      type,
      bizId,
      tid: Number(state.tid) || 0,
      sortField: String(state.sortFiled ?? 1),
      desc: state.direction === true,
      total: Number(state.listTotal || state.mediaListInfo?.media_count || 0),
      title: String(state.mediaListInfo?.title || '视频列表'),
      cursor: state.cursor?.oid && state.cursor?.bvid
        ? { oid: String(state.cursor.oid), bvid: String(state.cursor.bvid) }
        : null
    };
  }

  function listApiPath(context, cursor) {
    const query = new URLSearchParams({
      out_referer: '',
      mobi_app: 'web',
      type: String(context.type),
      biz_id: context.bizId,
      ps: '20',
      desc: String(context.desc),
      sort_field: context.sortField,
      tid: String(context.tid),
      bvid: String(cursor?.bvid || ''),
      oid: String(cursor?.oid || ''),
      otype: '2',
      with_current: 'false',
      direction: 'true',
      preview: '0',
      use_pn: 'false',
      pn: '1',
      web_location: '333.1245'
    });
    return '/x/v2/medialist/resource/list?' + query.toString();
  }

  async function loadListPage(cursor) {
    const context = getListContext();
    const data = await apiGet(listApiPath(context, cursor || context.cursor));
    const rawItems = Array.isArray(data.media_list) ? data.media_list : [];
    const items = rawItems.map(normalizeListItem).filter(Boolean);
    const tail = rawItems[rawItems.length - 1];
    return {
      title: context.title,
      total: Number(data.total_count || context.total || items.length),
      items,
      hasMore: data.has_more === true,
      cursor: tail?.id && (tail.bv_id || tail.bvid)
        ? { oid: String(tail.id), bvid: String(tail.bv_id || tail.bvid) }
        : null
    };
  }

  function resolveList() {
    const state = window.__INITIAL_STATE__ || {};
    const resources = Array.isArray(state.resourceList) ? state.resourceList : [];
    const items = resources.map(normalizeListItem).filter(Boolean);
    const context = getListContext();
    const tail = resources[resources.length - 1];
    return {
      title: context.title,
      total: context.total || items.length,
      items,
      hasMore: true,
      cursor: tail?.oid && tail?.bvid
        ? { oid: String(tail.oid), bvid: String(tail.bvid) }
        : context.cursor
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
        const audio = collectAudioItems(dash.dash)[0];
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
        const audioUrls = collectAudioUrls(dash.dash);
        const videoUrl = pickBestStreamUrl(video);
        const audioUrl = audioUrls[0] || null;
        if (!videoUrl) throw new Error('无法解析视频 CDN 地址');
        log('步骤3', `DASH ${qn}P 视频=${hostFromUrl(videoUrl)} 音频=${audioUrl ? hostFromUrl(audioUrl) : '无'} (${audioUrls.length}路)`);
        return {
          type: 'dash',
          video: videoUrl,
          videoUrls: extractStreamUrls(video),
          audio: audioUrl,
          audioUrls
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

  function safeFilename(name, fallback) {
    const cleaned = (name || fallback || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const chars = Array.from(cleaned); // 按 Unicode 码点，避免截断 emoji/代理对
    return chars.length <= 80 ? cleaned : chars.slice(0, 80).join('');
  }

  /** 仅下载音频轨（DASH 音频即 AAC fMP4，可直接存为 .m4a） */
  async function getAudioStreams(aid, cid) {
    const dash = await apiGet(
      `/x/player/playurl?avid=${aid}&cid=${cid}&qn=80&fnval=16&fourk=1&platform=pc`
    );
    const streams = collectAudioItems(dash.dash).map((audio) => ({
      urls: extractStreamUrls(audio),
      id: audio.id,
      codecs: audio.codecs || ''
    })).filter((stream) => stream.urls.length);
    if (!streams.length) throw new Error('该视频无独立音频轨');
    return streams;
  }

  async function handleAudioOnly(aid, cid, title, jobId, filenameBase) {
    const session = createSession(jobId);
    try {
      if (session.cancelled) throw new Error('下载已取消');
      const base = safeFilename(filenameBase || title, 'audio');
      const streams = await getAudioStreams(aid, cid);
      const urls = [];
      const seen = new Set();
      for (const stream of streams) {
        for (const url of stream.urls) {
          if (seen.has(url)) continue;
          seen.add(url);
          urls.push(url);
        }
      }
      if (!urls.length) throw new Error('无法解析音频 CDN 地址');
      log('步骤3', `音频候选 ${streams.length} 档 / ${urls.length} 路`);
      const sniffed = sniffPlayingUrls();
      const preferHost = hostFromUrl(sniffed.audio || sniffed.video);
      sendProgress(session, 'audio', 0);
      const blob = await pageDownload(session, urls, (p) => {
        sendProgress(session, 'audio', p.percent, { received: p.received, total: p.total });
      }, preferHost, 'audio');
      sendProgress(session, 'save', 100);
      saveBlob(blob, base + '.m4a');
      return { audioOnly: true, filename: base + '.m4a', jobId: session.jobId };
    } finally {
      destroySession(session.jobId);
    }
  }

  /** 音频模式体积预估（仅音频轨带宽） */
  async function estimateAudioSize(aid, cid, durationSec) {
    const dur = Math.max(Number(durationSec) || 0, 1);
    try {
      const dash = await apiGet(
        `/x/player/playurl?avid=${aid}&cid=${cid}&qn=80&fnval=16&fourk=1&platform=pc`
      );
      const audio = collectAudioItems(dash.dash)[0];
      if (audio?.bandwidth) {
        const bytes = Math.round((audio.bandwidth * dur) / 8);
        return { sizeBytes: bytes, sizeLabel: formatSize(bytes), estimateNote: '约数，仅供参考' };
      }
    } catch { /* ignore */ }
    return { sizeBytes: 0, sizeLabel: '未知', estimateNote: null };
  }

  /** 从页面已播放的资源中嗅探 CDN 地址（兜底） */
  function sniffPlayingUrls() {
    const entries = performance.getEntriesByType('resource') || [];
    const videos = [];
    const audios = [];
    for (const e of entries) {
      const u = e.name || '';
      if (!isDownloadableCdnUrl(u)) continue;
      if (/[^\d]302\d{2}(?:[^\d]|$)/.test(u) || u.includes('-1-302')) audios.push(u);
      else if (u.includes('.m4s') || u.includes('.flv') || u.includes('upgcxcode')) videos.push(u);
    }
    return { video: videos.pop(), audio: audios.pop() };
  }

  function hostFromUrl(url) {
    try { return new URL(url).hostname; } catch { return null; }
  }

  /** 并行任务：每个 jobId 独立 session（暂停/取消互不影响） */
  const sessions = new Map();
  const cancelledBeforeStart = new Set();
  const mergeWaiters = new Map();
  let jobSeq = 0;

  function createSession(jobId) {
    const id = jobId || `job-${Date.now()}-${++jobSeq}`;
    const session = {
      jobId: id,
      paused: false,
      cancelled: cancelledBeforeStart.delete(id),
      abortController: null,
      controllers: {},
      trackProgress: {},
      progressReportAt: {},
      pauseWait: null,
      lastProgress: null
    };
    sessions.set(id, session);
    return session;
  }

  function destroySession(jobId) {
    const s = sessions.get(jobId);
    if (!s) return;
    Object.values(s.controllers).forEach((c) => c?.abort());
    s.abortController?.abort();
    sessions.delete(jobId);
    cancelledBeforeStart.delete(jobId);
    const waiter = mergeWaiters.get(jobId);
    if (waiter) {
      mergeWaiters.delete(jobId);
      waiter.reject(new Error('下载已取消'));
    }
  }

  function abortSessionControllers(session) {
    Object.values(session.controllers).forEach((c) => c?.abort());
    session.abortController?.abort();
  }

  function getDisplayProgress(session) {
    const vp = session.trackProgress.video;
    if (vp?.total && vp.received < vp.total) {
      return {
        received: vp.received,
        total: vp.total,
        percent: Math.round((vp.received / vp.total) * 100)
      };
    }
    const ap = session.trackProgress.audio;
    if (ap) {
      return {
        received: ap.received || 0,
        total: ap.total || 0,
        percent: ap.total ? Math.round((ap.received / ap.total) * 100) : 0
      };
    }
    let received = 0;
    let total = 0;
    for (const p of Object.values(session.trackProgress)) {
      received += p.received || 0;
      total += p.total || 0;
    }
    return {
      received,
      total,
      percent: total ? Math.round((received / total) * 100) : 0
    };
  }

  function pauseDownloadControl(jobId) {
    const targets = jobId ? [sessions.get(jobId)].filter(Boolean) : [...sessions.values()];
    for (const session of targets) {
      if (session.cancelled || session.paused) continue;
      session.paused = true;
      const p = getDisplayProgress(session);
      sendProgress(session, 'paused', p.percent || 0, { received: p.received, total: p.total });
      abortSessionControllers(session);
      window.postMessage({ source: AGENT, type: 'MERGE_CANCEL', jobId: session.jobId }, '*');
    }
  }

  function resumeDownloadControl(jobId) {
    const targets = jobId ? [sessions.get(jobId)].filter(Boolean) : [...sessions.values()];
    for (const session of targets) {
      if (session.cancelled || !session.paused) continue;
      session.paused = false;
      if (session.pauseWait) {
        session.pauseWait.resolve();
        session.pauseWait = null;
      }
    }
  }

  function cancelDownloadControl(jobId) {
    if (jobId && !sessions.has(jobId)) cancelledBeforeStart.add(jobId);
    const targets = jobId ? [sessions.get(jobId)].filter(Boolean) : [...sessions.values()];
    for (const session of targets) {
      session.cancelled = true;
      session.paused = false;
      if (session.pauseWait) {
        session.pauseWait.resolve();
        session.pauseWait = null;
      }
      abortSessionControllers(session);
    }
  }

  function waitWhilePaused(session) {
    if (!session.paused || session.cancelled) return Promise.resolve();
    return new Promise((resolve) => {
      session.pauseWait = { resolve };
    });
  }

  function throwIfCancelled(session) {
    if (session.cancelled) throw new Error('下载已取消');
  }

  function reportDownloadProgress(session, trackId, progress, onProgress, force = false) {
    session.trackProgress[trackId] = progress;
    session.lastProgress = progress;
    const now = performance.now();
    const last = session.progressReportAt[trackId] || 0;
    if (!force && now - last < PROGRESS_REPORT_INTERVAL_MS) return;
    session.progressReportAt[trackId] = now;
    onProgress?.(progress);
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
      return '文件较大，下载时电脑可能会卡住，仍可继续';
    }
    if (/403|CDN|镜像|探测|HTTP 4|所有 CDN|无有效 CDN/.test(msg)) {
      return '下载失败。请先播放 5～10 秒，或改选 720P 后重试';
    }
    if (/超时/.test(msg)) {
      return '请求超时，请刷新页面后重试';
    }
    return msg;
  }

  async function pageDownload(session, urls, onProgress, preferHost, trackId = 'default') {
    const list = (Array.isArray(urls) ? urls : [urls])
      .filter((u) => isDownloadableCdnUrl(u) || isRewriteableStreamUrl(u));
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
          throwIfCancelled(session);
          session.abortController = new AbortController();
          session.controllers[trackId] = session.abortController;
          const headers = {};
          if (received > 0) headers.Range = `bytes=${received}-`;

          let res;
          try {
            res = await fetch(working, {
              credentials: 'omit',
              referrer: location.href,
              referrerPolicy: 'strict-origin-when-cross-origin',
              headers,
              signal: session.abortController.signal
            });
          } catch (e) {
            if (session.cancelled) throw new Error('下载已取消');
            if (session.paused) {
              await waitWhilePaused(session);
              throwIfCancelled(session);
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
              throwIfCancelled(session);
              let readResult;
              try {
                readResult = await reader.read();
              } catch (e) {
                if (session.cancelled) throw new Error('下载已取消');
                if (session.paused) {
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
              reportDownloadProgress(session, trackId, progress, onProgress);
            }
          } finally {
            try { reader.releaseLock(); } catch { /* ignore */ }
          }

          if (needResume) {
            await waitWhilePaused(session);
            throwIfCancelled(session);
            continue;
          }

          reportDownloadProgress(session, trackId, { received, total, percent: total ? Math.round((received / total) * 100) : 0 }, onProgress, true);
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

  function mergeM4sInWorker(videoBlob, audioBlob, session) {
    if (session?.cancelled) return Promise.reject(new Error('下载已取消'));
    return new Promise((resolve, reject) => {
      const jobId = session?.jobId;
      if (!jobId) {
        reject(new Error('下载任务不存在'));
        return;
      }
      mergeWaiters.set(jobId, { resolve, reject });
      window.postMessage({
        source: AGENT,
        type: 'MERGE_REQUEST',
        jobId,
        videoBlob,
        audioBlob
      }, '*');
      // Blob 已由 postMessage 交给内容脚本/Worker；不在等待期间额外保留引用。
      videoBlob = null;
      audioBlob = null;
    });
  }

  async function mergeM4sFallback(videoBlob, audioBlob, session) {
    if (!videoBlob?.size) throw new Error('视频数据为空');
    if (!audioBlob?.size) throw new Error('音频数据为空');

    const totalMB = (videoBlob.size + audioBlob.size) / 1024 / 1024;

    if (typeof window.mp4Remux !== 'function') {
      throw new Error('合并库未加载，请刷新页面重试');
    }
    if (!window.BiliM4sMux?.mergeM4s) {
      throw new Error('合并模块未加载，请刷新页面重试');
    }

    log('合并', `纯JS合并中 (${totalMB.toFixed(1)}MB)...`);
    const t0 = Date.now();
    let mergedInputBytes = 0;
    let lastReportedBytes = 0;
    const mergeBytes = videoBlob.size + audioBlob.size;
    const reportEveryBytes = 16 * 1024 * 1024;
    const blob = await window.BiliM4sMux.mergeM4s(videoBlob, audioBlob, window.mp4Remux, {
      shouldCancel: () => Boolean(session?.cancelled),
      onChunk: (chunkBytes) => {
        mergedInputBytes = Math.min(mergeBytes, mergedInputBytes + chunkBytes);
        if (mergedInputBytes - lastReportedBytes < reportEveryBytes && mergedInputBytes < mergeBytes) return;
        lastReportedBytes = mergedInputBytes;
        if (session && !session.cancelled) sendProgress(session, 'merge', Math.round((mergedInputBytes / mergeBytes) * 100), {
          received: mergedInputBytes,
          total: mergeBytes
        });
      }
    });
    log('合并', `完成 ${(blob.size / 1024 / 1024).toFixed(1)}MB (${Date.now() - t0}ms)`);
    return blob;
  }

  async function mergeM4sInPage(videoBlob, audioBlob, session) {
    try {
      return await mergeM4sInWorker(videoBlob, audioBlob, session);
    } catch (error) {
      // Worker 被企业策略或页面环境阻止时，仍使用已分段、可取消的主线程实现兜底。
      if (!/^WORKER_UNAVAILABLE:/.test(String(error?.message || error))) throw error;
      log('合并', 'Worker 不可用，改用兼容合成模式');
      return mergeM4sFallback(videoBlob, audioBlob, session);
    }
  }

  function sendProgress(session, step, percent, extra) {
    reply(null, {
      type: 'PROGRESS',
      jobId: session?.jobId,
      step,
      percent,
      ...extra
    });
  }

  async function handleDownload(aid, cid, qn, title, jobId, filenameBase) {
    const session = createSession(jobId);
    try {
      if (session.cancelled) throw new Error('下载已取消');
      const base = safeFilename(filenameBase || title, 'video');
      let streams = await getStreams(aid, cid, qn);

      if (streams.type === 'durl') {
        const urls = streams.urls || [];
        if (!urls.length) throw new Error('无有效 CDN 地址');
        const sniffed = sniffPlayingUrls();
        const preferHost = hostFromUrl(sniffed.video);
        sendProgress(session, 'download', 0);
        const blob = await pageDownload(session, urls, (p) => {
          sendProgress(session, 'download', p.percent, { received: p.received, total: p.total });
        }, preferHost);
        sendProgress(session, 'save', 100);
        saveBlob(blob, base + '.mp4');
        return { dash: false, jobId: session.jobId };
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

      function sendDashProgress() {
        const vPct = vTrack.total
          ? Math.min(100, Math.round((vTrack.received / vTrack.total) * 100))
          : 0;

        if (!vTrack.done) {
          sendProgress(session, 'video', vPct, { received: vTrack.received, total: vTrack.total });
          return;
        }
        if (hasAudio) {
          const aPct = aTrack.total
            ? Math.min(100, Math.round((aTrack.received / aTrack.total) * 100))
            : (aTrack.done ? 100 : 0);
          sendProgress(session, 'audio', aPct, { received: aTrack.received, total: aTrack.total });
        }
      }

      sendProgress(session, 'video', 0);

      const videoPromise = pageDownload(session, videoUrls, (p) => {
        Object.assign(vTrack, p);
        sendDashProgress();
      }, preferHost, 'video').then((blob) => {
        vTrack.done = true;
        sendDashProgress();
        return blob;
      });

      const audioPromise = hasAudio
        ? pageDownload(session, audioUrls, (p) => {
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
        sendProgress(session, 'merge', 0, { received: 0, total: mergeBytes });
        const mp4Blob = await mergeM4sInPage(vBlob, aBlob, session);
        sendProgress(session, 'save', 100);
        return {
          merged: true,
          filename: base + '.mp4',
          blob: mp4Blob,
          jobId: session.jobId
        };
      }

      saveBlob(vBlob, base + '_video.m4s');
      return { dash: true, videoOnly: true, jobId: session.jobId };
    } finally {
      destroySession(session.jobId);
    }
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== PANEL) return;
    const { id, type } = e.data;

    if (type === 'MERGE_RESULT') {
      const jobId = e.data.jobId;
      const waiter = mergeWaiters.get(jobId);
      if (!waiter) return;
      mergeWaiters.delete(jobId);
      if (e.data.error) waiter.reject(new Error(e.data.error));
      else waiter.resolve(e.data.blob);
      return;
    }

    try {
      switch (type) {
        case 'PARSE_URL':
          reply(id, { type: 'OK', data: { idInfo: parseVideoId(e.data.href) } });
          break;
        case 'RESOLVE_VIDEO':
          reply(id, { type: 'OK', data: { info: await resolveVideo(e.data.href, e.data.pageIndex || 0) } });
          break;
        case 'RESOLVE_LIST':
          reply(id, { type: 'OK', data: resolveList() });
          break;
        case 'LOAD_LIST_PAGE':
          reply(id, { type: 'OK', data: await loadListPage(e.data.cursor) });
          break;
        case 'GET_QUALITIES':
          reply(id, { type: 'OK', data: await getQualities(e.data.aid, e.data.cid) });
          break;
        case 'GET_ESTIMATE':
          reply(id, {
            type: 'OK',
            data: e.data.audioOnly
              ? await estimateAudioSize(e.data.aid, e.data.cid, e.data.duration)
              : await estimateDownloadSize(
                  e.data.aid,
                  e.data.cid,
                  e.data.qn,
                  e.data.duration
                )
          });
          break;
        case 'START_DOWNLOAD': {
          const jobId = e.data.jobId || null;
          const result = e.data.audioOnly
            ? await handleAudioOnly(e.data.aid, e.data.cid, e.data.title, jobId, e.data.filenameBase)
            : await handleDownload(e.data.aid, e.data.cid, e.data.qn, e.data.title, jobId, e.data.filenameBase);
          reply(id, { type: 'OK', data: result });
          break;
        }
        case 'PAUSE_DOWNLOAD':
          pauseDownloadControl(e.data.jobId || null);
          break;
        case 'RESUME_DOWNLOAD':
          resumeDownloadControl(e.data.jobId || null);
          break;
        case 'CANCEL_DOWNLOAD':
          cancelDownloadControl(e.data.jobId || null);
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

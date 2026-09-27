(function () {
  'use strict';

  if (window.__BILI_DL_INIT__) return;
  window.__BILI_DL_INIT__ = true;
  const EXT = typeof browser !== 'undefined' ? browser : chrome;

  const PANEL = 'bili-dl-panel';
  const AGENT = 'bili-dl-agent';
  const VERSION = EXT.runtime.getManifest().version;
  function isSpacePage() {
    return location.hostname === 'space.bilibili.com' && /^\/\d+\/?(?:upload\/video\/?)?$/.test(location.pathname);
  }
  function chooseSpaceQuality(available, tier) {
    // Bilibili's 112 / 116 are also 1080P (+ / 60fps); 120 starts at 4K.
    const cap = tier === 'highest' ? Infinity : tier === '720' ? 64 : 116;
    return available.filter((quality) => Number(quality.qn) > 0 && Number(quality.qn) <= cap)
      .sort((a, b) => Number(b.qn) - Number(a.qn))[0];
  }
  // 图标资源缓存破坏：换图标后递增 ICON_REV，避免只 F5 仍显示旧图
  const ICON_REV = '27';
  const ICON_URL = EXT.runtime.getURL(`icons/icon128.png?r=${ICON_REV}`);
  const FAQ_URL = 'https://snowflake-hangdudu.github.io/bili-downloader/faq.html';
  const PRIVACY_URL = 'https://snowflake-hangdudu.github.io/bili-downloader/';
  const CONFIG_BASE_URL = 'http://124.222.62.190:8081';
  const CONTENT_JSON_URL = `${CONFIG_BASE_URL}/api/config/bilibili`;
  const FEATURE_FLAGS_URL = `${CONFIG_BASE_URL}/api/feature-flags`;
  const PLUGINS_JSON_URL = `${CONFIG_BASE_URL}/api/plugins`;
  const CONTENT_CACHE_KEY = 'biliDlRemoteContent_v1';
  const PLUGIN_CATALOG_CACHE_KEY = 'biliDlPluginCatalog_v2';
  const FEEDBACK_EMAIL = 'hangdudu0@agent.qq.com';
  const DOWNLOAD_PREFS_KEY = 'biliDlDownloadPrefs_v1';
  const THEME_PREF_KEY = 'biliDlTheme_v1';
  const CONTENT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  // @pack:remote-debug-refresh -- release packers replace true with false.
  const REMOTE_CATALOG_DEBUG_REFRESH = true;
  const REMOTE_CONTENT_DEBUG_REFRESH = true;
  const DEFAULT_REMOTE_CONTENT = {
    notice: { enabled: true, title: '公告', updated: '', body: '暂未获取到最新公告，请稍后再试。\n\n下载功能不受影响。' },
    coop: { enabled: true, title: '开发合作', updated: '', body: '接浏览器插件定制开发。\n\n有合作意向请联系 QQ：748604487\n邮箱：hangdudu0@agent.qq.com\n请备注「插件开发」，并简单说明需求。' },
    rating: { enabled: false, url: '', minSuccess: 3 }
  };
  const STORE_RATING_KEY = 'biliDlStoreRating';
  const STORE_RATING_MIN_SUCCESS = 3;
  // 文案与 youtube-downloader 保持一致；仅评分状态随版本重置

  async function copyTextToClipboard(text) {
    const value = String(text ?? '');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch {
      // Content script may lack transient focus; fall back below.
    }
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:8px;top:8px;width:12px;height:12px;opacity:0.02;z-index:2147483647';
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('execCommand copy failed');
  }

  let muxReadyPromise = null;
  const MERGE_WORKER_URL = EXT.runtime.getURL('lib/m4s-mux-worker.js');
  let mergeWorkerSourcePromise = null;
  function loadMergeWorkerSource() {
    if (!mergeWorkerSourcePromise) {
      mergeWorkerSourcePromise = Promise.all([
        'lib/mp4-remux.iife.js', 'lib/m4s-mux.js', 'lib/m4s-mux-worker.js'
      ].map(async (path) => {
        const response = await fetch(EXT.runtime.getURL(path));
        if (!response.ok) throw new Error('合成组件读取失败: ' + path);
        return response.text();
      })).then((sources) => sources.join('\n;\n')).catch((error) => {
        mergeWorkerSourcePromise = null;
        throw error;
      });
    }
    return mergeWorkerSourcePromise;
  }
  const LARGE_MERGE_BYTES = 512 * 1024 * 1024;
  const MAX_SMALL_MERGE_WORKERS = 2;
  const mergeWorkerQueue = [];
  const activeMergeWorkers = new Map();
  let acceptsMergeRequest = () => false;

  function isLargeMerge(job) {
    if (job?.mode && job.mode !== 'dash') return false;
    return Number(job?.totalBytes || 0) >= LARGE_MERGE_BYTES;
  }

  function postMergeResult(job, payload) {
    window.postMessage({ source: PANEL, type: 'MERGE_RESULT', jobId: job.jobId, ...payload }, '*');
  }

  function finishMergeWorkerJob(job, payload) {
    if (!job || job.finished) return;
    job.finished = true;
    clearTimeout(job.startTimer);
    clearTimeout(job.stallTimer);
    try { job.worker?.terminate(); } catch { /* ignore */ }
    if (job.workerUrl) URL.revokeObjectURL(job.workerUrl);
    job.videoBlob = null;
    job.audioBlob = null;
    activeMergeWorkers.delete(job.jobId);
    const queuedIndex = mergeWorkerQueue.indexOf(job);
    if (queuedIndex >= 0) mergeWorkerQueue.splice(queuedIndex, 1);
    postMergeResult(job, payload);
    drainMergeWorkerQueue();
  }

  function canStartMergeWorker(job) {
    const active = [...activeMergeWorkers.values()];
    if (!active.length) return true;
    // 大文件独占合成通道：不限制文件大小，只避免多个大 MP4 同时争用内存与 CPU。
    if (isLargeMerge(job) || active.some(isLargeMerge)) return false;
    return active.length < MAX_SMALL_MERGE_WORKERS;
  }

  async function runMergeWorker(job) {
    // Reserve the slot before loading scripts so pending starts obey the limit.
    activeMergeWorkers.set(job.jobId, job);
    let worker;
    try {
      // A content script still creates workers with the document's origin.
      // Bundle only packaged scripts into a same-origin Blob instead of trying
      // to construct a cross-origin chrome-extension:// worker.
      const source = await loadMergeWorkerSource();
      if (job.finished) return;
      job.workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(job.workerUrl);
    } catch (error) {
      finishMergeWorkerJob(job, { error: `WORKER_UNAVAILABLE: ${error?.message || error}` });
      return;
    }
    job.worker = worker;
    activeMergeWorkers.set(job.jobId, job);
    const armStallWatchdog = () => {
      clearTimeout(job.stallTimer);
      job.stallTimer = setTimeout(() => finishMergeWorkerJob(job, { error: '合成长期无进展，已停止并释放资源，请重试' }), 180000);
    };
    job.startTimer = setTimeout(() => {
      if (!job.ready) finishMergeWorkerJob(job, { error: 'WORKER_UNAVAILABLE: 合成 Worker 启动超时' });
    }, 8000);

    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'READY') {
        job.ready = true;
        clearTimeout(job.startTimer);
        armStallWatchdog();
        try {
          worker.postMessage({ type: 'MERGE', jobId: job.jobId, videoBlob: job.videoBlob, audioBlob: job.audioBlob });
          // 发送给 Worker 后不再保留页面侧引用，降低内容脚本的峰值内存。
          job.videoBlob = null;
          job.audioBlob = null;
        } catch (error) {
          finishMergeWorkerJob(job, { error: `WORKER_UNAVAILABLE: ${error?.message || error}` });
        }
        return;
      }
      if (data.type === 'PROGRESS') {
        armStallWatchdog();
        updateProgress?.('merge', 0, data.received, data.total, job.jobId, {
          elapsedMs: data.elapsedMs,
          etaMs: data.etaMs
        });
        return;
      }
      if (data.type === 'DONE') {
        finishMergeWorkerJob(job, { blob: data.blob });
        return;
      }
      if (data.type === 'ERROR') finishMergeWorkerJob(job, { error: data.error || '合并失败' });
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      const prefix = job.ready ? '' : 'WORKER_UNAVAILABLE: ';
      finishMergeWorkerJob(job, { error: prefix + (event.message || '合成 Worker 发生错误') });
    };
  }

  function drainMergeWorkerQueue() {
    for (const job of [...mergeWorkerQueue]) {
      if (!canStartMergeWorker(job)) break;
      const index = mergeWorkerQueue.indexOf(job);
      if (index >= 0) mergeWorkerQueue.splice(index, 1);
      runMergeWorker(job);
    }
  }

  function requestWorkerMerge(data) {
    const jobId = String(data?.jobId || '');
    if (!jobId || !data?.videoBlob?.size || !data?.audioBlob?.size) return;
    if (!acceptsMergeRequest(jobId) || activeMergeWorkers.has(jobId) || mergeWorkerQueue.some((job) => job.jobId === jobId)) return;
    const job = {
      jobId,
      videoBlob: data.videoBlob,
      audioBlob: data.audioBlob,
      totalBytes: Number(data.videoBlob.size) + Number(data.audioBlob.size),
      worker: null,
      ready: false,
      finished: false,
      startTimer: null
    };
    mergeWorkerQueue.push(job);
    if (!canStartMergeWorker(job)) {
      updateProgress?.('merge', 0, 0, job.totalBytes, jobId, { queued: true });
    }
    drainMergeWorkerQueue();
  }

  function cancelWorkerMerge(jobId, notify = true) {
    const queued = mergeWorkerQueue.find((job) => job.jobId === jobId);
    const active = activeMergeWorkers.get(jobId);
    const job = queued || active;
    if (!job) return false;
    try { job.worker?.postMessage({ type: 'CANCEL', jobId }); } catch { /* ignore */ }
    finishMergeWorkerJob(job, notify ? { error: '下载已取消' } : { error: '下载已取消' });
    return true;
  }

  function createFragment(html) {
    return document.createRange().createContextualFragment(html);
  }

  function clearNode(node) {
    node.replaceChildren();
  }

  function appendTextElement(parent, tagName, className, text, title) {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = text;
    if (title) el.title = title;
    parent.appendChild(el);
    return el;
  }

  function setupMuxInPage() {
    if (muxReadyPromise) return muxReadyPromise;
    const base = EXT.runtime.getURL('lib/');
    const loadScript = (file) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base + file;
      const timer = setTimeout(() => { s.remove(); reject(new Error('合成组件加载超时: ' + file)); }, 10000);
      s.onload = () => { clearTimeout(timer); resolve(); };
      s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('合成组件加载失败: ' + file)); };
      (document.documentElement || document.head).appendChild(s);
    });
    muxReadyPromise = loadScript('mp4-remux.iife.js').then(() => loadScript('m4s-mux.js')).catch((error) => {
      muxReadyPromise = null;
      throw error;
    });
    return muxReadyPromise;
  }

  async function downloadBlob(blob, filename, shouldCancel = () => false) {
    if (shouldCancel()) throw new Error('下载已取消');
    if (!blob?.size || !filename) throw new Error('保存数据不可用，请刷新页面后重试');
    const extension = /\.(mp4|m4a)$/i.exec(filename)?.[1]?.toLowerCase();
    if (!extension) throw new Error('保存文件格式无效，请重新选择 MP4 或 M4A');
    // Direct CDN downloads may have an empty or text MIME type. Give the
    // browser an explicit media type without decoding or copying all bytes.
    const mediaType = extension === 'm4a' ? 'audio/mp4' : 'video/mp4';
    const mediaBlob = blob.type === mediaType ? blob : blob.slice(0, blob.size, mediaType);
    const url = URL.createObjectURL(mediaBlob);
    // Firefox keeps page Blob URLs scoped to the page principal. Let the page
    // initiate this local save instead of asking the extension background to
    // re-open the Blob URL with a different principal.
    // Content scripts cannot access runtime.getBrowserInfo() in Firefox.
    // The Firefox packer adds browser_specific_settings.gecko to its manifest,
    // and runtime.getManifest() is available in content scripts on both targets.
    const isFirefox = Boolean(EXT.runtime.getManifest()?.browser_specific_settings?.gecko);
    if (isFirefox) {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.documentElement.appendChild(link);
      try {
        if (shouldCancel()) throw new Error('下载已取消');
        link.click();
        return null;
      } finally {
        link.remove();
        // The browser needs a short turn to attach the local Blob to its save.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
    let downloadId;
    try {
      const started = await EXT.runtime.sendMessage({ type: 'BILI_DL_SAVE_MEDIA', url, filename });
      if (!started?.ok) throw new Error(started?.error || '无法创建浏览器下载');
      downloadId = started.downloadId;
      let lastBytes = -1;
      let lastProgressAt = Date.now();
      for (;;) {
        if (shouldCancel()) {
          await EXT.runtime.sendMessage({ type: 'BILI_DL_CANCEL_MEDIA', downloadId });
          throw new Error('下载已取消');
        }
        const result = await EXT.runtime.sendMessage({ type: 'BILI_DL_MEDIA_STATE', downloadId });
        if (!result?.ok) throw new Error(result?.error || '无法确认保存结果，请检查浏览器下载记录');
        if (result.state === 'complete') return downloadId;
        if (result.state === 'interrupted') throw new Error('浏览器保存失败：' + (result.error || '下载中断'));
        if (Number(result.bytesReceived || 0) !== lastBytes) {
          lastBytes = Number(result.bytesReceived || 0);
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt > 180000) {
          await EXT.runtime.sendMessage({ type: 'BILI_DL_CANCEL_MEDIA', downloadId });
          throw new Error('浏览器保存长时间无进展，已停止；请检查磁盘空间和浏览器下载记录');
        }
        // Poll only while a native save is active; no idle/background-page polling.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function formatView(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(v);
  }

  function formatTime(ts) {
    if (!ts) return '';
    const diff = Math.max(0, Date.now() - ts * 1000);
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + '分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + '小时前';
    const d = Math.floor(h / 24);
    if (d < 30) return d + '天前';
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + '个月前';
    return Math.floor(mo / 12) + '年前';
  }

  let videoInfo = null;
  let qualities = [];
  let selectedQn = 0;
  let selectedFormat = 'mp4'; // 'mp4' | 'm4a'
  let listDownloadKind = 'video'; // video | audio | both
  let qualityStrategy = 'exact'; // exact | highest
  // Selects among Bilibili's existing streams of the same resolution; never re-encodes.
  const streamPreference = 'high-bitrate';
  let filenameTemplate = (globalThis.BiliDlSettings && globalThis.BiliDlSettings.DEFAULTS.filenameTemplate) || '{title}';
  let pageIndex = 0;
  let isOpen = false;
  let reqId = 0;
  const pending = new Map();

  let downloading = false;
  let queueRunning = false;
  let queueCancelled = false;
  let queuePaused = false;
  let queuePauseWaiter = null;

  const HISTORY_KEY = 'biliDlHistory';
  const HISTORY_MAX = 50;

  function sameHistoryPart(a, b) {
    if (a?.cid && b?.cid) return a.cid === b.cid;
    if (a?.bvid && b?.bvid) {
      return a.bvid === b.bvid && (a.pageIndex ?? 0) === (b.pageIndex ?? 0);
    }
    return false;
  }

  function historyPartKey(h) {
    if (h?.cid) return `c:${h.cid}`;
    return `b:${h?.bvid || ''}#${h?.pageIndex ?? 0}`;
  }

  /** 同集同格式只留最新一条；MP4 与故意下的 M4A 可并列 */
  function pruneHistoryItems(items) {
    const kept = [];
    const seen = new Set();
    for (const h of (items || []).filter(Boolean)) {
      const fmt = h.format === 'm4a' ? 'm4a' : (h.format === 'mp4-video' ? 'mp4-video' : 'mp4');
      const dedupeKey = `${historyPartKey(h)}|${fmt}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      kept.push(h);
    }
    return kept;
  }

  async function loadHistory() {
    try {
      const { [HISTORY_KEY]: items } = await EXT.storage.local.get(HISTORY_KEY);
      return pruneHistoryItems(Array.isArray(items) ? items : []);
    } catch {
      return [];
    }
  }

  async function addHistory(entry) {
    try {
      const items = await loadHistory();
      const fmt = entry.format === 'm4a' ? 'm4a' : 'mp4';
      // 仅去掉「同集 + 同格式」旧记录；MP4 与 M4A 互不覆盖
      let next = items.filter((h) => {
        if (!sameHistoryPart(h, entry)) return true;
        const hFmt = h.format === 'm4a' ? 'm4a' : 'mp4';
        return hFmt !== fmt;
      });
      next.unshift(entry);
      next = pruneHistoryItems(next).slice(0, HISTORY_MAX);
      await EXT.storage.local.set({ [HISTORY_KEY]: next });
      return next;
    } catch { return null; }
  }

  /** B 站 view API：pages.length > 1 且每 P 有 cid 才是真·多 P */
  function isMultiPartVideo(pages) {
    return Array.isArray(pages) && pages.length > 1 && pages.every((p) => p && p.cid);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== AGENT) return;
    const { id, type, step, msg, data, error } = e.data;

    if (type === 'MERGE_REQUEST') {
      requestWorkerMerge(e.data);
      return;
    }
    if (type === 'MERGE_CANCEL') {
      cancelWorkerMerge(e.data.jobId);
      return;
    }

    if (type === 'LOG') {
      if (typeof debugLog === 'function') debugLog(step, msg);
      return;
    }
    if (type === 'PROGRESS') {
      if (typeof updateProgress === 'function') {
        updateProgress(
          e.data.step,
          e.data.percent,
          e.data.received,
          e.data.total,
          e.data.jobId,
          e.data
        );
      }
      return;
    }

    if (id && pending.has(id)) {
      const { resolve, reject } = pending.get(id);
      pending.delete(id);
      if (type === 'OK') resolve(data);
      else reject(new Error(error || '请求失败'));
    }
  });

  /** 轻请求超时 20s（接口卡死时快速报错）；下载等长任务由调用方传 timeout 覆盖 */
  function agentCall(type, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = 'req-' + (++reqId);
      pending.set(id, { resolve, reject });
      window.postMessage({ source: PANEL, id, type, ...payload }, '*');
      // 下载与合成没有固定时长上限；传 0 时只由用户取消或页面卸载结束。
      const limit = timeoutMs === 0 ? 0 : (Number(timeoutMs) > 0 ? timeoutMs : 20000);
      if (limit > 0) {
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('页面代理超时，请刷新页面重试'));
          }
        }, limit);
      }
    });
  }

  function agentSignal(type, extra = {}) {
    window.postMessage({ source: PANEL, type, ...extra }, '*');
  }

  let debugLog = (step, msg) => console.log('[BiliDL]', step, msg);
  let showStatus, updateProgress;

  function mountUI() {
    if (document.getElementById('bili-dl-panel-root')) return;

    const panel = document.createElement('div');
    panel.id = 'bili-dl-panel-root';
    panel.appendChild(createFragment(`
      <div id="bili-dl-panel" data-theme="bilibili">
        <button id="bili-dl-toggle" title="打开下载助手" aria-label="打开下载助手" aria-expanded="false">
          <img src="${ICON_URL}" alt="">
        </button>
        <div id="bili-dl-menu" class="hidden">
          <div class="bili-dl-header">
            <div class="bili-dl-header-left">
              <img class="bili-dl-header-icon" src="${ICON_URL}" alt="" width="22" height="22">
              <span class="bili-dl-title">B站视频下载助手</span>
              <span class="bili-dl-version">v${VERSION}</span>
            </div>
            <button id="bili-dl-close" aria-label="关闭">&times;</button>
          </div>
          <div id="bili-dl-home">
          <div id="bili-dl-mode-tabs" class="bili-dl-mode-tabs hidden" role="tablist" aria-label="下载模式">
            <button type="button" data-mode="video" class="active" role="tab" aria-selected="true">单视频</button>
            <button type="button" data-mode="list" role="tab" aria-selected="false">列表下载</button>
          </div>
          <div id="bili-dl-video-body" class="bili-dl-body">
            <div id="bili-dl-video-card" class="bili-dl-video-card">
              <div class="bili-dl-cover-column">
                <div class="bili-dl-cover-wrap">
                  <div id="bili-dl-cover-sk" class="bili-dl-sk-cover bili-dl-shimmer"></div>
                  <img id="bili-dl-cover" class="bili-dl-cover hidden" alt="">
                  <div id="bili-dl-cover-ph" class="bili-dl-cover-ph hidden">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                </div>
                <button id="bili-dl-download-cover" type="button" class="bili-dl-cover-download" disabled>下载封面</button>
              </div>
              <div class="bili-dl-video-meta">
                <div id="bili-dl-video-sk" class="bili-dl-video-sk">
                  <span class="bili-dl-sk-line bili-dl-shimmer"></span>
                  <span class="bili-dl-sk-line bili-dl-shimmer short"></span>
                  <span class="bili-dl-sk-line bili-dl-shimmer shorter"></span>
                </div>
                <div id="bili-dl-video-content" class="bili-dl-video-content hidden">
                  <div id="bili-dl-video-title" class="bili-dl-video-title"></div>
                  <div id="bili-dl-video-author" class="bili-dl-video-author hidden"></div>
                  <div id="bili-dl-video-sub" class="bili-dl-video-sub"></div>
                </div>
              </div>
            </div>

            <div id="bili-dl-pages" class="bili-dl-pages hidden"></div>

            <div class="bili-dl-section">
              <div class="bili-dl-section-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                清晰度
              </div>
              <div id="bili-dl-quality-pills" class="bili-dl-quality-pills">
                <span class="bili-dl-pill loading">加载中</span>
              </div>
              <label class="bili-dl-quality-strategy-row">清晰度策略
                <select id="bili-dl-quality-strategy" aria-label="单视频清晰度策略">
                  <option value="exact">使用所选清晰度</option>
                  <option value="highest">始终最高可用</option>
                </select>
              </label>
            </div>

            <div id="bili-dl-format-row" class="bili-dl-format-row bili-dl-section">
              <div class="bili-dl-section-head bili-dl-format-label">格式</div>
              <div id="bili-dl-format-pills" class="bili-dl-format-pills">
                <button type="button" class="bili-dl-pill active" data-format="mp4">MP4 视频</button>
                <button type="button" class="bili-dl-pill" data-format="m4a">M4A 音频</button>
              </div>
            </div>
            <label class="bili-dl-stream-preference-row">视频质量
              <select id="bili-dl-stream-preference" aria-label="视频流选择偏好" title="仅在同一清晰度的原始视频流之间选择">
                <option value="high-bitrate">高码率优先（推荐）</option>
                <option value="compatible">兼容优先</option>
              </select>
            </label>
            <p id="bili-dl-filename-preview" class="bili-dl-filename-preview" aria-live="polite"></p>

            <div id="bili-dl-estimate" class="bili-dl-estimate hidden">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              <span id="bili-dl-estimate-text">预计大小 —</span>
            </div>

            <button id="bili-dl-start" class="bili-dl-btn" disabled>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
              开始下载
            </button>
            <button id="bili-dl-queue-all" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
              <span id="bili-dl-queue-label">队列下载全部分 P</span>
            </button>
            <div id="bili-dl-video-job-panel" class="bili-dl-job-panel hidden">
              <div id="bili-dl-job-list" class="bili-dl-job-list"></div>
              <div id="bili-dl-queue-actions" class="bili-dl-job-panel-queue hidden">
                <button id="bili-dl-queue-pause" type="button" class="bili-dl-action-btn">暂停全部</button>
                <button id="bili-dl-queue-cancel" type="button" class="bili-dl-action-btn danger">取消整队</button>
              </div>
            </div>
            <div id="bili-dl-status" class="bili-dl-status hidden"></div>
          </div>
          <div id="bili-dl-list-body" class="bili-dl-list-body hidden">
            <div id="bili-dl-space-profile" class="bili-dl-space-profile hidden"></div>
            <div class="bili-dl-section">
              <div class="bili-dl-section-head">清晰度</div>
              <div id="bili-dl-list-quality-pills" class="bili-dl-quality-pills">
                <span class="bili-dl-pill loading">加载中</span>
              </div>
              <label class="bili-dl-quality-strategy-row">清晰度策略
                <select id="bili-dl-list-quality-strategy" aria-label="列表下载清晰度策略">
                  <option value="exact">使用所选清晰度</option>
                  <option value="highest">始终最高可用</option>
                </select>
              </label>
            </div>
            <div id="bili-dl-list-download-kind-row" class="bili-dl-list-download-kind-row" role="group" aria-label="列表下载内容">
              <div class="bili-dl-section-head">下载内容</div>
              <div id="bili-dl-list-download-kind" class="bili-dl-list-download-kind">
                <button type="button" class="active" data-list-download-kind="video">仅视频</button>
                <button type="button" data-list-download-kind="audio">仅音频</button>
                <button type="button" data-list-download-kind="both">视频+音频</button>
              </div>
            </div>
            <label class="bili-dl-stream-preference-row">视频质量
              <select id="bili-dl-list-stream-preference" aria-label="列表视频流选择偏好" title="仅在同一清晰度的原始视频流之间选择">
                <option value="high-bitrate">高码率优先（推荐）</option>
                <option value="compatible">兼容优先</option>
              </select>
            </label>
            <div class="bili-dl-list-tools" role="search">
              <input id="bili-dl-list-search" type="search" maxlength="80" placeholder="搜索已加载视频标题" aria-label="搜索已加载视频标题">
              <div class="bili-dl-list-filter" role="group" aria-label="列表筛选">
                <button id="bili-dl-list-refresh-page" type="button" class="bili-dl-list-refresh-page hidden" title="只读取 B 站当前页显示的投稿">刷新当前页</button>
                <span id="bili-dl-list-filter-sep" class="bili-dl-list-filter-sep hidden" aria-hidden="true">|</span>
                <button type="button" data-list-filter="all" class="active">全部</button>
                <button type="button" data-list-filter="selected">已选</button>
              </div>
              <select id="bili-dl-list-sort" aria-label="列表排序">
                <option value="default">默认</option>
                <option value="newest">最新</option>
                <option value="oldest">最早</option>
              </select>
            </div>
            <div id="bili-dl-list-head" class="bili-dl-list-head">
              <div class="bili-dl-list-heading"><strong id="bili-dl-list-title">视频列表</strong><span id="bili-dl-list-count"></span></div>
              <button id="bili-dl-list-select-all" type="button" title="选择当前已加载的所有视频">全选</button>
            </div>
            <div id="bili-dl-list-items" class="bili-dl-list-items"></div>
            <button id="bili-dl-list-load-more" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">继续加载</button>
            <button id="bili-dl-list-start" type="button" class="bili-dl-btn" disabled>下载已选视频</button>
            <div id="bili-dl-list-job-panel" class="bili-dl-job-panel hidden">
              <div id="bili-dl-list-job-list" class="bili-dl-job-list"></div>
              <div id="bili-dl-list-queue-actions" class="bili-dl-job-panel-queue hidden">
                <button id="bili-dl-list-queue-pause" type="button" class="bili-dl-action-btn">暂停全部</button>
                <button id="bili-dl-list-queue-cancel" type="button" class="bili-dl-action-btn danger">取消整队</button>
              </div>
            </div>
            <div id="bili-dl-list-result" class="bili-dl-list-result hidden">
              <p id="bili-dl-list-status" class="bili-dl-list-status" aria-live="polite"></p>
              <button id="bili-dl-list-retry-failed" type="button" class="bili-dl-list-retry hidden">重试未完成</button>
            </div>
          </div>
          <div id="bili-dl-store-rating" class="bili-dl-store-rating hidden" role="note" aria-live="polite">
            <p class="bili-dl-store-rating-title">下载搞定 ⭐ 给个好评呗</p>
            <p class="bili-dl-store-rating-text">用着顺手的话，去 Edge 商店点个分，对我们很有帮助。当然不评也完全没问题。</p>
            <button type="button" class="bili-dl-store-rating-primary" data-action="rate">去 Edge 商店评分 ⭐</button>
            <div class="bili-dl-store-rating-actions">
              <button type="button" class="bili-dl-store-rating-ghost" data-action="later">下次再说</button>
              <span class="bili-dl-store-rating-sep" aria-hidden="true">·</span>
              <button type="button" class="bili-dl-store-rating-ghost" data-action="never">别再问了</button>
            </div>
          </div>
          <div class="bili-dl-footer">
            <div class="bili-dl-footer-links">
              <button type="button" class="bili-dl-footer-link bili-dl-footer-plugins" data-sheet="plugins" title="相关插件">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                相关插件
              </button>
              <button type="button" class="bili-dl-footer-link bili-dl-footer-notice" data-sheet="notice" title="公告">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h1l6 4V6L5 10H4a1 1 0 0 0-1 1z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>
                公告
              </button>
              <button type="button" class="bili-dl-footer-link" data-sheet="diagnostics">诊断日志</button>
              <button type="button" class="bili-dl-footer-link" data-sheet="tasks">任务中心</button>
            </div>
            <div class="bili-dl-footer-meta">
              <button type="button" class="bili-dl-footer-action" data-sheet="settings" title="设置">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/></svg>
                设置
              </button>
              <button type="button" class="bili-dl-footer-action bili-dl-feedback" title="点击复制反馈邮箱 hangdudu0@agent.qq.com" aria-label="复制反馈邮箱">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span class="bili-dl-feedback-label">反馈</span>
              </button>
              <button type="button" class="bili-dl-footer-action" data-sheet="donate" title="自愿赞赏">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>
                赞赏
              </button>
            </div>
          </div>
          </div>
          <div id="bili-dl-page" class="bili-dl-page hidden">
            <button type="button" id="bili-dl-page-back" class="bili-dl-page-back">返回下载</button>
            <h3 id="bili-dl-info-title" class="bili-dl-page-title"></h3>
            <p id="bili-dl-info-date" class="bili-dl-info-date hidden"></p>
            <div id="bili-dl-info-body" class="bili-dl-info-body"></div>
          </div>
        </div>
      </div>
    `));
    document.body.appendChild(panel);

    const themedPanel = panel.querySelector('#bili-dl-panel');
    document.addEventListener('pointerdown', (event) => {
      const themeControl = panel.querySelector('.bili-dl-settings-theme-control');
      if (!themeControl || themeControl.contains(event.target)) return;
      const themeOptions = themeControl.querySelector('.bili-dl-settings-theme-options');
      const themeTrigger = themeControl.querySelector('.bili-dl-settings-theme-trigger');
      themeOptions?.classList.add('hidden');
      themeTrigger?.setAttribute('aria-expanded', 'false');
    });
    function applyTheme(value) {
      const theme = ['tokyo-love', 'manchester-sea', 'chinese-odyssey'].includes(value) ? value : 'bilibili';
      themedPanel.dataset.theme = theme;
      const themeControl = panel.querySelector('.bili-dl-settings-theme-control');
      if (themeControl) {
        const selectedOption = themeControl.querySelector(`[data-theme-option="${theme}"]`);
        const currentLabel = themeControl.querySelector('.bili-dl-settings-theme-current-label');
        const currentSwatch = themeControl.querySelector('.bili-dl-settings-theme-current-swatch');
        if (selectedOption && currentLabel && currentSwatch) {
          currentLabel.textContent = selectedOption.dataset.label;
          currentSwatch.dataset.theme = theme;
        }
        themeControl.querySelectorAll('[data-theme-option]').forEach((option) => {
          option.setAttribute('aria-selected', String(option.dataset.themeOption === theme));
        });
      }
    }

    const toggleBtn = panel.querySelector('#bili-dl-toggle');
    const menu = panel.querySelector('#bili-dl-menu');
    const closeBtn = panel.querySelector('#bili-dl-close');
    const modeTabsEl = panel.querySelector('#bili-dl-mode-tabs');
    const videoBodyEl = panel.querySelector('#bili-dl-video-body');
    const listBodyEl = panel.querySelector('#bili-dl-list-body');
    const listHeadEl = panel.querySelector('#bili-dl-list-head');
    const listTitleEl = panel.querySelector('#bili-dl-list-title');
    const listCountEl = panel.querySelector('#bili-dl-list-count');
    const listSelectAllBtn = panel.querySelector('#bili-dl-list-select-all');
    const listItemsEl = panel.querySelector('#bili-dl-list-items');
    const listSearchEl = panel.querySelector('#bili-dl-list-search');
    const listFilterEl = panel.querySelector('.bili-dl-list-filter');
    const listRefreshPageBtn = panel.querySelector('#bili-dl-list-refresh-page');
    const listFilterSepEl = panel.querySelector('#bili-dl-list-filter-sep');
    const listSortEl = panel.querySelector('#bili-dl-list-sort');
    const listLoadMoreBtn = panel.querySelector('#bili-dl-list-load-more');
    const listStartBtn = panel.querySelector('#bili-dl-list-start');
    const listPillsEl = panel.querySelector('#bili-dl-list-quality-pills');
    const listQualitySection = listPillsEl?.closest('.bili-dl-section');
    const listDownloadKindEl = panel.querySelector('#bili-dl-list-download-kind');
    const listJobPanelEl = panel.querySelector('#bili-dl-list-job-panel');
    const listQueuePauseBtn = panel.querySelector('#bili-dl-list-queue-pause');
    const listQueueCancelBtn = panel.querySelector('#bili-dl-list-queue-cancel');
    const listQueueActionsEl = panel.querySelector('#bili-dl-list-queue-actions');
    const listJobListEl = panel.querySelector('#bili-dl-list-job-list');
    const listRetryFailedBtn = panel.querySelector('#bili-dl-list-retry-failed');
    const listResultEl = panel.querySelector('#bili-dl-list-result');
    const listStatusEl = panel.querySelector('#bili-dl-list-status');
    const videoCard = panel.querySelector('#bili-dl-video-card');
    const coverSk = panel.querySelector('#bili-dl-cover-sk');
    const coverImg = panel.querySelector('#bili-dl-cover');
    const coverPh = panel.querySelector('#bili-dl-cover-ph');
    const videoSk = panel.querySelector('#bili-dl-video-sk');
    const videoContent = panel.querySelector('#bili-dl-video-content');
    const titleEl = panel.querySelector('#bili-dl-video-title');
    const authorEl = panel.querySelector('#bili-dl-video-author');
    const subEl = panel.querySelector('#bili-dl-video-sub');
    const pagesEl = panel.querySelector('#bili-dl-pages');
    const pillsEl = panel.querySelector('#bili-dl-quality-pills');
    const qualitySection = pillsEl?.closest('.bili-dl-section');
    const qualityStrategyEls = [
      panel.querySelector('#bili-dl-quality-strategy'),
      panel.querySelector('#bili-dl-list-quality-strategy')
    ].filter(Boolean);
    const streamPreferenceEls = [
      panel.querySelector('#bili-dl-stream-preference'),
      panel.querySelector('#bili-dl-list-stream-preference')
    ].filter(Boolean);
    const formatPillsEl = panel.querySelector('#bili-dl-format-pills');
    const formatRowEl = panel.querySelector('#bili-dl-format-row');
    const filenamePreviewEl = panel.querySelector('#bili-dl-filename-preview');
    const estimateEl = panel.querySelector('#bili-dl-estimate');
    const estimateText = panel.querySelector('#bili-dl-estimate-text');
    // 预估大小来自异步接口。用递增编号忽略旧响应，避免切换页签后旧响应再把区域撑开。
    let estimateRequestId = 0;
    let currentEstimateBytes = 0;
    const startBtn = panel.querySelector('#bili-dl-start');
    const coverDownloadBtn = panel.querySelector('#bili-dl-download-cover');
    const queueBtn = panel.querySelector('#bili-dl-queue-all');
    const queuePauseBtn = panel.querySelector('#bili-dl-queue-pause');
    const queueCancelBtn = panel.querySelector('#bili-dl-queue-cancel');
    const queueActionsEl = panel.querySelector('#bili-dl-queue-actions');
    const queueLabelEl = panel.querySelector('#bili-dl-queue-label');
    const videoJobPanelEl = panel.querySelector('#bili-dl-video-job-panel');
    const jobListEl = panel.querySelector('#bili-dl-job-list');
    const statusEl = panel.querySelector('#bili-dl-status');
    const storeRatingEl = panel.querySelector('#bili-dl-store-rating');
    const homeEl = panel.querySelector('#bili-dl-home');
    const pageEl = panel.querySelector('#bili-dl-page');
    const pageBack = panel.querySelector('#bili-dl-page-back');
    const infoTitle = panel.querySelector('#bili-dl-info-title');
    const infoDate = panel.querySelector('#bili-dl-info-date');
    const infoBody = panel.querySelector('#bili-dl-info-body');
    const defaultStartBtnNodes = Array.from(startBtn.childNodes).map((node) => node.cloneNode(true));
    let listItems = [];
    let spaceQualityTier = 'highest';
    let listTotal = 0;
    let collectionHref = '';
    let selectedListBvids = new Set();
    let listLoaded = false;
    let listCursor = null;
    let listHasMore = false;
    let listLoading = false;
    let listQuery = '';
    let listFilter = 'all';
    let listSort = 'default';
    let lastListFailures = [];
    let activeMode = 'video';
    let operationMode = null;
    const debugEntries = [];
    const taskHistory = [];

    function redactDiagnosticText(value) {
      return String(value || '')
        .replace(/https?:\/\/[^\s]+/gi, (url) => {
          try {
            const parsed = new URL(url);
            return `${parsed.origin}/[地址已隐藏]`;
          } catch { return '[地址已隐藏]'; }
        })
        .replace(/((?:SESSDATA|bili_jct|access_token|token|w_rid|sign)=)[^\s&]+/gi, '$1[已隐藏]');
    }

    debugLog = (step, msg) => {
      const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), step: redactDiagnosticText(step), msg: redactDiagnosticText(msg) };
      debugEntries.push(entry);
      if (debugEntries.length > 100) debugEntries.splice(0, debugEntries.length - 100);
      console.log('[BiliDL]', entry.step, entry.msg);
    };

    function recordTask(job) {
      if (!job || job.recorded || ![TASK_STATE.completed, TASK_STATE.failed, TASK_STATE.cancelled].includes(job.state)) return;
      job.recorded = true;
      const finishedAt = Date.now();
      const { cardEl, blob, mp4, ...metadata } = job;
      taskHistory.unshift({ ...metadata, info: { ...job.info }, phaseTimes: { ...job.phaseTimes }, finishedAt, elapsedMs: finishedAt - job.createdAt });
      if (taskHistory.length > 50) taskHistory.length = 50;
    }

    function formatTaskTimings(job) {
      const started = Number(job?.createdAt) || Date.now();
      const entries = Object.entries(job?.phaseTimes || {})
        .map(([phase, at]) => [phase, Math.max(0, Math.round((Number(at) - started) / 1000))])
        .sort((a, b) => a[1] - b[1]);
      return entries.length ? entries.map(([phase, seconds]) => `${phase} +${seconds}s`).join(' · ') : '未记录阶段耗时';
    }

    async function openBrowserDownloads() {
      const result = await EXT.runtime.sendMessage({ type: 'BILI_DL_OPEN_DOWNLOADS' }).catch(() => null);
      if (!result?.ok) debugLog('任务中心', `打开下载内容失败：${result?.error || '浏览器拒绝请求'}`);
    }

    function restoreStartButtonContent() {
      startBtn.replaceChildren(...defaultStartBtnNodes.map((node) => node.cloneNode(true)));
    }

    let remoteContent = { ...DEFAULT_REMOTE_CONTENT };
    let remoteContentLoadPromise = null;
    let relatedPlugins = [];
    let pluginCatalogLoaded = false;
    let pluginCatalogLoadPromise = null;
    const pluginIconLoadCache = new Map();
    const toLines = (value) => Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : String(value || '').split(/\n+/).map((item) => item.trim()).filter(Boolean);
    function fillPlainBody(el, text) { clearNode(el); toLines(text).forEach((line) => appendTextElement(el, 'p', '', line)); }
    function appendNoticeSection(el, title, value) { const lines = toLines(value); if (!lines.length) return; const section = document.createElement('section'); section.className = 'bili-dl-notice-section'; appendTextElement(section, 'h4', 'bili-dl-notice-section-title', title); const list = document.createElement('ul'); list.className = 'bili-dl-notice-list'; lines.forEach((line) => appendTextElement(list, 'li', '', line)); section.appendChild(list); el.appendChild(section); }
    function appendCoopSection(el, coop) {
      if (coop?.enabled === false) return;
      const lines = toLines(coop?.body);
      if (!lines.length) return;
      const section = document.createElement('section');
      section.className = 'bili-dl-notice-section bili-dl-notice-coop';
      const title = String(coop?.title || '开发合作').trim() || '开发合作';
      appendTextElement(section, 'h4', 'bili-dl-notice-section-title', title);
      lines.forEach((line) => appendTextElement(section, 'p', 'bili-dl-notice-coop-line', line));
      el.appendChild(section);
    }
    function fillNoticeBody(el, notice, coop) {
      clearNode(el);
      const roadmap = notice?.roadmap && typeof notice.roadmap === 'object' ? notice.roadmap : {};
      const structured = ['pinned', 'recent', 'knownIssues'].some((key) => toLines(notice?.[key]).length) || ['feedback', 'upcoming', 'planned'].some((key) => toLines(roadmap[key]).length);
      if (!structured) fillPlainBody(el, notice?.body || '暂无新公告');
      else {
        appendNoticeSection(el, '置顶说明', notice.pinned);
        appendNoticeSection(el, '最近更新', notice.recent);
        appendNoticeSection(el, '已知问题', notice.knownIssues);
        const plans = [['征集中', roadmap.feedback], ['即将更新', roadmap.upcoming], ['计划中', roadmap.planned]];
        if (plans.some(([, value]) => toLines(value).length)) {
          const section = document.createElement('section');
          section.className = 'bili-dl-notice-section';
          appendTextElement(section, 'h4', 'bili-dl-notice-section-title', '开发计划');
          plans.forEach(([label, value]) => {
            const lines = toLines(value);
            if (!lines.length) return;
            const group = document.createElement('div');
            group.className = 'bili-dl-notice-plan';
            appendTextElement(group, 'strong', 'bili-dl-notice-plan-label', label);
            const list = document.createElement('ul');
            list.className = 'bili-dl-notice-list';
            lines.forEach((line) => appendTextElement(list, 'li', '', line));
            group.appendChild(list);
            section.appendChild(group);
          });
          el.appendChild(section);
        }
      }
      appendCoopSection(el, coop);
    }
    function mergeRemoteContent(data) { return { notice: { ...DEFAULT_REMOTE_CONTENT.notice, ...(data.notice || {}) }, coop: { ...DEFAULT_REMOTE_CONTENT.coop, ...(data.coop || {}) }, rating: { ...DEFAULT_REMOTE_CONTENT.rating, ...(data.rating || {}) } }; }
    function detectBrowserStore() {
      const ua = navigator.userAgent || '';
      if (EXT.runtime.getManifest()?.browser_specific_settings?.gecko || /\bFirefox\//i.test(ua)) return 'firefox';
      if (/\bEdg(?:A|iOS)?\//i.test(ua)) return 'edge';
      return 'chrome';
    }
    function httpsUrl(value) {
      const url = String(value || '').trim();
      return /^https:\/\//i.test(url) ? url : '';
    }
    function ratingUrl() {
      const rating = remoteContent.rating || {};
      const key = detectBrowserStore();
      return httpsUrl(rating[key]) || httpsUrl(rating.url);
    }
    function pluginStoreUrl(plugin) {
      const directUrl = httpsUrl(plugin?.stores?.[detectBrowserStore()]);
      return directUrl ? { url: directUrl, label: '前往安装' } : null;
    }
    function pluginIconUrl(plugin) {
      try {
        const url = new URL(String(plugin?.iconUrl || ''));
        const base = new URL(CONFIG_BASE_URL);
        return url.origin === base.origin && url.pathname.startsWith('/assets/') ? url.href : '';
      } catch {
        return '';
      }
    }
    function loadPluginIcon(iconUrl) {
      if (!iconUrl) return Promise.resolve('');
      if (!pluginIconLoadCache.has(iconUrl)) {
        const request = EXT.runtime.sendMessage({ type: 'BILI_DL_FETCH_ASSET', url: iconUrl })
          .then((response) => response?.ok && typeof response.dataUrl === 'string' ? response.dataUrl : '')
          .catch(() => '');
        pluginIconLoadCache.set(iconUrl, request);
      }
      return pluginIconLoadCache.get(iconUrl);
    }
    function ratingEnabled() {
      const rating = remoteContent.rating || {};
      return rating.enabled === true && !!ratingUrl();
    }
    function ratingStoreLabel() {
      return { edge: 'Edge', chrome: 'Chrome', firefox: 'Firefox' }[detectBrowserStore()] || '商店';
    }
    function applyRatingCopy() {
      const label = ratingStoreLabel();
      const text = storeRatingEl?.querySelector('.bili-dl-store-rating-text');
      const btn = storeRatingEl?.querySelector('[data-action="rate"]');
      if (text) text.textContent = `用着顺手的话，去 ${label} 商店点个分，对我们很有帮助。当然不评也完全没问题。`;
      if (btn) btn.textContent = `去 ${label} 商店评分 ⭐`;
    }
    function ratingMinSuccess() { const n = Number(remoteContent.rating?.minSuccess); return n > 0 ? n : STORE_RATING_MIN_SUCCESS; }
    function applyRemoteButtons() {
      panel.querySelectorAll('[data-sheet]').forEach((btn) => {
        if (btn.dataset.sheet === 'plugins') {
          // Once the catalog is known, do not expose an empty related-plugins entry.
          btn.classList.toggle('hidden', pluginCatalogLoaded && relatedPlugins.length === 0);
          return;
        }
        const item = remoteContent[btn.dataset.sheet];
        btn.classList.toggle('hidden', item?.enabled === false);
      });
      if (!ratingEnabled()) storeRatingEl?.classList.add('hidden');
      else applyRatingCopy();
    }
    function getCachedRemoteContent(record) {
      const data = record?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return { data, fetchedAt: Number(record.fetchedAt) || 0 };
    }

    function getCachedPluginCatalog(record) {
      const flags = record?.data?.flags;
      const plugins = record?.data?.plugins;
      if (!flags || typeof flags !== 'object' || Array.isArray(flags) || !Array.isArray(plugins)) return null;
      return { data: { flags, plugins }, fetchedAt: Number(record.fetchedAt) || 0 };
    }

    function isRelatedPluginsMasterOn(flags) {
      if (!flags || typeof flags !== 'object') return false;
      if (flags.relatedPluginsVisible === true) return true;
      // Stale local cache during migration from bilibiliSeriesVisible.
      if (flags.relatedPluginsVisible == null && flags.bilibiliSeriesVisible === true) return true;
      return false;
    }

    function normalizeRelatedPlugins(flags, plugins) {
      // Server should already fold the master switch into each item’s visible
      // field; keep an explicit flag check as defense-in-depth for stale/mixed data.
      if (!isRelatedPluginsMasterOn(flags)) return [];
      return plugins
        .filter((plugin) => plugin && plugin.visible === true && plugin.id !== 'bilibili')
        .map((plugin) => ({
          id: String(plugin.id || ''),
          name: String(plugin.name || '相关插件'),
          description: String(plugin.description || ''),
          iconUrl: String(plugin.iconUrl || ''),
          stores: plugin.stores && typeof plugin.stores === 'object' ? plugin.stores : {}
        }))
        .filter((plugin) => plugin.id && pluginStoreUrl(plugin));
    }

    function applyPluginCatalog(data) {
      relatedPlugins = normalizeRelatedPlugins(data.flags, data.plugins);
      pluginCatalogLoaded = true;
      applyRemoteButtons();
      return relatedPlugins;
    }

    function formatCacheAge(fetchedAt) {
      return `${Math.max(0, Math.floor((Date.now() - fetchedAt) / 60000))} 分钟`;
    }

    async function loadPluginCatalogNow() {
      let cached = null;
      try {
        const stored = await EXT.storage.local.get(PLUGIN_CATALOG_CACHE_KEY);
        cached = getCachedPluginCatalog(stored[PLUGIN_CATALOG_CACHE_KEY]);
        if (!REMOTE_CATALOG_DEBUG_REFRESH && cached?.fetchedAt && Date.now() - cached.fetchedAt < CONTENT_CACHE_TTL_MS) {
          applyPluginCatalog(cached.data);
          debugLog('相关插件', `已使用 12 小时缓存（缓存 ${formatCacheAge(cached.fetchedAt)}），未请求接口`);
          return relatedPlugins;
        }
        if (REMOTE_CATALOG_DEBUG_REFRESH) debugLog('相关插件', '调试模式：忽略本地缓存并立即刷新插件目录');
        else if (cached) debugLog('相关插件', cached.fetchedAt ? '12 小时缓存已过期，准备请求插件目录' : '旧版插件缓存无时间信息，准备请求接口');
        else debugLog('相关插件', '无插件目录缓存，准备请求接口');
      } catch (error) {
        debugLog('相关插件', `读取插件目录缓存失败，准备请求接口：${error?.message || error}`);
      }

      try {
        const [flagsResp, pluginsResp] = await Promise.all([
          EXT.runtime.sendMessage({ type: 'BILI_DL_FETCH_JSON', url: FEATURE_FLAGS_URL }),
          EXT.runtime.sendMessage({ type: 'BILI_DL_FETCH_JSON', url: PLUGINS_JSON_URL })
        ]);
        if (!flagsResp?.ok || !pluginsResp?.ok) throw new Error(flagsResp?.error || pluginsResp?.error || '插件目录接口不可用');
        const flags = flagsResp.data?.flags;
        const plugins = pluginsResp.data;
        if (!flags || typeof flags !== 'object' || Array.isArray(flags) || !Array.isArray(plugins)) throw new Error('插件目录返回格式无效');
        const data = { flags, plugins };
        await EXT.storage.local.set({ [PLUGIN_CATALOG_CACHE_KEY]: { data, fetchedAt: Date.now() } });
        applyPluginCatalog(data);
        debugLog('相关插件', `远程目录已加载：总开关 ${isRelatedPluginsMasterOn(flags) ? '开启' : '关闭'}，可展示 ${relatedPlugins.length} 个`);
        return relatedPlugins;
      } catch (error) {
        debugLog('相关插件', `远程目录不可用：${error?.message || error}`);
      }
      if (cached) {
        applyPluginCatalog(cached.data);
        debugLog('相关插件', '接口获取失败，已使用过期本地插件目录缓存');
      } else {
        relatedPlugins = [];
        pluginCatalogLoaded = false;
        applyRemoteButtons();
      }
      return relatedPlugins;
    }

    function loadPluginCatalog() {
      if (!pluginCatalogLoadPromise) {
        pluginCatalogLoadPromise = loadPluginCatalogNow().finally(() => { pluginCatalogLoadPromise = null; });
      }
      return pluginCatalogLoadPromise;
    }

    async function loadRemoteContentNow() {
      let cached = null;
      try {
        const stored = await EXT.storage.local.get(CONTENT_CACHE_KEY);
        cached = getCachedRemoteContent(stored[CONTENT_CACHE_KEY]);
        if (!REMOTE_CONTENT_DEBUG_REFRESH && cached?.fetchedAt && Date.now() - cached.fetchedAt < CONTENT_CACHE_TTL_MS) {
          remoteContent = mergeRemoteContent(cached.data);
          debugLog('配置', `已使用 12 小时缓存（缓存 ${formatCacheAge(cached.fetchedAt)}），未请求接口`);
          applyRemoteButtons();
          return remoteContent;
        }
        if (REMOTE_CONTENT_DEBUG_REFRESH) debugLog('配置', '调试模式：忽略本地缓存并立即刷新公告/合作配置');
        else if (cached) debugLog('配置', cached.fetchedAt ? '12 小时缓存已过期，准备请求接口' : '旧版缓存无时间信息，准备请求接口');
        else debugLog('配置', '无本地缓存，准备请求接口');
      } catch (error) {
        debugLog('配置', `读取本地缓存失败，准备请求接口：${error?.message || error}`);
      }

      try {
        const resp = await EXT.runtime.sendMessage({ type: 'BILI_DL_FETCH_JSON', url: CONTENT_JSON_URL });
        if (resp?.ok && resp.data && typeof resp.data === 'object') {
          remoteContent = mergeRemoteContent(resp.data);
          await EXT.storage.local.set({ [CONTENT_CACHE_KEY]: { data: resp.data, fetchedAt: Date.now() } });
          debugLog('配置', `远程配置已加载：${Object.keys(resp.data).join(', ')}`);
          applyRemoteButtons();
          return remoteContent;
        }
        debugLog('配置', `远程配置不可用：${resp?.error || '返回格式无效'}`);
      } catch (error) {
        debugLog('配置', `远程配置请求异常：${error?.message || error}`);
      }
      if (cached) {
        remoteContent = mergeRemoteContent(cached.data);
        debugLog('配置', '接口获取失败，已使用过期本地缓存');
      } else {
        remoteContent = mergeRemoteContent({});
        debugLog('配置', '无本地缓存，已使用内置默认配置');
      }
      applyRemoteButtons();
      return remoteContent;
    }

    function loadRemoteContent() {
      if (!remoteContentLoadPromise) {
        remoteContentLoadPromise = loadRemoteContentNow().finally(() => { remoteContentLoadPromise = null; });
      }
      return remoteContentLoadPromise;
    }
    function fillSettingsSheet(el) {
      const Filename = globalThis.BiliDlFilename;
      const Settings = globalThis.BiliDlSettings;
      clearNode(el);
      if (!Filename || !Settings) {
        appendTextElement(el, 'p', '', '设置模块未加载，请刷新页面后重试。');
        return;
      }

      const root = document.createElement('div');
      root.className = 'bili-dl-settings';

      const themeRow = document.createElement('div');
      themeRow.className = 'bili-dl-settings-row';
      appendTextElement(themeRow, 'span', '', '主题色');
      const themeControl = document.createElement('div');
      themeControl.className = 'bili-dl-settings-theme-control';
      const themeTrigger = document.createElement('button');
      themeTrigger.type = 'button';
      themeTrigger.className = 'bili-dl-settings-theme-trigger';
      themeTrigger.setAttribute('aria-label', '主题色');
      themeTrigger.setAttribute('aria-haspopup', 'listbox');
      themeTrigger.setAttribute('aria-expanded', 'false');
      const currentSwatch = document.createElement('span');
      currentSwatch.className = 'bili-dl-settings-theme-swatch bili-dl-settings-theme-current-swatch';
      currentSwatch.setAttribute('aria-hidden', 'true');
      const currentLabel = document.createElement('span');
      currentLabel.className = 'bili-dl-settings-theme-current-label';
      const chevron = document.createElement('span');
      chevron.className = 'bili-dl-settings-theme-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      themeTrigger.append(currentSwatch, currentLabel, chevron);
      const themeOptions = document.createElement('div');
      themeOptions.className = 'bili-dl-settings-theme-options hidden';
      themeOptions.id = 'bili-dl-settings-theme-options';
      themeOptions.setAttribute('role', 'listbox');
      themeTrigger.setAttribute('aria-controls', themeOptions.id);
      const themeEntries = [['bilibili', '默认'], ['tokyo-love', '东爱主题'], ['manchester-sea', '海边的曼彻斯特'], ['chinese-odyssey', '大话西游']];
      themeEntries.forEach(([value, label]) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'bili-dl-settings-theme-option';
        option.dataset.themeOption = value;
        option.dataset.label = label;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(themedPanel.dataset.theme === value));
        const swatch = document.createElement('span');
        swatch.className = 'bili-dl-settings-theme-swatch';
        swatch.dataset.theme = value;
        swatch.setAttribute('aria-hidden', 'true');
        const optionLabel = document.createElement('span');
        optionLabel.textContent = label;
        option.append(swatch, optionLabel);
        option.onclick = async () => {
          const previous = themedPanel.dataset.theme;
          applyTheme(value);
          themeOptions.classList.add('hidden');
          themeTrigger.setAttribute('aria-expanded', 'false');
          try {
            await EXT.storage.local.set({ [THEME_PREF_KEY]: value });
            status.textContent = '主题已保存';
          } catch (error) {
            applyTheme(previous);
            status.textContent = error?.message || '主题保存失败';
          }
        };
        themeOptions.appendChild(option);
      });
      themeTrigger.onclick = () => {
        const isOpen = !themeOptions.classList.contains('hidden');
        themeOptions.classList.toggle('hidden', isOpen);
        themeTrigger.setAttribute('aria-expanded', String(!isOpen));
      };
      themeTrigger.onkeydown = (event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          themeOptions.classList.remove('hidden');
          themeTrigger.setAttribute('aria-expanded', 'true');
          const selected = themeOptions.querySelector('[aria-selected="true"]');
          (selected || themeOptions.firstElementChild)?.focus();
        }
      };
      themeOptions.onkeydown = (event) => {
        const options = [...themeOptions.querySelectorAll('[data-theme-option]')];
        const index = options.indexOf(event.target.closest('[data-theme-option]'));
        if (event.key === 'Escape') {
          event.preventDefault();
          themeOptions.classList.add('hidden');
          themeTrigger.setAttribute('aria-expanded', 'false');
          themeTrigger.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          options[(index + direction + options.length) % options.length]?.focus();
        }
      };
      themeControl.append(themeTrigger, themeOptions);
      themeRow.appendChild(themeControl);
      root.appendChild(themeRow);

      const presetRow = document.createElement('label');
      presetRow.className = 'bili-dl-settings-row';
      appendTextElement(presetRow, 'span', '', '文件名');
      const preset = document.createElement('select');
      preset.className = 'bili-dl-settings-select';
      preset.setAttribute('aria-label', '文件名规则');
      [
        ['title', '默认（仅标题）'],
        ['title-bvid', '标题 + BV'],
        ['title-bvid-quality', '标题 + BV + 清晰度'],
        ['detailed', '标题 + UP + BV + 清晰度'],
        ['custom', '自定义…']
      ].forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        preset.appendChild(opt);
      });
      presetRow.appendChild(preset);
      root.appendChild(presetRow);

      const customBlock = document.createElement('div');
      customBlock.className = 'bili-dl-settings-custom';
      customBlock.hidden = true;

      const templateInput = document.createElement('input');
      templateInput.type = 'text';
      templateInput.className = 'bili-dl-settings-input';
      templateInput.maxLength = 200;
      templateInput.spellcheck = false;
      templateInput.autocomplete = 'off';
      templateInput.placeholder = '{title} - {bvid}';
      templateInput.setAttribute('aria-label', '自定义文件名模板');
      customBlock.appendChild(templateInput);

      const chips = document.createElement('div');
      chips.className = 'bili-dl-settings-chips';
      chips.setAttribute('aria-label', '插入变量');
      Filename.VARIABLES.forEach((item) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'bili-dl-settings-chip';
        chip.textContent = item.label;
        chip.title = `{${item.key}} · ${item.tip}`;
        chip.onclick = () => {
          const start = templateInput.selectionStart ?? templateInput.value.length;
          const end = templateInput.selectionEnd ?? templateInput.value.length;
          const token = `{${item.key}}`;
          templateInput.value = `${templateInput.value.slice(0, start)}${token}${templateInput.value.slice(end)}`;
          const pos = start + token.length;
          templateInput.focus();
          templateInput.setSelectionRange(pos, pos);
          syncPresetFromTemplate();
          refreshPreview();
          queueSave();
        };
        chips.appendChild(chip);
      });
      customBlock.appendChild(chips);
      root.appendChild(customBlock);

      const preview = appendTextElement(root, 'p', 'bili-dl-settings-preview', '—');
      const error = appendTextElement(root, 'p', 'bili-dl-settings-error', '');
      error.hidden = true;

      const foot = document.createElement('div');
      foot.className = 'bili-dl-settings-foot';
      const status = document.createElement('span');
      status.className = 'bili-dl-settings-status';
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'bili-dl-settings-reset';
      resetBtn.textContent = '恢复默认文件名';
      foot.append(status, resetBtn);
      root.appendChild(foot);
      el.appendChild(root);
      applyTheme(themedPanel.dataset.theme);

      let saveTimer = 0;

      function matchPreset(template) {
        const value = String(template || '').trim();
        for (const [key, tpl] of Object.entries(Filename.PRESETS)) {
          if (tpl === value) return key;
        }
        return 'custom';
      }

      function syncCustomVisibility() {
        customBlock.hidden = preset.value !== 'custom';
      }

      function syncPresetFromTemplate() {
        preset.value = matchPreset(templateInput.value.trim());
        syncCustomVisibility();
      }

      function currentTemplate() {
        if (preset.value !== 'custom' && Filename.PRESETS[preset.value]) {
          return Filename.PRESETS[preset.value];
        }
        return templateInput.value.trim();
      }

      function refreshPreview() {
        const check = Filename.validateTemplate(currentTemplate());
        if (!check.ok) {
          error.hidden = false;
          error.textContent = check.error;
          preview.textContent = '—';
          return false;
        }
        error.hidden = true;
        error.textContent = '';
        const videoName = Filename.withExtension(
          Filename.renderTemplate(check.template, Settings.SAMPLE_META, {
            format: 'mp4',
            qualityLabel: '1080P',
            index: 2
          }),
          'mp4'
        );
        const audioName = Filename.withExtension(
          Filename.renderTemplate(check.template, Settings.SAMPLE_META, {
            format: 'm4a',
            qualityLabel: '音频',
            index: 2
          }),
          'm4a'
        );
        preview.textContent = `预览：${videoName}  ·  ${audioName}`;
        return check.template;
      }

      function applyForm(settings) {
        const template = settings.filenameTemplate || Settings.DEFAULTS.filenameTemplate;
        templateInput.value = template;
        preset.value = matchPreset(template);
        syncCustomVisibility();
        refreshPreview();
      }

      async function persist(showOk) {
        const template = refreshPreview();
        if (!template) {
          status.textContent = '模板无效';
          return;
        }
        try {
          const saved = await Settings.saveSettings({
            filenameTemplate: template
          });
          applyFilenameSettings(saved);
          if (showOk) status.textContent = '已保存';
          else status.textContent = '';
        } catch (err) {
          status.textContent = err?.message || '保存失败';
        }
      }

      function queueSave() {
        status.textContent = '';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { persist(true); }, 280);
      }

      preset.onchange = () => {
        if (preset.value !== 'custom' && Filename.PRESETS[preset.value]) {
          templateInput.value = Filename.PRESETS[preset.value];
        } else if (preset.value === 'custom' && Filename.PRESETS[matchPreset(templateInput.value)]) {
          // keep current text for editing
        }
        syncCustomVisibility();
        refreshPreview();
        queueSave();
      };
      templateInput.oninput = () => {
        syncPresetFromTemplate();
        refreshPreview();
        queueSave();
      };
      resetBtn.onclick = async () => {
        clearTimeout(saveTimer);
        try {
          const defaults = await Settings.resetSettings();
          applyFilenameSettings(defaults);
          applyForm(defaults);
          status.textContent = '已恢复默认';
        } catch (err) {
          status.textContent = err?.message || '重置失败';
        }
      };

      Settings.loadSettings().then(applyForm).catch((err) => {
        status.textContent = err?.message || '加载失败';
      });
    }

    function renderInfoSheet(key, item) {
      pageEl?.classList.toggle('is-plugins', key === 'plugins');
      pageEl?.classList.toggle('is-donate', key === 'donate');
      if (key === 'donate') {
        infoTitle.textContent = '感谢您的支持与赞赏';
        infoDate.textContent = '';
        infoDate.classList.add('hidden');
        clearNode(infoBody);

        const donation = document.createElement('section');
        donation.className = 'bili-dl-donate';
        appendTextElement(donation, 'p', 'bili-dl-donate-intro', '您的支持将用于持续维护适配、改进下载体验。赞赏完全自愿，下载功能始终免费。');

        const methods = document.createElement('div');
        methods.className = 'bili-dl-donate-methods';
        methods.setAttribute('aria-label', '选择赞赏方式');
        const code = document.createElement('div');
        code.className = 'bili-dl-donate-code';
        const image = document.createElement('img');
        const buttons = [];
        const options = [
          { id: 'wechat', label: '微信赞赏', file: 'assets/donate-wechat.jpg' },
          { id: 'alipay', label: '支付宝', file: 'assets/donate-alipay.jpg' }
        ];
        const selectMethod = (option) => {
          const url = EXT.runtime.getURL(option.file);
          code.dataset.method = option.id;
          image.src = url;
          image.alt = `${option.label}二维码`;
          buttons.forEach((button) => {
            const active = button.dataset.method === option.id;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
          });
        };
        options.forEach((option) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'bili-dl-donate-method';
          button.dataset.method = option.id;
          button.setAttribute('aria-pressed', 'false');
          button.textContent = option.label;
          button.addEventListener('click', () => selectMethod(option));
          buttons.push(button);
          methods.appendChild(button);
        });
        code.appendChild(image);
        donation.append(methods, code);
        infoBody.appendChild(donation);
        selectMethod(options[0]);
        return;
      }
      if (key === 'settings') {
        infoTitle.textContent = '设置';
        infoDate.textContent = '已入队任务不受影响';
        infoDate.classList.remove('hidden');
        fillSettingsSheet(infoBody);
        return;
      }
      if (key === 'plugins') {
        infoTitle.textContent = '相关插件';
        infoDate.textContent = '';
        infoDate.classList.add('hidden');
        clearNode(infoBody);
        const list = document.createElement('div');
        list.className = 'bili-dl-plugins-list';
        relatedPlugins.forEach((item) => {
          const storeTarget = pluginStoreUrl(item);
          if (!storeTarget) return;
          const row = document.createElement('a');
          row.className = 'bili-dl-plugin-row';
          row.href = storeTarget.url;
          row.target = '_blank';
          row.rel = 'noopener';
          row.title = `${storeTarget.label}：${item.name}`;
          const icon = pluginIconUrl(item);
          const iconWrap = document.createElement('span');
          iconWrap.className = 'bili-dl-plugin-icon-wrap';
          iconWrap.setAttribute('aria-hidden', 'true');
          const fallback = document.createElement('span');
          fallback.className = 'bili-dl-plugin-icon-fallback';
          fallback.textContent = String(item.name || '插').trim().charAt(0) || '插';
          iconWrap.appendChild(fallback);
          if (icon) {
            const image = document.createElement('img');
            image.className = 'bili-dl-plugin-icon';
            image.alt = '';
            image.addEventListener('error', () => {
              image.remove();
              iconWrap.classList.add('is-fallback');
            }, { once: true });
            iconWrap.appendChild(image);
            void loadPluginIcon(icon).then((dataUrl) => {
              if (!dataUrl || !image.isConnected) {
                image.remove();
                iconWrap.classList.add('is-fallback');
                return;
              }
              image.src = dataUrl;
              iconWrap.classList.remove('is-fallback');
            });
          } else {
            iconWrap.classList.add('is-fallback');
          }
          row.appendChild(iconWrap);
          const copy = document.createElement('span');
          copy.className = 'bili-dl-plugin-copy';
          appendTextElement(copy, 'strong', '', item.name);
          appendTextElement(copy, 'span', '', item.description || '实用浏览器扩展');
          row.appendChild(copy);
          appendTextElement(row, 'span', 'bili-dl-plugin-action', `${storeTarget.label} ›`);
          list.appendChild(row);
        });
        if (relatedPlugins.length) infoBody.appendChild(list);
        else appendTextElement(infoBody, 'p', 'bili-dl-plugins-note', pluginCatalogLoaded ? '当前浏览器暂无可安装的相关插件。' : '正在读取相关插件目录…');
        return;
      }
      if (key === 'tasks') {
        infoTitle.textContent = '任务中心';
        infoDate.textContent = `本页任务 ${activeJobs.size} 个，最近记录 ${taskHistory.length} 条。`;
        infoDate.classList.remove('hidden');
        const render = (filter = 'all') => {
          clearNode(infoBody);
          const filters = [['all', '全部'], ['active', '下载中'], ['completed', '完成'], ['failed', '失败'], ['cancelled', '已取消']];
          const tools = document.createElement('div');
          tools.className = 'bili-dl-task-filters';
          filters.forEach(([value, label]) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.classList.toggle('active', value === filter); button.onclick = () => render(value); tools.appendChild(button); });
          infoBody.appendChild(tools);
          const rows = [...activeJobs.values(), ...taskHistory].filter((job) => filter === 'all' || (filter === 'active' ? ![TASK_STATE.completed, TASK_STATE.failed, TASK_STATE.cancelled].includes(job.state) : job.state === filter));
          if (!rows.length) { appendTextElement(infoBody, 'p', 'bili-dl-list-empty', '暂无此类任务。'); return; }
          rows.forEach((job) => { const row = document.createElement('div'); row.className = 'bili-dl-task-row'; appendTextElement(row, 'strong', '', job.info?.title || '视频'); const elapsed = Math.max(0, Math.round(((job.finishedAt || Date.now()) - job.createdAt) / 1000)); appendTextElement(row, 'span', '', `${job.state || 'downloading'} · ${elapsed}s${job.error?.message ? `：${job.error.message}` : ''}`); appendTextElement(row, 'small', '', formatTaskTimings(job)); if (job.state === TASK_STATE.failed) { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试'; retry.onclick = () => { showHome(); if (job.scope === 'list') setDownloadMode('list').then(() => startListDownload([{ item: job.info, requestedQn: job.requestedQn || job.qn || selectedQn }])); else launchVideoTask(job); }; row.appendChild(retry); } if (job.state === TASK_STATE.completed) { const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = '打开下载内容'; locate.onclick = openBrowserDownloads; row.appendChild(locate); } infoBody.appendChild(row); });
        };
        render();
        return;
      }
      if (key === 'feedback') {
        infoTitle.textContent = '反馈';
        infoDate.textContent = '复制邮箱后，附上诊断报告或截图发送即可。';
        infoDate.classList.remove('hidden');
        clearNode(infoBody);
        appendTextElement(infoBody, 'p', 'bili-dl-feedback-email', FEEDBACK_EMAIL);
        const copyEmail = appendTextElement(infoBody, 'button', 'bili-dl-btn bili-dl-diagnostics-copy', '复制反馈邮箱');
        copyEmail.type = 'button';
        copyEmail.onclick = async () => {
          try {
            await copyTextToClipboard(FEEDBACK_EMAIL);
            copyEmail.textContent = '邮箱已复制';
          } catch {
            copyEmail.textContent = '请手动复制上方邮箱';
          }
        };
        const openDiag = appendTextElement(infoBody, 'button', 'bili-dl-btn bili-dl-btn-secondary bili-dl-diagnostics-copy', '打开诊断日志');
        openDiag.type = 'button';
        openDiag.onclick = () => { renderInfoSheet('diagnostics'); };
        return;
      }
      if (key === 'diagnostics') {
        infoTitle.textContent = '诊断日志';
        infoDate.textContent = `本页保留最近 ${debugEntries.length} / 100 条；已隐藏链接和敏感参数。`;
        infoDate.classList.remove('hidden');
        clearNode(infoBody);
        appendTextElement(infoBody, 'p', 'bili-dl-feedback-email', `反馈邮箱：${FEEDBACK_EMAIL}`);
        const timingLines = [...activeJobs.values(), ...taskHistory].map((job) => `任务：${job.info?.title || '视频'} · ${job.state} · ${formatTaskTimings(job)}`);
        const report = ['B站视频下载助手诊断报告', `时间：${new Date().toLocaleString('zh-CN')}`, `页面：${location.pathname}`, `反馈邮箱：${FEEDBACK_EMAIL}`, '', '任务阶段耗时：', ...(timingLines.length ? timingLines : ['暂无任务']), '', '日志：', ...debugEntries.map((entry) => `[${entry.time}] ${entry.step}：${entry.msg}`)].join('\n');
        const textarea = document.createElement('textarea');
        textarea.className = 'bili-dl-diagnostics-text';
        textarea.readOnly = true;
        textarea.value = report;
        textarea.setAttribute('aria-label', '可复制的诊断报告');
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'bili-dl-btn bili-dl-diagnostics-copy';
        copy.textContent = '复制诊断报告';
        copy.onclick = async () => {
          try {
            await copyTextToClipboard(report);
            copy.textContent = '已复制';
          } catch {
            copy.textContent = '复制失败，请手动全选上方文本';
          }
        };
        infoBody.append(textarea, copy);
        return;
      }
      const data = item || {};
      infoTitle.textContent = data.title || (key === 'coop' ? '开发合作' : '公告');
      infoDate.textContent = data.updated ? '更新：' + data.updated : '';
      infoDate.classList.toggle('hidden', !data.updated);
      if (key === 'notice') fillNoticeBody(infoBody, data, remoteContent.coop);
      else fillPlainBody(infoBody, data.body);
    }
    function showHome() {
      pageEl?.classList.add('hidden');
      pageEl?.classList.remove('is-plugins', 'is-donate');
      homeEl?.classList.remove('hidden');
      menu.classList.remove('is-page');
    }
    async function openInfoSheet(key) {
      menu.classList.remove('is-entering');
      renderInfoSheet(key, remoteContent[key]);
      homeEl?.classList.add('hidden');
      pageEl?.classList.remove('hidden');
      menu.classList.add('is-page');
      pageEl.scrollTop = 0;
      if (key === 'plugins') {
        await loadPluginCatalog();
        if (menu.classList.contains('is-page')) renderInfoSheet(key);
        return;
      }
      if (key === 'diagnostics' || key === 'tasks' || key === 'settings' || key === 'donate' || key === 'feedback') return;
      await loadRemoteContent();
      if (!menu.classList.contains('is-page')) return;
      renderInfoSheet(key, remoteContent[key]);
    }
    panel.querySelectorAll('[data-sheet]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openInfoSheet(btn.dataset.sheet);
    }));
    pageBack?.addEventListener('click', showHome);
    loadRemoteContent();

    // 评分卡片：交互对齐 youtube-downloader；文案/状态随版本重置
    // 「去评分」后：整个浏览器会话内不再提示（关浏览器再开才可能再出）；不是新开标签就再弹
    const STORE_RATING_BROWSER_SESSION_KEY = `biliDlStoreRatingBrowserHide_${VERSION}`;
    let storeRatingHiddenBrowserSession = false;

    async function refreshBrowserSessionHideFlag() {
      try {
        if (EXT.storage?.session) {
          const r = await EXT.storage.session.get(STORE_RATING_BROWSER_SESSION_KEY);
          storeRatingHiddenBrowserSession = !!r[STORE_RATING_BROWSER_SESSION_KEY];
          return;
        }
      } catch (_) {}
      storeRatingHiddenBrowserSession = false;
    }

    async function setBrowserSessionHideFlag(on) {
      storeRatingHiddenBrowserSession = !!on;
      try {
        if (!EXT.storage?.session) return;
        if (on) {
          await EXT.storage.session.set({ [STORE_RATING_BROWSER_SESSION_KEY]: 1 });
        } else {
          await EXT.storage.session.remove(STORE_RATING_BROWSER_SESSION_KEY);
        }
      } catch (_) {}
    }

    refreshBrowserSessionHideFlag().catch(() => {});

    async function loadStoreRatingState() {
      try {
        const r = await EXT.storage.local.get(STORE_RATING_KEY);
        let s = r[STORE_RATING_KEY];
        if (!s || typeof s !== 'object' || s.forVersion !== VERSION) {
          s = { forVersion: VERSION, successCount: 0 };
          await EXT.storage.local.set({ [STORE_RATING_KEY]: s }).catch(() => {});
          await setBrowserSessionHideFlag(false);
        }
        return s;
      } catch {
        return { forVersion: VERSION, successCount: 0 };
      }
    }

    async function saveStoreRatingState(patch) {
      const prev = await loadStoreRatingState();
      await EXT.storage.local.set({
        [STORE_RATING_KEY]: { ...prev, forVersion: VERSION, ...patch }
      }).catch(() => {});
    }

    function hideStoreRatingBanner() {
      storeRatingEl?.classList.add('hidden');
    }

    async function hideStoreRatingForBrowserSession() {
      await setBrowserSessionHideFlag(true);
      hideStoreRatingBanner();
    }

    function showStoreRatingBanner() {
      if (!storeRatingEl || !ratingEnabled()) return;
      applyRatingCopy();
      storeRatingEl.classList.remove('hidden');
      try {
        storeRatingEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (_) {}
    }

    async function noteDownloadSuccessForRating() {
      await loadRemoteContent();
      if (!ratingEnabled() || !storeRatingEl) return;
      try {
        const s = await loadStoreRatingState();
        if (s.neverAsk) return;
        const successCount = (Number(s.successCount) || 0) + 1;
        await saveStoreRatingState({ successCount, dismissedUntilNextSuccess: false });
        if (successCount < ratingMinSuccess()) return;
        showStoreRatingBanner();
      } catch (err) {
        console.warn('[BiliDL] store rating failed', err);
      }
    }

    storeRatingEl?.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'rate') {
          await hideStoreRatingForBrowserSession();
          const url = ratingUrl();
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
          return;
        }
        if (action === 'never') {
          await saveStoreRatingState({ neverAsk: true });
          hideStoreRatingBanner();
          return;
        }
        // 下次再说：本次藏起，下次再成功下载还会出现
        await saveStoreRatingState({ dismissedUntilNextSuccess: true });
        hideStoreRatingBanner();
      });
    });

    function setQueueLabel(count) {
      queueLabelEl.textContent = count > 1 ? `队列下载全部 ${count} 个分 P` : '队列下载全部分 P';
    }

    function saveDownloadPrefs() {
      return EXT.storage.local.set({ [DOWNLOAD_PREFS_KEY]: { format: selectedFormat, qn: selectedQn, qualityStrategy, spaceQualityTier, streamPreference, listDownloadKind } }).catch(() => {});
    }

    function applyFilenameSettings(settings) {
      if (!settings) return;
      filenameTemplate = settings.filenameTemplate || filenameTemplate;
      refreshFilenamePreview();
    }

    async function loadFilenameSettings() {
      try {
        if (globalThis.BiliDlSettings?.loadSettings) {
          applyFilenameSettings(await globalThis.BiliDlSettings.loadSettings());
        }
      } catch { /* 设置读取失败不影响下载 */ }
    }

    function setFormat(fmt) {
      selectedFormat = fmt;
      formatPillsEl.querySelectorAll('.bili-dl-pill[data-format]').forEach((b) => {
        b.classList.toggle('active', b.dataset.format === fmt);
      });
      const isAudio = fmt === 'm4a';
      if (qualitySection) qualitySection.classList.toggle('hidden', isAudio);
      streamPreferenceEls.forEach((el) => el.closest('.bili-dl-stream-preference-row')?.classList.toggle('hidden', isAudio));
      refreshStartBtnForParallel();
      refreshEstimate();
      refreshFilenamePreview();
      saveDownloadPrefs();
    }

    function syncQualitySelection() {
      [pillsEl, listPillsEl].forEach((container) => {
        container?.querySelectorAll('.bili-dl-pill[data-qn]').forEach((button) => {
          button.classList.toggle('active', Number(button.dataset.qn) === selectedQn);
        });
      });
    }

    function selectQuality(qn) {
      selectedQn = Number(qn) || 0;
      qualityStrategy = 'exact';
      qualityStrategyEls.forEach((el) => { el.value = qualityStrategy; });
      syncQualitySelection();
      refreshEstimate();
      refreshFilenamePreview();
      saveDownloadPrefs();
    }

    async function loadDownloadPrefs() {
      try {
        const data = await EXT.storage.local.get(DOWNLOAD_PREFS_KEY);
        const prefs = data[DOWNLOAD_PREFS_KEY] || {};
        if (['highest', '1080', '720'].includes(prefs.spaceQualityTier)) spaceQualityTier = prefs.spaceQualityTier;
        if (prefs.format === 'mp4' || prefs.format === 'm4a') setFormat(prefs.format);
        if (Number(prefs.qn) > 0) selectedQn = Number(prefs.qn);
        if (prefs.qualityStrategy === 'highest' || prefs.qualityStrategy === 'exact') qualityStrategy = prefs.qualityStrategy;
        if (['video', 'audio', 'both'].includes(prefs.listDownloadKind)) setListDownloadKind(prefs.listDownloadKind, false);
        qualityStrategyEls.forEach((el) => { el.value = qualityStrategy; });
        streamPreferenceEls.forEach((el) => { el.value = streamPreference; });
        syncQualitySelection();
        if (isSpacePage()) renderSpaceQuality();
        await loadFilenameSettings();
        refreshFilenamePreview();
      } catch { /* 偏好读取失败不影响下载 */ }
    }

    showStatus = (type, text) => {
      statusEl.classList.remove('hidden', 'success', 'error');
      statusEl.classList.add(type);
      statusEl.textContent = text;
      statusEl.setAttribute('role', type === 'error' ? 'alert' : 'status');
      if (type === 'success') {
        const action = appendTextElement(statusEl, 'button', 'bili-dl-status-action', '查看浏览器下载记录');
        action.type = 'button';
        action.onclick = openBrowserDownloads;
      }
    };

    function isListPage() {
      return isSpacePage() || /^\/list\//.test(location.pathname) || (collectionHref && new URL(collectionHref).pathname === location.pathname && Boolean(videoInfo?.collection?.items?.length));
    }

    let spaceGathering = false;

    function renderSpaceQuality() {
      if (!isSpacePage() || !listQualitySection || !listPillsEl) return;
      listQualitySection.querySelector('.bili-dl-section-head').textContent = '清晰度策略';
      listQualitySection.querySelector('.bili-dl-quality-strategy-row').classList.add('hidden');
      clearNode(listPillsEl);
      for (const [value, label] of [['highest', '最高可用'], ['1080', '最高 1080P'], ['720', '最高 720P']]) {
        const button = appendTextElement(listPillsEl, 'button', `bili-dl-pill${value === spaceQualityTier ? ' active' : ''}`, label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(value === spaceQualityTier));
        button.title = value === 'highest' ? '每个视频下载当前账号可获取的最高画质' : `在 ${value}P 及以下选择最高可用画质`;
        button.onclick = () => {
          spaceQualityTier = value;
          renderSpaceQuality();
          saveDownloadPrefs();
        };
      }
    }

    function readSpaceDomMeta() {
      const pickText = (...selectors) => {
        for (const selector of selectors) {
          const text = document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
          if (text) return text;
        }
        return '';
      };
      const readStat = (label) => {
        for (const item of document.querySelectorAll('.nav-statistics .nav-item, .n-statistics .n-data, .counter-item, .h-statistics li, .upinfo__detail__stat')) {
          const text = item.textContent.replace(/\s+/g, ' ').trim();
          if (!text.includes(label)) continue;
          const num = item.querySelector('.item-num, .num, .n-num, .counter, .upinfo__detail__stat-count')?.textContent?.replace(/\s+/g, ' ').trim();
          if (num) return num;
          return text.replace(new RegExp(`\\s*${label}.*$`), '').trim() || text;
        }
        const fallback = { 粉丝: '.h-fans', 关注: '.h-following', 获赞: '.h-liked' }[label];
        if (!fallback) return '';
        const text = document.querySelector(fallback)?.textContent?.replace(/\s+/g, ' ').trim() || '';
        return text.replace(label, '').trim();
      };
      return {
        name: pickText('.nickname', '.h-name', '.space-name', '.upinfo__name'),
        fans: readStat('粉丝'),
        following: readStat('关注'),
        likes: readStat('获赞')
      };
    }

    function readSpaceAvatarUrl() {
      const scopes = [
        '.upinfo__avatar img',
        '.h-avatar img',
        '.space-upinfo .avatar img',
        '.header-upinfo .avatar img',
        '.space-header .header-avatar-wrap img',
        '.space-header .avatar img'
      ];
      for (const selector of scopes) {
        const img = document.querySelector(selector);
        if (img?.src) return normalizeCoverUrl(img.src);
      }
      const header = document.querySelector('.space-upinfo, .h-header, .space-header, .header-info');
      const img = header?.querySelector('img');
      return img?.src ? normalizeCoverUrl(img.src) : '';
    }

    let cachedSpaceDomPage = 1;

    function readSpaceDomPageNumber() {
      const active = document.querySelector(
        '.vui_pagenation .vui_pager-item.is-active, .vui_pager .is-active, .be-pager-item-active, .pagination .current, button[aria-current="page"], .pagenation .current'
      );
      const n = Number(String(active?.textContent || active?.getAttribute('aria-label') || '').replace(/\D/g, ''));
      if (Number.isFinite(n) && n > 0) {
        cachedSpaceDomPage = n;
        return n;
      }
      return cachedSpaceDomPage;
    }

    function mutationTouchesExtension(mutations) {
      const panelRoot = document.getElementById('bili-dl-panel-root');
      if (!panelRoot) return false;
      return mutations.every((mutation) => {
        const node = mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target;
        return node instanceof Node && panelRoot.contains(node);
      });
    }

    function scrapeSpaceVisibleVideos() {
      const roots = [
        document.querySelector('#video-list'),
        document.querySelector('.video-list'),
        document.querySelector('.list-content'),
        document.querySelector('.section-gap')
      ].filter(Boolean);
      const root = roots[0] || document.body;
      const author = readSpaceDomMeta().name || listItems[0]?.author || '';
      const seen = new Set();
      const items = [];
      for (const link of root.querySelectorAll('a[href*="/video/BV"], a[href*="/video/bv"]')) {
        if (link.closest('.space-upinfo, .h-header, .space-header, nav, header, .bili-dl-panel')) continue;
        const match = /\/video\/(BV[\w]+)/i.exec(link.href);
        if (!match) continue;
        const bvid = match[1].toUpperCase();
        if (seen.has(bvid)) continue;
        seen.add(bvid);
        const card = link.closest('.small-item, .bili-video-card, .upload-video-card, .video-list .item, .list-item');
        const titleNode = card?.querySelector('.title, .bili-video-card__info--tit, .name, [title]');
        const title = titleNode?.getAttribute('title')?.trim()
          || titleNode?.textContent?.replace(/\s+/g, ' ').trim()
          || link.getAttribute('title')?.trim()
          || bvid;
        items.push({
          bvid,
          aid: '',
          cid: '',
          title,
          author,
          cover: card?.querySelector('img')?.src || '',
          views: '',
          pubtime: 0,
          duration: 0
        });
      }
      return items;
    }

    function syncSpaceListTools() {
      const onSpace = isSpacePage();
      listRefreshPageBtn?.classList.toggle('hidden', !onSpace);
      listFilterSepEl?.classList.toggle('hidden', !onSpace);
    }

    function renderSpaceProfile() {
      const profile = panel.querySelector('#bili-dl-space-profile');
      if (!profile) return;
      if (!isSpacePage()) {
        profile.classList.add('hidden');
        clearNode(profile);
        return;
      }
      const dom = readSpaceDomMeta();
      const name = dom.name || listItems[0]?.author || 'UP 主';
      const avatarUrl = readSpaceAvatarUrl();
      clearNode(profile);
      profile.classList.remove('hidden');
      if (avatarUrl) {
        const image = document.createElement('img');
        image.src = avatarUrl;
        image.alt = '';
        image.onerror = () => image.remove();
        profile.appendChild(image);
      }
      const copy = appendTextElement(profile, 'div', 'bili-dl-space-profile-copy', '');
      appendTextElement(copy, 'strong', '', name);
      const meta = appendTextElement(copy, 'div', 'bili-dl-space-profile-meta', '');
      if (dom.fans) appendTextElement(meta, 'span', '', `${dom.fans} 粉丝`);
      if (dom.following) appendTextElement(meta, 'span', '', `${dom.following} 关注`);
      if (dom.likes) appendTextElement(meta, 'span', '', `${dom.likes} 获赞`);
      appendTextElement(meta, 'span', '', listLoaded ? `${listTotal} 个投稿` : '正在读取投稿…');
    }

    function setListStatus(text, type = '') {
      listStatusEl.textContent = text;
      listStatusEl.title = text;
      listStatusEl.dataset.type = type;
      const progressText = !queueCancelled && /^正在下载\s+\d+\/\d+/.test(String(text || ''));
      if (progressText && operationMode === 'list') {
        const card = listJobListEl?.querySelector('.bili-dl-job-card:last-child .bili-dl-progress-sub');
        if (card) {
          card.textContent = text;
          card.title = text;
          card.classList.remove('hidden');
        }
      }
      listResultEl?.classList.toggle('hidden', progressText || (!text && !lastListFailures.length));
    }

    function formatDuration(sec) {
      const value = Math.max(0, Number(sec) || 0);
      return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    }

    function listDownloadKindLabel(kind = listDownloadKind) {
      if (kind === 'audio') return '仅音频';
      if (kind === 'both') return '视频+音频';
      return '仅视频';
    }

    function setListDownloadKind(kind, persist = true) {
      if (!['video', 'audio', 'both'].includes(kind)) return;
      listDownloadKind = kind;
      listDownloadKindEl?.querySelectorAll('[data-list-download-kind]').forEach((button) => {
        const active = button.dataset.listDownloadKind === kind;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      if (listQualitySection) listQualitySection.classList.toggle('hidden', kind === 'audio');
      updateListSelection();
      if (persist) saveDownloadPrefs();
    }

    function updateListSelection() {
      const count = selectedListBvids.size;
      listStartBtn.disabled = !count || queueRunning || spaceGathering;
      listStartBtn.textContent = count ? `下载已选 ${count} 个${listDownloadKindLabel()}` : `下载已选${listDownloadKindLabel()}`;
      const allSelected = listItems.length > 0 && listItems.every((item) => selectedListBvids.has(item.bvid));
      listSelectAllBtn.textContent = allSelected ? '取消全选' : '全选';
      listSelectAllBtn.disabled = !listItems.length;
      listSelectAllBtn.setAttribute('aria-pressed', String(allSelected));
    }

    function updateListLoadMore() {
      const visible = listHasMore || listLoading;
      listLoadMoreBtn.classList.toggle('hidden', !visible);
      listLoadMoreBtn.disabled = listLoading || spaceGathering || !listHasMore;
      listLoadMoreBtn.textContent = listLoading
        ? '正在加载…'
        : `${isSpacePage() ? '读取全部投稿' : '继续加载'}（已加载 ${listItems.length} 个）`;
    }

    function updateListRetryFailed() {
      const count = lastListFailures.length;
      listRetryFailedBtn.classList.toggle('hidden', !count);
      listRetryFailedBtn.disabled = queueRunning;
      listRetryFailedBtn.textContent = count ? `重试未完成（${count}）` : '重试未完成';
      listResultEl?.classList.toggle('hidden', !count && !listStatusEl.textContent);
    }

    function renderListItems() {
      clearNode(listItemsEl);
      const fragment = document.createDocumentFragment();
      const keyword = listQuery.trim().toLocaleLowerCase();
      const visibleItems = listItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          if (listFilter === 'selected' && !selectedListBvids.has(item.bvid)) return false;
          return !keyword || item.title.toLocaleLowerCase().includes(keyword);
        });
      if (listSort !== 'default') {
        visibleItems.sort((a, b) => listSort === 'newest'
          ? (Number(b.item.pubtime) || 0) - (Number(a.item.pubtime) || 0)
          : (Number(a.item.pubtime) || 0) - (Number(b.item.pubtime) || 0));
      }
      visibleItems.forEach(({ item, index }) => {
        const label = document.createElement('label');
        label.className = 'bili-dl-list-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.bvid = item.bvid;
        checkbox.checked = selectedListBvids.has(item.bvid);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            selectedListBvids.add(item.bvid);
          } else selectedListBvids.delete(item.bvid);
          updateListSelection();
          if (listFilter === 'selected') renderListItems();
        });
        const ordinal = document.createElement('span');
        ordinal.className = 'bili-dl-list-item-index';
        ordinal.textContent = String(index + 1);
        const meta = document.createElement('span');
        meta.className = 'bili-dl-list-item-meta';
        const title = document.createElement('strong');
        title.textContent = item.title;
        title.title = item.title;
        const detail = document.createElement('small');
        detail.textContent = [item.views, item.duration ? formatDuration(item.duration) : ''].filter(Boolean).join(' · ');
        meta.append(title, detail);
        label.append(checkbox, ordinal, meta);
        fragment.appendChild(label);
      });
      listItemsEl.appendChild(fragment);
      if (!visibleItems.length) {
        const empty = document.createElement('p');
        empty.className = 'bili-dl-list-empty';
        empty.textContent = listFilter === 'selected' ? '暂无符合条件的已选视频。' : '没有匹配已加载标题的视频。';
        listItemsEl.appendChild(empty);
      }
      updateListSelection();
    }

    function mergeListItems(items) {
      const existing = new Set(listItems.map((item) => item.bvid));
      const fresh = (Array.isArray(items) ? items : []).filter((item) => item?.bvid && !existing.has(item.bvid));
      listItems.push(...fresh);
      return fresh.length;
    }

    function mergeSpacePageItems(apiItems, scrapedItems) {
      if (!scrapedItems.length) return apiItems;
      const apiByBvid = new Map((apiItems || []).filter((item) => item?.bvid).map((item) => [String(item.bvid).toUpperCase(), item]));
      return scrapedItems.map((item) => {
        const api = apiByBvid.get(String(item.bvid).toUpperCase());
        return api ? { ...api, title: item.title || api.title, cover: item.cover || api.cover } : item;
      });
    }

    async function ensureListItemVideoIds(item) {
      if (item?.aid && item?.cid) return item;
      const resolved = await agentCall('RESOLVE_VIDEO', { href: `https://www.bilibili.com/video/${item.bvid}`, pageIndex: 0 });
      item.aid = String(resolved.info.aid || item.aid || '');
      item.cid = String(resolved.info.cid || item.cid || '');
      if (!item.aid || !item.cid) throw new Error('无法读取该投稿的视频信息');
      return item;
    }

    async function applySpaceListData(data, { pn, pageOnly = false, statusPrefix = '' } = {}) {
      listItems = Array.isArray(data.items) ? data.items : [];
      listTotal = Number(data.total) || 0;
      selectedListBvids = new Set(listItems.filter((item) => selectedListBvids.has(item.bvid)).map((item) => item.bvid));
      listCursor = pageOnly ? null : (data.cursor || null);
      listHasMore = pageOnly ? true : !!data.hasMore;
      const author = readSpaceDomMeta().name || listItems[0]?.author || 'UP 主';
      listTitleEl.textContent = pageOnly ? `${author} · 第 ${pn} 页` : (data.title || `${author}的全部投稿`);
      listTitleEl.title = listTitleEl.textContent;
      listCountEl.textContent = pageOnly
        ? `当前页 ${listItems.length}${listTotal ? ` / 共 ${listTotal}` : ''} 个`
        : `已加载 ${listItems.length}${listTotal ? ` / 共 ${listTotal}` : ''} 个`;
      listLoaded = true;
      renderListItems();
      renderSpaceProfile();
      const prefix = statusPrefix || (pageOnly ? `已同步第 ${pn} 页 ${listItems.length} 个投稿` : '');
      setListStatus(prefix || (listItems.length ? '可勾选投稿，或点击“读取全部投稿”加载并全选。' : '未读取到视频，请刷新页面后重试。'));
    }

    async function refreshSpaceCurrentPage(fromWatcher = false) {
      if (!isSpacePage() || listLoading || queueRunning || spaceGathering) return;
      const requestedHref = location.href;
      const pn = readSpaceDomPageNumber();
      listLoading = true;
      listRefreshPageBtn.disabled = true;
      updateListLoadMore();
      setListStatus(fromWatcher ? `已切换到第 ${pn} 页，正在同步…` : `正在读取第 ${pn} 页投稿…`);
      try {
        const scraped = scrapeSpaceVisibleVideos();
        const data = await agentCall('RESOLVE_LIST', { cursor: { pn } });
        if (requestedHref !== location.href) return;
        const items = mergeSpacePageItems(data.items, scraped);
        await applySpaceListData({ ...data, items }, {
          pn,
          pageOnly: true,
          statusPrefix: `已同步第 ${pn} 页 ${items.length} 个投稿，勾选后开始下载。`
        });
      } catch (error) {
        if (requestedHref !== location.href) return;
        const scraped = scrapeSpaceVisibleVideos();
        if (scraped.length) {
          await applySpaceListData({ items: scraped, total: listTotal, space: true }, {
            pn,
            pageOnly: true,
            statusPrefix: `已从当前页读取 ${scraped.length} 个投稿。`
          });
        } else {
          setListStatus(`读取失败：${error.message || error}`, 'error');
        }
      } finally {
        listLoading = false;
        listRefreshPageBtn.disabled = false;
        updateListLoadMore();
        updateListSelection();
      }
    }

    async function loadListItems(force = false) {
      if (listLoading) return;
      if (listLoaded && !force) return;
      const requestedHref = location.href;
      listLoading = true;
      updateListLoadMore();
      setListStatus(force ? '正在刷新列表…' : '正在读取视频列表…');
      try {
        const spacePn = isSpacePage() ? readSpaceDomPageNumber() : 0;
        const scraped = isSpacePage() ? scrapeSpaceVisibleVideos() : [];
        const data = await agentCall('RESOLVE_LIST', spacePn ? { cursor: { pn: spacePn } } : {});
        if (requestedHref !== location.href) return;
        if (data.space) {
          const items = mergeSpacePageItems(data.items, scraped);
          await applySpaceListData({ ...data, items }, {
            pn: spacePn,
            pageOnly: true,
            statusPrefix: items.length ? `已读取第 ${spacePn} 页 ${items.length} 个投稿，可勾选下载或点“读取全部投稿”。` : ''
          });
        } else {
          listItems = Array.isArray(data.items) ? data.items : [];
          listTotal = Number(data.total) || 0;
          selectedListBvids = new Set(listItems.filter((item) => selectedListBvids.has(item.bvid)).map((item) => item.bvid));
          listCursor = data.cursor || null;
          listHasMore = !!data.hasMore;
          listTitleEl.textContent = data.title || '视频列表';
          listTitleEl.title = data.title || '视频列表';
          listCountEl.textContent = `已加载 ${listItems.length}${data.total ? ` / 共 ${data.total}` : ''} 个`;
          listLoaded = true;
          renderListItems();
          setListStatus(listItems.length ? (data.collection ? '勾选合集视频后将自动依次下载；下载期间请保持页面打开。' : '滚动 B 站页面加载更多视频后，重新进入“列表下载”即可更新。') : '未读取到视频，请刷新页面后重试。');
        }
        debugLog('列表', `已读取 ${listItems.length} 个视频`);
      } catch (error) {
        if (requestedHref !== location.href) return;
        setListStatus(`列表读取失败：${error.message || error}`, 'error');
        debugLog('列表', `读取失败：${error.message || error}`);
      } finally {
        listLoading = false;
        updateListLoadMore();
        if (requestedHref !== location.href && activeMode === 'list' && !queueRunning) loadListItems(true);
      }
    }

    async function loadMoreListItems() {
      if (listLoading || !listHasMore) return;
      const requestedHref = location.href;
      listLoading = true;
      updateListLoadMore();
      setListStatus(`正在加载更多视频（当前 ${listItems.length} 个）…`);
      try {
        const data = await agentCall('LOAD_LIST_PAGE', { cursor: listCursor });
        if (requestedHref !== location.href) return false;
        const added = mergeListItems(data.items);
        listTotal = Number(data.total) || listTotal;
        if (data.hasMore && !added) throw new Error('分页未返回新视频，请稍后重试');
        listCursor = data.cursor || listCursor;
        listHasMore = !!data.hasMore && added > 0;
        listCountEl.textContent = `已加载 ${listItems.length}${data.total ? ` / 共 ${data.total}` : ''} 个`;
        renderListItems();
        setListStatus(added ? `已加载 ${added} 个视频，可继续选择。` : '没有更多可加载的视频。');
        debugLog('列表', `分页加载 ${added} 个，累计 ${listItems.length} 个`);
        return true;
      } catch (error) {
        setListStatus(`继续加载失败：${error.message || error}`, 'error');
        debugLog('列表', `分页加载失败：${error.message || error}`);
        return false;
      } finally {
        listLoading = false;
        updateListLoadMore();
      }
    }

    async function setDownloadMode(mode) {
      if (isSpacePage()) mode = 'list';
      activeMode = mode;
      videoBodyEl.classList.toggle('hidden', mode === 'list');
      listBodyEl.classList.toggle('hidden', mode !== 'list');
      menu.classList.toggle('is-list-mode', mode === 'list');
      if (mode === 'list') {
        estimateRequestId += 1;
        syncQualitySelection();
        if (isSpacePage()) renderSpaceQuality();
      } else {
        syncQualitySelection();
        refreshEstimate();
      }
      modeTabsEl.querySelectorAll('[data-mode]').forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      homeEl.scrollTop = 0;
      if (mode === 'list') await loadListItems(!queueRunning);
    }

    function showErrorWithFaq(text, anchor) {
      statusEl.classList.remove('hidden', 'success', 'error');
      statusEl.classList.add('error');
      const href = anchor ? `${FAQ_URL}#${anchor}` : FAQ_URL;
      clearNode(statusEl);
      statusEl.append(document.createTextNode(text + ' '));
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'bili-dl-status-link';
      link.textContent = '查看常见问题';
      statusEl.appendChild(link);
    }

    function showRetryableDownloadError(job, error) {
      const problem = classifyDownloadError(error);
      job.error = problem;
      setTaskState(job, problem.type === 'cancelled' ? TASK_STATE.cancelled : TASK_STATE.failed, problem.message);
      statusEl.classList.remove('hidden', 'success', 'error');
      statusEl.classList.add('error');
      clearNode(statusEl);
      statusEl.append(document.createTextNode(`下载失败：${problem.message} `));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'bili-dl-status-action';
      retry.textContent = '重试此任务';
      retry.onclick = () => launchVideoTask(job);
      statusEl.appendChild(retry);
      const link = document.createElement('a');
      link.href = errorFaqAnchor(problem.message) ? `${FAQ_URL}#${errorFaqAnchor(problem.message)}` : FAQ_URL;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'bili-dl-status-link';
      link.textContent = '查看常见问题';
      statusEl.appendChild(link);
    }

    const STEP_LABELS = {
      prepare: '准备下载',
      download: '下载视频',
      video: '下载视频',
      audio: '下载音频',
      merge: '合并音视频',
      save: '保存文件',
      paused: '已暂停',
      queue: '分 P 队列下载'
    };

    function formatBytes(n) {
      const v = Number(n) || 0;
      if (v >= 1024 * 1024 * 1024) return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
      if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
      if (v >= 1024) return Math.round(v / 1024) + ' KB';
      if (v > 0) return v + ' B';
      return '0 B';
    }

    async function refreshEstimate() {
      const requestId = ++estimateRequestId;
      currentEstimateBytes = 0;
      if (activeMode === 'list') {
        estimateEl.classList.add('hidden');
        return;
      }
      if (!videoInfo?.aid || !videoInfo?.cid) {
        estimateEl.classList.add('hidden');
        return;
      }
      if (selectedFormat === 'm4a') {
        try {
          // 先同步展示占位行，再用实际结果替换文字；高度不会在请求完成时突变。
          estimateText.textContent = '⌛ 预计大小 正在计算…';
          estimateEl.classList.remove('hidden');
          const est = await agentCall('GET_ESTIMATE', {
            aid: videoInfo.aid,
            cid: videoInfo.cid,
            duration: videoInfo.duration,
            audioOnly: true
          });
          if (requestId !== estimateRequestId || activeMode === 'list') return;
          currentEstimateBytes = Number(est.sizeBytes) || 0;
          let text = '⌛ 预计大小 ' + (est.sizeLabel || '未知') + ' · 仅供参考';
          if (est.estimateNote) text += ' · ' + est.estimateNote;
          estimateText.textContent = text;
          estimateEl.classList.remove('hidden');
        } catch {
          if (requestId !== estimateRequestId || activeMode === 'list') return;
          estimateEl.classList.add('hidden');
        }
        return;
      }
      if (!selectedQn) {
        estimateEl.classList.add('hidden');
        return;
      }
      try {
        // 同上：保持预估行占位，切换到单视频页不会因异步结果二次改变高度。
        estimateText.textContent = '⌛ 预计大小 正在计算…';
        estimateEl.classList.remove('hidden');
        const est = await agentCall('GET_ESTIMATE', {
          aid: videoInfo.aid,
          cid: videoInfo.cid,
          qn: selectedQn,
          duration: videoInfo.duration,
          streamPreference
        });
        if (requestId !== estimateRequestId || activeMode === 'list') return;
        currentEstimateBytes = Number(est.sizeBytes) || 0;
        let text = '⌛ 预计大小 ' + (est.sizeLabel || '未知') + ' · 仅供参考';
        if (est.estimateNote) text += ' · ' + est.estimateNote;
        estimateText.textContent = text;
        estimateEl.classList.remove('hidden');
      } catch {
        if (requestId !== estimateRequestId || activeMode === 'list') return;
        estimateEl.classList.add('hidden');
      }
    }

    function errorFaqAnchor(msg) {
      if (/过大/.test(msg)) return 'file-size';
      if (/合成|合并/.test(msg)) return 'merge-slow';
      if (/取消/.test(msg)) return null;
      return 'download-fail';
    }

    /** 并行任务：每个 job 一张独立进度卡，可单独暂停/取消 */
    const PARALLEL_MAX = 3;
    const activeJobs = new Map();
    acceptsMergeRequest = (jobId) => {
      const job = activeJobs.get(jobId);
      return Boolean(job && !job.cancelRequested && job.state === TASK_STATE.merging);
    };
    let jobSeq = 0;
    const TASK_STATE = Object.freeze({
      queued: 'queued',
      preparing: 'preparing',
      downloading: 'downloading',
      paused: 'paused',
      merging: 'merging',
      saving: 'saving',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'cancelled'
    });
    const taskUi = {
      video: { jobList: jobListEl, jobPanel: videoJobPanelEl, queuePause: queuePauseBtn, queueCancel: queueCancelBtn, queueActions: queueActionsEl, body: videoBodyEl },
      list: { jobList: listJobListEl, jobPanel: listJobPanelEl, queuePause: listQueuePauseBtn, queueCancel: listQueueCancelBtn, queueActions: listQueueActionsEl, body: listBodyEl }
    };

    function getTaskUi(scope) {
      return taskUi[scope] || taskUi.video;
    }

    function jobScope(job) {
      return job?.scope === 'list' ? 'list' : 'video';
    }

    function createDownloadTask(seed = {}) {
      return {
        ...seed,
        jobId: seed.jobId || `job-${Date.now()}-${++jobSeq}`,
        scope: seed.scope === 'list' ? 'list' : 'video',
        state: TASK_STATE.queued,
        attempts: Number(seed.attempts) || 0,
        error: null,
        createdAt: Date.now(),
        phaseTimes: {},
        updatedAt: Date.now()
      };
    }

    function setTaskState(job, state, detail = '') {
      if (!job) return;
      job.state = state;
      job.updatedAt = Date.now();
      job.phaseTimes ||= {};
      job.phaseTimes[state] ||= job.updatedAt;
      if (detail) job.detail = detail;
      if (job.cardEl) job.cardEl.dataset.state = state;
    }

    function classifyDownloadError(error) {
      const message = String(error?.message || error || '下载失败');
      if (/下载已取消|已取消|取消/.test(message)) return { type: 'cancelled', message: '下载已取消' };
      if (/Could not establish connection|Receiving end does not exist|message port closed|Extension context invalidated/i.test(message)) {
        return { type: 'extension', message: '扩展已更新，请刷新当前 B 站页面后重试' };
      }
      if (/登录|权限|会员|大会员/.test(message)) return { type: 'permission', message };
      if (/清晰度|可下载/.test(message)) return { type: 'quality', message };
      if (/合成|合并|mux|remux/i.test(message)) return { type: 'merge', message };
      if (/保存|download/i.test(message)) return { type: 'save', message };
      return { type: 'network', message };
    }

    function taskStateForStep(step) {
      if (step === 'prepare' || step === 'queue') return TASK_STATE.preparing;
      if (step === 'paused') return TASK_STATE.paused;
      if (step === 'merge') return TASK_STATE.merging;
      if (step === 'save') return TASK_STATE.saving;
      return TASK_STATE.downloading;
    }

    function syncJobListVisibility() {
      downloading = activeJobs.size > 0 || queueRunning;
      const listQueueLayout = queueRunning && operationMode === 'list' && !queueCancelled;
      listBodyEl?.classList.toggle('is-queue-running', listQueueLayout);
      Object.entries(taskUi).forEach(([scope, ui]) => {
        const hasJobs = Array.from(activeJobs.values()).some((job) => jobScope(job) === scope);
        const showQueueControls = queueRunning && !queueCancelled && operationMode === scope;
        ui.jobList.classList.toggle('hidden', !hasJobs);
        ui.queueActions.classList.toggle('hidden', !showQueueControls);
        ui.jobPanel?.classList.toggle('hidden', !(hasJobs || showQueueControls));
        ui.queuePause.textContent = queuePaused ? '继续全部' : '暂停全部';
      });
    }

    function waitWhileQueuePaused() {
      if (!queuePaused || queueCancelled) return Promise.resolve();
      if (!queuePauseWaiter) {
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        queuePauseWaiter = { resolve, promise };
      }
      return queuePauseWaiter.promise;
    }

    function resumeEntireQueue() {
      queuePaused = false;
      agentSignal('RESUME_DOWNLOAD');
      if (queuePauseWaiter) {
        queuePauseWaiter.resolve();
        queuePauseWaiter = null;
      }
      syncJobListVisibility();
    }

    function pauseEntireQueue() {
      queuePaused = true;
      agentSignal('PAUSE_DOWNLOAD');
      if ([...activeJobs.values()].some((job) => job.merging || job.state === TASK_STATE.saving)) {
        const message = '已暂停后续任务；当前合成或保存完成后，不再启动下一项。';
        if (operationMode === 'list') setListStatus(message);
        else showStatus('info', message);
      }
      syncJobListVisibility();
    }

    function toggleEntireQueuePause() {
      if (!queueRunning || queueCancelled) return;
      if (queuePaused) resumeEntireQueue();
      else pauseEntireQueue();
    }

    function cancelEntireQueue() {
      if (!queueRunning) return;
      queueCancelled = true;
      queuePaused = false;
      if (queuePauseWaiter) {
        queuePauseWaiter.resolve();
        queuePauseWaiter = null;
      }
      activeJobs.forEach((job) => {
        job.cancelRequested = true;
        agentSignal('CANCEL_DOWNLOAD', { jobId: job.jobId });
      });
      Object.values(taskUi).forEach(({ queuePause, queueCancel }) => {
        queuePause.disabled = true;
        queueCancel.disabled = true;
        queueCancel.textContent = '正在取消…';
      });
      if (operationMode === 'list') setListStatus('正在取消队列…');
      syncJobListVisibility();
    }

    function resetQueueCancelButton() {
      queuePaused = false;
      if (queuePauseWaiter) {
        queuePauseWaiter.resolve();
        queuePauseWaiter = null;
      }
      Object.values(taskUi).forEach(({ queuePause, queueCancel }) => {
        queuePause.disabled = false;
        queuePause.textContent = '暂停全部';
        queueCancel.disabled = false;
        queueCancel.textContent = '取消整队';
      });
      syncJobListVisibility();
    }

    function hideProgress() {
      activeJobs.forEach((j) => j.cardEl?.remove());
      activeJobs.clear();
      Object.values(taskUi).forEach(({ jobList }) => clearNode(jobList));
      syncJobListVisibility();
    }

    function mountJobCard(job) {
      const el = document.createElement('div');
      el.className = 'bili-dl-progress bili-dl-job-card';
      el.dataset.jobId = job.jobId;
      el.appendChild(createFragment(`
        <div class="bili-dl-progress-meta">
          <span class="bili-dl-progress-title"></span>
          <span class="bili-dl-progress-q"></span>
        </div>
        <div class="bili-dl-progress-sub hidden"></div>
        <div class="bili-dl-progress-head">
          <span class="bili-dl-job-phase">准备下载</span>
          <span class="bili-dl-job-pct">0%</span>
          <button type="button" class="bili-dl-job-cancel-inline">取消</button>
        </div>
        <div class="bili-dl-progress-track">
          <div class="bili-dl-progress-bar"></div>
        </div>
        <div class="bili-dl-progress-actions hidden">
          <button type="button" class="bili-dl-action-btn bili-dl-job-pause">暂停</button>
          <button type="button" class="bili-dl-action-btn danger bili-dl-job-cancel">取消</button>
        </div>
      `));
      const titleEl = el.querySelector('.bili-dl-progress-title');
      titleEl.textContent = job.info?.title || '视频';
      titleEl.title = job.info?.title || '';
      el.querySelector('.bili-dl-progress-q').textContent =
        job.format === 'm4a' ? 'M4A 音频' : (job.label || '');

      const pauseBtn = el.querySelector('.bili-dl-job-pause');
      const cancelBtn = el.querySelector('.bili-dl-job-cancel');
      const cancelInline = el.querySelector('.bili-dl-job-cancel-inline');
      const bar = el.querySelector('.bili-dl-progress-bar');

      pauseBtn.onclick = () => {
        if (queuePaused) { resumeEntireQueue(); return; }
        const j = activeJobs.get(job.jobId);
        if (!j || j.merging) return;
        if (j.paused) {
          agentSignal('RESUME_DOWNLOAD', { jobId: job.jobId });
          j.paused = false;
          setTaskState(j, TASK_STATE.downloading);
          pauseBtn.textContent = '暂停';
          bar.classList.remove('paused');
        } else {
          agentSignal('PAUSE_DOWNLOAD', { jobId: job.jobId });
        }
      };

      const cancelJob = () => {
        job.cancelRequested = true;
        agentSignal('CANCEL_DOWNLOAD', { jobId: job.jobId });
      };
      cancelBtn.onclick = cancelJob;
      cancelInline.onclick = cancelJob;

      job.cardEl = el;
      job.paused = false;
      job.merging = false;
      const ui = getTaskUi(jobScope(job));
      ui.jobList.appendChild(el);
      syncJobListVisibility();
      // 新任务出现时把进度和操作按钮带入当前标签的可视区域。
      requestAnimationFrame(() => {
        if (jobScope(job) === 'list') {
          ui.jobList.scrollTop = ui.jobList.scrollHeight;
          if (listBodyEl.scrollHeight > listBodyEl.clientHeight) {
            listBodyEl.scrollTo({ top: listBodyEl.scrollHeight, behavior: 'smooth' });
          }
        } else if (videoBodyEl.scrollHeight > videoBodyEl.clientHeight) {
          videoBodyEl.scrollTo({ top: videoBodyEl.scrollHeight, behavior: 'smooth' });
        }
      });
      return el;
    }

    function removeJobCard(jobId) {
      const j = activeJobs.get(jobId);
      recordTask(j);
      j?.cardEl?.remove();
      activeJobs.delete(jobId);
      syncJobListVisibility();
    }

    function setJobActionsVisible(el, visible) {
      const actions = el.querySelector('.bili-dl-progress-actions');
      const inline = el.querySelector('.bili-dl-job-cancel-inline');
      const isList = el.closest('#bili-dl-list-job-list');
      if (isList) {
        actions?.classList.add('hidden');
        inline?.classList.toggle('hidden', !visible);
        return;
      }
      actions?.classList.toggle('hidden', !visible);
      inline?.classList.add('hidden');
    }

    updateProgress = (step, percent, received, total, jobId, meta = {}) => {
      const job = jobId ? activeJobs.get(jobId) : null;
      const el = job?.cardEl;
      if (!el || job.cancelRequested || queueCancelled) return;
      setTaskState(job, taskStateForStep(step));

      const phaseEl = el.querySelector('.bili-dl-job-phase');
      const pctEl = el.querySelector('.bili-dl-job-pct');
      const bar = el.querySelector('.bili-dl-progress-bar');
      const pauseBtn = el.querySelector('.bili-dl-job-pause');
      const cancelBtn = el.querySelector('.bili-dl-job-cancel');

      if (step === 'merge' || step === 'save') {
        job.merging = step === 'merge';
        // 流式合成可中断：保留取消入口，避免大文件合成时用户只能等待或刷新页面。
        setJobActionsVisible(el, true);
        pauseBtn.disabled = step === 'merge' || step === 'save';
        cancelBtn.disabled = false;
      } else if (step !== 'paused') {
        job.merging = false;
        setJobActionsVisible(el, true);
        pauseBtn.disabled = false;
        cancelBtn.disabled = false;
      }

      if (step === 'paused') {
        job.paused = true;
        pauseBtn.textContent = '继续';
        phaseEl.textContent = STEP_LABELS.paused;
        bar.classList.add('paused');
        return;
      }

      if (job.paused && step !== 'paused') {
        job.paused = false;
        pauseBtn.textContent = '暂停';
        bar.classList.remove('paused');
      }

      const pct = Number(percent);
      const recv = Number(received) || 0;
      const tot = Number(total) || 0;

      if (step === 'merge') {
        const sizeHint = tot || recv;
        if (meta.queued) {
          phaseEl.textContent = '等待其他大文件合成完成…';
        } else if (sizeHint) {
          const etaMs = Number(meta.etaMs) || 0;
          const etaText = etaMs > 0
            ? ` · 约剩余 ${etaMs >= 60000 ? Math.ceil(etaMs / 60000) + ' 分钟' : Math.ceil(etaMs / 1000) + ' 秒'}`
            : '';
          phaseEl.textContent = recv > 0
            ? `正在合成 ${formatBytes(recv)} / ${formatBytes(sizeHint)}${etaText}`
            : '正在合成，约 ' + formatBytes(sizeHint);
        } else {
          phaseEl.textContent = STEP_LABELS.merge;
        }
        bar.classList.add('indeterminate');
        pctEl.classList.add('hidden');
        return;
      }

      if (step === 'queue') {
        phaseEl.textContent = STEP_LABELS.queue;
        const qp = Math.min(100, Math.max(0, pct || 0));
        pctEl.textContent = qp + '%';
        bar.style.width = qp + '%';
        bar.classList.remove('indeterminate', 'paused');
        pctEl.classList.remove('hidden');
        return;
      }

      phaseEl.textContent = STEP_LABELS[step] || '下载中…';

      if (tot > 0) {
        const displayPct = Math.min(100, Math.max(0, pct >= 0 ? pct : Math.round((recv / tot) * 100)));
        pctEl.textContent = formatBytes(recv) + ' / ' + formatBytes(tot);
        bar.style.width = displayPct + '%';
        bar.classList.remove('indeterminate');
        pctEl.classList.remove('hidden');
        return;
      }

      if (recv > 0) {
        pctEl.textContent = formatBytes(recv);
        bar.classList.add('indeterminate');
        pctEl.classList.remove('hidden');
        return;
      }

      if (pct > 0) {
        pctEl.textContent = Math.min(100, pct) + '%';
        bar.style.width = Math.min(100, pct) + '%';
        bar.classList.remove('indeterminate');
        pctEl.classList.remove('hidden');
      } else {
        bar.classList.add('indeterminate');
        pctEl.classList.add('hidden');
      }
    };

    function setDetect(_text, _ready) {
      // 识别条已移除，保留空函数以免改动过多调用点
    }

    function setVideoLoading(loading) {
      videoCard.classList.toggle('is-loading', loading);
      if (loading) {
        coverSk.classList.remove('hidden');
        coverImg.classList.add('hidden');
        coverPh.classList.add('hidden');
      }
      videoSk.classList.toggle('hidden', !loading);
      videoContent.classList.toggle('hidden', loading);
    }

    function renderQualityPills(list) {
      if (isSpacePage()) {
        renderSpaceQuality();
        return;
      }
      qualities = list || [];
      [pillsEl, listPillsEl].forEach(clearNode);
      if (!qualities.length) {
        [pillsEl, listPillsEl].forEach((container) => appendTextElement(container, 'span', 'bili-dl-pill disabled', '无可用清晰度'));
        selectedQn = 0;
        return;
      }
      if (qualityStrategy === 'highest') {
        selectedQn = qualities.reduce((highest, item) => Number(item.qn) > Number(highest.qn) ? item : highest, qualities[0]).qn;
      } else if (!qualities.some((q) => q.qn === selectedQn)) {
        selectedQn = qualities[0].qn;
      }
      [pillsEl, listPillsEl].forEach((container) => {
        const frag = document.createDocumentFragment();
        qualities.forEach((q) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `bili-dl-pill${q.qn === selectedQn ? ' active' : ''}`;
          btn.dataset.qn = String(q.qn);
          btn.textContent = q.label;
          btn.onclick = () => selectQuality(q.qn);
          frag.appendChild(btn);
        });
        container.appendChild(frag);
      });
      refreshFilenamePreview();
      refreshEstimate();
    }

    /** 会话内快照缓存：10s 过期，按 href+分 P 区分，重复开面板免重请求 */
    let snapshotCache = null;
    let snapshotCacheAt = 0;
    let snapshotCacheKey = '';
    const SNAPSHOT_TTL = 10000;

    function snapshotKey() {
      return `${location.href}#p=${pageIndex}`;
    }

    async function fetchSnapshot() {
      const now = Date.now();
      const key = snapshotKey();
      if (
        snapshotCache &&
        snapshotCacheKey === key &&
        now - snapshotCacheAt < SNAPSHOT_TTL
      ) {
        return snapshotCache;
      }
      const res = await agentCall('RESOLVE_VIDEO', { href: location.href, pageIndex });
      let qRes = { qualities: [], maxLabel: '', loginHint: null };
      let qualityError = '';
      try {
        qRes = await agentCall('GET_QUALITIES', { aid: res.info.aid, cid: res.info.cid });
      } catch (error) {
        qualityError = error?.message || String(error);
      }
      if (key !== snapshotKey()) throw new Error('视频已切换，请稍后重试');
      const snapshot = {
        info: res.info,
        qualities: qRes.qualities || [],
        maxLabel: qRes.maxLabel || '',
        loginHint: qRes.loginHint || null,
        qualityError
      };
      if (!qualityError) {
        snapshotCache = snapshot;
        snapshotCacheAt = now;
        snapshotCacheKey = key;
      }
      return snapshot;
    }

    async function loadVideoInfo() {
      if (isSpacePage()) {
        modeTabsEl.classList.add('hidden');
        menu.classList.add('is-list-page');
        renderSpaceProfile();
        renderSpaceQuality();
        if (activeMode !== 'list') await setDownloadMode('list');
        else if (!listLoaded) await loadListItems();
        return;
      }
      panel.querySelector('#bili-dl-space-profile')?.classList.add('hidden');
      const requestedHref = location.href;
      setDetect('识别页面中…', false);
      setVideoLoading(true);
      titleEl.textContent = '';
      authorEl.textContent = '';
      authorEl.classList.add('hidden');
      subEl.textContent = '';
      estimateEl.classList.add('hidden');
      queueBtn.classList.add('hidden');
      startBtn.disabled = true;
      coverDownloadBtn.disabled = true;
      statusEl.classList.add('hidden');
      clearNode(pillsEl);
      appendTextElement(pillsEl, 'span', 'bili-dl-pill loading', '加载中');

      try {
        const snap = await fetchSnapshot();
        if (requestedHref !== location.href) return;
        videoInfo = snap.info;
        collectionHref = requestedHref;
        modeTabsEl.classList.toggle('hidden', !isListPage());
        menu.classList.toggle('is-list-page', isListPage());
        if (!isListPage() && activeMode === 'list' && !operationMode) await setDownloadMode('video');
        setVideoLoading(false);
        titleEl.textContent = videoInfo.title;
        setDetect('已识别视频页面', true);

        if (videoInfo.author) {
          authorEl.textContent = videoInfo.author;
          authorEl.classList.remove('hidden');
        } else {
          authorEl.classList.add('hidden');
        }

        if (videoInfo.pic) {
          coverImg.src = normalizeCoverUrl(videoInfo.pic);
          const showCover = () => {
            coverImg.classList.remove('hidden');
            coverPh.classList.add('hidden');
            coverSk.classList.add('hidden');
          };
          const showCoverFallback = () => {
            coverImg.classList.add('hidden');
            coverPh.classList.remove('hidden');
            coverSk.classList.add('hidden');
          };
          if (coverImg.complete) {
            coverImg.naturalWidth ? showCover() : showCoverFallback();
          } else {
            coverImg.onload = showCover;
            coverImg.onerror = showCoverFallback;
          }
          coverDownloadBtn.disabled = false;
        } else {
          coverPh.classList.remove('hidden');
          coverSk.classList.add('hidden');
        }

        const parts = [];
        if (videoInfo.view) parts.push(formatView(videoInfo.view) + ' 播放');
        if (videoInfo.pubdate) parts.push(formatTime(videoInfo.pubdate));
        subEl.textContent = parts.length ? parts.join(' · ') : 'B站视频';

        if (isMultiPartVideo(videoInfo.pages)) {
          pagesEl.classList.remove('hidden');
          clearNode(pagesEl);
          const frag = document.createDocumentFragment();
          videoInfo.pages.forEach((p, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `bili-dl-page-btn${i === pageIndex ? ' active' : ''}`;
            btn.dataset.index = String(i);
            btn.textContent = `P${p.page}`;
            frag.appendChild(btn);
          });
          pagesEl.appendChild(frag);
          pagesEl.querySelectorAll('.bili-dl-page-btn').forEach((btn) => {
            btn.onclick = () => {
              pageIndex = +btn.dataset.index;
              snapshotCache = null;
              snapshotCacheKey = '';
              loadVideoInfo();
            };
          });
          queueBtn.classList.remove('hidden');
          setQueueLabel(videoInfo.pages.length);
        } else {
          pagesEl.classList.add('hidden');
          queueBtn.classList.add('hidden');
        }

        if (selectedFormat === 'm4a') {
          if (qualitySection) qualitySection.classList.add('hidden');
        } else {
          if (qualitySection) qualitySection.classList.remove('hidden');
        }
        renderQualityPills(snap.qualities);
        if (snap.qualityError) {
          showErrorWithFaq('清晰度读取失败：' + snap.qualityError, 'download-fail');
          debugLog('清晰度', snap.qualityError);
        }
        if (snap.qualities.some((q) => q.mode === 'dash')) {
          setupMuxInPage().catch(() => {});
        }
        refreshStartBtnForQueue();

        debugLog('加载', `${videoInfo.aid}/${videoInfo.cid} · ${snap.qualities.map((q) => q.label).join(', ')}`);
      } catch (err) {
        if (requestedHref !== location.href) return;
        setDetect('识别失败', false);
        setVideoLoading(false);
        titleEl.textContent = '加载失败';
        subEl.textContent = err.message;
        coverPh.classList.remove('hidden');
        coverSk.classList.add('hidden');
        showErrorWithFaq(err.message, 'download-fail');
        debugLog('错误', err.message);
      }
    }

    function getSelectedQualityLabel() {
      return qualities.find((q) => q.qn === selectedQn)?.label || '';
    }

    function buildFilenameBase(info, qn, format, opts = {}) {
      const Filename = globalThis.BiliDlFilename;
      const qualityLabel = format === 'm4a'
        ? '音频'
        : (opts.qualityLabel || qualities.find((q) => q.qn === qn)?.label || `${qn}P`);
      const template = opts.filenameTemplate || filenameTemplate;
      const meta = {
        title: info?.title,
        author: info?.author,
        bvid: info?.bvid,
        part: opts.part != null ? opts.part : (info?.page || info?.part || ((opts.pageIndex != null ? opts.pageIndex : 0) + 1)),
        partTitle: opts.partTitle || info?.partTitle || info?.title
      };
      if (Filename?.renderTemplate) {
        try {
          return Filename.renderTemplate(template, meta, {
            format,
            qualityLabel,
            index: opts.index != null ? opts.index : 1,
            createdAt: opts.createdAt || Date.now()
          });
        } catch {
          /* fall through to safe default */
        }
      }
      const title = String(info?.title || 'bilibili-video').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim() || 'bilibili-video';
      const bvid = info?.bvid ? `BV${String(info.bvid).replace(/^BV/i, '')}` : '';
      return [title, bvid, qualityLabel].filter(Boolean).join(' - ');
    }

    function refreshFilenamePreview() {
      if (!filenamePreviewEl) return;
      if (!videoInfo) {
        filenamePreviewEl.textContent = '文件名预览会在识别视频后显示';
        return;
      }
      const ext = selectedFormat === 'm4a' ? 'm4a' : 'mp4';
      const base = buildFilenameBase(videoInfo, selectedQn, selectedFormat, {
        pageIndex,
        part: videoInfo.pages?.[pageIndex]?.page || (pageIndex + 1),
        partTitle: videoInfo.pages?.[pageIndex]?.part || videoInfo.title,
        index: 1
      });
      const label = document.createElement('span');
      label.className = 'bili-dl-filename-preview-label';
      label.textContent = '保存为：';
      const filename = document.createElement('span');
      filename.className = 'bili-dl-filename-preview-name';
      filename.textContent = `${base}.${ext}`;
      filename.title = filename.textContent;
      filenamePreviewEl.replaceChildren(label, filename);
    }


    async function ensureMuxReady() {
      const sel = qualities.find((q) => q.qn === selectedQn);
      if (sel?.mode !== 'dash') return true;
      try {
        await setupMuxInPage();
        return true;
      } catch {
        showErrorWithFaq('请刷新页面后重试', 'merge-slow');
        return false;
      }
    }

    function captureDownloadJob() {
      const sel = qualities.find((q) => q.qn === selectedQn);
      const createdAt = Date.now();
      const label = selectedFormat === 'm4a' ? '音频' : getSelectedQualityLabel();
      const filenameSnapshot = {
        filenameTemplate,
        createdAt,
        index: 1,
        pageIndex,
        part: videoInfo.pages?.[pageIndex]?.page || (pageIndex + 1),
        partTitle: videoInfo.pages?.[pageIndex]?.part || videoInfo.title,
        qualityLabel: label
      };
      return {
        scope: 'video',
        info: {
          bvid: videoInfo.bvid,
          aid: videoInfo.aid,
          cid: videoInfo.cid,
          title: videoInfo.title,
          author: videoInfo.author || '',
          page: filenameSnapshot.part,
          partTitle: filenameSnapshot.partTitle
        },
        qn: selectedQn,
        format: selectedFormat,
        streamPreference,
        mode: sel?.mode || 'durl',
        pageIndex,
        label,
        estimatedBytes: currentEstimateBytes,
        ...filenameSnapshot,
        filenameBase: buildFilenameBase(videoInfo, selectedQn, selectedFormat, filenameSnapshot)
      };
    }

    function canStartCurrentDownload() {
      if (!videoInfo) return false;
      if (selectedFormat === 'm4a') return true;
      return !!selectedQn;
    }

    function refreshStartBtnForParallel() {
      if (queueRunning) return;
      const n = activeJobs.size;
      const largeRunning = [...activeJobs.values()].some((job) => isLargeMerge(job));
      startBtn.disabled = !canStartCurrentDownload() || largeRunning;
      if (n > 0) {
        startBtn.textContent = largeRunning ? '大文件处理中' : (n >= PARALLEL_MAX ? `并行已满 (${n})` : `再下一个 (${n})`);
        queueBtn.disabled = true;
      } else {
        restoreStartButtonContent();
        queueBtn.disabled = false;
      }
    }

    // 兼容旧调用名
    function refreshStartBtnForQueue() {
      refreshStartBtnForParallel();
    }

    async function runSingleDownload(info, opts = {}) {
      const format = opts.format || selectedFormat;
      const qn = opts.qn != null ? opts.qn : selectedQn;
      const streamSelection = streamPreference;
      const jobId = opts.jobId || null;
      const shouldCancel = () => Boolean(activeJobs.get(jobId)?.cancelRequested || (queueRunning && queueCancelled));
      const job = jobId ? activeJobs.get(jobId) : null;
      const filenameBase = opts.filenameBase
        || job?.filenameBase
        || buildFilenameBase(info, qn, format, {
          filenameTemplate: opts.filenameTemplate || job?.filenameTemplate || filenameTemplate,
          createdAt: opts.createdAt || job?.createdAt,
          index: opts.index != null ? opts.index : (job?.index != null ? job.index : 1),
          pageIndex: opts.pageIndex != null ? opts.pageIndex : job?.pageIndex,
          part: opts.part != null ? opts.part : job?.part,
          partTitle: opts.partTitle || job?.partTitle || info?.partTitle,
          qualityLabel: opts.qualityLabel || job?.label
        });
      await waitWhileQueuePaused();
      if (shouldCancel()) throw new Error('下载已取消');

      if (format === 'm4a') {
        const result = await agentCall('START_DOWNLOAD', {
          aid: info.aid,
          cid: info.cid,
          title: info.title,
          filenameBase,
          audioOnly: true,
          jobId
        }, 0);
        result.downloadId = await downloadBlob(result.blob, result.filename, shouldCancel);
        updateProgress('save', 100, 0, 0, jobId);
        return result;
      }

      const result = await agentCall('START_DOWNLOAD', {
        aid: info.aid,
        cid: info.cid,
        qn,
        streamPreference: streamSelection,
        title: info.title,
        filenameBase,
        includeAudioBlob: opts.reuseAudio === true,
        jobId
      }, 0);

      if (result.blob) {
        updateProgress('save', 95, 0, 0, jobId);
        const blob = result.blob || new Blob([result.mp4], { type: 'video/mp4' });
        result.downloadId = await downloadBlob(blob, result.filename, shouldCancel);
        updateProgress('save', 100, 0, 0, jobId);
      } else {
        throw new Error('保存数据不可用，请刷新页面后重试');
      }
      return result;
    }

    async function saveReusedAudio(result, filenameBase, shouldCancel, jobId) {
      const audioBlob = result?.audioBlob;
      if (!audioBlob?.size) return null;
      const filename = `${filenameBase}.m4a`;
      updateProgress('save', 95, 0, 0, jobId);
      const downloadId = await downloadBlob(audioBlob, filename, shouldCancel);
      updateProgress('save', 100, 0, 0, jobId);
      return { audioOnly: true, reusedAudio: true, filename, downloadId };
    }

    function finishActiveJob(jobId) {
      removeJobCard(jobId);
      if (!queueRunning && activeJobs.size === 0) operationMode = null;
      refreshStartBtnForParallel();
    }

    async function launchVideoTask(seed) {
      if (queueRunning) return;
      const seedIsLarge = isLargeMerge(seed);
      const activeLarge = [...activeJobs.values()].some((job) => isLargeMerge(job));
      if ((seedIsLarge && activeJobs.size > 0) || activeLarge) {
        showStatus('error', '大文件正在下载或合成。为避免内存过载，请等待它完成或取消后再开始下一个。');
        return;
      }
      if (activeJobs.size >= PARALLEL_MAX) {
        showStatus('error', `最多同时 ${PARALLEL_MAX} 个下载，请等完成后再加`);
        return;
      }

      const job = createDownloadTask({ ...seed, jobId: '', attempts: (seed.attempts || 0) + 1 });
      operationMode = 'video';
      const jobId = job.jobId;
      debugLog('下载', `准备启动 ${jobId}：${job.info.title || '视频'}`);
      activeJobs.set(jobId, job);
      mountJobCard(job);
      updateProgress('prepare', 0, 0, 0, jobId);
      refreshStartBtnForParallel();
      statusEl.classList.add('hidden');
      debugLog('下载', `并行启动 ${jobId} · 当前 ${activeJobs.size} 个`);

      (async () => {
        try {
          if (job.format !== 'm4a' && job.mode === 'dash') {
            await setupMuxInPage();
          }
          const result = await runSingleDownload(job.info, {
            qn: job.qn,
            format: job.format,
            jobId,
            filenameBase: job.filenameBase,
            filenameTemplate: job.filenameTemplate,
            createdAt: job.createdAt,
            index: job.index,
            pageIndex: job.pageIndex,
            part: job.part,
            partTitle: job.partTitle,
            qualityLabel: job.label
          });
          if (result.videoOnly) {
            setTaskState(job, TASK_STATE.completed);
            showStatus('success', `已下载视频轨（无音频）：${job.info.title || ''}`);
          } else {
            const fmt = result.audioOnly ? 'm4a' : 'mp4';
            addHistory({
              bvid: job.info.bvid,
              aid: job.info.aid,
              cid: job.info.cid,
              pageIndex: job.pageIndex,
              title: job.info.title,
              label: fmt === 'm4a' ? '音频' : job.label,
              format: fmt,
              ts: Date.now()
            });
            showStatus(
              'success',
              fmt === 'm4a'
                ? `已保存 M4A：${job.info.title || ''}`
                : `已保存 MP4：${job.info.title || ''}`
            );
            setTaskState(job, TASK_STATE.completed);
            noteDownloadSuccessForRating();
          }
        } catch (err) {
          const problem = classifyDownloadError(err);
          if (problem.type === 'cancelled') {
            setTaskState(job, TASK_STATE.cancelled);
            showStatus('error', `已取消：${job.info.title || '下载'}`);
          } else {
            showRetryableDownloadError(job, err);
            debugLog('错误', problem.message);
          }
        } finally {
          finishActiveJob(jobId);
        }
      })();
    }

    async function startDownload() {
      if (!canStartCurrentDownload() || queueRunning) return;
      return launchVideoTask(captureDownloadJob());
    }

    function coverFilename(title, coverUrl) {
      const base = String(title || 'bilibili-cover')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 120) || 'bilibili-cover';
      const ext = /\.(jpe?g|png|webp)(?:$|[?@])/i.exec(String(coverUrl || ''))?.[1]?.toLowerCase() || 'jpg';
      return `${base}-封面.${ext === 'jpeg' ? 'jpg' : ext}`;
    }

    function normalizeCoverUrl(value) {
      const sourceUrl = String(value || '').trim();
      if (sourceUrl.startsWith('//')) return `https:${sourceUrl}`;
      // B 站 view API 仍可能返回 http 封面；下载 API 不会自动沿用页面的混合内容升级。
      return sourceUrl.replace(/^http:\/\//i, 'https://');
    }

    async function downloadCover() {
      if (!videoInfo?.pic || coverDownloadBtn.disabled) return;
      coverDownloadBtn.disabled = true;
      // 浏览器原生下载没有可供面板同步的封面进度，避免展示不准确的状态行。
      statusEl.classList.add('hidden');
      try {
        const url = normalizeCoverUrl(videoInfo.pic);
        const filename = coverFilename(videoInfo.title, videoInfo.pic);
        debugLog('封面', `开始下载：${filename} · ${url}`);
        const response = await EXT.runtime.sendMessage({
          type: 'BILI_DL_DOWNLOAD_COVER',
          url,
          filename
        });
        if (!response?.ok) throw new Error(response?.error || '封面下载失败');
        debugLog('封面', `下载任务已创建：${response.downloadId}`);
      } catch (err) {
        debugLog('封面', `下载失败：${err.message || err}`);
      } finally {
        coverDownloadBtn.disabled = !videoInfo?.pic;
      }
    }

    async function startQueueDownload(retryPlan = null) {
      if (queueRunning || activeJobs.size) return;
      const isRetry = Array.isArray(retryPlan);
      if (!isRetry && (!canStartCurrentDownload() || !isMultiPartVideo(videoInfo.pages))) return;
      const plan = isRetry ? retryPlan.map((item) => ({ ...item })) : videoInfo.pages.map((_part, index) => {
        const createdAt = Date.now();
        const partMeta = videoInfo.pages[index] || {};
        const label = selectedFormat === 'm4a' ? '音频' : getSelectedQualityLabel();
        const nameOpts = {
          filenameTemplate,
          createdAt,
          index: index + 1,
          pageIndex: index,
          part: partMeta.page || (index + 1),
          partTitle: partMeta.part || videoInfo.title,
          qualityLabel: label
        };
        return {
          href: location.href,
          index,
          qn: selectedQn,
          format: selectedFormat,
          streamPreference,
          label,
          mode: qualities.find((quality) => quality.qn === selectedQn)?.mode || 'durl',
          filenameTemplate: nameOpts.filenameTemplate,
          createdAt: nameOpts.createdAt,
          batchIndex: nameOpts.index,
          part: nameOpts.part,
          partTitle: nameOpts.partTitle,
          filenameBase: buildFilenameBase({
            title: partMeta.part || videoInfo.title,
            author: videoInfo.author,
            bvid: videoInfo.bvid,
            page: nameOpts.part,
            partTitle: nameOpts.partTitle
          }, selectedQn, selectedFormat, nameOpts)
        };
      });
      if (!plan.length) return;
      // Lock before the first await: double-clicks must not start duplicate queues.
      queueRunning = true;
      queueCancelled = false;
      queuePaused = false;
      operationMode = 'video';
      startBtn.disabled = true;
      queueBtn.disabled = true;
      queueLabelEl.textContent = '自动依次下载分 P…';
      statusEl.classList.add('hidden');
      syncJobListVisibility();
      let ok = 0, cancelled = 0, nextIndex = 0;
      const failed = [];
      try {
        if (!(await ensureMuxReady())) return;
        async function runOnePart(entry) {
          const job = createDownloadTask({
            scope: 'video', format: entry.format, qn: entry.qn, mode: entry.mode,
            pageIndex: entry.index, label: `P${entry.index + 1} · ${entry.label}`,
            info: { title: `P${entry.index + 1}` },
            filenameTemplate: entry.filenameTemplate,
            filenameBase: entry.filenameBase,
            createdAt: entry.createdAt,
            index: entry.batchIndex != null ? entry.batchIndex : (entry.index + 1),
            part: entry.part,
            partTitle: entry.partTitle,
            qualityLabel: entry.label
          });
          activeJobs.set(job.jobId, job);
          mountJobCard(job);
          const check = async () => {
            await waitWhileQueuePaused();
            if (queueCancelled || job.cancelRequested) throw new Error('下载已取消');
          };
          try {
            for (let attempt = 0; attempt < 2; attempt++) {
              await check();
              try {
                updateProgress('prepare', 0, 0, 0, job.jobId);
                const result = await agentCall('RESOLVE_VIDEO', { href: entry.href, pageIndex: entry.index });
                await check();
                job.info = result.info;
                const title = job.cardEl?.querySelector('.bili-dl-progress-title');
                if (title) { title.textContent = job.info.title; title.title = job.info.title; }
                await runSingleDownload(job.info, {
                  qn: entry.qn,
                  format: entry.format,
                  streamPreference: entry.streamPreference,
                  jobId: job.jobId,
                  filenameBase: entry.filenameBase || job.filenameBase,
                  filenameTemplate: entry.filenameTemplate || job.filenameTemplate,
                  createdAt: entry.createdAt || job.createdAt,
                  index: entry.batchIndex != null ? entry.batchIndex : (entry.index + 1),
                  pageIndex: entry.index,
                  part: entry.part,
                  partTitle: entry.partTitle || job.info?.partTitle,
                  qualityLabel: entry.label
                });
                ok++;
                setTaskState(job, TASK_STATE.completed);
                await addHistory({ bvid: job.info.bvid, aid: job.info.aid, cid: job.info.cid,
                  pageIndex: entry.index, title: job.info.title, label: entry.label, format: entry.format, ts: Date.now() });
                return;
              } catch (error) {
                const problem = classifyDownloadError(error);
                // Retrying an uncertain disk save could create a duplicate file.
                if (attempt || problem.type !== 'network' || queueCancelled || job.cancelRequested) throw error;
                job.attempts++;
                updateProgress('queue', 0, 0, 0, job.jobId);
                const phase = job.cardEl?.querySelector('.bili-dl-job-phase');
                if (phase) phase.textContent = '网络失败，稍后重试…';
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }
            }
          } catch (error) {
            const problem = classifyDownloadError(error);
            if (problem.type === 'cancelled' || queueCancelled || job.cancelRequested) {
              cancelled++;
              setTaskState(job, TASK_STATE.cancelled);
            } else {
              failed.push({ ...entry, message: problem.message });
              job.error = problem;
              setTaskState(job, TASK_STATE.failed, problem.message);
              debugLog('队列', `P${entry.index + 1} 失败：${problem.message}`);
            }
          } finally { removeJobCard(job.jobId); }
        }
        async function worker() {
          while (nextIndex < plan.length && !queueCancelled) {
            await waitWhileQueuePaused();
            if (queueCancelled) break;
            await runOnePart(plan[nextIndex++]);
          }
        }
        const workers = 1;
        await Promise.all(Array.from({ length: workers }, () => worker()));
        const counts = `成功 ${ok}，失败 ${failed.length}${cancelled ? `，取消 ${cancelled}` : ''}`;
        showStatus(failed.length || queueCancelled ? 'error' : 'success',
          `${queueCancelled ? '队列已取消' : '队列处理完成'}：${counts}${failed.length ? `。P${failed[0].index + 1}：${failed[0].message}` : ''}`);
        if (failed.length) {
          const retry = appendTextElement(statusEl, 'button', 'bili-dl-status-action', `仅重试失败的 ${failed.length} 项`);
          retry.type = 'button';
          retry.onclick = () => startQueueDownload(failed);
        }
        if (ok) noteDownloadSuccessForRating();
      } catch (error) {
        showStatus('error', `队列停止：${error.message || error}`);
      } finally {
        queueRunning = false;
        operationMode = null;
        resetQueueCancelButton();
        setQueueLabel(videoInfo?.pages?.length || plan.length);
        refreshStartBtnForParallel();
      }
    }

    async function startListDownload(retryTasks = null) {
      const isRetry = Array.isArray(retryTasks);
      const items = isRetry
        ? retryTasks.map((entry) => entry.item).filter(Boolean)
        : listItems.filter((item) => selectedListBvids.has(item.bvid));
      if (!items.length || queueRunning || spaceGathering) return;
      if (activeJobs.size > 0) {
        setListStatus('请先等待当前下载完成，再开始列表下载。', 'error');
        return;
      }
      const queueQn = selectedQn;
      const queueStrategy = qualityStrategy;
      const queueSpaceTier = isSpacePage() ? spaceQualityTier : null;
      const queueStreamPreference = streamPreference;
      const queueDownloadKind = isRetry && retryTasks[0]?.downloadKind
        ? retryTasks[0].downloadKind
        : listDownloadKind;
      queueRunning = true;
      operationMode = 'list';
      queueCancelled = false;
      queuePaused = false;
      listStartBtn.disabled = true;
      updateListRetryFailed();
      let ok = 0;
      let fail = 0;
      let cancelled = 0;
      let downgraded = 0;
      const failedTasks = [];
      let processed = 0;
      try {
        for (let index = 0; index < items.length; index++) {
          await waitWhileQueuePaused();
          if (queueCancelled) break;
          const item = items[index];
          const retryTask = isRetry ? retryTasks[index] : null;
          const downloadKind = retryTask?.downloadKind || queueDownloadKind;
          const wantsVideo = downloadKind !== 'audio';
          const wantsAudio = downloadKind !== 'video';
          const outputFormat = wantsVideo ? 'mp4' : 'm4a';
          const contentLabel = listDownloadKindLabel(downloadKind);
          setListStatus(`正在下载 ${index + 1}/${items.length}：${item.title}`);
          const jobId = `list-${Date.now()}-${index}`;
          const createdAt = Date.now();
          const nameOpts = {
            filenameTemplate,
            createdAt,
            index: index + 1,
            pageIndex: 0,
            part: 1,
            partTitle: item.title,
            qualityLabel: !wantsVideo
              ? '音频'
              : getSelectedQualityLabel()
          };
          const filenameBase = buildFilenameBase({
            title: item.title,
            author: item.author,
            bvid: item.bvid,
            page: 1,
            partTitle: item.title
          }, queueQn, outputFormat, nameOpts);
          const audioFilenameBase = wantsAudio
            ? buildFilenameBase({ title: item.title, author: item.author, bvid: item.bvid, page: 1, partTitle: item.title }, queueQn, 'm4a', { ...nameOpts, qualityLabel: '音频' })
            : '';
          const job = createDownloadTask({
            jobId,
            scope: 'list',
            info: item,
            format: outputFormat,
            downloadKind,
            label: `列表 · ${contentLabel}${downloadKind === 'audio' ? '' : ` · ${getSelectedQualityLabel()}`}`,
            filenameTemplate,
            filenameBase,
            audioFilenameBase,
            createdAt,
            index: nameOpts.index,
            part: 1,
            partTitle: item.title
          });
          activeJobs.set(jobId, job);
          mountJobCard(job);
          updateProgress('prepare', 0, 0, 0, jobId);
          try {
            let qn = Number(retryTask?.requestedQn) || queueQn;
            if (queueCancelled) throw new Error('下载已取消');
            await ensureListItemVideoIds(item);
            if (queueCancelled) throw new Error('下载已取消');
            job.info.aid = item.aid;
            job.info.cid = item.cid;
            let wasDowngraded = false;
            let actualLabel = '音频';
            if (wantsVideo) {
              if (queueCancelled) throw new Error('下载已取消');
              const qualityData = await agentCall('GET_QUALITIES', { aid: item.aid, cid: item.cid });
              if (queueCancelled) throw new Error('下载已取消');
              const available = qualityData.qualities || [];
              if (!isRetry && queueStrategy === 'highest' && available.length) {
                qn = available.reduce((highest, quality) => Number(quality.qn) > Number(highest.qn) ? quality : highest, available[0]).qn;
              }
              const requested = available.find((quality) => quality.qn === qn);
              const actualQuality = queueSpaceTier && !isRetry ? chooseSpaceQuality(available, queueSpaceTier)
                : requested || available.filter((quality) => Number(quality.qn) < Number(qn))
                  .sort((a, b) => Number(b.qn) - Number(a.qn))[0];
              qn = actualQuality?.qn;
              if (!qn) throw new Error('该视频没有可下载的清晰度');
              wasDowngraded = !queueSpaceTier && !requested;
              job.requestedQn = qn;
              actualLabel = actualQuality.label || `${qn}P`;
              if (actualQuality.mode === 'dash') await setupMuxInPage();
            }
            job.label = `列表 · ${contentLabel}${wantsVideo ? ` · ${actualLabel}` : ''}${wasDowngraded ? '（降级）' : ''}`;
            const labelEl = job.cardEl?.querySelector('.bili-dl-progress-q');
            if (labelEl) labelEl.textContent = job.label;
            let videoResult = null;
            if (wantsVideo) {
              videoResult = await runSingleDownload(item, {
                qn, format: 'mp4', streamPreference: queueStreamPreference, jobId,
                filenameBase: job.filenameBase, filenameTemplate: job.filenameTemplate,
                createdAt: job.createdAt, index: job.index, qualityLabel: actualLabel,
                reuseAudio: downloadKind === 'both'
              });
              job.videoSaved = true;
              await addHistory({ bvid: item.bvid, aid: item.aid, cid: item.cid, pageIndex: 0, title: item.title, label: `视频 · ${actualLabel}`, format: 'mp4', downgraded: wasDowngraded, ts: Date.now() }).catch((error) => debugLog('历史', '视频已保存，历史记录写入失败：' + error.message));
            }
            if (wantsAudio) {
              if (downloadKind === 'both') {
                job.label = '列表 · 仅音频';
                if (labelEl) labelEl.textContent = job.label;
              }
              const reused = downloadKind === 'both'
                ? await saveReusedAudio(videoResult, job.audioFilenameBase, () => Boolean(activeJobs.get(jobId)?.cancelRequested || queueCancelled), jobId)
                : null;
              if (!reused) {
                await runSingleDownload(item, {
                  qn, format: 'm4a', streamPreference: queueStreamPreference, jobId,
                  filenameBase: job.audioFilenameBase, filenameTemplate: job.filenameTemplate,
                  createdAt: job.createdAt, index: job.index, qualityLabel: '音频'
                });
              }
              job.audioSaved = true;
              await addHistory({ bvid: item.bvid, aid: item.aid, cid: item.cid, pageIndex: 0, title: item.title, label: '音频', format: 'm4a', ts: Date.now() }).catch((error) => debugLog('历史', '音频已保存，历史记录写入失败：' + error.message));
            }
            ok++;
            if (wasDowngraded) downgraded++;
            selectedListBvids.delete(item.bvid);
            listItemsEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
              if (input.dataset.bvid === item.bvid) input.checked = false;
            });
            setTaskState(job, TASK_STATE.completed);
            debugLog('列表', `完成 ${index + 1}/${items.length}：${item.title}`);
          } catch (error) {
            const problem = classifyDownloadError(error);
            if (problem.type === 'cancelled') {
              cancelled++;
              failedTasks.push({ item, requestedQn: Number(retryTask?.requestedQn) || queueQn, downloadKind: job.videoSaved ? 'audio' : downloadKind, message: '已取消，可重试' });
              setTaskState(job, TASK_STATE.cancelled);
              debugLog('列表', `已取消 ${index + 1}/${items.length}：${item.title}`);
            } else {
              fail++;
              job.error = problem;
              setTaskState(job, TASK_STATE.failed, problem.message);
              failedTasks.push({ item, requestedQn: Number(retryTask?.requestedQn) || queueQn, downloadKind: job.videoSaved ? 'audio' : downloadKind, title: item.title, message: problem.message });
              debugLog('列表', `失败 ${index + 1}/${items.length}：${item.title} · ${problem.message}`);
            }
          } finally {
            removeJobCard(jobId);
            processed = index + 1;
          }
          if (job.error?.type === 'save') {
            for (const pendingItem of items.slice(index + 1)) {
              failedTasks.push({ item: pendingItem, requestedQn: queueQn, downloadKind: queueDownloadKind, message: '保存异常后未开始，可重试' });
            }
            setListStatus('保存异常，已停止后续下载；检查磁盘和浏览器下载记录后，可重试未完成视频。', 'error');
            processed = items.length;
            break;
          }
          // Give the browser a rendering/cleanup turn between full media jobs.
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } finally {
        if (queueCancelled) {
          for (const pendingItem of items.slice(processed)) {
            failedTasks.push({ item: pendingItem, requestedQn: queueQn, downloadKind: queueDownloadKind, message: '队列取消后未开始，可重试' });
          }
        }
        queueRunning = false;
        operationMode = null;
        resetQueueCancelButton();
        updateListSelection();
        lastListFailures = failedTasks;
        updateListRetryFailed();
        refreshStartBtnForParallel();
      }
      if (queueCancelled) setListStatus(`已取消 · 已保存 ${ok}/${items.length} 个${listDownloadKindLabel(queueDownloadKind)}`, 'error');
      else if (fail || cancelled) {
        setListStatus(`已结束 · 成功 ${ok} · 失败 ${fail} · 取消 ${cancelled}${downgraded ? ` · 清晰度降级 ${downgraded}` : ''}`, fail ? 'error' : 'success');
      }
      else setListStatus(`已完成 · 保存 ${ok} 个${listDownloadKindLabel(queueDownloadKind)}${downgraded ? ` · 清晰度降级 ${downgraded}` : ''}`, 'success');
      if (ok) {
        noteDownloadSuccessForRating();
      }
    }

    function syncSpaceDownloadAllVisibility() {
      const button = document.getElementById('bili-dl-space-download-all');
      if (!button || !isSpacePage()) return;
      if (isOpen) button.setAttribute('hidden', '');
      else button.removeAttribute('hidden');
    }

    function openMenuShell() {
      menu.classList.remove('hidden');
      menu.classList.remove('is-entering');
      void menu.offsetWidth;
      menu.classList.add('is-entering');
      toggleBtn.title = '收起下载助手';
      toggleBtn.setAttribute('aria-label', '收起下载助手');
      toggleBtn.setAttribute('aria-expanded', 'true');
      syncSpaceDownloadAllVisibility();
    }

    function closeMenuShell() {
      menu.classList.add('hidden');
      menu.classList.remove('is-entering');
      toggleBtn.title = '打开下载助手';
      toggleBtn.setAttribute('aria-label', '打开下载助手');
      toggleBtn.setAttribute('aria-expanded', 'false');
      syncSpaceDownloadAllVisibility();
    }
    toggleBtn.onclick = async () => {
      if (toggleDragged) return; // 拖拽后不触发点击
      if (isOpen) {
        isOpen = false;
        closeMenuShell();
        return;
      }
      isOpen = true;
      modeTabsEl.classList.toggle('hidden', !isListPage());
      menu.classList.toggle('is-list-page', isListPage());
      if (isListPage() && activeMode === 'list') await setDownloadMode('list');
      else if (!isListPage()) setDownloadMode('video');
      openMenuShell();
      await loadVideoInfo();
    };
    closeBtn.onclick = () => {
      isOpen = false;
      closeMenuShell();
    };
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isOpen || !menu.classList.contains('is-page')) return;
      showHome();
    });
    startBtn.onclick = () => {
      startDownload().catch((error) => {
        const message = error?.message || String(error);
        showStatus('error', message);
        debugLog('下载', `启动异常：${message}`);
      });
    };
    coverDownloadBtn.onclick = downloadCover;
    queueBtn.onclick = startQueueDownload;
    queuePauseBtn.onclick = toggleEntireQueuePause;
    queueCancelBtn.onclick = cancelEntireQueue;
    listQueuePauseBtn.onclick = toggleEntireQueuePause;
    listQueueCancelBtn.onclick = cancelEntireQueue;
    listStartBtn.onclick = startListDownload;
    listRefreshPageBtn.onclick = () => refreshSpaceCurrentPage(false);
    listLoadMoreBtn.onclick = () => isSpacePage() ? prepareAllSpaceUploads(listLoadMoreBtn) : loadMoreListItems();
    listRetryFailedBtn.onclick = () => startListDownload(lastListFailures);
    listDownloadKindEl?.querySelectorAll('[data-list-download-kind]').forEach((button) => {
      button.onclick = () => setListDownloadKind(button.dataset.listDownloadKind);
    });
    listSelectAllBtn.onclick = () => {
      const allSelected = listItems.length > 0 && listItems.every((item) => selectedListBvids.has(item.bvid));
      if (allSelected) selectedListBvids.clear();
      else listItems.forEach((item) => selectedListBvids.add(item.bvid));
      if (listFilter === 'selected') renderListItems();
      else {
        listItemsEl.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = selectedListBvids.has(input.dataset.bvid); });
        updateListSelection();
      }
    };
    listSearchEl.oninput = () => {
      listQuery = listSearchEl.value.slice(0, 80);
      renderListItems();
    };
    listSortEl.onchange = () => {
      listSort = ['newest', 'oldest'].includes(listSortEl.value) ? listSortEl.value : 'default';
      renderListItems();
    };
    listFilterEl.querySelectorAll('[data-list-filter]').forEach((button) => {
      button.onclick = () => {
        listFilter = button.dataset.listFilter === 'selected' ? 'selected' : 'all';
        listFilterEl.querySelectorAll('[data-list-filter]').forEach((item) => item.classList.toggle('active', item === button));
        renderListItems();
      };
    });
    modeTabsEl.querySelectorAll('[data-mode]').forEach((button) => {
      button.onclick = () => setDownloadMode(button.dataset.mode).catch((error) => {
        setListStatus(`切换失败：${error.message || error}`, 'error');
        debugLog('列表', error.message || String(error));
      });
    });

    formatPillsEl.querySelectorAll('.bili-dl-pill[data-format]').forEach((btn) => {
      btn.onclick = () => setFormat(btn.dataset.format);
    });
    qualityStrategyEls.forEach((el) => {
      el.onchange = () => {
        qualityStrategy = el.value === 'highest' ? 'highest' : 'exact';
        qualityStrategyEls.forEach((item) => { item.value = qualityStrategy; });
        renderQualityPills(qualities);
        saveDownloadPrefs();
      };
    });
    if (EXT.storage?.onChanged) {
      EXT.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[THEME_PREF_KEY]) applyTheme(changes[THEME_PREF_KEY].newValue);
        const key = globalThis.BiliDlSettings?.STORAGE_KEY || 'biliDlSettings_v1';
        if (changes[key]?.newValue) applyFilenameSettings(globalThis.BiliDlSettings.normalizeSettings(changes[key].newValue));
      });
    }
    EXT.storage.local.get(THEME_PREF_KEY).then((data) => applyTheme(data[THEME_PREF_KEY])).catch(() => {});
    loadDownloadPrefs().catch(() => {});

    // FAB 可拖拽：按住按钮拖动；小位移松开仍算点击打开面板
    // 用 document 级 move/up，并禁用 img 原生拖图（B 站页上 capture 常被抢走）
    let toggleDragged = false;
    let dragActive = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragPanelLeft = 0;
    let dragPanelTop = 0;
    let dragMoved = false;
    let dragPointerId = null;

    const fabPanel = document.getElementById('bili-dl-panel');
    const FAB_SIZE = 64;
    const FAB_MARGIN = 8;

    function clampFabPos(left, top) {
      const maxL = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN);
      const maxT = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN);
      return {
        left: Math.min(Math.max(left, FAB_MARGIN), maxL),
        top: Math.min(Math.max(top, FAB_MARGIN), maxT)
      };
    }

    function applyFabPos(left, top) {
      const p = clampFabPos(left, top);
      fabPanel.style.left = p.left + 'px';
      fabPanel.style.top = p.top + 'px';
      fabPanel.style.right = 'auto';
      fabPanel.style.bottom = 'auto';
      return p;
    }

    function onFabPointerMove(e) {
      if (!dragActive || e.pointerId !== dragPointerId) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 6) {
        dragMoved = true;
        toggleDragged = true;
        toggleBtn.classList.add('dragging');
      }
      if (dragMoved) {
        e.preventDefault();
        applyFabPos(dragPanelLeft + dx, dragPanelTop + dy);
      }
    }

    function onFabPointerUp(e) {
      if (!dragActive || e.pointerId !== dragPointerId) return;
      dragActive = false;
      dragPointerId = null;
      document.removeEventListener('pointermove', onFabPointerMove, true);
      document.removeEventListener('pointerup', onFabPointerUp, true);
      document.removeEventListener('pointercancel', onFabPointerUp, true);
      toggleBtn.classList.remove('dragging');
      fabPanel.style.transition = '';

      if (dragMoved) {
        const r = fabPanel.getBoundingClientRect();
        const p = applyFabPos(r.left, r.top);
        EXT.storage.local.set({ biliDlFabPos: p }).catch(() => {});
      }
      // 延后清标记，避免紧随其后的 click 误开面板
      setTimeout(() => { toggleDragged = false; }, 120);
    }

    toggleBtn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      dragActive = true;
      dragMoved = false;
      toggleDragged = false;
      dragPointerId = e.pointerId;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const r = fabPanel.getBoundingClientRect();
      // 以 FAB 左上角为准（菜单展开时 panel 很大，不能用整块宽高）
      dragPanelLeft = r.right - FAB_SIZE;
      dragPanelTop = r.bottom - FAB_SIZE;
      // 若已是 left/top 定位，直接用当前 left/top
      if (fabPanel.style.left && fabPanel.style.left !== 'auto') {
        dragPanelLeft = parseFloat(fabPanel.style.left) || dragPanelLeft;
        dragPanelTop = parseFloat(fabPanel.style.top) || dragPanelTop;
      }
      fabPanel.style.transition = 'none';
      applyFabPos(dragPanelLeft, dragPanelTop);
      document.addEventListener('pointermove', onFabPointerMove, true);
      document.addEventListener('pointerup', onFabPointerUp, true);
      document.addEventListener('pointercancel', onFabPointerUp, true);
    });

    toggleBtn.addEventListener('dragstart', (e) => e.preventDefault());

    // 恢复上次拖拽位置；窗口缩放时夹回可视区
    EXT.storage.local.get('biliDlFabPos').then(({ biliDlFabPos: pos }) => {
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        applyFabPos(pos.left, pos.top);
      }
    }).catch(() => {});

    let fabResizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(fabResizeTimer);
      fabResizeTimer = setTimeout(() => {
        const left = parseFloat(fabPanel.style.left);
        const top = parseFloat(fabPanel.style.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return;
        const p = applyFabPos(left, top);
        EXT.storage.local.set({ biliDlFabPos: p }).catch(() => {});
      }, 100);
    });

    panel.querySelector('.bili-dl-feedback')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.currentTarget;
      const label = btn.querySelector('.bili-dl-feedback-label');
      let copied = false;
      try {
        await copyTextToClipboard(FEEDBACK_EMAIL);
        copied = true;
      } catch { /* 复制失败时改开诊断页，便于手动反馈 */ }
      if (copied && label) {
        const prev = label.textContent;
        label.textContent = '已复制';
        btn.classList.add('is-copied');
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => {
          label.textContent = prev || '反馈';
          btn.classList.remove('is-copied');
        }, 1600);
        return;
      }
      openInfoSheet('feedback').catch(() => {});
    });

    window.__BILI_DL_API__ = {
      fetchSnapshot,
      openPanel: async (mode = 'video', opts = {}) => {
        isOpen = true;
        openMenuShell();
        modeTabsEl.classList.toggle('hidden', !isListPage());
        menu.classList.toggle('is-list-page', isListPage());
        if (mode === 'list' && isListPage()) await setDownloadMode('list');
        else setDownloadMode('video');
        await loadVideoInfo();
        if (opts.sheet) await openInfoSheet(opts.sheet);
      }
    };

    async function prepareAllSpaceUploads(button) {
      if (spaceGathering || queueRunning || listLoading) return;
      const href = location.href;
      spaceGathering = true;
      button.disabled = true;
      listLoaded = false;
      updateListSelection();
      try {
        await window.__BILI_DL_API__.openPanel('list');
        if (!listLoaded || href !== location.href) return;
        while (listHasMore && href === location.href) {
          if (!await loadMoreListItems()) return;
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        if (href !== location.href) return;
        if (listItems.length !== listTotal) {
          setListStatus(`已读取 ${listItems.length} / ${listTotal} 个投稿，数量有变化，请重新读取后确认。`, 'error');
          return;
        }
        selectedListBvids = new Set(listItems.map((item) => item.bvid));
        renderListItems();
        setListStatus(`已读取并选中全部 ${listItems.length} 个投稿，选择清晰度和下载内容后开始下载。`);
      } catch (error) {
        setListStatus(`读取全部投稿失败：${error.message || error}`, 'error');
      } finally {
        spaceGathering = false;
        button.disabled = false;
        updateListSelection();
        updateListLoadMore();
      }
    }

    // Space is a SPA: reattach the entry when the native video heading is replaced.
    function mountSpaceEntry() {
      if (!isSpacePage()) {
        document.getElementById('bili-dl-space-download-all')?.setAttribute('hidden', '');
        return;
      }
      if (document.getElementById('bili-dl-space-download-all')) {
        syncSpaceDownloadAllVisibility();
        return;
      }
      const heading = [...document.querySelectorAll('h1,h2,h3,.section-title,.part-title,.video-title,.upload-title,.video-header .title')]
        .find((node) => /^(?:TA的视频|TA 的视频|我的视频|视频)(?:\s*[·\-]?\s*\d+)?$/.test(node.textContent.trim()));
      if (!heading) return;
      const button = document.createElement('button');
      button.id = 'bili-dl-space-download-all';
      button.type = 'button';
      button.title = '读取该 UP 主的全部视频投稿并打开批量下载面板';
      button.setAttribute('aria-label', '下载该 UP 主的全部视频投稿');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4');
      icon.appendChild(path);
      button.append(icon, document.createTextNode('下载全部'));
      button.onclick = () => prepareAllSpaceUploads(button);
      heading.appendChild(button);
      syncSpaceDownloadAllVisibility();
    }
    if (location.hostname === 'space.bilibili.com') {
      let entryTimer;
      let pageWatchTimer;
      let lastSpaceDomPage = readSpaceDomPageNumber();
      new MutationObserver((mutations) => {
        clearTimeout(entryTimer);
        entryTimer = setTimeout(mountSpaceEntry, 200);
        if (mutationTouchesExtension(mutations)) return;
        clearTimeout(pageWatchTimer);
        pageWatchTimer = setTimeout(() => {
          if (!isSpacePage()) return;
          if (queueRunning || downloading || spaceGathering || listLoading) return;
          const pn = readSpaceDomPageNumber();
          if (pn === lastSpaceDomPage) return;
          lastSpaceDomPage = pn;
          if (isOpen && activeMode === 'list' && listLoaded) {
            refreshSpaceCurrentPage(true);
          }
        }, 250);
      }).observe(document.body, { childList: true, subtree: true });
      mountSpaceEntry();
    }

    let lastUrl = location.href;

    function onUrlChanged() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      const p = Number(new URL(location.href).searchParams.get('p')) || 0;
      pageIndex = Math.max(0, p - 1);
      snapshotCache = null;
      snapshotCacheKey = '';
      listLoaded = false;
      listItems = [];
      selectedListBvids = new Set();
      cachedSpaceDomPage = readSpaceDomPageNumber();
      syncSpaceListTools();
      modeTabsEl.classList.toggle('hidden', !isListPage());
      menu.classList.toggle('is-list-page', isListPage());
      if (isListPage() && activeMode === 'list') setDownloadMode('list');
      else if (!isListPage()) setDownloadMode('video');
      // 下载中仍刷新视频信息，便于「加入队列」下一集；不打断进度条
      if (!downloading && !queueRunning) {
        videoInfo = null;
        selectedQn = 0;
      }
      if (isOpen) loadVideoInfo();
    }

    // SPA 路由监听：popstate（前进/后退）+ 拦截 pushState/replaceState（站内切换）
    window.addEventListener('popstate', onUrlChanged);
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const ret = origPush.apply(this, args);
      onUrlChanged();
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = origReplace.apply(this, args);
      onUrlChanged();
      return ret;
    };
    // 兜底：站内其他改 URL 方式（location 直接赋值等）
    window.addEventListener('hashchange', onUrlChanged);

    function autoOpenPanelSoon() {
      setTimeout(() => {
        isOpen = true;
        modeTabsEl.classList.toggle('hidden', !isListPage());
        menu.classList.toggle('is-list-page', isListPage());
        openMenuShell();
        loadVideoInfo();
      }, 600);
    }

    try {
      if (sessionStorage.getItem('biliDlAutoOpen')) {
        sessionStorage.removeItem('biliDlAutoOpen');
        autoOpenPanelSoon();
      }
    } catch { /* ignore */ }

    // popup 历史「打开」等跨标签场景用 storage 标记
    EXT.storage.local.get('biliDlAutoOpen').then(({ biliDlAutoOpen: flag }) => {
      if (!flag) return;
      EXT.storage.local.remove('biliDlAutoOpen').catch(() => {});
      autoOpenPanelSoon();
    }).catch(() => {});
  }

  function waitAndMount() {
    if (document.body) mountUI();
    else setTimeout(waitAndMount, 100);
  }
  waitAndMount();

  EXT.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const api = window.__BILI_DL_API__;
    if (!api) {
      sendResponse({ ok: false, error: '页面未就绪，请刷新后重试' });
      return;
    }
    if (msg.type === 'BILI_DL_GET_INFO') {
      api.fetchSnapshot()
        .then((data) => sendResponse({ ok: true, data }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.type === 'BILI_DL_OPEN_PANEL') {
      api.openPanel(msg.mode, { sheet: msg.sheet })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });
})();

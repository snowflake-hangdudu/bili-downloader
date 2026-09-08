(function () {
  'use strict';

  if (window.__BILI_DL_INIT__) return;
  window.__BILI_DL_INIT__ = true;
  const EXT = typeof browser !== 'undefined' ? browser : chrome;

  const PANEL = 'bili-dl-panel';
  const AGENT = 'bili-dl-agent';
  const VERSION = EXT.runtime.getManifest().version;
  // 图标资源缓存破坏：换图标后递增 ICON_REV，避免只 F5 仍显示旧图
  const ICON_REV = '26';
  const ICON_URL = EXT.runtime.getURL(`icons/icon128.png?r=${ICON_REV}`);
  const FAQ_URL = 'https://snowflake-hangdudu.github.io/bili-downloader/faq.html';
  const PRIVACY_URL = 'https://snowflake-hangdudu.github.io/bili-downloader/';
  const CONTENT_JSON_URL = 'http://124.222.62.190:8081/api/config/bilibili';
  const CONTENT_CACHE_KEY = 'biliDlRemoteContent_v1';
  const DOWNLOAD_PREFS_KEY = 'biliDlDownloadPrefs_v1';
  const CONTENT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  const DEFAULT_REMOTE_CONTENT = {
    notice: { enabled: true, title: '公告', updated: '', body: '暂未获取到最新公告，请稍后再试。\n\n下载功能不受影响。' },
    coop: { enabled: true, title: '开发合作', updated: '', body: '接浏览器插件定制开发。\n\n有合作意向请联系 QQ：748604487\n邮箱：hangdudu0@agent.qq.com\n请备注「插件开发」，并简单说明需求。' },
    rating: { enabled: false, url: '', minSuccess: 3 }
  };
  const STORE_RATING_KEY = 'biliDlStoreRating';
  const STORE_RATING_MIN_SUCCESS = 3;
  // 文案与 youtube-downloader 保持一致；仅评分状态随版本重置

  let muxReadyPromise = null;
  const MERGE_WORKER_URL = EXT.runtime.getURL('lib/m4s-mux-worker.js');
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

  function runMergeWorker(job) {
    let worker;
    try {
      worker = new Worker(MERGE_WORKER_URL);
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
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('加载失败: ' + file));
      (document.documentElement || document.head).appendChild(s);
    });
    muxReadyPromise = loadScript('mp4-remux.iife.js').then(() => loadScript('m4s-mux.js'));
    return muxReadyPromise;
  }

  async function downloadBlob(blob, filename, shouldCancel = () => false) {
    if (shouldCancel()) throw new Error('下载已取消');
    if (!blob?.size || !filename) throw new Error('保存数据不可用，请刷新页面后重试');
    const url = URL.createObjectURL(blob);
    let downloadId;
    try {
      const started = await EXT.runtime.sendMessage({ type: 'BILI_DL_SAVE_MEDIA', url, filename });
      if (!started?.ok) throw new Error(started?.error || '无法创建浏览器下载');
      downloadId = started.downloadId;
      for (;;) {
        if (shouldCancel()) {
          await EXT.runtime.sendMessage({ type: 'BILI_DL_CANCEL_MEDIA', downloadId });
          throw new Error('下载已取消');
        }
        const result = await EXT.runtime.sendMessage({ type: 'BILI_DL_MEDIA_STATE', downloadId });
        if (!result?.ok) throw new Error(result?.error || '无法确认保存结果，请检查浏览器下载记录');
        if (result.state === 'complete') return downloadId;
        if (result.state === 'interrupted') throw new Error('浏览器保存失败：' + (result.error || '下载中断'));
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
  let qualityStrategy = 'exact'; // exact | highest
  // Selects among Bilibili's existing streams of the same resolution; never re-encodes.
  let streamPreference = 'high-bitrate'; // high-bitrate | compatible
  let filenameStyle = 'title-bvid-quality';
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
      const fmt = h.format === 'm4a' ? 'm4a' : 'mp4';
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
      <div id="bili-dl-panel">
        <button id="bili-dl-toggle" title="打开下载助手" aria-label="打开下载助手" aria-expanded="false">
          <img src="${ICON_URL}" alt="">
        </button>
        <div id="bili-dl-menu" class="hidden">
          <div class="bili-dl-header">
            <div class="bili-dl-header-left">
              <img class="bili-dl-header-icon" src="${ICON_URL}" alt="" width="22" height="22">
              <span class="bili-dl-title">下载助手 B站</span>
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

            <div id="bili-dl-format-row" class="bili-dl-format-row">
              <span class="bili-dl-info-item">格式</span>
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
            <label class="bili-dl-filename-row">文件名
              <select id="bili-dl-filename-style" aria-label="下载文件名规则">
                <option value="title">仅标题</option>
                <option value="title-bvid">标题 + BV 号</option>
                <option value="title-bvid-quality">标题 + BV 号 + 清晰度</option>
                <option value="detailed">标题 + UP 主 + BV 号 + 分 P + 清晰度</option>
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
            <button id="bili-dl-queue-pause" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">暂停全部</button>
            <button id="bili-dl-queue-cancel" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">取消整队</button>
            <div id="bili-dl-job-list" class="bili-dl-job-list hidden"></div>
            <div id="bili-dl-status" class="bili-dl-status hidden"></div>
          </div>
          <div id="bili-dl-list-body" class="bili-dl-list-body hidden">
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
            <label class="bili-dl-stream-preference-row">视频质量
              <select id="bili-dl-list-stream-preference" aria-label="列表视频流选择偏好" title="仅在同一清晰度的原始视频流之间选择">
                <option value="high-bitrate">高码率优先（推荐）</option>
                <option value="compatible">兼容优先</option>
              </select>
            </label>
            <div class="bili-dl-list-tools" role="search">
              <input id="bili-dl-list-search" type="search" maxlength="80" placeholder="搜索已加载视频标题" aria-label="搜索已加载视频标题">
              <div class="bili-dl-list-filter" role="group" aria-label="列表筛选">
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
              <strong id="bili-dl-list-title">视频列表</strong>
              <span><span id="bili-dl-list-count"></span> <button id="bili-dl-list-refresh" type="button">刷新</button></span>
            </div>
            <div id="bili-dl-list-items" class="bili-dl-list-items"></div>
            <button id="bili-dl-list-load-more" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">继续加载</button>
            <button id="bili-dl-list-start" type="button" class="bili-dl-btn" disabled>下载已选视频</button>
            <button id="bili-dl-list-queue-pause" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">暂停全部</button>
            <button id="bili-dl-list-queue-cancel" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">取消整队</button>
            <div id="bili-dl-list-job-list" class="bili-dl-job-list hidden"></div>
            <button id="bili-dl-list-retry-failed" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">重试失败视频</button>
            <p id="bili-dl-list-status" class="bili-dl-list-status hidden" aria-live="polite"></p>
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
              <button type="button" class="bili-dl-faq-link" data-sheet="notice">公告</button>
              <button type="button" class="bili-dl-faq-link" data-sheet="coop">开发合作</button>
              <a class="bili-dl-faq-link" href="${FAQ_URL}" target="_blank" rel="noopener">常见问题</a>
              <a class="bili-dl-privacy-link" href="${PRIVACY_URL}" target="_blank" rel="noopener">隐私政策</a>
              <button type="button" class="bili-dl-faq-link" data-sheet="diagnostics">诊断日志</button>
              <button type="button" class="bili-dl-faq-link" data-sheet="tasks">任务中心</button>
              <a class="bili-dl-feedback" href="mailto:hangdudu0@agent.qq.com?subject=B站视频下载助手反馈">反馈邮箱：hangdudu0@agent.qq.com</a>
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

    const toggleBtn = panel.querySelector('#bili-dl-toggle');
    const menu = panel.querySelector('#bili-dl-menu');
    const closeBtn = panel.querySelector('#bili-dl-close');
    const modeTabsEl = panel.querySelector('#bili-dl-mode-tabs');
    const videoBodyEl = panel.querySelector('#bili-dl-video-body');
    const listBodyEl = panel.querySelector('#bili-dl-list-body');
    const listHeadEl = panel.querySelector('#bili-dl-list-head');
    const listTitleEl = panel.querySelector('#bili-dl-list-title');
    const listCountEl = panel.querySelector('#bili-dl-list-count');
    const listRefreshBtn = panel.querySelector('#bili-dl-list-refresh');
    const listItemsEl = panel.querySelector('#bili-dl-list-items');
    const listSearchEl = panel.querySelector('#bili-dl-list-search');
    const listFilterEl = panel.querySelector('.bili-dl-list-filter');
    const listSortEl = panel.querySelector('#bili-dl-list-sort');
    const listLoadMoreBtn = panel.querySelector('#bili-dl-list-load-more');
    const listStartBtn = panel.querySelector('#bili-dl-list-start');
    const listPillsEl = panel.querySelector('#bili-dl-list-quality-pills');
    const listQueuePauseBtn = panel.querySelector('#bili-dl-list-queue-pause');
    const listQueueCancelBtn = panel.querySelector('#bili-dl-list-queue-cancel');
    const listJobListEl = panel.querySelector('#bili-dl-list-job-list');
    const listRetryFailedBtn = panel.querySelector('#bili-dl-list-retry-failed');
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
    const filenameStyleEl = panel.querySelector('#bili-dl-filename-style');
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
    const queueLabelEl = panel.querySelector('#bili-dl-queue-label');
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
      taskHistory.unshift({ ...job, info: { ...job.info }, phaseTimes: { ...job.phaseTimes }, finishedAt, elapsedMs: finishedAt - job.createdAt });
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
    const toLines = (value) => Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : String(value || '').split(/\n+/).map((item) => item.trim()).filter(Boolean);
    function fillPlainBody(el, text) { clearNode(el); toLines(text).forEach((line) => appendTextElement(el, 'p', '', line)); }
    function appendNoticeSection(el, title, value) { const lines = toLines(value); if (!lines.length) return; const section = document.createElement('section'); section.className = 'bili-dl-notice-section'; appendTextElement(section, 'h4', 'bili-dl-notice-section-title', title); const list = document.createElement('ul'); list.className = 'bili-dl-notice-list'; lines.forEach((line) => appendTextElement(list, 'li', '', line)); section.appendChild(list); el.appendChild(section); }
    function fillNoticeBody(el, notice) { clearNode(el); const roadmap = notice?.roadmap && typeof notice.roadmap === 'object' ? notice.roadmap : {}; const structured = ['pinned', 'recent', 'knownIssues'].some((key) => toLines(notice?.[key]).length) || ['feedback', 'upcoming', 'planned'].some((key) => toLines(roadmap[key]).length); if (!structured) { fillPlainBody(el, notice?.body || '暂无新公告'); return; } appendNoticeSection(el, '置顶说明', notice.pinned); appendNoticeSection(el, '最近更新', notice.recent); appendNoticeSection(el, '已知问题', notice.knownIssues); const plans = [['征集中', roadmap.feedback], ['即将更新', roadmap.upcoming], ['计划中', roadmap.planned]]; if (plans.some(([, value]) => toLines(value).length)) { const section = document.createElement('section'); section.className = 'bili-dl-notice-section'; appendTextElement(section, 'h4', 'bili-dl-notice-section-title', '开发计划'); plans.forEach(([label, value]) => { const lines = toLines(value); if (!lines.length) return; const group = document.createElement('div'); group.className = 'bili-dl-notice-plan'; appendTextElement(group, 'strong', 'bili-dl-notice-plan-label', label); const list = document.createElement('ul'); list.className = 'bili-dl-notice-list'; lines.forEach((line) => appendTextElement(list, 'li', '', line)); group.appendChild(list); section.appendChild(group); }); el.appendChild(section); } }
    function mergeRemoteContent(data) { return { notice: { ...DEFAULT_REMOTE_CONTENT.notice, ...(data.notice || {}) }, coop: { ...DEFAULT_REMOTE_CONTENT.coop, ...(data.coop || {}) }, rating: { ...DEFAULT_REMOTE_CONTENT.rating, ...(data.rating || {}) } }; }
    function detectBrowserStore() {
      const ua = navigator.userAgent || '';
      if (/\bFirefox\b/i.test(ua)) return 'firefox';
      if (/\bEdg\b/i.test(ua)) return 'edge';
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

    function formatCacheAge(fetchedAt) {
      return `${Math.max(0, Math.floor((Date.now() - fetchedAt) / 60000))} 分钟`;
    }

    async function loadRemoteContentNow() {
      let cached = null;
      try {
        const stored = await EXT.storage.local.get(CONTENT_CACHE_KEY);
        cached = getCachedRemoteContent(stored[CONTENT_CACHE_KEY]);
        if (cached?.fetchedAt && Date.now() - cached.fetchedAt < CONTENT_CACHE_TTL_MS) {
          remoteContent = mergeRemoteContent(cached.data);
          debugLog('配置', `已使用 12 小时缓存（缓存 ${formatCacheAge(cached.fetchedAt)}），未请求接口`);
          applyRemoteButtons();
          return remoteContent;
        }
        if (cached) debugLog('配置', cached.fetchedAt ? '12 小时缓存已过期，准备请求接口' : '旧版缓存无时间信息，准备请求接口');
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
    function unlockMenuHeight() {
      menu.style.removeProperty('--bili-dl-sheet-min');
      menu.style.height = '';
      menu.style.minHeight = '';
    }
    function rememberSheetMinHeight() {
      // 固定一次高度：子项 flex:1 1 0% 才能出现内部滚动；不要反复改 height
      const h = Math.round(menu.getBoundingClientRect().height);
      if (h > 0) {
        menu.style.setProperty('--bili-dl-sheet-min', h + 'px');
        menu.style.height = h + 'px';
      }
    }
    function renderInfoSheet(key, item) {
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
      if (key === 'diagnostics') {
        infoTitle.textContent = '诊断日志';
        infoDate.textContent = `本页保留最近 ${debugEntries.length} / 100 条；已隐藏链接和敏感参数。`;
        infoDate.classList.remove('hidden');
        clearNode(infoBody);
        const timingLines = [...activeJobs.values(), ...taskHistory].map((job) => `任务：${job.info?.title || '视频'} · ${job.state} · ${formatTaskTimings(job)}`);
        const report = ['B站视频下载助手诊断报告', `时间：${new Date().toLocaleString('zh-CN')}`, `页面：${location.pathname}`, '', '任务阶段耗时：', ...(timingLines.length ? timingLines : ['暂无任务']), '', '日志：', ...debugEntries.map((entry) => `[${entry.time}] ${entry.step}：${entry.msg}`)].join('\n');
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
            await navigator.clipboard.writeText(report);
            copy.textContent = '已复制';
          } catch {
            textarea.focus();
            textarea.select();
            document.execCommand('copy');
            copy.textContent = '已复制';
          }
        };
        infoBody.append(textarea, copy);
        return;
      }
      const data = item || {};
      infoTitle.textContent = data.title || (key === 'coop' ? '开发合作' : '公告');
      infoDate.textContent = data.updated ? '更新：' + data.updated : '';
      infoDate.classList.toggle('hidden', !data.updated);
      if (key === 'notice') fillNoticeBody(infoBody, data);
      else fillPlainBody(infoBody, data.body);
    }
    function showHome() {
      pageEl?.classList.add('hidden');
      homeEl?.classList.remove('hidden');
      menu.classList.remove('is-page');
      unlockMenuHeight();
    }
    async function openInfoSheet(key) {
      // 记住当前高度作 min-height，不锁死 height，长文在页面内滚动，避免裁切与上下抖
      menu.classList.remove('is-entering');
      rememberSheetMinHeight();
      renderInfoSheet(key, remoteContent[key]);
      homeEl?.classList.add('hidden');
      pageEl?.classList.remove('hidden');
      menu.classList.add('is-page');
      pageEl.scrollTop = 0;
      if (key === 'diagnostics' || key === 'tasks') return;
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
      return EXT.storage.local.set({ [DOWNLOAD_PREFS_KEY]: { format: selectedFormat, qn: selectedQn, qualityStrategy, streamPreference, filenameStyle } }).catch(() => {});
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
        if (prefs.format === 'mp4' || prefs.format === 'm4a') setFormat(prefs.format);
        if (Number(prefs.qn) > 0) selectedQn = Number(prefs.qn);
        if (prefs.qualityStrategy === 'highest' || prefs.qualityStrategy === 'exact') qualityStrategy = prefs.qualityStrategy;
        if (prefs.streamPreference === 'compatible' || prefs.streamPreference === 'high-bitrate') streamPreference = prefs.streamPreference;
        if (['title', 'title-bvid', 'title-bvid-quality', 'detailed'].includes(prefs.filenameStyle)) filenameStyle = prefs.filenameStyle;
        qualityStrategyEls.forEach((el) => { el.value = qualityStrategy; });
        streamPreferenceEls.forEach((el) => { el.value = streamPreference; });
        if (filenameStyleEl) filenameStyleEl.value = filenameStyle;
        syncQualitySelection();
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
      return /^\/list\//.test(location.pathname);
    }

    function setListStatus(text, type = '') {
      listStatusEl.textContent = text;
      listStatusEl.classList.toggle('hidden', !text);
      listStatusEl.dataset.type = type;
    }

    function formatDuration(sec) {
      const value = Math.max(0, Number(sec) || 0);
      return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    }

    function updateListSelection() {
      const count = selectedListBvids.size;
      listStartBtn.disabled = !count || queueRunning;
      listStartBtn.textContent = count ? `下载已选 ${count} 个视频` : '下载已选视频';
    }

    function updateListLoadMore() {
      const visible = listHasMore || listLoading;
      listLoadMoreBtn.classList.toggle('hidden', !visible);
      listLoadMoreBtn.disabled = listLoading || !listHasMore;
      listLoadMoreBtn.textContent = listLoading
        ? '正在加载…'
        : `继续加载（已加载 ${listItems.length} 个）`;
    }

    function updateListRetryFailed() {
      const count = lastListFailures.length;
      listRetryFailedBtn.classList.toggle('hidden', !count);
      listRetryFailedBtn.disabled = queueRunning;
      listRetryFailedBtn.textContent = count ? `重试失败视频（${count}）` : '重试失败视频';
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

    async function loadListItems(force = false) {
      if (listLoaded && !force) return;
      listLoading = true;
      updateListLoadMore();
      setListStatus(force ? '正在刷新列表…' : '正在读取视频列表…');
      try {
        const data = await agentCall('RESOLVE_LIST', {});
        listItems = Array.isArray(data.items) ? data.items : [];
        selectedListBvids = new Set();
        listCursor = data.cursor || null;
        listHasMore = !!data.hasMore;
        listTitleEl.textContent = data.title || '视频列表';
        listCountEl.textContent = `已加载 ${listItems.length}${data.total ? ` / 共 ${data.total}` : ''} 个`;
        listLoaded = true;
        renderListItems();
        setListStatus(listItems.length ? '可选择已加载的视频；长列表请先向下滚动 B 站页面，再点“刷新”。' : '未读取到视频，请刷新页面后重试。');
        debugLog('列表', `已读取 ${listItems.length} 个视频`);
      } catch (error) {
        setListStatus(`列表读取失败：${error.message || error}`, 'error');
        debugLog('列表', `读取失败：${error.message || error}`);
      } finally {
        listLoading = false;
        updateListLoadMore();
      }
    }

    async function loadMoreListItems() {
      if (listLoading || !listHasMore) return;
      listLoading = true;
      updateListLoadMore();
      setListStatus(`正在加载更多视频（当前 ${listItems.length} 个）…`);
      try {
        const data = await agentCall('LOAD_LIST_PAGE', { cursor: listCursor });
        const added = mergeListItems(data.items);
        listCursor = data.cursor || listCursor;
        listHasMore = !!data.hasMore && added > 0;
        listCountEl.textContent = `已加载 ${listItems.length}${data.total ? ` / 共 ${data.total}` : ''} 个`;
        renderListItems();
        setListStatus(added ? `已加载 ${added} 个视频，可继续选择。` : '没有更多可加载的视频。');
        debugLog('列表', `分页加载 ${added} 个，累计 ${listItems.length} 个`);
      } catch (error) {
        setListStatus(`继续加载失败：${error.message || error}`, 'error');
        debugLog('列表', `分页加载失败：${error.message || error}`);
      } finally {
        listLoading = false;
        updateListLoadMore();
      }
    }

    async function setDownloadMode(mode) {
      if (mode === 'list' && !isListPage()) return;
      if (operationMode && mode !== operationMode) {
        const text = operationMode === 'list' ? '列表下载进行中，请在当前页签查看进度或取消任务。' : '单视频下载进行中，请完成或取消后再切换页签。';
        if (activeMode === 'list') setListStatus(text, 'error');
        else showStatus('error', text);
        return;
      }
      activeMode = mode;
      videoBodyEl.classList.toggle('hidden', mode === 'list');
      listBodyEl.classList.toggle('hidden', mode !== 'list');
      menu.classList.toggle('is-list-mode', mode === 'list');
      if (mode === 'list') {
        estimateRequestId += 1;
        syncQualitySelection();
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
      if (mode === 'list') await loadListItems();
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
          estimateText.textContent = '预计大小：正在计算…';
          estimateEl.classList.remove('hidden');
          const est = await agentCall('GET_ESTIMATE', {
            aid: videoInfo.aid,
            cid: videoInfo.cid,
            duration: videoInfo.duration,
            audioOnly: true
          });
          if (requestId !== estimateRequestId || activeMode === 'list') return;
          currentEstimateBytes = Number(est.sizeBytes) || 0;
          let text = '预计大小：约 ' + (est.sizeLabel || '未知');
          if (est.estimateNote) text += '（' + est.estimateNote + '）';
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
        estimateText.textContent = '预计大小：正在计算…';
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
        let text = '预计大小：约 ' + (est.sizeLabel || '未知');
        if (est.estimateNote) text += '（' + est.estimateNote + '）';
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
      video: { jobList: jobListEl, queuePause: queuePauseBtn, queueCancel: queueCancelBtn, body: videoBodyEl },
      list: { jobList: listJobListEl, queuePause: listQueuePauseBtn, queueCancel: listQueueCancelBtn, body: listBodyEl }
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
      Object.entries(taskUi).forEach(([scope, ui]) => {
        const hasJobs = Array.from(activeJobs.values()).some((job) => jobScope(job) === scope);
        ui.jobList.classList.toggle('hidden', !hasJobs);
        const showQueueControls = queueRunning && operationMode === scope;
        ui.queuePause.classList.toggle('hidden', !showQueueControls);
        ui.queueCancel.classList.toggle('hidden', !showQueueControls);
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
        <div class="bili-dl-progress-head">
          <span class="bili-dl-job-phase">准备下载</span>
          <span class="bili-dl-job-pct">0%</span>
        </div>
        <div class="bili-dl-progress-track">
          <div class="bili-dl-progress-bar"></div>
        </div>
        <div class="bili-dl-progress-actions">
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

      cancelBtn.onclick = () => {
        job.cancelRequested = true;
        agentSignal('CANCEL_DOWNLOAD', { jobId: job.jobId });
      };

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
      el.querySelector('.bili-dl-progress-actions')?.classList.toggle('hidden', !visible);
    }

    updateProgress = (step, percent, received, total, jobId, meta = {}) => {
      const job = jobId ? activeJobs.get(jobId) : null;
      const el = job?.cardEl;
      if (!el) return;
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
      const qRes = await agentCall('GET_QUALITIES', { aid: res.info.aid, cid: res.info.cid });
      snapshotCache = {
        info: res.info,
        qualities: qRes.qualities || [],
        maxLabel: qRes.maxLabel || '',
        loginHint: qRes.loginHint || null
      };
      snapshotCacheAt = now;
      snapshotCacheKey = key;
      return snapshotCache;
    }

    async function loadVideoInfo() {
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
        videoInfo = snap.info;
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
        if (snap.qualities.some((q) => q.mode === 'dash')) {
          setupMuxInPage().catch(() => {});
        }
        refreshStartBtnForQueue();

        debugLog('加载', `${videoInfo.aid}/${videoInfo.cid} · ${snap.qualities.map((q) => q.label).join(', ')}`);
      } catch (err) {
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

    function buildFilenameBase(info, qn, format) {
      const quality = format === 'm4a' ? '音频' : (qualities.find((q) => q.qn === qn)?.label || `${qn}P`);
      const title = String(info?.title || 'bilibili-video').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim() || 'bilibili-video';
      const bvid = info?.bvid ? `BV${String(info.bvid).replace(/^BV/i, '')}` : '';
      const author = String(info?.author || '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim();
      if (filenameStyle === 'title') return title;
      if (filenameStyle === 'title-bvid') return [title, bvid].filter(Boolean).join(' - ');
      if (filenameStyle === 'detailed') return [title, author, bvid, quality].filter(Boolean).join(' - ');
      return [title, bvid, quality].filter(Boolean).join(' - ');
    }

    function refreshFilenamePreview() {
      if (!filenamePreviewEl) return;
      if (!videoInfo) {
        filenamePreviewEl.textContent = '文件名预览会在识别视频后显示';
        return;
      }
      const ext = selectedFormat === 'm4a' ? 'm4a' : 'mp4';
      filenamePreviewEl.textContent = `保存为：${buildFilenameBase(videoInfo, selectedQn, selectedFormat)}.${ext}`;
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
      return {
        scope: 'video',
        info: {
          bvid: videoInfo.bvid,
          aid: videoInfo.aid,
          cid: videoInfo.cid,
          title: videoInfo.title,
          author: videoInfo.author || ''
        },
        qn: selectedQn,
        format: selectedFormat,
        streamPreference,
        mode: sel?.mode || 'durl',
        pageIndex,
        label: selectedFormat === 'm4a' ? '音频' : getSelectedQualityLabel(),
        estimatedBytes: currentEstimateBytes
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
      const streamSelection = opts.streamPreference || streamPreference;
      const jobId = opts.jobId || null;
      const shouldCancel = () => Boolean(activeJobs.get(jobId)?.cancelRequested || (queueRunning && queueCancelled));
      await waitWhileQueuePaused();
      if (shouldCancel()) throw new Error('下载已取消');

      if (format === 'm4a') {
        const result = await agentCall('START_DOWNLOAD', {
          aid: info.aid,
          cid: info.cid,
          title: info.title,
          filenameBase: buildFilenameBase(info, qn, format),
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
        filenameBase: buildFilenameBase(info, qn, format),
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
            jobId
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
      const plan = isRetry ? retryPlan.map((item) => ({ ...item })) : videoInfo.pages.map((_part, index) => ({
        href: location.href, index, qn: selectedQn, format: selectedFormat, streamPreference,
        label: selectedFormat === 'm4a' ? '音频' : getSelectedQualityLabel(),
        mode: qualities.find((quality) => quality.qn === selectedQn)?.mode || 'durl'
      }));
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
            info: { title: `P${entry.index + 1}` }
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
                await runSingleDownload(job.info, { qn: entry.qn, format: entry.format, streamPreference: entry.streamPreference, jobId: job.jobId });
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
      if (!items.length || queueRunning) return;
      if (activeJobs.size > 0) {
        setListStatus('请先等待当前下载完成，再开始列表下载。', 'error');
        return;
      }
      const queueQn = selectedQn;
      const queueStrategy = qualityStrategy;
      const queueStreamPreference = streamPreference;
      queueRunning = true;
      operationMode = 'list';
      queueCancelled = false;
      queuePaused = false;
      listStartBtn.disabled = true;
      updateListRetryFailed();
      await setupMuxInPage().catch(() => {});
      let ok = 0;
      let fail = 0;
      let cancelled = 0;
      let downgraded = 0;
      const failedTasks = [];
      try {
        for (let index = 0; index < items.length; index++) {
          await waitWhileQueuePaused();
          if (queueCancelled) break;
          const item = items[index];
          const retryTask = isRetry ? retryTasks[index] : null;
          setListStatus(`正在下载 ${index + 1}/${items.length}：${item.title}`);
          const jobId = `list-${Date.now()}-${index}`;
          const job = createDownloadTask({
            jobId,
            scope: 'list',
            info: item,
            format: 'mp4',
            label: `列表 · ${getSelectedQualityLabel()}`
          });
          activeJobs.set(jobId, job);
          mountJobCard(job);
          updateProgress('prepare', 0, 0, 0, jobId);
          try {
            let qn = Number(retryTask?.requestedQn) || queueQn;
            const qualityData = await agentCall('GET_QUALITIES', { aid: item.aid, cid: item.cid });
            const available = qualityData.qualities || [];
            if (!isRetry && queueStrategy === 'highest' && available.length) {
              qn = available.reduce((highest, quality) => Number(quality.qn) > Number(highest.qn) ? quality : highest, available[0]).qn;
            }
            const requested = available.find((quality) => quality.qn === qn);
            const actualQuality = requested || available.filter((quality) => Number(quality.qn) < Number(qn))
              .sort((a, b) => Number(b.qn) - Number(a.qn))[0];
            qn = actualQuality?.qn;
            if (!qn) throw new Error('该视频没有可下载的清晰度');
            const wasDowngraded = !requested;
            job.requestedQn = qn;
            const actualLabel = actualQuality.label || `${qn}P`;
            job.label = `列表 · ${actualLabel}${wasDowngraded ? '（降级）' : ''}`;
            const labelEl = job.cardEl?.querySelector('.bili-dl-progress-q');
            if (labelEl) labelEl.textContent = job.label;
            const result = await runSingleDownload(item, { qn, format: 'mp4', streamPreference: queueStreamPreference, jobId });
            if (result.videoOnly) throw new Error('只下载到无音频视频轨');
            ok++;
            if (wasDowngraded) downgraded++;
            setTaskState(job, TASK_STATE.completed);
            await addHistory({ bvid: item.bvid, aid: item.aid, cid: item.cid, pageIndex: 0, title: item.title, label: actualLabel, format: 'mp4', downgraded: wasDowngraded, ts: Date.now() });
            debugLog('列表', `完成 ${index + 1}/${items.length}：${item.title}`);
          } catch (error) {
            const problem = classifyDownloadError(error);
            if (problem.type === 'cancelled') {
              cancelled++;
              setTaskState(job, TASK_STATE.cancelled);
              debugLog('列表', `已取消 ${index + 1}/${items.length}：${item.title}`);
            } else {
              fail++;
              job.error = problem;
              setTaskState(job, TASK_STATE.failed, problem.message);
              failedTasks.push({ item, requestedQn: Number(retryTask?.requestedQn) || queueQn, title: item.title, message: problem.message });
              debugLog('列表', `失败 ${index + 1}/${items.length}：${item.title} · ${problem.message}`);
            }
          } finally {
            removeJobCard(jobId);
          }
        }
      } finally {
        queueRunning = false;
        operationMode = null;
        resetQueueCancelButton();
        updateListSelection();
        lastListFailures = failedTasks;
        updateListRetryFailed();
        refreshStartBtnForParallel();
      }
      if (queueCancelled) setListStatus(`列表下载已取消：已保存 ${ok}/${items.length} 个视频`, 'error');
      else if (fail || cancelled) {
        const firstReason = failedTasks[0]?.message;
        setListStatus(`列表下载完成：成功 ${ok}，失败 ${fail}，已取消 ${cancelled}${downgraded ? `，清晰度降级 ${downgraded}` : ''}${firstReason ? `；首个失败原因：${firstReason}` : ''}`, fail ? 'error' : 'success');
      }
      else setListStatus(`列表下载完成：已保存 ${ok} 个视频${downgraded ? `（${downgraded} 个清晰度降级）` : ''}`, 'success');
      if (ok) {
        noteDownloadSuccessForRating();
      }
    }

    function openMenuShell() {
      menu.classList.remove('hidden');
      menu.classList.remove('is-entering');
      void menu.offsetWidth;
      menu.classList.add('is-entering');
      toggleBtn.title = '收起下载助手';
      toggleBtn.setAttribute('aria-label', '收起下载助手');
      toggleBtn.setAttribute('aria-expanded', 'true');
    }

    function closeMenuShell() {
      menu.classList.add('hidden');
      menu.classList.remove('is-entering');
      toggleBtn.title = '打开下载助手';
      toggleBtn.setAttribute('aria-label', '打开下载助手');
      toggleBtn.setAttribute('aria-expanded', 'false');
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
    listRetryFailedBtn.onclick = () => startListDownload(lastListFailures);
    listRefreshBtn.onclick = () => loadListItems(true);
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
      button.onclick = () => setDownloadMode(button.dataset.mode);
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
    streamPreferenceEls.forEach((el) => {
      el.onchange = () => {
        streamPreference = el.value === 'compatible' ? 'compatible' : 'high-bitrate';
        streamPreferenceEls.forEach((item) => { item.value = streamPreference; });
        refreshEstimate();
        saveDownloadPrefs();
      };
    });
    filenameStyleEl.onchange = () => {
      filenameStyle = filenameStyleEl.value;
      refreshFilenamePreview();
      saveDownloadPrefs();
    };
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

    panel.querySelector('.bili-dl-feedback')?.addEventListener('click', (e) => {
      e.preventDefault();
      const el = e.currentTarget;
      navigator.clipboard?.writeText('hangdudu0@agent.qq.com').catch(() => {});
      window.location.href = 'mailto:hangdudu0@agent.qq.com?subject=B站视频下载助手反馈';
    });

    window.__BILI_DL_API__ = {
      fetchSnapshot,
      openPanel: async (mode = 'video') => {
        isOpen = true;
        openMenuShell();
        modeTabsEl.classList.toggle('hidden', !isListPage());
        menu.classList.toggle('is-list-page', isListPage());
        if (mode === 'list' && isListPage()) await setDownloadMode('list');
        else setDownloadMode('video');
        await loadVideoInfo();
      }
    };

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
      api.openPanel(msg.mode)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });
})();

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
  const CONTENT_JSON_URL = 'https://download-config-hub.nutmeg-venus-6882.chatgpt.site/api/config/bilibili';
  const CONTENT_CACHE_KEY = 'biliDlRemoteContent_v1';
  const DEFAULT_REMOTE_CONTENT = {
    notice: { enabled: true, title: '公告', updated: '', body: '暂未获取到最新公告，请稍后再试。\n\n下载功能不受影响。' },
    coop: { enabled: true, title: '开发合作', updated: '', body: '接浏览器插件定制开发。\n\n有合作意向请发邮件。\n邮箱：hangdudu0@agent.qq.com' },
    rating: { enabled: false, url: '', minSuccess: 3 }
  };
  const STORE_RATING_KEY = 'biliDlStoreRating';
  const STORE_RATING_MIN_SUCCESS = 3;
  // 文案与 youtube-downloader 保持一致；仅评分状态随版本重置

  let muxReadyPromise = null;

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

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    return new Promise((resolve) => {
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
        resolve();
      }, 1000);
    });
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
  let pageIndex = 0;
  let isOpen = false;
  let reqId = 0;
  const pending = new Map();

  let downloading = false;
  let queueRunning = false;
  let queueCancelled = false;

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
          e.data.jobId
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
      const limit = Number(timeoutMs) > 0 ? timeoutMs : 20000;
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('页面代理超时，请刷新页面重试'));
        }
      }, limit);
    });
  }

  function agentSignal(type, extra = {}) {
    window.postMessage({ source: PANEL, type, ...extra }, '*');
  }

  let debugLog, showStatus, updateProgress;

  function mountUI() {
    if (document.getElementById('bili-dl-panel-root')) return;

    const panel = document.createElement('div');
    panel.id = 'bili-dl-panel-root';
    panel.appendChild(createFragment(`
      <div id="bili-dl-panel">
        <button id="bili-dl-toggle" title="下载视频">
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
          <div class="bili-dl-body">
            <div id="bili-dl-video-card" class="bili-dl-video-card">
              <div class="bili-dl-cover-wrap">
                <div id="bili-dl-cover-sk" class="bili-dl-sk-cover bili-dl-shimmer"></div>
                <img id="bili-dl-cover" class="bili-dl-cover hidden" alt="">
                <div id="bili-dl-cover-ph" class="bili-dl-cover-ph hidden">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </div>
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
            </div>

            <div id="bili-dl-format-row" class="bili-dl-format-row">
              <span class="bili-dl-info-item">格式</span>
              <div id="bili-dl-format-pills" class="bili-dl-format-pills">
                <button type="button" class="bili-dl-pill active" data-format="mp4">MP4 视频</button>
                <button type="button" class="bili-dl-pill" data-format="m4a">M4A 音频</button>
              </div>
            </div>

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
            <button id="bili-dl-queue-cancel" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">取消整队</button>
            <div id="bili-dl-job-list" class="bili-dl-job-list hidden"></div>
            <div id="bili-dl-status" class="bili-dl-status hidden"></div>
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
              <a class="bili-dl-faq-link" href="${FAQ_URL}" target="_blank" rel="noopener">常见问题</a>
              <a class="bili-dl-privacy-link" href="${PRIVACY_URL}" target="_blank" rel="noopener">隐私政策</a>
              <button type="button" class="bili-dl-faq-link" data-sheet="notice">公告</button>
              <button type="button" class="bili-dl-faq-link" data-sheet="coop">开发合作</button>
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
    const formatPillsEl = panel.querySelector('#bili-dl-format-pills');
    const estimateEl = panel.querySelector('#bili-dl-estimate');
    const estimateText = panel.querySelector('#bili-dl-estimate-text');
    const startBtn = panel.querySelector('#bili-dl-start');
    const queueBtn = panel.querySelector('#bili-dl-queue-all');
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

    function restoreStartButtonContent() {
      startBtn.replaceChildren(...defaultStartBtnNodes.map((node) => node.cloneNode(true)));
    }

    let remoteContent = { ...DEFAULT_REMOTE_CONTENT };
    const toLines = (value) => Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : String(value || '').split(/\n+/).map((item) => item.trim()).filter(Boolean);
    function fillPlainBody(el, text) { clearNode(el); toLines(text).forEach((line) => appendTextElement(el, 'p', '', line)); }
    function appendNoticeSection(el, title, value) { const lines = toLines(value); if (!lines.length) return; const section = document.createElement('section'); section.className = 'bili-dl-notice-section'; appendTextElement(section, 'h4', 'bili-dl-notice-section-title', title); const list = document.createElement('ul'); list.className = 'bili-dl-notice-list'; lines.forEach((line) => appendTextElement(list, 'li', '', line)); section.appendChild(list); el.appendChild(section); }
    function fillNoticeBody(el, notice) { clearNode(el); const roadmap = notice?.roadmap && typeof notice.roadmap === 'object' ? notice.roadmap : {}; const structured = ['pinned', 'recent', 'knownIssues'].some((key) => toLines(notice?.[key]).length) || ['feedback', 'upcoming', 'planned'].some((key) => toLines(roadmap[key]).length); if (!structured) { fillPlainBody(el, notice?.body || '暂无新公告'); return; } appendNoticeSection(el, '置顶说明', notice.pinned); appendNoticeSection(el, '最近更新', notice.recent); appendNoticeSection(el, '已知问题', notice.knownIssues); const plans = [['征集中', roadmap.feedback], ['即将更新', roadmap.upcoming], ['计划中', roadmap.planned]]; if (plans.some(([, value]) => toLines(value).length)) { const section = document.createElement('section'); section.className = 'bili-dl-notice-section'; appendTextElement(section, 'h4', 'bili-dl-notice-section-title', '开发计划'); plans.forEach(([label, value]) => { const lines = toLines(value); if (!lines.length) return; const group = document.createElement('div'); group.className = 'bili-dl-notice-plan'; appendTextElement(group, 'strong', 'bili-dl-notice-plan-label', label); const list = document.createElement('ul'); list.className = 'bili-dl-notice-list'; lines.forEach((line) => appendTextElement(list, 'li', '', line)); group.appendChild(list); section.appendChild(group); }); el.appendChild(section); } }
    function mergeRemoteContent(data) { return { notice: { ...DEFAULT_REMOTE_CONTENT.notice, ...(data.notice || {}) }, coop: { ...DEFAULT_REMOTE_CONTENT.coop, ...(data.coop || {}) }, rating: { ...DEFAULT_REMOTE_CONTENT.rating, ...(data.rating || {}) } }; }
    function ratingEnabled() { const rating = remoteContent.rating || {}; return rating.enabled === true && /^https:\/\//i.test(String(rating.url || '')); }
    function ratingUrl() { return ratingEnabled() ? String(remoteContent.rating.url) : ''; }
    function ratingMinSuccess() { const n = Number(remoteContent.rating?.minSuccess); return n > 0 ? n : STORE_RATING_MIN_SUCCESS; }
    function applyRemoteButtons() { panel.querySelectorAll('[data-sheet]').forEach((btn) => { const item = remoteContent[btn.dataset.sheet]; btn.classList.toggle('hidden', item?.enabled === false); }); if (!ratingEnabled()) storeRatingEl?.classList.add('hidden'); }
    async function loadRemoteContent() { try { const resp = await EXT.runtime.sendMessage({ type: 'BILI_DL_FETCH_JSON', url: CONTENT_JSON_URL }); if (resp?.ok && resp.data && typeof resp.data === 'object') { remoteContent = mergeRemoteContent(resp.data); await EXT.storage.local.set({ [CONTENT_CACHE_KEY]: { data: remoteContent } }); applyRemoteButtons(); return remoteContent; } } catch (_) {} try { const cached = await EXT.storage.local.get(CONTENT_CACHE_KEY); remoteContent = cached[CONTENT_CACHE_KEY]?.data ? mergeRemoteContent(cached[CONTENT_CACHE_KEY].data) : mergeRemoteContent({}); } catch (_) { remoteContent = mergeRemoteContent({}); } applyRemoteButtons(); return remoteContent; }
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
          hideStoreRatingBanner();
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

    function setFormat(fmt) {
      selectedFormat = fmt;
      formatPillsEl.querySelectorAll('.bili-dl-pill[data-format]').forEach((b) => {
        b.classList.toggle('active', b.dataset.format === fmt);
      });
      const isAudio = fmt === 'm4a';
      if (qualitySection) qualitySection.classList.toggle('hidden', isAudio);
      refreshEstimate();
    }

    debugLog = (step, msg) => console.log('[BiliDL]', step, msg);

    showStatus = (type, text) => {
      statusEl.classList.remove('hidden', 'success', 'error');
      statusEl.classList.add(type);
      statusEl.textContent = text;
    };

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
      if (!videoInfo?.aid || !videoInfo?.cid) {
        estimateEl.classList.add('hidden');
        return;
      }
      if (selectedFormat === 'm4a') {
        try {
          const est = await agentCall('GET_ESTIMATE', {
            aid: videoInfo.aid,
            cid: videoInfo.cid,
            duration: videoInfo.duration,
            audioOnly: true
          });
          let text = '预计大小：约 ' + (est.sizeLabel || '未知');
          if (est.estimateNote) text += '（' + est.estimateNote + '）';
          estimateText.textContent = text;
          estimateEl.classList.remove('hidden');
        } catch {
          estimateEl.classList.add('hidden');
        }
        return;
      }
      if (!selectedQn) {
        estimateEl.classList.add('hidden');
        return;
      }
      try {
        const est = await agentCall('GET_ESTIMATE', {
          aid: videoInfo.aid,
          cid: videoInfo.cid,
          qn: selectedQn,
          duration: videoInfo.duration
        });
        let text = '预计大小：约 ' + (est.sizeLabel || '未知');
        if (est.estimateNote) text += '（' + est.estimateNote + '）';
        estimateText.textContent = text;
        estimateEl.classList.remove('hidden');
      } catch {
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
    let jobSeq = 0;

    function syncJobListVisibility() {
      downloading = activeJobs.size > 0 || queueRunning;
      jobListEl.classList.toggle('hidden', activeJobs.size === 0);
      queueCancelBtn.classList.toggle('hidden', !queueRunning);
    }

    function cancelEntireQueue() {
      if (!queueRunning) return;
      queueCancelled = true;
      activeJobs.forEach((job) => {
        agentSignal('CANCEL_DOWNLOAD', { jobId: job.jobId });
      });
      queueCancelBtn.disabled = true;
      queueCancelBtn.textContent = '正在取消…';
    }

    function hideProgress() {
      activeJobs.forEach((j) => j.cardEl?.remove());
      activeJobs.clear();
      clearNode(jobListEl);
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
        const j = activeJobs.get(job.jobId);
        if (!j || j.merging) return;
        if (j.paused) {
          agentSignal('RESUME_DOWNLOAD', { jobId: job.jobId });
          j.paused = false;
          pauseBtn.textContent = '暂停';
          bar.classList.remove('paused');
        } else {
          agentSignal('PAUSE_DOWNLOAD', { jobId: job.jobId });
        }
      };

      cancelBtn.onclick = () => {
        agentSignal('CANCEL_DOWNLOAD', { jobId: job.jobId });
      };

      job.cardEl = el;
      job.paused = false;
      job.merging = false;
      jobListEl.appendChild(el);
      syncJobListVisibility();
      return el;
    }

    function removeJobCard(jobId) {
      const j = activeJobs.get(jobId);
      j?.cardEl?.remove();
      activeJobs.delete(jobId);
      syncJobListVisibility();
    }

    function setJobActionsVisible(el, visible) {
      el.querySelector('.bili-dl-progress-actions')?.classList.toggle('hidden', !visible);
    }

    updateProgress = (step, percent, received, total, jobId) => {
      const job = jobId ? activeJobs.get(jobId) : null;
      const el = job?.cardEl;
      if (!el) return;

      const phaseEl = el.querySelector('.bili-dl-job-phase');
      const pctEl = el.querySelector('.bili-dl-job-pct');
      const bar = el.querySelector('.bili-dl-progress-bar');
      const pauseBtn = el.querySelector('.bili-dl-job-pause');

      if (step === 'merge' || step === 'save') {
        job.merging = step === 'merge';
        setJobActionsVisible(el, step !== 'merge' && step !== 'save');
      } else if (step !== 'paused') {
        job.merging = false;
        setJobActionsVisible(el, true);
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
        phaseEl.textContent = sizeHint
          ? '正在合成，约 ' + formatBytes(sizeHint)
          : STEP_LABELS.merge;
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
      clearNode(pillsEl);
      if (!qualities.length) {
        appendTextElement(pillsEl, 'span', 'bili-dl-pill disabled', '无可用清晰度');
        selectedQn = 0;
        return;
      }
      if (!qualities.some((q) => q.qn === selectedQn)) {
        selectedQn = qualities[0].qn;
      }
      const frag = document.createDocumentFragment();
      qualities.forEach((q) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `bili-dl-pill${q.qn === selectedQn ? ' active' : ''}`;
        btn.dataset.qn = String(q.qn);
        btn.textContent = q.label;
        frag.appendChild(btn);
      });
      pillsEl.appendChild(frag);
      pillsEl.querySelectorAll('.bili-dl-pill[data-qn]').forEach((btn) => {
        btn.onclick = () => {
          selectedQn = +btn.dataset.qn;
          pillsEl.querySelectorAll('.bili-dl-pill').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          refreshEstimate();
        };
      });
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
          coverImg.src = videoInfo.pic;
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
        info: {
          bvid: videoInfo.bvid,
          aid: videoInfo.aid,
          cid: videoInfo.cid,
          title: videoInfo.title
        },
        qn: selectedQn,
        format: selectedFormat,
        mode: sel?.mode || 'durl',
        pageIndex,
        label: selectedFormat === 'm4a' ? '音频' : getSelectedQualityLabel()
      };
    }

    function refreshStartBtnForParallel() {
      if (queueRunning) return;
      const n = activeJobs.size;
      startBtn.disabled = !selectedQn || !videoInfo;
      if (n > 0) {
        startBtn.textContent = n >= PARALLEL_MAX ? `并行已满 (${n})` : `再下一个 (${n})`;
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
      const jobId = opts.jobId || null;

      if (format === 'm4a') {
        const result = await agentCall('START_DOWNLOAD', {
          aid: info.aid,
          cid: info.cid,
          title: info.title,
          audioOnly: true,
          jobId
        }, 600000);
        updateProgress('save', 100, 0, 0, jobId);
        return result;
      }

      const result = await agentCall('START_DOWNLOAD', {
        aid: info.aid,
        cid: info.cid,
        qn,
        title: info.title,
        jobId
      }, 600000);

      if (result.merged) {
        updateProgress('save', 95, 0, 0, jobId);
        const blob = result.blob || new Blob([result.mp4], { type: 'video/mp4' });
        await downloadBlob(blob, result.filename);
        updateProgress('save', 100, 0, 0, jobId);
      } else {
        updateProgress('save', 100, 0, 0, jobId);
      }
      return result;
    }

    function finishActiveJob(jobId) {
      removeJobCard(jobId);
      refreshStartBtnForParallel();
    }

    async function startDownload() {
      if (!selectedQn || !videoInfo || queueRunning) return;
      if (activeJobs.size >= PARALLEL_MAX) {
        showStatus('error', `最多同时 ${PARALLEL_MAX} 个下载，请等完成后再加`);
        return;
      }

      const job = captureDownloadJob();
      const jobId = `job-${Date.now()}-${++jobSeq}`;
      job.jobId = jobId;
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
            noteDownloadSuccessForRating();
          }
        } catch (err) {
          if (err.message === '下载已取消') {
            showStatus('error', `已取消：${job.info.title || '下载'}`);
          } else {
            showErrorWithFaq(err.message, errorFaqAnchor(err.message));
            debugLog('错误', err.message);
          }
        } finally {
          finishActiveJob(jobId);
        }
      })();
    }

    async function startQueueDownload() {
      if (!selectedQn || !videoInfo || !isMultiPartVideo(videoInfo.pages) || queueRunning) return;
      if (activeJobs.size > 0) {
        showStatus('error', '请先等当前并行下载结束，再使用分 P 队列');
        return;
      }
      if (!(await ensureMuxReady())) return;

      const total = videoInfo.pages.length;
      const qn = selectedQn;
      const format = selectedFormat;
      const label = format === 'm4a' ? '音频' : getSelectedQualityLabel();
      const mode = qualities.find((q) => q.qn === qn)?.mode || 'durl';

      queueRunning = true;
      queueCancelled = false;
      startBtn.disabled = true;
      queueBtn.disabled = true;
      queueLabelEl.textContent = '并行下载分 P…';
      queueCancelBtn.disabled = false;
      queueCancelBtn.textContent = '取消整队';
      statusEl.classList.add('hidden');
      syncJobListVisibility();

      let ok = 0;
      let fail = 0;
      let nextIndex = 0;

      async function runOnePart(i) {
        if (queueCancelled) return;
        const jobId = `part-${Date.now()}-${i}-${++jobSeq}`;
        let partInfo;
        try {
          const res = await agentCall('RESOLVE_VIDEO', { href: location.href, pageIndex: i });
          partInfo = res.info;
        } catch (err) {
          fail++;
          debugLog('队列', `P${i + 1} 解析失败: ${err.message}`);
          return;
        }

        const job = {
          jobId,
          info: partInfo,
          qn,
          format,
          mode,
          pageIndex: i,
          label: `P${i + 1} · ${label}`
        };
        activeJobs.set(jobId, job);
        mountJobCard(job);
        updateProgress('prepare', 0, 0, 0, jobId);

        const tryDownload = async () => {
          await runSingleDownload(partInfo, { qn, format, jobId });
        };

        try {
          await tryDownload();
          ok++;
          addHistory({
            bvid: partInfo.bvid,
            aid: partInfo.aid,
            cid: partInfo.cid,
            pageIndex: i,
            title: partInfo.title,
            label,
            format,
            ts: Date.now()
          });
        } catch (err) {
          if (err.message === '下载已取消' || queueCancelled) return;
          debugLog('队列', `P${i + 1} 失败，1s 后重试: ${err.message}`);
          updateProgress('queue', 0, 0, 0, jobId);
          const phase = job.cardEl?.querySelector('.bili-dl-job-phase');
          if (phase) phase.textContent = '重试中…';
          await new Promise((r) => setTimeout(r, 1000));
          if (queueCancelled) return;
          try {
            await tryDownload();
            ok++;
            addHistory({
              bvid: partInfo.bvid,
              aid: partInfo.aid,
              cid: partInfo.cid,
              pageIndex: i,
              title: partInfo.title,
              label,
              format,
              ts: Date.now()
            });
          } catch (retryErr) {
            if (retryErr.message === '下载已取消' || queueCancelled) return;
            fail++;
            debugLog('队列', `P${i + 1} 重试仍失败: ${retryErr.message}`);
          }
        } finally {
          removeJobCard(jobId);
        }
      }

      async function worker() {
        while (!queueCancelled) {
          const i = nextIndex++;
          if (i >= total) break;
          await runOnePart(i);
        }
      }

      const workers = Math.min(PARALLEL_MAX, total);
      await Promise.all(Array.from({ length: workers }, () => worker()));

      queueRunning = false;
      queueCancelBtn.disabled = false;
      queueCancelBtn.textContent = '取消整队';
      syncJobListVisibility();

      if (queueCancelled) {
        showStatus('error', `队列已取消（已完成 ${ok}/${total}）`);
      } else if (fail === 0) {
        showStatus('success', `队列下载完成，共 ${ok} 个分 P`);
        noteDownloadSuccessForRating();
      } else if (ok === 0) {
        showErrorWithFaq(
          `全部失败（${fail} 个）。先播放视频 2～3 秒，或换 720P 后重试`,
          'cdn-403'
        );
      } else {
        showErrorWithFaq(
          `部分完成：成功 ${ok}，失败 ${fail}。先播放 2～3 秒再重试，或换 720P`,
          'parts'
        );
      }

      setQueueLabel(total);
      restoreStartButtonContent();
      startBtn.disabled = !selectedQn || !videoInfo;
      queueBtn.disabled = false;
      refreshStartBtnForParallel();
    }

    function openMenuShell() {
      menu.classList.remove('hidden');
      menu.classList.remove('is-entering');
      void menu.offsetWidth;
      menu.classList.add('is-entering');
    }
    toggleBtn.onclick = async () => {
      if (toggleDragged) return; // 拖拽后不触发点击
      isOpen = !isOpen;
      if (isOpen) {
        openMenuShell();
        await loadVideoInfo();
      } else {
        menu.classList.add('hidden');
        menu.classList.remove('is-entering');
      }
    };
    closeBtn.onclick = () => {
      isOpen = false;
      menu.classList.add('hidden');
      menu.classList.remove('is-entering');
    };
    startBtn.onclick = startDownload;
    queueBtn.onclick = startQueueDownload;
    queueCancelBtn.onclick = cancelEntireQueue;

    formatPillsEl.querySelectorAll('.bili-dl-pill[data-format]').forEach((btn) => {
      btn.onclick = () => setFormat(btn.dataset.format);
    });

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
      openPanel: async () => {
        isOpen = true;
        openMenuShell();
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
        menu.classList.remove('hidden');
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
      api.openPanel()
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });
})();

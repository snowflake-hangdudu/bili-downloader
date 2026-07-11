(function () {
  'use strict';

  if (window.__BILI_DL_INIT__) return;
  window.__BILI_DL_INIT__ = true;

  const PANEL = 'bili-dl-panel';
  const AGENT = 'bili-dl-agent';
  const VERSION = chrome.runtime.getManifest().version;
  const ICON_URL = chrome.runtime.getURL('icons/icon128.png');

  function setupMuxInPage() {
    const base = chrome.runtime.getURL('lib/');
    ['mp4-remux.iife.js', 'm4s-mux.js'].forEach((file) => {
      const s = document.createElement('script');
      s.src = base + file;
      (document.documentElement || document.head).appendChild(s);
    });
  }
  setupMuxInPage();

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
  let pageIndex = 0;
  let isOpen = false;
  let reqId = 0;
  const pending = new Map();

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== AGENT) return;
    const { id, type, step, msg, data, error } = e.data;

    if (type === 'LOG') {
      if (typeof debugLog === 'function') debugLog(step, msg);
      return;
    }
    if (type === 'PROGRESS') return;

    if (id && pending.has(id)) {
      const { resolve, reject } = pending.get(id);
      pending.delete(id);
      if (type === 'OK') resolve(data);
      else reject(new Error(error || '请求失败'));
    }
  });

  function agentCall(type, payload) {
    return new Promise((resolve, reject) => {
      const id = 'req-' + (++reqId);
      pending.set(id, { resolve, reject });
      window.postMessage({ source: PANEL, id, type, ...payload }, '*');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('页面代理超时，请刷新页面重试'));
        }
      }, 600000);
    });
  }

  let debugLog, showStatus;

  function mountUI() {
    if (document.getElementById('bili-dl-panel-root')) return;

    const panel = document.createElement('div');
    panel.id = 'bili-dl-panel-root';
    panel.innerHTML = `
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
          <div class="bili-dl-body">
            <div class="bili-dl-detect">
              <span class="bili-dl-dot"></span>
              <span id="bili-dl-detect-text">识别页面中…</span>
              <span class="bili-dl-tag">B站 · 详情</span>
              <span id="bili-dl-ready" class="bili-dl-badge hidden">可用</span>
            </div>

            <div class="bili-dl-video-card">
              <div class="bili-dl-cover-wrap">
                <img id="bili-dl-cover" class="bili-dl-cover hidden" alt="">
                <div id="bili-dl-cover-ph" class="bili-dl-cover-ph">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
              <div class="bili-dl-video-meta">
                <div id="bili-dl-video-title" class="bili-dl-video-title">加载中…</div>
                <div id="bili-dl-video-author" class="bili-dl-video-author hidden"></div>
                <div id="bili-dl-video-sub" class="bili-dl-video-sub">—</div>
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

            <div class="bili-dl-info-row">
              <span class="bili-dl-info-item">格式 MP4</span>
              <span id="bili-dl-max-label" class="bili-dl-info-tip">源最高 —</span>
            </div>

            <button id="bili-dl-start" class="bili-dl-btn" disabled>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
              开始下载
            </button>
            <div id="bili-dl-status" class="bili-dl-status hidden"></div>
          </div>
          <div class="bili-dl-footer">
            <span class="bili-dl-footer-text">当前页面 · B站视频详情页</span>
            <a class="bili-dl-feedback" href="tencent://message/?uin=748604487&amp;Site=qq&amp;Menu=yes" title="有问题请通过 QQ 反馈">有问题请反馈 QQ</a>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const toggleBtn = panel.querySelector('#bili-dl-toggle');
    const menu = panel.querySelector('#bili-dl-menu');
    const closeBtn = panel.querySelector('#bili-dl-close');
    const detectText = panel.querySelector('#bili-dl-detect-text');
    const readyBadge = panel.querySelector('#bili-dl-ready');
    const coverImg = panel.querySelector('#bili-dl-cover');
    const coverPh = panel.querySelector('#bili-dl-cover-ph');
    const titleEl = panel.querySelector('#bili-dl-video-title');
    const authorEl = panel.querySelector('#bili-dl-video-author');
    const subEl = panel.querySelector('#bili-dl-video-sub');
    const pagesEl = panel.querySelector('#bili-dl-pages');
    const pillsEl = panel.querySelector('#bili-dl-quality-pills');
    const maxLabelEl = panel.querySelector('#bili-dl-max-label');
    const startBtn = panel.querySelector('#bili-dl-start');
    const statusEl = panel.querySelector('#bili-dl-status');
    const btnDefaultHtml = startBtn.innerHTML;

    debugLog = (step, msg) => console.log('[BiliDL]', step, msg);

    showStatus = (type, text) => {
      if (type === 'downloading') return;
      statusEl.classList.remove('hidden', 'success', 'error');
      statusEl.classList.add(type);
      statusEl.textContent = text;
    };

    function setDetect(text, ready) {
      detectText.textContent = text;
      readyBadge.classList.toggle('hidden', !ready);
    }

    function renderQualityPills(list) {
      qualities = list || [];
      if (!qualities.length) {
        pillsEl.innerHTML = '<span class="bili-dl-pill disabled">无可用清晰度</span>';
        selectedQn = 0;
        return;
      }
      if (!qualities.some((q) => q.qn === selectedQn)) {
        selectedQn = qualities[0].qn;
      }
      pillsEl.innerHTML = qualities.map((q) =>
        `<button type="button" class="bili-dl-pill${q.qn === selectedQn ? ' active' : ''}" data-qn="${q.qn}">${q.label}</button>`
      ).join('');
      pillsEl.querySelectorAll('.bili-dl-pill[data-qn]').forEach((btn) => {
        btn.onclick = () => {
          selectedQn = +btn.dataset.qn;
          pillsEl.querySelectorAll('.bili-dl-pill').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        };
      });
    }

    async function fetchSnapshot() {
      const res = await agentCall('RESOLVE_VIDEO', { href: location.href, pageIndex });
      const qRes = await agentCall('GET_QUALITIES', { aid: res.info.aid, cid: res.info.cid });
      return {
        info: res.info,
        qualities: qRes.qualities || [],
        maxLabel: qRes.maxLabel || ''
      };
    }

    async function loadVideoInfo() {
      setDetect('识别页面中…', false);
      titleEl.textContent = '加载中…';
      authorEl.textContent = '';
      authorEl.classList.add('hidden');
      subEl.textContent = '—';
      coverImg.classList.add('hidden');
      coverPh.classList.remove('hidden');
      startBtn.disabled = true;
      statusEl.classList.add('hidden');
      pillsEl.innerHTML = '<span class="bili-dl-pill loading">加载中</span>';

      try {
        const snap = await fetchSnapshot();
        videoInfo = snap.info;
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
          coverImg.onload = () => {
            coverImg.classList.remove('hidden');
            coverPh.classList.add('hidden');
          };
        }

        const parts = [];
        if (videoInfo.view) parts.push(formatView(videoInfo.view) + ' 播放');
        if (videoInfo.pubdate) parts.push(formatTime(videoInfo.pubdate));
        subEl.textContent = parts.length ? parts.join(' · ') : 'B站视频';

        if (videoInfo.pages?.length > 1) {
          pagesEl.classList.remove('hidden');
          pagesEl.innerHTML = videoInfo.pages
            .map((p, i) => `<button type="button" class="bili-dl-page-btn${i === pageIndex ? ' active' : ''}" data-index="${i}">P${p.page}</button>`)
            .join('');
          pagesEl.querySelectorAll('.bili-dl-page-btn').forEach((btn) => {
            btn.onclick = () => { pageIndex = +btn.dataset.index; loadVideoInfo(); };
          });
        } else {
          pagesEl.classList.add('hidden');
        }

        maxLabelEl.textContent = snap.maxLabel ? `源最高 ${snap.maxLabel}` : '源最高 —';
        renderQualityPills(snap.qualities);
        startBtn.disabled = !snap.qualities.length;

        debugLog('加载', `${videoInfo.aid}/${videoInfo.cid} · ${snap.qualities.map((q) => q.label).join(', ')}`);
      } catch (err) {
        setDetect('识别失败', false);
        titleEl.textContent = '加载失败';
        subEl.textContent = err.message;
        showStatus('error', err.message);
        debugLog('错误', err.message);
      }
    }

    async function startDownload() {
      if (!selectedQn || !videoInfo) return;
      startBtn.disabled = true;
      startBtn.textContent = '下载中…';
      statusEl.classList.add('hidden');
      debugLog('下载', `qn=${selectedQn}`);

      try {
        const result = await agentCall('START_DOWNLOAD', {
          aid: videoInfo.aid,
          cid: videoInfo.cid,
          qn: selectedQn,
          title: videoInfo.title
        });

        if (result.merged) {
          const blob = new Blob([result.mp4], { type: 'video/mp4' });
          await downloadBlob(blob, result.filename);
          showStatus('success', '下载完成，已保存为 MP4');
        } else if (result.videoOnly) {
          showStatus('success', '已下载视频轨（无音频）');
        } else {
          showStatus('success', '下载完成');
        }
      } catch (err) {
        showStatus('error', err.message);
        debugLog('错误', err.message);
      } finally {
        startBtn.disabled = false;
        startBtn.innerHTML = btnDefaultHtml;
      }
    }

    toggleBtn.onclick = async () => {
      isOpen = !isOpen;
      menu.classList.toggle('hidden', !isOpen);
      if (isOpen) await loadVideoInfo();
    };
    closeBtn.onclick = () => { isOpen = false; menu.classList.add('hidden'); };
    startBtn.onclick = startDownload;

    panel.querySelector('.bili-dl-feedback')?.addEventListener('click', () => {
      navigator.clipboard?.writeText('748604487').catch(() => {});
    });

    window.__BILI_DL_API__ = {
      fetchSnapshot,
      openPanel: async () => {
        isOpen = true;
        menu.classList.remove('hidden');
        await loadVideoInfo();
      }
    };

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        pageIndex = 0;
        videoInfo = null;
        selectedQn = 0;
        if (isOpen) loadVideoInfo();
      }
    }, 1000);
  }

  function waitAndMount() {
    if (document.body) mountUI();
    else setTimeout(waitAndMount, 100);
  }
  waitAndMount();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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

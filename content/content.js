(function () {
  'use strict';

  if (window.__BILI_DL_INIT__) return;
  window.__BILI_DL_INIT__ = true;

  const PANEL = 'bili-dl-panel';
  const AGENT = 'bili-dl-agent';
  const VERSION = chrome.runtime.getManifest().version;
  // 图标资源缓存破坏：换图标后递增 ICON_REV，避免只 F5 仍显示旧图
  const ICON_REV = '22';
  const ICON_URL = chrome.runtime.getURL(`icons/icon128.png?r=${ICON_REV}`);
  const FAQ_URL = 'https://snowflake-hangdudu.github.io/bili-downloader/faq.html';

  let muxReadyPromise = null;

  function setupMuxInPage() {
    if (muxReadyPromise) return muxReadyPromise;
    const base = chrome.runtime.getURL('lib/');
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
  setupMuxInPage().catch(() => {});

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

  let downloading = false;
  let downloadPaused = false;
  let queueRunning = false;
  let queueCancelled = false;

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
        updateProgress(e.data.step, e.data.percent, e.data.received, e.data.total);
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

  function agentSignal(type) {
    window.postMessage({ source: PANEL, type }, '*');
  }

  let debugLog, showStatus, updateProgress;

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

            <div class="bili-dl-info-row">
              <span class="bili-dl-info-item">格式 MP4</span>
              <span id="bili-dl-max-label" class="bili-dl-info-tip">源最高 —</span>
            </div>

            <div id="bili-dl-estimate" class="bili-dl-estimate hidden">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              <span id="bili-dl-estimate-text">预计大小 —</span>
            </div>

            <div id="bili-dl-login-hint" class="bili-dl-hint hidden"></div>

            <button id="bili-dl-start" class="bili-dl-btn" disabled>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
              开始下载
            </button>
            <button id="bili-dl-queue-all" type="button" class="bili-dl-btn bili-dl-btn-secondary hidden">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
              <span id="bili-dl-queue-label">队列下载全部分 P</span>
            </button>
            <div id="bili-dl-progress" class="bili-dl-progress hidden">
              <div class="bili-dl-progress-meta">
                <span id="bili-dl-progress-title" class="bili-dl-progress-title"></span>
                <span id="bili-dl-progress-q" class="bili-dl-progress-q"></span>
              </div>
              <div class="bili-dl-progress-head">
                <span id="bili-dl-progress-phase">下载中…</span>
                <span id="bili-dl-progress-pct">0%</span>
              </div>
              <div class="bili-dl-progress-track">
                <div id="bili-dl-progress-bar" class="bili-dl-progress-bar"></div>
              </div>
              <div id="bili-dl-progress-actions" class="bili-dl-progress-actions hidden">
                <button id="bili-dl-pause" type="button" class="bili-dl-action-btn">暂停</button>
                <button id="bili-dl-cancel-dl" type="button" class="bili-dl-action-btn danger">取消</button>
              </div>
            </div>
            <div id="bili-dl-status" class="bili-dl-status hidden"></div>
          </div>
          <div class="bili-dl-footer">
            <span class="bili-dl-footer-text">当前页面 · B站视频详情页</span>
            <div class="bili-dl-footer-links">
              <a class="bili-dl-faq-link" href="${FAQ_URL}" target="_blank" rel="noopener">常见问题</a>
              <a class="bili-dl-feedback" href="tencent://message/?uin=748604487&amp;Site=qq&amp;Menu=yes" title="有问题请通过 QQ 反馈">反馈 QQ</a>
            </div>
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
    const maxLabelEl = panel.querySelector('#bili-dl-max-label');
    const estimateEl = panel.querySelector('#bili-dl-estimate');
    const estimateText = panel.querySelector('#bili-dl-estimate-text');
    const loginHintEl = panel.querySelector('#bili-dl-login-hint');
    const startBtn = panel.querySelector('#bili-dl-start');
    const queueBtn = panel.querySelector('#bili-dl-queue-all');
    const queueLabelEl = panel.querySelector('#bili-dl-queue-label');
    const progressEl = panel.querySelector('#bili-dl-progress');
    const progressTitle = panel.querySelector('#bili-dl-progress-title');
    const progressQ = panel.querySelector('#bili-dl-progress-q');
    const progressPhase = panel.querySelector('#bili-dl-progress-phase');
    const progressPct = panel.querySelector('#bili-dl-progress-pct');
    const progressBar = panel.querySelector('#bili-dl-progress-bar');
    const progressActions = panel.querySelector('#bili-dl-progress-actions');
    const pauseBtn = panel.querySelector('#bili-dl-pause');
    const cancelDlBtn = panel.querySelector('#bili-dl-cancel-dl');
    const statusEl = panel.querySelector('#bili-dl-status');
    const btnDefaultHtml = startBtn.innerHTML;

    function setQueueLabel(count) {
      queueLabelEl.textContent = count > 1 ? `队列下载全部 ${count} 个分 P` : '队列下载全部分 P';
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
      statusEl.innerHTML = `${text} <a href="${href}" target="_blank" rel="noopener" class="bili-dl-status-link">查看常见问题</a>`;
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

    function setLoginHint(text) {
      if (text) {
        loginHintEl.textContent = text;
        loginHintEl.classList.remove('hidden');
      } else {
        loginHintEl.textContent = '';
        loginHintEl.classList.add('hidden');
      }
    }

    async function refreshEstimate() {
      if (!selectedQn || !videoInfo?.aid || !videoInfo?.cid) {
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

    function setProgressActionsVisible(visible) {
      progressActions.classList.toggle('hidden', !visible);
    }

    function resetPauseUI() {
      downloadPaused = false;
      pauseBtn.textContent = '暂停';
      progressBar.classList.remove('paused');
    }

    function hideProgress() {
      downloading = false;
      resetPauseUI();
      progressEl.classList.add('hidden');
      setProgressActionsVisible(false);
      progressBar.style.width = '0%';
      progressBar.classList.remove('indeterminate');
      progressPct.classList.remove('hidden');
    }

    function showProgressStart() {
      downloading = true;
      resetPauseUI();
      progressEl.classList.remove('hidden');
      setProgressActionsVisible(true);
      progressTitle.textContent = videoInfo?.title || '视频';
      progressTitle.title = videoInfo?.title || '';
      progressQ.textContent = getSelectedQualityLabel();
      updateProgress('prepare', 0);
    }

    updateProgress = (step, percent, received, total) => {
      if (!downloading) return;
      progressEl.classList.remove('hidden');

      if (step === 'merge' || step === 'save') {
        setProgressActionsVisible(false);
      } else if (step !== 'paused') {
        setProgressActionsVisible(true);
      }

      if (step === 'paused') {
        downloadPaused = true;
        pauseBtn.textContent = '继续';
        progressPhase.textContent = STEP_LABELS.paused;
        progressBar.classList.add('paused');
        return;
      }

      if (downloadPaused && step !== 'paused') {
        downloadPaused = false;
        pauseBtn.textContent = '暂停';
        progressBar.classList.remove('paused');
      }

      if (step === 'queue') {
        progressPhase.textContent = STEP_LABELS.queue;
        const qp = Math.min(100, Math.max(0, Number(percent) || 0));
        progressPct.textContent = qp + '%';
        progressBar.style.width = qp + '%';
        progressBar.classList.remove('indeterminate', 'paused');
        progressPct.classList.remove('hidden');
        return;
      }

      const pct = Number(percent);
      const recv = Number(received) || 0;
      const tot = Number(total) || 0;

      if (step === 'merge') {
        const sizeHint = tot || recv;
        progressPhase.textContent = sizeHint
          ? '正在合成，约 ' + formatBytes(sizeHint)
          : STEP_LABELS.merge;
        progressBar.classList.add('indeterminate');
        progressPct.classList.add('hidden');
        return;
      }

      progressPhase.textContent = STEP_LABELS[step] || '下载中…';

      if (tot > 0) {
        const displayPct = Math.min(100, Math.max(0, pct >= 0 ? pct : Math.round((recv / tot) * 100)));
        progressPct.textContent = formatBytes(recv) + ' / ' + formatBytes(tot);
        progressBar.style.width = displayPct + '%';
        progressBar.classList.remove('indeterminate');
        progressPct.classList.remove('hidden');
        return;
      }

      if (recv > 0) {
        progressPct.textContent = formatBytes(recv);
        progressBar.classList.add('indeterminate');
        progressPct.classList.remove('hidden');
        return;
      }

      if (pct > 0) {
        progressPct.textContent = Math.min(100, pct) + '%';
        progressBar.style.width = Math.min(100, pct) + '%';
        progressBar.classList.remove('indeterminate');
        progressPct.classList.remove('hidden');
      } else {
        progressBar.classList.add('indeterminate');
        progressPct.classList.add('hidden');
      }
    };

    function setDetect(text, ready) {
      detectText.textContent = text;
      readyBadge.classList.toggle('hidden', !ready);
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
          refreshEstimate();
        };
      });
      refreshEstimate();
    }

    async function fetchSnapshot() {
      const res = await agentCall('RESOLVE_VIDEO', { href: location.href, pageIndex });
      const qRes = await agentCall('GET_QUALITIES', { aid: res.info.aid, cid: res.info.cid });
      return {
        info: res.info,
        qualities: qRes.qualities || [],
        maxLabel: qRes.maxLabel || '',
        loginHint: qRes.loginHint || null
      };
    }

    async function loadVideoInfo() {
      setDetect('识别页面中…', false);
      setVideoLoading(true);
      titleEl.textContent = '';
      authorEl.textContent = '';
      authorEl.classList.add('hidden');
      subEl.textContent = '';
      estimateEl.classList.add('hidden');
      loginHintEl.classList.add('hidden');
      queueBtn.classList.add('hidden');
      startBtn.disabled = true;
      statusEl.classList.add('hidden');
      pillsEl.innerHTML = '<span class="bili-dl-pill loading">加载中</span>';

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
          pagesEl.innerHTML = videoInfo.pages
            .map((p, i) => `<button type="button" class="bili-dl-page-btn${i === pageIndex ? ' active' : ''}" data-index="${i}">P${p.page}</button>`)
            .join('');
          pagesEl.querySelectorAll('.bili-dl-page-btn').forEach((btn) => {
            btn.onclick = () => { pageIndex = +btn.dataset.index; loadVideoInfo(); };
          });
          queueBtn.classList.remove('hidden');
          setQueueLabel(videoInfo.pages.length);
        } else {
          pagesEl.classList.add('hidden');
          queueBtn.classList.add('hidden');
        }

        maxLabelEl.textContent = snap.maxLabel ? `源最高 ${snap.maxLabel}` : '源最高 —';
        setLoginHint(snap.loginHint);
        renderQualityPills(snap.qualities);
        if (snap.qualities.some((q) => q.mode === 'dash')) {
          setupMuxInPage().catch(() => {});
        }
        startBtn.disabled = !snap.qualities.length;

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

    pauseBtn.onclick = () => {
      if (!downloading) return;
      if (downloadPaused) {
        agentSignal('RESUME_DOWNLOAD');
        downloadPaused = false;
        pauseBtn.textContent = '暂停';
        progressBar.classList.remove('paused');
      } else {
        agentSignal('PAUSE_DOWNLOAD');
      }
    };

    cancelDlBtn.onclick = () => {
      if (!downloading) return;
      queueCancelled = true;
      agentSignal('CANCEL_DOWNLOAD');
    };

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

    async function runSingleDownload(info) {
      const result = await agentCall('START_DOWNLOAD', {
        aid: info.aid,
        cid: info.cid,
        qn: selectedQn,
        title: info.title
      });

      if (result.merged) {
        updateProgress('save', 95);
        const blob = result.blob || new Blob([result.mp4], { type: 'video/mp4' });
        await downloadBlob(blob, result.filename);
        updateProgress('save', 100);
      } else if (result.videoOnly) {
        updateProgress('save', 100);
      } else {
        updateProgress('save', 100);
      }
      return result;
    }

    async function startDownload() {
      if (!selectedQn || !videoInfo || queueRunning) return;
      if (!(await ensureMuxReady())) return;

      startBtn.disabled = true;
      queueBtn.disabled = true;
      startBtn.textContent = '下载中…';
      statusEl.classList.add('hidden');
      showProgressStart();
      debugLog('下载', `qn=${selectedQn}`);

      try {
        const result = await runSingleDownload(videoInfo);
        hideProgress();
        if (result.videoOnly) {
          showStatus('success', '已下载视频轨（无音频）');
        } else {
          showStatus('success', '下载完成，已保存为 MP4');
        }
      } catch (err) {
        hideProgress();
        if (err.message === '下载已取消') {
          showStatus('error', '下载已取消');
        } else {
          showErrorWithFaq(err.message, errorFaqAnchor(err.message));
        }
        debugLog('错误', err.message);
      } finally {
        startBtn.disabled = false;
        queueBtn.disabled = false;
        startBtn.innerHTML = btnDefaultHtml;
      }
    }

    async function startQueueDownload() {
      if (!selectedQn || !videoInfo || !isMultiPartVideo(videoInfo.pages) || queueRunning) return;
      if (!(await ensureMuxReady())) return;

      const total = videoInfo.pages.length;
      queueRunning = true;
      queueCancelled = false;
      startBtn.disabled = true;
      queueBtn.disabled = true;
      queueLabelEl.textContent = '队列下载中…';
      statusEl.classList.add('hidden');

      let ok = 0;
      let fail = 0;

      for (let i = 0; i < total; i++) {
        if (queueCancelled) break;

        let partInfo;
        try {
          const res = await agentCall('RESOLVE_VIDEO', { href: location.href, pageIndex: i });
          partInfo = res.info;
        } catch (err) {
          fail++;
          debugLog('队列', `P${i + 1} 解析失败: ${err.message}`);
          continue;
        }

        downloading = true;
        resetPauseUI();
        progressEl.classList.remove('hidden');
        setProgressActionsVisible(true);
        progressTitle.textContent = `P${i + 1}/${total} · ${partInfo.title}`;
        progressTitle.title = partInfo.title;
        progressQ.textContent = getSelectedQualityLabel();
        updateProgress('queue', Math.round((i / total) * 100));

        try {
          await runSingleDownload(partInfo);
          ok++;
        } catch (err) {
          if (err.message === '下载已取消' || queueCancelled) break;
          fail++;
          debugLog('队列', `P${i + 1} 失败: ${err.message}`);
        }
      }

      hideProgress();
      queueRunning = false;

      if (queueCancelled) {
        showStatus('error', `队列已取消（已完成 ${ok}/${total}）`);
      } else if (fail === 0) {
        showStatus('success', `队列下载完成，共 ${ok} 个分 P`);
      } else {
        showErrorWithFaq(`部分完成：成功 ${ok}，失败 ${fail}。可先播放再重试失败项`, 'parts');
      }

      queueBtn.disabled = false;
      startBtn.disabled = false;
      setQueueLabel(total);
      startBtn.innerHTML = btnDefaultHtml;
    }

    toggleBtn.onclick = async () => {
      isOpen = !isOpen;
      menu.classList.toggle('hidden', !isOpen);
      if (isOpen) await loadVideoInfo();
    };
    closeBtn.onclick = () => { isOpen = false; menu.classList.add('hidden'); };
    startBtn.onclick = startDownload;
    queueBtn.onclick = startQueueDownload;

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

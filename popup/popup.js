const VERSION = chrome.runtime.getManifest().version;
const FEEDBACK_QQ = 'hangdudu@agent.qq.com';
document.getElementById('app-version').textContent = 'v' + VERSION;

const $ = (id) => document.getElementById(id);

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

function isBiliVideoUrl(url) {
  return url && url.includes('bilibili.com/video/');
}

function formatCurrentSite(url) {
  if (!url) return '当前页面：—';
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return '当前页面：' + u.protocol.replace(':', '');
    }
    let path = u.pathname;
    if (path.length > 24) path = path.slice(0, 24) + '…';
    const suffix = path && path !== '/' ? path : '';
    return '当前页面：' + u.hostname + suffix;
  } catch {
    return '当前页面：未知';
  }
}

const HISTORY_KEY = 'biliDlHistory';

function historyPartKey(h) {
  if (h?.cid) return `c:${h.cid}`;
  return `b:${h?.bvid || ''}#${h?.pageIndex ?? 0}`;
}

/** 同集同格式只留一条；MP4 与故意下的 M4A 可并列 */
function pruneHistoryItems(items) {
  const kept = [];
  const seen = new Set();
  for (const h of (Array.isArray(items) ? items : []).filter(Boolean)) {
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
    const { [HISTORY_KEY]: items } = await chrome.storage.local.get(HISTORY_KEY);
    return pruneHistoryItems(items);
  } catch {
    return [];
  }
}

function historyEntryUrl(entry) {
  if (!entry?.bvid) return null;
  return `https://www.bilibili.com/video/${entry.bvid}${entry.pageIndex > 0 ? `?p=${entry.pageIndex + 1}` : ''}`;
}

function formatHistoryTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024 * 1024) return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
  if (v >= 1024) return Math.round(v / 1024) + ' KB';
  if (v > 0) return v + ' B';
  return '0 B';
}

/** 与面板一致：跳转视频页并自动展开下载面板 */
async function openHistoryEntry(entry) {
  const url = historyEntryUrl(entry);
  if (!url) return;

  await chrome.storage.local.set({ biliDlAutoOpen: 1 });

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && isBiliVideoUrl(active.url)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: active.id },
        func: () => {
          try { sessionStorage.setItem('biliDlAutoOpen', '1'); } catch { /* ignore */ }
        }
      });
    } catch { /* ignore */ }
    await chrome.tabs.update(active.id, { url });
    window.close();
    return;
  }

  if (active?.id && active.url && /bilibili\.com/i.test(active.url)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: active.id },
        func: () => {
          try { sessionStorage.setItem('biliDlAutoOpen', '1'); } catch { /* ignore */ }
        }
      });
    } catch { /* ignore */ }
    await chrome.tabs.update(active.id, { url });
    window.close();
    return;
  }

  await chrome.tabs.create({ url });
  window.close();
}

async function renderPopupHistory() {
  const items = await loadHistory();
  const countEl = $('popup-history-count');
  const listEl = $('popup-history-list');
  const clearEl = $('popup-history-clear');
  if (items.length) {
    countEl.textContent = items.length;
    countEl.classList.remove('hidden');
    clearEl.classList.remove('hidden');
    listEl.innerHTML = items.map((h, i) => {
      const url = historyEntryUrl(h);
      const link = url
        ? `<button type="button" class="popup-history-open" data-idx="${i}">打开</button>`
        : '';
      return `
        <div class="popup-history-item">
          <div class="popup-history-item-main">
            <div class="popup-history-item-title" title="${(h.title || '').replace(/"/g, '&quot;')}">${h.title || '未命名'}</div>
            <div class="popup-history-item-meta">${formatHistoryTime(h.ts)} · ${h.label || ''}${h.format === 'm4a' ? ' · M4A' : ''}${h.fileSize ? ' · ' + formatBytes(h.fileSize) : ''}</div>
          </div>
          ${link}
        </div>`;
    }).join('');
    listEl.querySelectorAll('.popup-history-open').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.idx);
        const entry = items[idx];
        if (entry) await openHistoryEntry(entry);
      });
    });
  } else {
    countEl.classList.add('hidden');
    clearEl.classList.add('hidden');
    listEl.innerHTML = '<div class="popup-history-empty">暂无下载记录</div>';
  }
}

function showEmptyState(tab) {
  const siteEl = $('empty-current-site');
  if (siteEl) siteEl.textContent = formatCurrentSite(tab?.url);
  showState('state-empty');
}

function showState(name) {
  ['state-loading', 'state-video', 'state-empty', 'state-error'].forEach((id) => {
    $(id).classList.toggle('hidden', id !== name);
  });
}

function readPageState() {
  const state = window.__INITIAL_STATE__;
  if (state?.videoData) {
    const v = state.videoData;
    return {
      title: v.title,
      author: v.owner?.name || '',
      pic: v.pic,
      view: v.stat?.view,
      pubdate: v.pubdate,
      pages: v.pages?.length || 1
    };
  }
  return null;
}

async function fallbackFromPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: readPageState
  });
  return result;
}

function renderVideo(data) {
  const info = data.info;
  const qualities = data.qualities || [];

  $('video-title').textContent = info.title || '当前 B 站视频';

  const authorEl = $('video-author');
  if (info.author) {
    authorEl.textContent = info.author;
    authorEl.classList.remove('hidden');
  } else {
    authorEl.classList.add('hidden');
  }

  const parts = [];
  if (info.view) parts.push(formatView(info.view) + ' 播放');
  if (info.pubdate) parts.push(formatTime(info.pubdate));
  $('video-sub').textContent = parts.length ? parts.join(' · ') : 'B站视频';

  const cover = $('video-cover');
  const coverPh = $('video-cover-ph');
  if (info.pic) {
    cover.src = info.pic;
    cover.onload = () => {
      cover.classList.remove('hidden');
      coverPh.classList.add('hidden');
    };
    cover.onerror = () => {
      cover.classList.add('hidden');
      coverPh.classList.remove('hidden');
    };
  } else {
    cover.classList.add('hidden');
    coverPh.classList.remove('hidden');
  }

  const pagesEl = $('video-pages');
  if (info.pages?.length > 1 && info.pages.every((p) => p && p.cid)) {
    pagesEl.classList.remove('hidden');
    pagesEl.innerHTML = info.pages
      .map((p) => `<span class="popup-page-tag">P${p.page}${p.part ? ' ' + p.part : ''}</span>`)
      .join('');
  } else {
    pagesEl.classList.add('hidden');
  }

  const tagsEl = $('quality-tags');
  if (qualities.length) {
    tagsEl.innerHTML = qualities.map((q, i) =>
      `<span class="popup-q-tag${i === 0 ? ' best' : ''}">${q.label}</span>`
    ).join('');
  } else {
    tagsEl.innerHTML = '<span class="popup-q-tag">暂无可用清晰度</span>';
  }

  $('max-quality').textContent = data.maxLabel ? `源最高 ${data.maxLabel}` : '源最高 —';

  const loginHintEl = $('login-hint');
  if (data.loginHint) {
    loginHintEl.textContent = data.loginHint;
    loginHintEl.classList.remove('hidden');
  } else {
    loginHintEl.textContent = '';
    loginHintEl.classList.add('hidden');
  }

  $('btn-open-panel').disabled = !qualities.length;
}

async function init() {
  showState('state-loading');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !isBiliVideoUrl(tab.url)) {
    showEmptyState(tab);
    return;
  }

  let tabId = tab.id;

  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'BILI_DL_GET_INFO' });
    if (resp?.ok) {
      renderVideo(resp.data);
      showState('state-video');
    } else {
      throw new Error(resp?.error || '无法获取视频信息');
    }
  } catch {
    try {
      const basic = await fallbackFromPage(tabId);
      if (basic?.title) {
        renderVideo({
          info: {
            title: basic.title,
            author: basic.author,
            pic: basic.pic,
            view: basic.view,
            pubdate: basic.pubdate,
            pages: basic.pages > 1 ? Array.from({ length: basic.pages }, (_, i) => ({ page: i + 1 })) : []
          },
          qualities: [],
          maxLabel: ''
        });
        $('quality-tags').innerHTML = '<span class="popup-q-tag">请刷新页面后重试</span>';
        $('btn-open-panel').disabled = false;
        showState('state-video');
      } else {
        throw new Error('页面数据未加载');
      }
    } catch (err) {
      $('error-text').textContent = err.message || '加载失败';
      showState('state-error');
    }
  }

  $('btn-open-panel')?.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'BILI_DL_OPEN_PANEL' });
      window.close();
    } catch {
      $('error-text').textContent = '无法打开面板，请刷新视频页';
      showState('state-error');
    }
  });

  $('btn-retry')?.addEventListener('click', async () => {
    if (!tabId) return;
    try {
      await chrome.tabs.reload(tabId);
      window.close();
    } catch {
      $('error-text').textContent = '无法刷新页面，请手动 F5';
      showState('state-error');
    }
  });
}

init();

document.getElementById('popup-history-toggle')?.addEventListener('click', async () => {
  const panel = document.getElementById('popup-history-panel');
  const hidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !hidden);
  if (hidden) await renderPopupHistory();
});

document.getElementById('popup-history-clear')?.addEventListener('click', async () => {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  await renderPopupHistory();
});

renderPopupHistory();

document.getElementById('feedback-qq')?.addEventListener('click', () => {
  const el = document.getElementById('feedback-qq');
  navigator.clipboard?.writeText(FEEDBACK_QQ).then(() => {
    if (!el) return;
    const old = el.textContent;
    el.textContent = '邮箱已复制，请通过邮件联系';
    el.classList.add('copied');
    setTimeout(() => {
      el.textContent = old;
      el.classList.remove('copied');
    }, 1500);
  }).catch(() => {});
});

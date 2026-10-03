const EXT = typeof browser !== 'undefined' ? browser : chrome;

const VERSION = EXT.runtime.getManifest().version;

document.getElementById('app-version').textContent = 'v' + VERSION;

const THEME_PREF_KEY = 'biliDlTheme_v1';

function t(key, values) {

  return globalThis.BiliDlI18n?.t?.(key, values) ?? key;

}

function applyPopupTheme(value) {

  const Theme = globalThis.BiliDlTheme;

  if (!Theme) return;

  Theme.applyToRoot(document.body, value);

}

function applyPopupLanguage() {

  globalThis.BiliDlI18n?.apply(document);

}

function localizeQualityLabel(label) {
  let text = String(label || '');
  const pairs = [
    ['准高清', 'qNearHd'],
    ['高码率', 'qHighBitrate'],
    ['超清', 'qUhd'],
    ['高清', 'qHd'],
    ['标清', 'qSd'],
    ['流畅', 'qFluent']
  ];
  for (const [zh, key] of pairs) {
    if (text.includes(zh)) text = text.replaceAll(zh, t(key));
  }
  return text;
}
function translateUserError(msg) {

  const s = String(msg || '');

  const exact = {

    '无法获取视频信息': 'getInfoFailed',

    '页面数据未加载': 'pageDataNotLoaded',

    '页面未就绪': 'pageNotReady'

  };

  if (exact[s]) return t(exact[s]);

  return s;

}

Promise.all([

  globalThis.BiliDlI18n?.ready,

  globalThis.BiliDlTheme?.loadThemes?.()

]).then(() => EXT.storage.local.get(THEME_PREF_KEY))

  .then((data) => {

    applyPopupLanguage();

    applyPopupTheme(data?.[THEME_PREF_KEY]);

    init();

  })

  .catch(() => init());

EXT.storage.onChanged?.addListener((changes, area) => {

  if (area !== 'local') return;

  if (changes[THEME_PREF_KEY]) applyPopupTheme(changes[THEME_PREF_KEY].newValue);

  if (changes[globalThis.BiliDlI18n?.KEY]) applyPopupLanguage();

});

globalThis.BiliDlI18n?.onChange?.(() => applyPopupLanguage());



const $ = (id) => document.getElementById(id);



function clearNode(node) {

  node.replaceChildren();

}



function appendDiv(parent, className, text, title) {

  const el = document.createElement('div');

  el.className = className;

  el.textContent = text;

  if (title) el.title = title;

  parent.appendChild(el);

  return el;

}



function formatView(n) {

  const v = Number(n) || 0;

  const lang = globalThis.BiliDlI18n?.language?.() || 'zh-CN';

  if (lang === 'en') {

    if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';

    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';

    if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';

    return String(v);

  }

  if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + t('unitYi');

  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + t('unitWan');

  return String(v);

}



function formatTime(ts) {

  if (!ts) return '';

  const diff = Math.max(0, Date.now() - ts * 1000);

  const m = Math.floor(diff / 60000);

  if (m < 1) return t('justNow');

  if (m < 60) return t('minutesAgo', { n: m });

  const h = Math.floor(m / 60);

  if (h < 24) return t('hoursAgo', { n: h });

  const d = Math.floor(h / 24);

  if (d < 30) return t('daysAgo', { n: d });

  const mo = Math.floor(d / 30);

  if (mo < 12) return t('monthsAgo', { n: mo });

  return t('yearsAgo', { n: Math.floor(mo / 12) });

}



function isBiliDownloadUrl(url) {

  return url && (/bilibili\.com\/video\//.test(url) || /bilibili\.com\/list\//.test(url) || isSpaceDownloadUrl(url));

}



function isSpaceDownloadUrl(value) {

  try {

    const url = new URL(value);

    return url.hostname === 'space.bilibili.com' && /^\/\d+\/?(?:upload\/video\/?)?$/.test(url.pathname);

  } catch { return false; }

}



function formatCurrentSite(url) {

  if (!url) return t('currentPageEmpty');

  try {

    const u = new URL(url);

    if (u.protocol !== 'http:' && u.protocol !== 'https:') {

      return t('currentPage') + u.protocol.replace(':', '');

    }

    let path = u.pathname;

    if (path.length > 24) path = path.slice(0, 24) + '…';

    const suffix = path && path !== '/' ? path : '';

    return t('currentPage') + u.hostname + suffix;

  } catch {

    return t('currentPageUnknown');

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

    const { [HISTORY_KEY]: items } = await EXT.storage.local.get(HISTORY_KEY);

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



  await EXT.storage.local.set({ biliDlAutoOpen: 1 });



  const [active] = await EXT.tabs.query({ active: true, currentWindow: true });

  if (active?.id && isBiliDownloadUrl(active.url)) {

    try {

      await EXT.scripting.executeScript({

        target: { tabId: active.id },

        func: () => {

          try { sessionStorage.setItem('biliDlAutoOpen', '1'); } catch { /* ignore */ }

        }

      });

    } catch { /* ignore */ }

    await EXT.tabs.update(active.id, { url });

    window.close();

    return;

  }



  if (active?.id && active.url && /bilibili\.com/i.test(active.url)) {

    try {

      await EXT.scripting.executeScript({

        target: { tabId: active.id },

        func: () => {

          try { sessionStorage.setItem('biliDlAutoOpen', '1'); } catch { /* ignore */ }

        }

      });

    } catch { /* ignore */ }

    await EXT.tabs.update(active.id, { url });

    window.close();

    return;

  }



  await EXT.tabs.create({ url });

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

    clearNode(listEl);

    const frag = document.createDocumentFragment();

    items.forEach((h, i) => {

      const itemEl = document.createElement('div');

      itemEl.className = 'popup-history-item';

      const mainEl = document.createElement('div');

      mainEl.className = 'popup-history-item-main';

      itemEl.appendChild(mainEl);

      appendDiv(mainEl, 'popup-history-item-title', h.title || t('untitled'), h.title || t('untitled'));

      appendDiv(

        mainEl,

        'popup-history-item-meta',

        `${formatHistoryTime(h.ts)} · ${h.label || ''}${h.format === 'm4a' ? ' · M4A' : ''}${h.fileSize ? ' · ' + formatBytes(h.fileSize) : ''}`

      );

      if (historyEntryUrl(h)) {

        const btn = document.createElement('button');

        btn.type = 'button';

        btn.className = 'popup-history-open';

        btn.textContent = t('historyOpen');

        btn.addEventListener('click', async () => {

          const entry = items[i];

          if (entry) await openHistoryEntry(entry);

        });

        itemEl.appendChild(btn);

      }

      frag.appendChild(itemEl);

    });

    listEl.appendChild(frag);

  } else {

    countEl.classList.add('hidden');

    clearEl.classList.add('hidden');

    clearNode(listEl);

    appendDiv(listEl, 'popup-history-empty', t('historyEmpty'));

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

  const bvid = location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/i)?.[1];

  if (state?.videoData && (!bvid || String(state.videoData.bvid || '').toLowerCase() === bvid.toLowerCase())) {

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

  const title = document.querySelector('h1.video-title')?.textContent?.trim()

    || document.querySelector('meta[property="og:title"]')?.content?.trim();

  if (!title) return null;

  return {

    title,

    author: document.querySelector('.up-name')?.textContent?.trim() || '',

    pic: document.querySelector('meta[property="og:image"]')?.content || '',

    pages: 1

  };

}



async function fallbackFromPage(tabId) {

  const [{ result }] = await EXT.scripting.executeScript({

    target: { tabId },

    func: readPageState,

    world: 'MAIN'

  });

  return result;

}



function renderVideo(data) {

  const info = data.info;

  const rawQualities = data.qualities || [];

  const preferred = rawQualities.filter((q) => Number(q.qn) > 16);

  const qualities = preferred.length ? preferred : rawQualities;



  $('video-title').textContent = info.title || t('currentBiliVideo');



  const authorEl = $('video-author');

  if (info.author) {

    authorEl.textContent = info.author;

    authorEl.classList.remove('hidden');

  } else {

    authorEl.classList.add('hidden');

  }



  const parts = [];

  if (info.view) parts.push(formatView(info.view) + ' ' + t('unitPlay'));

  if (info.pubdate) parts.push(formatTime(info.pubdate));

  $('video-sub').textContent = parts.length ? parts.join(' · ') : t('biliVideo');



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



  const tagsEl = $('quality-tags');

  if (qualities.length) {

    clearNode(tagsEl);

    const frag = document.createDocumentFragment();

    qualities.forEach((q, i) => {

      const el = document.createElement('span');

      el.className = `popup-q-tag${i === 0 ? ' best' : ''}`;

      el.textContent = localizeQualityLabel(q.label);

      frag.appendChild(el);

    });

    tagsEl.appendChild(frag);

  } else {

    clearNode(tagsEl);

    const el = document.createElement('span');

    el.className = 'popup-q-tag';

    el.textContent = data.qualityError ? t('qualityUnavailable') : t('qualityNone');

    tagsEl.appendChild(el);

  }



  $('btn-open-panel').disabled = !qualities.length && !data.qualityError;

  if ($('btn-open-panel').dataset.i18nBound !== '1') {

    $('btn-open-panel').textContent = t('openPanel');

    $('btn-open-panel').dataset.i18nBound = '1';

  }

}



async function init() {

  showState('state-loading');



  const [tab] = await EXT.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url || !isBiliDownloadUrl(tab.url)) {

    showEmptyState(tab);

    return;

  }



  let tabId = tab.id;



  if (isSpaceDownloadUrl(tab.url)) {

    renderVideo({ info: { title: t('spaceUploadTitle'), author: '', pic: '', pages: [] }, qualities: [], qualityError: 'space' });

    $('video-sub').textContent = t('spaceUploadSub');

    $('quality-tags').textContent = t('spaceUploadTags');

    $('btn-open-panel').disabled = false;

    $('btn-open-panel').textContent = t('openSpacePanel');

    $('btn-open-panel').onclick = async () => {

      try {

        const response = await EXT.tabs.sendMessage(tabId, { type: 'BILI_DL_OPEN_PANEL', mode: 'list' });

        if (!response?.ok) throw new Error(response?.error || t('pageNotReady'));

        window.close();

      } catch {

        $('error-text').textContent = t('pluginReloadSpace');

        showState('state-error');

      }

    };

    showState('state-video');

    return;

  }



  try {

    const resp = await EXT.tabs.sendMessage(tabId, { type: 'BILI_DL_GET_INFO' });

    if (resp?.ok) {

      renderVideo(resp.data);

      showState('state-video');

    } else {

      throw new Error(resp?.error || t('getInfoFailed'));

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

        clearNode($('quality-tags'));

        const retryTag = document.createElement('span');

        retryTag.className = 'popup-q-tag';

        retryTag.textContent = t('refreshPageRetry');

        $('quality-tags').appendChild(retryTag);

        $('btn-open-panel').disabled = false;

        showState('state-video');

      } else {

        throw new Error(t('pageDataNotLoaded'));

      }

    } catch (err) {

      $('error-text').textContent = translateUserError(err.message) || t('loadFailed');

      showState('state-error');

    }

  }



  $('btn-open-panel')?.addEventListener('click', async () => {

    try {

      await EXT.tabs.sendMessage(tabId, { type: 'BILI_DL_OPEN_PANEL', mode: /bilibili\.com\/list\//.test(tab.url) ? 'list' : 'video' });

      window.close();

    } catch {

      $('error-text').textContent = t('cannotOpenPanel');

      showState('state-error');

    }

  });



  $('btn-retry')?.addEventListener('click', async () => {

    if (!tabId) return;

    try {

      await EXT.tabs.reload(tabId);

      window.close();

    } catch {

      $('error-text').textContent = t('cannotRefreshPage');

      showState('state-error');

    }

  });

}



document.getElementById('popup-history-toggle')?.addEventListener('click', async () => {

  const panel = document.getElementById('popup-history-panel');

  const hidden = panel.classList.contains('hidden');

  panel.classList.toggle('hidden', !hidden);

  if (hidden) await renderPopupHistory();

});



document.getElementById('popup-history-clear')?.addEventListener('click', async () => {

  await EXT.storage.local.set({ [HISTORY_KEY]: [] });

  await renderPopupHistory();

});



renderPopupHistory();


// MV3 Service Worker — 处理受限的远程配置读取及浏览器原生下载
chrome.runtime.onInstalled.addListener(() => {
  const v = chrome.runtime.getManifest().version;
  console.log('[BiliDL] 已安装 v' + v);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (['BILI_DL_SAVE_MEDIA', 'BILI_DL_MEDIA_STATE', 'BILI_DL_CANCEL_MEDIA'].includes(msg?.type)) {
    (async () => {
      const senderUrl = new URL(_sender.url || '');
      if (_sender.id !== chrome.runtime.id || !_sender.tab || senderUrl.protocol !== 'https:' ||
          !/(^|\.)bilibili\.com$/.test(senderUrl.hostname)) throw new Error('不允许的下载请求');
      if (msg.type === 'BILI_DL_SAVE_MEDIA') {
        const url = new URL(String(msg.url || ''));
        if (url.protocol !== 'blob:' || url.origin !== senderUrl.origin) throw new Error('无效的媒体地址');
        const filename = String(msg.filename || '');
        if (!filename || /[\\/\x00-\x1f]/.test(filename) || !/\.(mp4|m4a)$/.test(filename)) throw new Error('无效的文件名');
        const downloadId = await chrome.downloads.download({ url: url.href, filename, saveAs: false, conflictAction: 'uniquify' });
        return { ok: true, downloadId };
      }
      if (!Number.isInteger(msg.downloadId)) throw new Error('无效的下载编号');
      const [item] = await chrome.downloads.search({ id: msg.downloadId });
      // Re-check ownership after service-worker restarts; never expose other downloads.
      if (!item || item.byExtensionId !== chrome.runtime.id) throw new Error('下载记录不可用，请打开浏览器下载记录检查');
      if (msg.type === 'BILI_DL_CANCEL_MEDIA' && item.state === 'in_progress') await chrome.downloads.cancel(item.id);
      return { ok: true, state: item.state, error: item.error || '', bytesReceived: item.bytesReceived || 0 };
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (msg?.type === 'BILI_DL_OPEN_DOWNLOADS') {
    const url = typeof browser !== 'undefined' && browser.runtime.getBrowserInfo ? 'about:downloads' : 'chrome://downloads/';
    chrome.tabs.create({ url }, () => {
      const error = chrome.runtime.lastError;
      sendResponse({ ok: !error, error: error?.message || '' });
    });
    return true;
  }
  if (msg?.type === 'BILI_DL_DOWNLOAD_COVER') {
    const sourceUrl = String(msg.url || '').trim();
    const filename = String(msg.filename || 'bilibili-cover.jpg');
    const url = sourceUrl.replace(/^http:\/\//i, 'https://');
    if (!/^https:\/\/(?:[^/]+\.)?hdslb\.com\//i.test(url)) {
      console.warn('[BiliDL] 封面下载拒绝：地址不在 hdslb.com 白名单', { sourceUrl, normalizedUrl: url });
      sendResponse({ ok: false, error: '不允许的封面地址' });
      return;
    }
    console.info('[BiliDL] 封面下载请求', { filename, sourceUrl, url });
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.error('[BiliDL] 封面下载启动失败', error.message || error);
        sendResponse({ ok: false, error: error.message || '封面下载失败' });
      } else {
        console.info('[BiliDL] 封面下载已创建', { downloadId, filename });
        sendResponse({ ok: true, downloadId });
      }
    });
    return true;
  }

  if (msg?.type !== 'BILI_DL_FETCH_JSON') return;
  const url = String(msg.url || '');
  if (url !== 'http://124.222.62.190:8081/api/config/bilibili') {
    console.warn('[BiliDL] 配置请求拒绝：地址不在白名单', url);
    sendResponse({ ok: false, error: '不允许的地址' });
    return;
  }
  console.info('[BiliDL] 请求远程配置', url);
  fetch(url, { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
    .then((data) => {
      console.info('[BiliDL] 远程配置加载成功', Object.keys(data || {}));
      sendResponse({ ok: true, data });
    })
    .catch((error) => {
      console.error('[BiliDL] 远程配置加载失败', error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
  return true;
});

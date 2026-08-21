// MV3 Service Worker — 当前版本仅做安装日志，核心逻辑在 content / page-agent
chrome.runtime.onInstalled.addListener(() => {
  const v = chrome.runtime.getManifest().version;
  console.log('[BiliDL] 已安装 v' + v);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'BILI_DL_FETCH_JSON') return;
  const url = String(msg.url || '');
  if (url !== 'https://download-config-hub.nutmeg-venus-6882.chatgpt.site/api/config/bilibili') {
    sendResponse({ ok: false, error: '不允许的地址' });
    return;
  }
  fetch(url, { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

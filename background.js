// MV3 Service Worker — 当前版本仅做安装日志，核心逻辑在 content / page-agent
chrome.runtime.onInstalled.addListener(() => {
  const v = chrome.runtime.getManifest().version;
  console.log('[BiliDL] 已安装 v' + v);
});

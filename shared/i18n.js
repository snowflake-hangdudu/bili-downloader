(function (root) {
  'use strict';

  const KEY = 'biliDlLanguage_v1';
  const messages = {
    'zh-CN': {
      followBrowser: '跟随浏览器',
      chinese: '简体中文',
      traditionalChinese: '繁體中文',
      english: 'English',
      appTitle: 'B站视频下载助手',
      close: '关闭',
      modeLabel: '下载模式',
      singleVideo: '单视频',
      listDownload: '列表下载',
      coverDownload: '下载封面',
      quality: '清晰度',
      qualityStrategy: '清晰度策略',
      qualityExact: '使用所选清晰度',
      qualityHighest: '始终最高可用',
      format: '格式',
      mp4: 'MP4 视频',
      m4a: 'M4A 音频',
      streamPreference: '视频质量',
      streamHighBitrate: '高码率优先（推荐）',
      streamCompatible: '兼容优先',
      streamPreferenceTitle: '仅在同一清晰度的原始视频流之间选择',
      estimateEmpty: '预计大小 —',
      startDownload: '开始下载',
      queueAllParts: '队列下载全部分 P',
      pauseAll: '暂停全部',
      cancelQueue: '取消整队',
      listDownloadKind: '下载内容',
      videoOnly: '仅视频',
      audioOnly: '仅音频',
      videoAndAudio: '视频+音频',
      listSearchPlaceholder: '搜索已加载视频标题',
      listFilter: '列表筛选',
      refreshCurrentPage: '刷新当前页',
      refreshCurrentPageTitle: '只读取 B 站当前页显示的投稿',
      filterAll: '全部',
      filterSelected: '已选',
      sortDefault: '默认',
      sortNewest: '最新',
      sortOldest: '最早',
      videoList: '视频列表',
      selectAll: '全选',
      selectAllTitle: '选择当前已加载的所有视频',
      loadMore: '继续加载',
      downloadSelected: '下载已选视频',
      retryIncomplete: '重试未完成',
      relatedPlugins: '相关插件',
      notice: '公告',
      diagnostics: '诊断日志',
      tasks: '任务中心',
      settings: '设置',
      feedback: '反馈',
      donate: '赞赏',
      donateTitle: '自愿赞赏',
      feedbackTitle: '点击复制反馈邮箱 {email}',
      backToDownload: '返回下载',
      settingsHint: '已入队任务不受影响',
      theme: '主题色',
      language: '语言',
      filename: '文件名',
      filenameRule: '文件名规则',
      presetTitle: '默认（仅标题）',
      presetTitleBvid: '标题 + BV',
      presetTitleBvidQuality: '标题 + BV + 清晰度',
      presetDetailed: '标题 + UP + BV + 清晰度',
      presetCustom: '自定义…',
      customTemplate: '自定义文件名模板',
      insertField: '插入变量',
      resetFilename: '恢复默认文件名',
      themeSaved: '主题已保存',
      themeSaveFailed: '主题保存失败',
      saved: '已保存',
      settingsLoadFailed: '设置模块未加载，请刷新页面后重试。',
      defaultTheme: '默认',
      'theme-cyan-mist': '苍雾青',
      'theme-violet-haze': '夜雾紫',
      'theme-ember': '余烬橙',
      'theme-bronze-smoke': '铜烟棕',
      'theme-deep-ocean': '深海蓝',
      'theme-obsidian': '曜石黑',
      'theme-tokyo-love': '东爱主题',
      'theme-manchester-sea': '海边的曼彻斯特',
      'theme-chinese-odyssey': '大话西游',
      chipTitle: '标题',
      chipAuthor: 'UP主',
      chipBvid: 'BV号',
      chipPart: '分P编号',
      chipPartTitle: '分P标题',
      chipIndex: '批次序号',
      chipQuality: '清晰度',
      chipDate: '日期',
      ratingTitle: '下载搞定 ⭐ 给个好评呗',
      ratingText: '用着顺手的话，去 Edge 商店点个分，对我们很有帮助。当然不评也完全没问题。',
      ratingGo: '去 Edge 商店评分 ⭐',
      ratingLater: '下次再说',
      ratingNever: '别再问了',
      loading: '加载中',
      identifying: '正在识别页面…',
      openPanel: '打开下载面板',
      availableQuality: '可用清晰度',
      emptyDetect: '当前不是支持的下载页面',
      emptyTitle: '支持 /video 播放页与 /list 列表页',
      emptyDesc: '请打开 bilibili.com/video/BV…、/video/av… 或 /list/…。首页、搜索、番剧页没有下载入口。',
      currentPage: '当前页面：',
      currentPageEmpty: '当前页面：—',
      currentPageUnknown: '当前页面：未知',
      stepOpen: '打开视频页（BV / av）或列表页',
      stepFab: '点击页面右下角悬浮按钮',
      stepDownload: '选清晰度下载；列表每次最多选 10 条',
      tagMp4: 'MP4 / M4A',
      tagFree: '完全免费',
      openSample: '打开示例视频页',
      loadFailed: '加载失败',
      errorTitle: '暂时无法读取视频信息',
      errorHint: '请刷新 B 站视频页后，再点击扩展图标重试',
      retry: '刷新并重试',
      history: '下载历史',
      historyClear: '清空历史',
      historyOpen: '打开',
      historyEmpty: '暂无下载记录',
      untitled: '未命名',
      faq: '常见问题',
      privacy: '隐私政策',
      helpLinks: '帮助链接',
      disclaimer: '仅供个人学习 · 请遵守 B 站用户协议',
      justNow: '刚刚',
      minutesAgo: '{n}分钟前',
      hoursAgo: '{n}小时前',
      daysAgo: '{n}天前',
      monthsAgo: '{n}个月前',
      yearsAgo: '{n}年前'
    },
    'zh-TW': {
      followBrowser: '跟隨瀏覽器',
      chinese: '简体中文',
      traditionalChinese: '繁體中文',
      english: 'English',
      appTitle: 'B站影片下載助手',
      close: '關閉',
      modeLabel: '下載模式',
      singleVideo: '單一影片',
      listDownload: '列表下載',
      coverDownload: '下載封面',
      quality: '畫質',
      qualityStrategy: '畫質策略',
      qualityExact: '使用所選畫質',
      qualityHighest: '始終最高可用',
      format: '格式',
      mp4: 'MP4 影片',
      m4a: 'M4A 音訊',
      streamPreference: '影片品質',
      streamHighBitrate: '高碼率優先（推薦）',
      streamCompatible: '相容優先',
      streamPreferenceTitle: '僅在同一畫質的原始影片串流之間選擇',
      estimateEmpty: '預估大小 —',
      startDownload: '開始下載',
      queueAllParts: '佇列下載全部分 P',
      pauseAll: '全部暫停',
      cancelQueue: '取消整隊',
      listDownloadKind: '下載內容',
      videoOnly: '僅影片',
      audioOnly: '僅音訊',
      videoAndAudio: '影片+音訊',
      listSearchPlaceholder: '搜尋已載入影片標題',
      listFilter: '列表篩選',
      refreshCurrentPage: '重新整理目前頁',
      refreshCurrentPageTitle: '只讀取 B 站目前頁顯示的投稿',
      filterAll: '全部',
      filterSelected: '已選',
      sortDefault: '預設',
      sortNewest: '最新',
      sortOldest: '最早',
      videoList: '影片列表',
      selectAll: '全選',
      selectAllTitle: '選擇目前已載入的所有影片',
      loadMore: '繼續載入',
      downloadSelected: '下載已選影片',
      retryIncomplete: '重試未完成',
      relatedPlugins: '相關擴充功能',
      notice: '公告',
      diagnostics: '診斷記錄',
      tasks: '任務中心',
      settings: '設定',
      feedback: '意見回饋',
      donate: '贊助',
      donateTitle: '自願贊助',
      feedbackTitle: '點選以複製意見回饋信箱 {email}',
      backToDownload: '返回下載',
      settingsHint: '已加入佇列的任務不受影響',
      theme: '主題色',
      language: '語言',
      filename: '檔名',
      filenameRule: '檔名規則',
      presetTitle: '預設（僅標題）',
      presetTitleBvid: '標題 + BV',
      presetTitleBvidQuality: '標題 + BV + 畫質',
      presetDetailed: '標題 + UP + BV + 畫質',
      presetCustom: '自訂…',
      customTemplate: '自訂檔名範本',
      insertField: '插入變數',
      resetFilename: '恢復預設檔名',
      themeSaved: '主題已儲存',
      themeSaveFailed: '主題儲存失敗',
      saved: '已儲存',
      settingsLoadFailed: '設定模組未載入，請重新整理頁面後重試。',
      defaultTheme: '預設',
      'theme-cyan-mist': '蒼霧青',
      'theme-violet-haze': '夜霧紫',
      'theme-ember': '餘燼橙',
      'theme-bronze-smoke': '銅煙棕',
      'theme-deep-ocean': '深海藍',
      'theme-obsidian': '曜石黑',
      'theme-tokyo-love': '東愛主題',
      'theme-manchester-sea': '海邊的曼徹斯特',
      'theme-chinese-odyssey': '大話西遊',
      chipTitle: '標題',
      chipAuthor: 'UP主',
      chipBvid: 'BV號',
      chipPart: '分P編號',
      chipPartTitle: '分P標題',
      chipIndex: '批次序號',
      chipQuality: '畫質',
      chipDate: '日期',
      ratingTitle: '下載完成 ⭐ 給個好評吧',
      ratingText: '如果好用，到 Edge 商店評分對我們很有幫助。當然不評也完全沒問題。',
      ratingGo: '前往 Edge 商店評分 ⭐',
      ratingLater: '下次再說',
      ratingNever: '不要再問',
      loading: '載入中',
      identifying: '正在識別頁面…',
      openPanel: '開啟下載面板',
      availableQuality: '可用畫質',
      emptyDetect: '目前不是支援的下載頁面',
      emptyTitle: '支援 /video 播放頁與 /list 列表頁',
      emptyDesc: '請開啟 bilibili.com/video/BV…、/video/av… 或 /list/…。首頁、搜尋、番劇頁沒有下載入口。',
      currentPage: '目前頁面：',
      currentPageEmpty: '目前頁面：—',
      currentPageUnknown: '目前頁面：未知',
      stepOpen: '開啟影片頁（BV / av）或列表頁',
      stepFab: '點選頁面右下角浮動按鈕',
      stepDownload: '選畫質下載；列表每次最多選 10 條',
      tagMp4: 'MP4 / M4A',
      tagFree: '完全免費',
      openSample: '開啟範例影片頁',
      loadFailed: '載入失敗',
      errorTitle: '暫時無法讀取影片資訊',
      errorHint: '請重新整理 B 站影片頁後，再點選擴充功能圖示重試',
      retry: '重新整理並重試',
      history: '下載記錄',
      historyClear: '清除記錄',
      historyOpen: '開啟',
      historyEmpty: '還沒有下載記錄',
      untitled: '未命名',
      faq: '常見問題',
      privacy: '隱私權政策',
      helpLinks: '說明連結',
      disclaimer: '僅供個人學習 · 請遵守 B 站使用者協議',
      justNow: '剛剛',
      minutesAgo: '{n}分鐘前',
      hoursAgo: '{n}小時前',
      daysAgo: '{n}天前',
      monthsAgo: '{n}個月前',
      yearsAgo: '{n}年前'
    },
    en: {
      followBrowser: 'Follow browser',
      chinese: '简体中文',
      traditionalChinese: '繁體中文',
      english: 'English',
      appTitle: 'Bilibili Video Download Assistant',
      close: 'Close',
      modeLabel: 'Download mode',
      singleVideo: 'Single video',
      listDownload: 'List download',
      coverDownload: 'Save cover',
      quality: 'Quality',
      qualityStrategy: 'Quality strategy',
      qualityExact: 'Use selected quality',
      qualityHighest: 'Highest available',
      format: 'Format',
      mp4: 'MP4 video',
      m4a: 'M4A audio',
      streamPreference: 'Video stream',
      streamHighBitrate: 'Higher bitrate (recommended)',
      streamCompatible: 'Compatibility first',
      streamPreferenceTitle: 'Choose between raw streams at the same quality',
      estimateEmpty: 'Estimated size —',
      startDownload: 'Start download',
      queueAllParts: 'Queue all parts',
      pauseAll: 'Pause all',
      cancelQueue: 'Cancel queue',
      listDownloadKind: 'Download content',
      videoOnly: 'Video only',
      audioOnly: 'Audio only',
      videoAndAudio: 'Video + audio',
      listSearchPlaceholder: 'Search loaded titles',
      listFilter: 'List filters',
      refreshCurrentPage: 'Refresh current page',
      refreshCurrentPageTitle: 'Read only videos shown on the current Bilibili page',
      filterAll: 'All',
      filterSelected: 'Selected',
      sortDefault: 'Default',
      sortNewest: 'Newest',
      sortOldest: 'Oldest',
      videoList: 'Video list',
      selectAll: 'Select all',
      selectAllTitle: 'Select all loaded videos',
      loadMore: 'Load more',
      downloadSelected: 'Download selected',
      retryIncomplete: 'Retry incomplete',
      relatedPlugins: 'Related extensions',
      notice: 'Notice',
      diagnostics: 'Diagnostics',
      tasks: 'Tasks',
      settings: 'Settings',
      feedback: 'Feedback',
      donate: 'Donate',
      donateTitle: 'Voluntary tip',
      feedbackTitle: 'Click to copy feedback email {email}',
      backToDownload: 'Back to download',
      settingsHint: 'Queued tasks are not affected',
      theme: 'Theme',
      language: 'Language',
      filename: 'Filename',
      filenameRule: 'Filename rule',
      presetTitle: 'Default (title only)',
      presetTitleBvid: 'Title + BV',
      presetTitleBvidQuality: 'Title + BV + quality',
      presetDetailed: 'Title + uploader + BV + quality',
      presetCustom: 'Custom…',
      customTemplate: 'Custom filename template',
      insertField: 'Insert field',
      resetFilename: 'Reset filename',
      themeSaved: 'Theme saved',
      themeSaveFailed: 'Could not save theme',
      saved: 'Saved',
      settingsLoadFailed: 'Settings module failed to load. Refresh the page and try again.',
      defaultTheme: 'Default',
      'theme-cyan-mist': 'Cyan Mist',
      'theme-violet-haze': 'Violet Haze',
      'theme-ember': 'Ember',
      'theme-bronze-smoke': 'Bronze Smoke',
      'theme-deep-ocean': 'Deep Ocean',
      'theme-obsidian': 'Obsidian',
      'theme-tokyo-love': 'Tokyo Love Story',
      'theme-manchester-sea': 'Manchester by the Sea',
      'theme-chinese-odyssey': 'A Chinese Odyssey',
      chipTitle: 'Title',
      chipAuthor: 'Uploader',
      chipBvid: 'BV ID',
      chipPart: 'Part no.',
      chipPartTitle: 'Part title',
      chipIndex: 'Batch index',
      chipQuality: 'Quality',
      chipDate: 'Date',
      ratingTitle: 'All set ⭐ Leave a rating',
      ratingText: 'If this helps, a rating on the Edge store would mean a lot. Totally optional.',
      ratingGo: 'Rate on Edge ⭐',
      ratingLater: 'Later',
      ratingNever: 'Don\'t ask again',
      loading: 'Loading',
      identifying: 'Reading this page…',
      openPanel: 'Open download panel',
      availableQuality: 'Available quality',
      emptyDetect: 'This page is not supported',
      emptyTitle: 'Supports /video pages and /list pages',
      emptyDesc: 'Open bilibili.com/video/BV…, /video/av…, or /list/…. Home, search, and bangumi pages have no download entry.',
      currentPage: 'Current page: ',
      currentPageEmpty: 'Current page: —',
      currentPageUnknown: 'Current page: Unknown',
      stepOpen: 'Open a video page (BV / av) or list page',
      stepFab: 'Click the floating button at the bottom-right',
      stepDownload: 'Pick quality; list mode allows up to 10 items per batch',
      tagMp4: 'MP4 / M4A',
      tagFree: 'Free',
      openSample: 'Open sample video',
      loadFailed: 'Load failed',
      errorTitle: 'Cannot read video info yet',
      errorHint: 'Refresh the Bilibili page, then click the extension icon again',
      retry: 'Refresh and retry',
      history: 'Download history',
      historyClear: 'Clear history',
      historyOpen: 'Open',
      historyEmpty: 'No downloads yet',
      untitled: 'Untitled',
      faq: 'FAQ',
      privacy: 'Privacy',
      helpLinks: 'Help links',
      disclaimer: 'For personal learning only. Follow Bilibili\'s terms.',
      justNow: 'Just now',
      minutesAgo: '{n} minutes ago',
      hoursAgo: '{n} hours ago',
      daysAgo: '{n} days ago',
      monthsAgo: '{n} months ago',
      yearsAgo: '{n} years ago'
    }
  };

  let preference = 'auto';
  let language = 'zh-CN';
  const listeners = new Set();

  function api() {
    return root.browser || root.chrome;
  }

  function storageGet(key) {
    const ext = api();
    const get = ext?.storage?.local?.get;
    if (typeof get !== 'function') return Promise.resolve({});
    try {
      const result = get.call(ext.storage.local, key);
      if (result && typeof result.then === 'function') return result;
    } catch (_) {}
    return new Promise((resolve) => {
      try {
        get.call(ext.storage.local, key, (value) => resolve(value || {}));
      } catch (_) {
        resolve({});
      }
    });
  }

  function storageSet(value) {
    const ext = api();
    const set = ext?.storage?.local?.set;
    if (typeof set !== 'function') return Promise.resolve();
    try {
      const result = set.call(ext.storage.local, value);
      if (result && typeof result.then === 'function') return result;
    } catch (_) {}
    return new Promise((resolve) => {
      try {
        set.call(ext.storage.local, value, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  function browserLanguage() {
    const ui = String(api()?.i18n?.getUILanguage?.() || root.navigator?.language || 'zh-CN').toLowerCase().replace(/_/g, '-');
    if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(ui)) return 'zh-TW';
    if (/^zh(?:-cn|-sg|-hans)?(?:-|$)/.test(ui) || ui === 'zh') return 'zh-CN';
    if (/^en(?:-|$)/.test(ui)) return 'en';
    return 'zh-CN';
  }

  function normalizePreference(value) {
    if (value === 'auto' || value == null || value === '') return 'auto';
    if (value === 'en') return 'en';
    if (value === 'zh-TW' || value === 'zh-tw') return 'zh-TW';
    if (value === 'zh-CN' || value === 'zh-cn') return 'zh-CN';
    return 'auto';
  }

  function resolveLanguage(pref) {
    const normalized = normalizePreference(pref);
    return normalized === 'auto' ? browserLanguage() : normalized;
  }

  function t(key, values) {
    const template = messages[language]?.[key] ?? messages['zh-CN']?.[key] ?? messages.en?.[key] ?? key;
    return String(template).replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
  }

  function apply(scope) {
    const node = scope?.querySelectorAll ? scope : root.document;
    if (!node?.querySelectorAll) return language;
    if (node.documentElement) {
      node.documentElement.lang = language === 'en' ? 'en' : language === 'zh-TW' ? 'zh-TW' : 'zh-CN';
    }
    node.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    node.querySelectorAll('[data-i18n-aria]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAria));
    });
    node.querySelectorAll('[data-i18n-title]').forEach((element) => {
      const values = {};
      if (element.dataset.feedbackEmail) values.email = element.dataset.feedbackEmail;
      element.title = t(element.dataset.i18nTitle, values);
    });
    node.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    });
    node.querySelectorAll('option[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    node.querySelectorAll('select[data-i18n-aria]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAria));
    });
    return language;
  }

  function emit() {
    listeners.forEach((listener) => {
      try { listener({ preference, language }); } catch (_) {}
    });
  }

  const ready = storageGet(KEY).then((stored) => {
    preference = normalizePreference(stored?.[KEY]);
    language = resolveLanguage(preference);
    return { preference, language };
  }).catch(() => ({ preference, language }));

  async function save(value) {
    preference = normalizePreference(value);
    language = resolveLanguage(preference);
    await storageSet({ [KEY]: preference });
    emit();
    return { preference, language };
  }

  api()?.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[KEY]) return;
    preference = normalizePreference(changes[KEY].newValue);
    const next = resolveLanguage(preference);
    if (next === language && changes[KEY].oldValue === changes[KEY].newValue) return;
    language = next;
    emit();
  });

  function mergeMessages(extra) {
    if (!extra || typeof extra !== 'object') return;
    for (const lang of Object.keys(extra)) {
      if (messages[lang]) Object.assign(messages[lang], extra[lang]);
    }
  }

  root.BiliDlI18n = {
    KEY,
    ready,
    preference: () => preference,
    language: () => language,
    browserLanguage,
    resolveLanguage,
    t,
    apply,
    save,
    mergeMessages,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

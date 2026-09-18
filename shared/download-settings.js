/**
 * Versioned download settings for Bilibili downloader.
 * Attaches to globalThis.BiliDlSettings.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'biliDlSettings_v1';
  const LEGACY_PREFS_KEY = 'biliDlDownloadPrefs';
  const LEGACY_PREFS_KEY_V1 = 'biliDlDownloadPrefs_v1';
  const Filename = root.BiliDlFilename;

  const DEFAULTS = Object.freeze({
    version: 1,
    filenameTemplate: '{title}'
  });

  function cloneDefaults() {
    return {
      version: DEFAULTS.version,
      filenameTemplate: DEFAULTS.filenameTemplate
    };
  }

  function normalizeSettings(raw) {
    const next = cloneDefaults();
    const src = raw && typeof raw === 'object' ? raw : {};
    if (Filename) {
      const migrated = Filename.migrateStyleToTemplate(src.filenameStyle);
      const template = String(src.filenameTemplate || migrated || next.filenameTemplate).trim();
      const check = Filename.validateTemplate(template);
      next.filenameTemplate = check.ok ? check.template : next.filenameTemplate;
    }
    return next;
  }

  async function readStorage(keys) {
    const EXT = typeof browser !== 'undefined' ? browser : chrome;
    return EXT.storage.local.get(keys);
  }

  async function writeStorage(values) {
    const EXT = typeof browser !== 'undefined' ? browser : chrome;
    return EXT.storage.local.set(values);
  }

  async function loadSettings() {
    const stored = await readStorage([STORAGE_KEY, LEGACY_PREFS_KEY, LEGACY_PREFS_KEY_V1]);
    if (stored[STORAGE_KEY] && typeof stored[STORAGE_KEY] === 'object') {
      return normalizeSettings(stored[STORAGE_KEY]);
    }
    const legacy = (stored[LEGACY_PREFS_KEY_V1] && typeof stored[LEGACY_PREFS_KEY_V1] === 'object'
      ? stored[LEGACY_PREFS_KEY_V1]
      : null)
      || (stored[LEGACY_PREFS_KEY] && typeof stored[LEGACY_PREFS_KEY] === 'object'
        ? stored[LEGACY_PREFS_KEY]
        : {});
    const migrated = normalizeSettings({
      filenameTemplate: Filename ? Filename.migrateStyleToTemplate(legacy.filenameStyle) : DEFAULTS.filenameTemplate
    });
    await writeStorage({ [STORAGE_KEY]: migrated });
    return migrated;
  }

  async function saveSettings(partial) {
    const current = await loadSettings();
    const incoming = partial || {};
    if (Filename && Object.prototype.hasOwnProperty.call(incoming, 'filenameTemplate')) {
      const check = Filename.validateTemplate(incoming.filenameTemplate);
      if (!check.ok) throw new Error(check.error);
      incoming.filenameTemplate = check.template;
    }
    const merged = normalizeSettings({ ...current, ...incoming });
    await writeStorage({ [STORAGE_KEY]: merged });
    return merged;
  }

  async function resetSettings() {
    const defaults = cloneDefaults();
    await writeStorage({ [STORAGE_KEY]: defaults });
    return defaults;
  }

  const SAMPLE_META = Object.freeze({
    title: '示例视频标题',
    author: '示例UP主',
    bvid: 'BV1GJ411x7h7',
    part: 2,
    partTitle: '分P标题示例',
    quality: '1080P'
  });

  function previewFilename(settings, format) {
    if (!Filename) return '示例预览不可用';
    const fmt = format === 'mp4' ? 'mp4' : format === 'm4a' ? 'm4a' : 'mp4';
    const base = Filename.renderTemplate(settings?.filenameTemplate || DEFAULTS.filenameTemplate, SAMPLE_META, {
      format: fmt,
      qualityLabel: fmt === 'm4a' ? '音频' : '1080P',
      index: 2,
      createdAt: Date.now()
    });
    return Filename.withExtension(base, fmt);
  }

  const api = {
    STORAGE_KEY,
    LEGACY_PREFS_KEY,
    DEFAULTS,
    SAMPLE_META,
    normalizeSettings,
    loadSettings,
    saveSettings,
    resetSettings,
    previewFilename,
    cloneDefaults
  };

  root.BiliDlSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

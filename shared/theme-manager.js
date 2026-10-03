(function (global) {
  'use strict';

  const DEFAULT_THEME_ID = 'bilibili';
  const AMBIENT_VAR_KEYS = [
    '--bg', '--surface', '--surface-hover', '--surface-strong', '--border', '--border-soft',
    '--text-primary', '--text-secondary', '--text-muted',
    '--brand', '--brand-strong', '--brand-hover', '--brand-soft', '--brand-border', '--brand-cta',
    '--footer-bg', '--footer-text',
    '--bdl-bg', '--bdl-surface', '--bdl-border', '--bdl-text', '--bdl-text-secondary', '--bdl-text-muted',
    '--bdl-header-text', '--bdl-primary', '--bdl-accent', '--bdl-primary-strong', '--bdl-accent-strong',
    '--bdl-primary-hover', '--bdl-accent-hover', '--bdl-primary-soft', '--bdl-accent-soft',
    '--bdl-primary-border', '--bdl-accent-border', '--bdl-primary-contrast', '--bdl-accent-contrast',
    '--theme-gradient-background', '--theme-gradient-button', '--theme-gradient-preview', '--theme-gradient-header',
    '--theme-surface-blur', '--theme-header-blur', '--theme-noise-opacity', '--theme-shadow'
  ];

  let themes = [];
  let themesPromise = null;

  function runtime() {
    return typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  }

  function themesUrl() {
    const ext = runtime();
    return ext?.runtime?.getURL?.('shared/themes-ambient-full.json') || '';
  }

  function loadThemes() {
    if (themes.length) return Promise.resolve(themes);
    if (themesPromise) return themesPromise;
    themesPromise = fetch(themesUrl())
      .then((response) => {
        if (!response.ok) throw new Error('主题配置读取失败');
        return response.json();
      })
      .then((data) => {
        themes = Array.isArray(data?.themes) ? data.themes : [];
        return themes;
      })
      .catch(() => {
        themes = [];
        return themes;
      });
    return themesPromise;
  }

  function getTheme(id) {
    return themes.find((theme) => theme.id === id) || null;
  }

  function isAmbientTheme(id) {
    return id && id !== DEFAULT_THEME_ID;
  }

  function listEntries() {
    const entries = [[DEFAULT_THEME_ID, '默认', '']];
    themes.forEach((theme) => entries.push([theme.id, theme.name, theme.gradients?.preview || '']));
    return entries;
  }

  function normalizeThemeId(value) {
    if (value === DEFAULT_THEME_ID) return DEFAULT_THEME_ID;
    return getTheme(value)?.id || DEFAULT_THEME_ID;
  }

  function clearAmbientVars(root) {
    if (!root?.style) return;
    AMBIENT_VAR_KEYS.forEach((key) => root.style.removeProperty(key));
  }

  function mapThemeVars(theme) {
    const c = theme.colors || {};
    const g = theme.gradients || {};
    const e = theme.effects || {};
    return {
      '--bg': c.background,
      '--surface': c.surface,
      '--surface-hover': c.surfaceHover,
      '--surface-strong': c.surfaceStrong,
      '--border': c.border,
      '--border-soft': c.borderSoft,
      '--text-primary': c.textPrimary,
      '--text-secondary': c.textSecondary,
      '--text-muted': c.textMuted,
      '--brand': c.primary,
      '--brand-strong': c.primaryStrong,
      '--brand-hover': c.primaryHover,
      '--brand-soft': c.primarySoft,
      '--brand-border': c.primaryBorder,
      '--brand-cta': g.primaryButton,
      '--footer-bg': c.surfaceStrong,
      '--footer-text': c.textSecondary,
      '--bdl-bg': c.background,
      '--bdl-surface': c.surface,
      '--bdl-border': c.border,
      '--bdl-text': c.textPrimary,
      '--bdl-text-secondary': c.textSecondary,
      '--bdl-text-muted': c.textMuted,
      '--bdl-header-text': c.textPrimary,
      '--bdl-primary': c.primary,
      '--bdl-accent': c.primary,
      '--bdl-primary-strong': c.primaryStrong,
      '--bdl-accent-strong': c.primaryStrong,
      '--bdl-primary-hover': c.primaryHover,
      '--bdl-accent-hover': c.primaryHover,
      '--bdl-primary-soft': c.primarySoft,
      '--bdl-accent-soft': c.primarySoft,
      '--bdl-primary-border': c.primaryBorder,
      '--bdl-accent-border': c.primaryBorder,
      '--bdl-primary-contrast': '#ffffff',
      '--bdl-accent-contrast': '#ffffff',
      '--theme-gradient-background': g.background,
      '--theme-gradient-button': g.primaryButton,
      '--theme-gradient-preview': g.preview,
      '--theme-gradient-header': g.header,
      '--theme-surface-blur': e.surfaceBlur,
      '--theme-header-blur': e.headerBlur,
      '--theme-noise-opacity': String(e.noiseOpacity ?? 0),
      '--theme-shadow': e.shadow
    };
  }

  function applyToRoot(root, value) {
    if (!root) return DEFAULT_THEME_ID;
    const themeId = normalizeThemeId(value);
    root.dataset.theme = themeId;

    if (!isAmbientTheme(themeId)) {
      root.removeAttribute('data-theme-mode');
      root.removeAttribute('data-theme-kind');
      clearAmbientVars(root);
      return DEFAULT_THEME_ID;
    }

    const theme = getTheme(themeId);
    if (!theme) {
      root.dataset.theme = DEFAULT_THEME_ID;
      root.removeAttribute('data-theme-mode');
      root.removeAttribute('data-theme-kind');
      clearAmbientVars(root);
      return DEFAULT_THEME_ID;
    }

    root.dataset.themeMode = theme.mode;
    root.dataset.themeKind = 'ambient';
    const vars = mapThemeVars(theme);
    Object.entries(vars).forEach(([key, val]) => {
      if (val != null && val !== '') root.style.setProperty(key, val);
    });
    return theme.id;
  }

  function styleSwatch(swatch, themeId) {
    if (!swatch) return;
    swatch.dataset.theme = themeId;
    swatch.style.backgroundImage = '';
    swatch.style.backgroundColor = '';
    if (themeId === DEFAULT_THEME_ID) {
      swatch.style.background = 'linear-gradient(135deg, #00AEEC, #0074DA)';
      return;
    }
    const preview = getTheme(themeId)?.gradients?.preview;
    if (preview) swatch.style.backgroundImage = preview;
  }

  function syncPicker(themeControl, root, themeId) {
    if (!themeControl || !root) return;
    const id = normalizeThemeId(themeId || root.dataset.theme);
    const selectedOption = themeControl.querySelector(`[data-theme-option="${id}"]`);
    const currentLabel = themeControl.querySelector('.bili-dl-settings-theme-current-label');
    const currentSwatch = themeControl.querySelector('.bili-dl-settings-theme-current-swatch');
    if (selectedOption && currentLabel) currentLabel.textContent = selectedOption.dataset.label || id;
    styleSwatch(currentSwatch, id);
    themeControl.querySelectorAll('[data-theme-option]').forEach((option) => {
      option.setAttribute('aria-selected', String(option.dataset.themeOption === id));
    });
  }

  global.BiliDlTheme = {
    DEFAULT_THEME_ID,
    loadThemes,
    getTheme,
    listEntries,
    isAmbientTheme,
    normalizeThemeId,
    applyToRoot,
    styleSwatch,
    syncPicker
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

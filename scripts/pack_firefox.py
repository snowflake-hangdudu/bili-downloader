"""打包 Firefox 发布包（XPI）"""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'bilibili-downloader-firefox.xpi')
# Firefox 商店版本可独立于 Chromium manifest.json 递增。
FIREFOX_RELEASE_VERSION = '1.2.4'

INCLUDE = {
    'background.js',
    '_locales/zh_CN/messages.json', '_locales/en/messages.json',
    'content/page-agent.js', 'content/content.js', 'content/content.css',
    'shared/design-system.css', 'shared/ambient-themes.css', 'shared/theme-manager.js',
    'shared/themes-ambient-full.json', 'shared/i18n.js', 'shared/i18n-extra.js', 'shared/filename.js', 'shared/download-settings.js',
    'popup/popup.html', 'popup/popup.js', 'popup/popup.css',
    'lib/mp4-remux.iife.js', 'lib/m4s-mux.js', 'lib/m4s-mux-worker.js',
    'icons/icon128.png', 'icons/icon48.png', 'icons/icon32.png', 'icons/icon16.png',
    'assets/donate-wechat.jpg', 'assets/donate-alipay.jpg',
}
DEBUG_REFRESH_MARKERS = (
    ('const REMOTE_CATALOG_DEBUG_REFRESH = true;', 'const REMOTE_CATALOG_DEBUG_REFRESH = false;'),
    ('const REMOTE_CONTENT_DEBUG_REFRESH = true;', 'const REMOTE_CONTENT_DEBUG_REFRESH = false;'),
)


def packaged_bytes(rel, path):
    if rel != 'content/content.js':
        with open(path, 'rb') as f:
            return f.read()
    with open(path, 'r', encoding='utf-8') as f:
        source = f.read()
    for debug_marker, release_marker in DEBUG_REFRESH_MARKERS:
        if debug_marker in source:
            source = source.replace(debug_marker, release_marker, 1)
        elif release_marker not in source:
            raise SystemExit(f'PACK FAIL missing remote debug marker: {debug_marker}')
    return source.encode('utf-8')


def build_manifest():
    with open(os.path.join(ROOT, 'manifest.json'), 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    manifest['version'] = FIREFOX_RELEASE_VERSION
    manifest['background'] = {
        'scripts': ['background.js']
    }
    manifest['browser_specific_settings'] = {
        'gecko': {
            'id': 'bilibili-downloader@hangdudu.local',
            'data_collection_permissions': {
                'required': ['none']
            },
            'strict_min_version': '128.0'
        }
    }
    return json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'


def main():
    missing = [rel for rel in sorted(INCLUDE) if not os.path.isfile(os.path.join(ROOT, rel.replace('/', os.sep)))]
    if missing:
        raise SystemExit('PACK FAIL missing required files:\n' + '\n'.join(missing))
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('manifest.json', build_manifest().encode('utf-8'))
        print('ADD: manifest.json (firefox)')
        for rel in sorted(INCLUDE):
            path = os.path.join(ROOT, rel.replace('/', os.sep))
            zf.writestr(rel, packaged_bytes(rel, path))
            print('ADD:', rel)
    print('OK ->', OUT)


if __name__ == '__main__':
    main()

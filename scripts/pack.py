"""打包发布 zip（排除 test/node_modules 等）"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'bilibili-downloader.zip')

INCLUDE = {
    'manifest.json', 'background.js',
    '_locales/zh_CN/messages.json', '_locales/en/messages.json',
    'content/page-agent.js', 'content/content.js', 'content/content.css',
    'shared/design-system.css', 'shared/filename.js', 'shared/download-settings.js',
    'popup/popup.html', 'popup/popup.js', 'popup/popup.css',
    'lib/mp4-remux.iife.js', 'lib/m4s-mux.js', 'lib/m4s-mux-worker.js',
    'icons/icon128.png', 'icons/icon48.png', 'icons/icon32.png', 'icons/icon16.png',
}

REQUIRED = set(INCLUDE)
DEBUG_CATALOG_MARKER = 'const REMOTE_CATALOG_DEBUG_REFRESH = true;'
RELEASE_CATALOG_MARKER = 'const REMOTE_CATALOG_DEBUG_REFRESH = false;'


def packaged_bytes(rel, path):
    if rel != 'content/content.js':
        with open(path, 'rb') as f:
            return f.read()
    with open(path, 'r', encoding='utf-8') as f:
        source = f.read()
    if DEBUG_CATALOG_MARKER not in source:
        raise SystemExit('PACK FAIL missing remote catalog debug marker')
    return source.replace(DEBUG_CATALOG_MARKER, RELEASE_CATALOG_MARKER, 1).encode('utf-8')

def main():
    missing = [rel for rel in sorted(REQUIRED) if not os.path.isfile(os.path.join(ROOT, rel.replace('/', os.sep)))]
    if missing:
        raise SystemExit('PACK FAIL missing required files:\n' + '\n'.join(missing))
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zf:
        for rel in sorted(INCLUDE):
            path = os.path.join(ROOT, rel.replace('/', os.sep))
            zf.writestr(rel, packaged_bytes(rel, path))
            print('ADD:', rel)
    print('OK ->', OUT)

if __name__ == '__main__':
    main()

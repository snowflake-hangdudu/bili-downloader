"""打包发布 zip（排除 test/node_modules 等）"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'bilibili-downloader.zip')

INCLUDE = {
    'manifest.json', 'background.js',
    'content/page-agent.js', 'content/content.js', 'content/content.css',
    'popup/popup.html', 'popup/popup.js', 'popup/popup.css',
    'lib/mp4-remux.iife.js', 'lib/m4s-mux.js',
    'icons/icon128.png', 'icons/icon48.png', 'icons/icon32.png', 'icons/icon16.png',
}

def main():
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zf:
        for rel in sorted(INCLUDE):
            path = os.path.join(ROOT, rel.replace('/', os.sep))
            if not os.path.isfile(path):
                print('SKIP (missing):', rel)
                continue
            zf.write(path, rel)
            print('ADD:', rel)
    print('OK ->', OUT)

if __name__ == '__main__':
    main()

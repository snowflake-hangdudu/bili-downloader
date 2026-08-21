"""打包 Firefox 发布包（XPI）"""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'bilibili-downloader-firefox.xpi')

INCLUDE = {
    'background.js',
    '_locales/zh_CN/messages.json', '_locales/en/messages.json',
    'content/page-agent.js', 'content/content.js', 'content/content.css',
    'popup/popup.html', 'popup/popup.js', 'popup/popup.css',
    'lib/mp4-remux.iife.js', 'lib/m4s-mux.js',
    'icons/icon128.png', 'icons/icon48.png', 'icons/icon32.png', 'icons/icon16.png',
}


def build_manifest():
    with open(os.path.join(ROOT, 'manifest.json'), 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    manifest['background'] = {
        'scripts': ['background.js']
    }
    manifest['browser_specific_settings'] = {
        'gecko': {
            'id': 'bilibili-downloader@hangdudu.local',
            'data_collection_permissions': {
                'required': ['none']
            },
            'strict_min_version': '121.0'
        }
    }
    return json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'


def main():
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('manifest.json', build_manifest().encode('utf-8'))
        print('ADD: manifest.json (firefox)')
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

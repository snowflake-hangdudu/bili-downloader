"""下载 ffmpeg.wasm 到 lib/ffmpeg"""
import os, urllib.request

base = os.path.join(os.path.dirname(__file__), '..', 'lib', 'ffmpeg')
os.makedirs(base, exist_ok=True)

files = {
    'ffmpeg.min.js': 'https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js',
    'ffmpeg-core.js': 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
    'ffmpeg-core.wasm': 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.wasm',
    'ffmpeg-core.worker.js': 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.worker.js',
}

for name, url in files.items():
    path = os.path.join(base, name)
    print('Downloading', name, '...')
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(path, 'wb') as f:
                f.write(data)
            print('  ->', len(data), 'bytes')
            break
        except Exception as e:
            print('  attempt', attempt + 1, 'failed:', e)
            if attempt == 2:
                raise

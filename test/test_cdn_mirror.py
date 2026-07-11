"""验证 CDN 镜像替换方案对用户视频是否有效"""
import urllib.request, json, re

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
REF = 'https://www.bilibili.com/'
MIRRORS = [
    'upos-sz-mirrorali.bilivideo.com',
    'upos-sz-mirrorcos.bilivideo.com',
    'upos-sz-mirrorbos.bilivideo.com',
]

def get_api(path):
    req = urllib.request.Request('https://api.bilibili.com' + path, headers={
        'User-Agent': UA, 'Referer': REF, 'Origin': 'https://www.bilibili.com'
    })
    return json.loads(urllib.request.urlopen(req, timeout=15).read())

def rewrite(url, host):
    from urllib.parse import urlparse, urlunparse
    p = urlparse(url)
    if 'akamaized' in p.hostname or p.path.startswith('/v1/resource'):
        return None
    if 'bilivideo' not in p.hostname and 'mcdn' not in p.hostname:
        return None
    return urlunparse(('https', host, p.path, p.params, p.query, p.fragment))

def test_url(url, label):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': REF})
    req.add_header('Range', 'bytes=0-1023')
    try:
        r = urllib.request.urlopen(req, timeout=10)
        print(f'  {label}: HTTP {r.status} OK ({r.headers.get("Content-Length", "?")} bytes sample)')
        return True
    except urllib.error.HTTPError as e:
        print(f'  {label}: HTTP {e.code} FAIL')
        return False
    except Exception as e:
        print(f'  {label}: {e}')
        return False

bvid = 'BV13CT66DEE5'
view = get_api(f'/x/web-interface/view?bvid={bvid}')
aid, cid = view['data']['aid'], view['data']['cid']
play = get_api(f'/x/player/playurl?avid={aid}&cid={cid}&qn=16&fnval=16&fourk=1&platform=pc')

video_url = play['data']['dash']['video'][0]['baseUrl']
print('原始 CDN:', re.search(r'https?://[^/]+', video_url).group())
print('测试各节点（仅前1KB）:')
test_url(video_url, '原始')
for m in MIRRORS:
    u = rewrite(video_url, m)
    if u:
        test_url(u, m)

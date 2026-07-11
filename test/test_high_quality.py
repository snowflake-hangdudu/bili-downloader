"""检查 1080P/4K 的 playurl 返回地址"""
import urllib.request, json, re

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
REF = 'https://www.bilibili.com/'

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': REF, 'Origin': 'https://www.bilibili.com'})
    return json.loads(urllib.request.urlopen(req, timeout=15).read())

bvid = 'BV13CT66DEE5'
view = get(f'https://api.bilibili.com/x/web-interface/view?bvid={bvid}')
aid, cid = view['data']['aid'], view['data']['cid']

for qn, name in [(127, '4K'), (112, '1080P+'), (80, '1080P'), (64, '720P')]:
    d = get(f'https://api.bilibili.com/x/player/playurl?avid={aid}&cid={cid}&qn={qn}&fnval=16&fourk=1&platform=pc')['data']
    dash = d.get('dash') or {}
    videos = dash.get('video') or []
    audios = dash.get('audio') or []
    v = next((x for x in videos if x['id'] == qn), videos[0] if videos else None)
    a = audios[0] if audios else None
    print(f'\n=== {name} (qn={qn}) ===')
    if v:
        u = v.get('baseUrl') or v.get('base_url', '')
        print(f'  video id={v["id"]} host={u.split("/")[2] if u else "?"} size={v.get("size")}')
        print(f'  video url prefix: {u[:80]}...')
    if a:
        u = a.get('baseUrl') or a.get('base_url', '')
        print(f'  audio id={a["id"]} host={u.split("/")[2] if u else "?"} size={a.get("size")}')
    durl = d.get('durl') or []
    print(f'  durl count={len(durl)}')

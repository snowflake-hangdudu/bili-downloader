"""对比 360p/480p 的 DASH vs durl 返回"""
import urllib.request, json

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
REF = 'https://www.bilibili.com/'

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': REF})
    return json.loads(urllib.request.urlopen(req, timeout=15).read())

bvid = 'BV13CT66DEE5'
view = get(f'https://api.bilibili.com/x/web-interface/view?bvid={bvid}')
aid, cid = view['data']['aid'], view['data']['cid']
print(f'aid={aid} cid={cid}\n')

for qn, name in [(80, '1080P'), (64, '720P'), (32, '480P'), (16, '360P')]:
    for fnval in [16, 1]:
        p = get(f'https://api.bilibili.com/x/player/playurl?avid={aid}&cid={cid}&qn={qn}&fnval={fnval}&platform=pc')
        d = p['data']
        dash_v = (d.get('dash') or {}).get('video') or []
        dash_a = (d.get('dash') or {}).get('audio') or []
        durl = d.get('durl') or []
        print(f'{name} fnval={fnval}: dash_v={len(dash_v)} dash_a={len(dash_a)} durl={len(durl)}')
        if durl:
            u = durl[0]['url']
            print(f'  durl size={durl[0].get("size")} url_host={u.split("/")[2]}')
        if dash_v:
            v = next((x for x in dash_v if x['id']==qn), dash_v[0])
            print(f'  video id={v["id"]} size={v.get("size")}')
        if dash_a:
            a = dash_a[0]
            print(f'  audio id={a["id"]} size={a.get("size")}')

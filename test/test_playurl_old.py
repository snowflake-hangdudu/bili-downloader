import urllib.request, json

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
REF = 'https://www.bilibili.com/'

def get(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Referer': REF, 'Origin': 'https://www.bilibili.com'
    })
    return json.loads(urllib.request.urlopen(req).read())

aid, cid = 80433022, 137649199
for fnval in [16, 1]:
    url = f'https://api.bilibili.com/x/player/playurl?avid={aid}&cid={cid}&qn=80&fnval={fnval}&fourk=1&platform=pc'
    r = get(url)
    d = r.get('data') or {}
    print('fnval=%d code=%s formats=%d dash=%d durl=%d' % (
        fnval, r.get('code'), len(d.get('support_formats') or []),
        len((d.get('dash') or {}).get('video') or []), len(d.get('durl') or [])
    ))

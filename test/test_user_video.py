import urllib.request, json, re

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
REF = 'https://www.bilibili.com/'

def get(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Referer': REF, 'Origin': 'https://www.bilibili.com'
    })
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())
    except Exception as e:
        return {'error': str(e)}

bvid = 'BV13CT66DEE5'
url = 'https://www.bilibili.com/video/BV13CT66DEE5/?spm_id_from=333.1007.tianma.2-2-5.click&vd_source=b86ae0d2e854655b4bd5ecb664fbc680'

# URL parse test (same regex as extension)
path = '/video/BV13CT66DEE5/'
m = re.search(r'/video/(BV[a-zA-Z0-9]+)', path, re.I)
print('URL parse:', m.group(1) if m else 'FAIL')

# view API
r = get(f'https://api.bilibili.com/x/web-interface/view?bvid={bvid}')
print('view code:', r.get('code'), r.get('message', r.get('error', '')))
if r.get('code') == 0:
    d = r['data']
    print('  title:', d.get('title'))
    print('  aid:', d.get('aid'), 'cid:', d.get('cid'))
    print('  pages:', len(d.get('pages') or []))

    aid, cid = d['aid'], d.get('cid') or (d.get('pages') or [{}])[0].get('cid')
    # playurl
    p = get(f'https://api.bilibili.com/x/player/playurl?avid={aid}&cid={cid}&qn=80&fnval=16&fourk=1&platform=pc')
    print('playurl code:', p.get('code'), p.get('message', ''))
    if p.get('code') == 0:
        pd = p['data']
        print('  formats:', len(pd.get('support_formats') or []))

# pagelist
pl = get(f'https://api.bilibili.com/x/player/pagelist?bvid={bvid}')
print('pagelist code:', pl.get('code'), 'count:', len(pl.get('data') or []))

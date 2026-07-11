import urllib.request, json, re, time, hashlib, urllib.parse

bvid = 'BV1GJ411x7h7'

# 1. Old view API (no wbi) - best fallback
url1 = f'https://api.bilibili.com/x/web-interface/view?bvid={bvid}'
r1 = json.loads(urllib.request.urlopen(url1).read())
print('Old view API:', r1.get('code'), r1.get('message', 'OK'))
if r1.get('code') == 0:
    d = r1['data']
    print('  aid=', d['aid'], 'cid=', d['cid'], 'title=', d['title'][:30])

# 2. av URL format
url_av = 'https://api.bilibili.com/x/web-interface/view?aid=80433022'
r_av = json.loads(urllib.request.urlopen(url_av).read())
print('aid view API:', r_av.get('code'))

# 3. pagelist API
url_p = f'https://api.bilibili.com/x/player/pagelist?bvid={bvid}&jsonp=jsonp'
r_p = json.loads(urllib.request.urlopen(url_p).read())
print('pagelist API:', r_p.get('code'), 'pages=', len(r_p.get('data') or []))

# 4. Test MD5 JS vs Python for wbi
MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
nav = json.loads(urllib.request.urlopen('https://api.bilibili.com/x/web-interface/nav').read())
wbi = nav['data']['wbi_img']
img = re.search(r'/([^/]+)\.\w+$', wbi['img_url']).group(1)
sub = re.search(r'/([^/]+)\.\w+$', wbi['sub_url']).group(1)
mixin = ''.join((img+sub)[i] for i in MIXIN_TAB)[:32]
wts = int(time.time())
signed = {'bvid': bvid, 'wts': wts}
q = '&'.join(f'{urllib.parse.quote(str(k))}={urllib.parse.quote(str(v))}' for k,v in sorted(signed.items()))
w_rid = hashlib.md5((q + mixin).encode()).hexdigest()
url2 = f'https://api.bilibili.com/x/web-interface/wbi/view?{urllib.parse.urlencode({**signed, "w_rid": w_rid})}'
r2 = json.loads(urllib.request.urlopen(url2).read())
print('WBI view API:', r2.get('code'), r2.get('message', 'OK'))

# 5. Page HTML
req = urllib.request.Request('https://www.bilibili.com/video/BV1GJ411x7h7/', headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req).read().decode('utf-8', 'ignore')
print('HTML length:', len(html))
print('Has script tags:', '<script' in html)
# look for bvid in html
print('bvid in html:', bvid in html)

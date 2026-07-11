"""逐步调试 B 站 API - 步骤 1~4"""
import hashlib, json, re, time, urllib.request, urllib.parse

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
]

def extract_key(url):
    m = re.search(r'/([^/]+)\.(png|jpg|webp)', url, re.I)
    return m.group(1) if m else ''

def gen_mixin_key(img_key, sub_key):
    raw = img_key + sub_key
    return ''.join(raw[i] for i in MIXIN_KEY_ENC_TAB)[:32]

def encode_upper(s):
    return urllib.parse.quote(str(s), safe='')

def sign_params(params, img_key, sub_key):
    mixin_key = gen_mixin_key(img_key, sub_key)
    wts = int(time.time())
    signed = {**params, 'wts': wts}
    query = '&'.join(
        f'{encode_upper(k)}={encode_upper(v)}'
        for k, v in sorted(signed.items())
    )
    w_rid = hashlib.md5((query + mixin_key).encode()).hexdigest()
    return {**params, 'wts': wts, 'w_rid': w_rid}

def fetch(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com/'
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

# 步骤 1: WBI 官方示例验证
print('=== 步骤 1: WBI 签名算法 ===')
IMG = '7cd084941338484aae1ad9425b84077c'
SUB = '4932caff0ff746eab6f01bf08b70ac45'
mixin = gen_mixin_key(IMG, SUB)
expected = 'ea1db124af3c7062474693fa704f4ff8'
print(f'mixin_key: {"PASS" if mixin == expected else "FAIL"} ({mixin})')

# 固定 wts 验证 w_rid
wts = 1702204169
signed_test = {'foo': '114', 'bar': '514', 'zab': 1919810, 'wts': wts}
q = '&'.join(f'{encode_upper(k)}={encode_upper(v)}' for k, v in sorted(signed_test.items()))
w_rid = hashlib.md5((q + mixin).encode()).hexdigest()
expected_rid = '8f6f2b5b3d485fe1886cec6a0be8c5d4'
print(f'w_rid: {"PASS" if w_rid == expected_rid else "FAIL"} ({w_rid})')

# 步骤 2: nav 接口
print('\n=== 步骤 2: nav 接口 ===')
nav = fetch('https://api.bilibili.com/x/web-interface/nav')
print(f'code={nav["code"]}, login={nav["data"].get("isLogin")}')
wbi = nav['data']['wbi_img']
img_key = extract_key(wbi['img_url'])
sub_key = extract_key(wbi['sub_url'])
print(f'img_key={img_key[:12]}..., sub_key={sub_key[:12]}...')

# 步骤 3: 视频信息
print('\n=== 步骤 3: 视频信息 (BV1GJ411x7h7) ===')
bvid = 'BV1GJ411x7h7'
params = sign_params({'bvid': bvid}, img_key, sub_key)
query = urllib.parse.urlencode(params)
view = fetch(f'https://api.bilibili.com/x/web-interface/wbi/view?{query}')
print(f'code={view["code"]}, msg={view.get("message")}')
if view['code'] == 0:
    d = view['data']
    print(f'PASS title={d["title"]}, aid={d["aid"]}, cid={d["cid"]}')
    aid, cid = d['aid'], d['cid']

    # 步骤 4: playurl
    print('\n=== 步骤 4: playurl 接口 ===')
    for fnval in [16, 1]:
        pp = sign_params({'avid': aid, 'cid': cid, 'qn': 16, 'fnval': fnval, 'fourk': 1, 'platform': 'pc'}, img_key, sub_key)
        pq = urllib.parse.urlencode(pp)
        play = fetch(f'https://api.bilibili.com/x/player/wbi/playurl?{pq}')
        print(f'fnval={fnval}: code={play["code"]}, msg={play.get("message","OK")}')
        if play['code'] == 0:
            pd = play['data']
            fmts = pd.get('support_formats') or []
            dash_v = (pd.get('dash') or {}).get('video') or []
            durl = pd.get('durl') or []
            print(f'  formats={len(fmts)}, dash.video={len(dash_v)}, durl={len(durl)}')
            if dash_v:
                url = dash_v[0].get('baseUrl') or dash_v[0].get('base_url','')
                print(f'  video url prefix: {url[:70]}...')
else:
    print('FAIL - 检查签名或 urlencode 差异')

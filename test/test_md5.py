"""验证 JS wbi.js 的 MD5 是否与 Python hashlib 一致"""
import hashlib, subprocess, json, tempfile, os

# 官方测试向量
IMG = '7cd084941338484aae1ad9425b84077c'
SUB = '4932caff0ff746eab6f01bf08b70ac45'
MIXIN = 'ea1db124af3c7062474693fa704f4ff8'
QUERY = 'bar=114&foo=114&wts=1702204169&zab=1919810'
EXPECTED = '8f6f2b5b3d485fe1886cec6a0be8c5d4'

py_md5 = hashlib.md5((QUERY + MIXIN).encode()).hexdigest()
print('Python MD5:', py_md5, 'PASS' if py_md5 == EXPECTED else 'FAIL')

# 读取 wbi.js 并在 node 中测试（如果有 node）
wbi_path = r'd:\插件\bilibili-downloader\lib\wbi.js'
with open(wbi_path, encoding='utf-8') as f:
    code = f.read()

test_js = code.replace('export async function getWbiKeys', 'async function getWbiKeys') \
    .replace('export async function signParams', 'async function signParams') + f"""
const signed = await signParams({{foo:'114',bar:'514',zab:1919810}}, '{IMG}', '{SUB}');
console.log(JSON.stringify({{w_rid: signed.w_rid, wts: signed.wts}}));
"""

with tempfile.NamedTemporaryFile(mode='w', suffix='.mjs', delete=False, encoding='utf-8') as tf:
    tf.write(test_js)
    tmp = tf.name

try:
    r = subprocess.run(['node', tmp], capture_output=True, text=True, timeout=10)
    if r.returncode == 0:
        out = json.loads(r.stdout.strip())
        print('Node signParams w_rid:', out['w_rid'])
        # 固定 wts 无法直接比，但可测 mixin 通过 getWbiKeys path
    else:
        print('Node not available or error:', r.stderr[:200])
except FileNotFoundError:
    print('Node 未安装，跳过 JS MD5 验证')

# 测试 playurl 不带 cookie vs 带错误签名
import urllib.request, time, re

MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]

def sign(params, img, sub):
    import urllib.parse
    raw = img + sub
    mixin = ''.join(raw[i] for i in MIXIN_KEY_ENC_TAB)[:32]
    wts = int(time.time())
    signed = {**params, 'wts': wts}
    q = '&'.join(f'{urllib.parse.quote(str(k), safe="")}={urllib.parse.quote(str(v), safe="")}' for k,v in sorted(signed.items()))
    w_rid = hashlib.md5((q + mixin).encode()).hexdigest()
    return {**params, 'wts': wts, 'w_rid': w_rid}

nav = json.loads(urllib.request.urlopen('https://api.bilibili.com/x/web-interface/nav').read())
img = re.search(r'/([^/]+)\.\w+$', nav['data']['wbi_img']['img_url']).group(1)
sub = re.search(r'/([^/]+)\.\w+$', nav['data']['wbi_img']['sub_url']).group(1)

# 测试错误签名
bad = sign({'avid': 80433022, 'cid': 137649199, 'qn': 80, 'fnval': 16, 'fourk': 1, 'platform': 'pc'}, img, 'WRONG_KEY')
import urllib.parse
q = urllib.parse.urlencode(bad)
r = json.loads(urllib.request.urlopen(f'https://api.bilibili.com/x/player/wbi/playurl?{q}').read())
print('Bad sign code:', r.get('code'), r.get('message'))

good = sign({'avid': 80433022, 'cid': 137649199, 'qn': 80, 'fnval': 16, 'fourk': 1, 'platform': 'pc'}, img, sub)
q2 = urllib.parse.urlencode(good)
r2 = json.loads(urllib.request.urlopen(f'https://api.bilibili.com/x/player/wbi/playurl?{q2}').read())
print('Good sign code:', r2.get('code'), 'formats:', len(r2.get('data',{}).get('support_formats') or []))

finally:
    os.unlink(tmp)

"""验证 JS wbi.js MD5 实现"""
import hashlib

# 从 wbi.js 复制的测试 - 用 Python hashlib 验证官方向量
QUERY = 'bar=114&foo=114&wts=1702204169&zab=1919810'
MIXIN = 'ea1db124af3c7062474693fa704f4ff8'
expected = '8f6f2b5b3d485fe1886cec6a0be8c5d4'
got = hashlib.md5((QUERY + MIXIN).encode()).hexdigest()
print('Official vector:', 'PASS' if got == expected else f'FAIL {got}')

# 测试 JS MD5 通过 node
import subprocess, tempfile, os
js_md5_test = r'''
// paste minimal - run signParams with fixed time mock
const MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
'''
# Read full wbi.js and test md5 output for known query
wbi_path = r'd:\插件\bilibili-downloader\lib\wbi.js'
with open(wbi_path, encoding='utf-8') as f:
    code = f.read()

# Extract md5 function test by evaluating signParams logic
test_code = code.replace('export async function getWbiKeys', 'async function getWbiKeys') \
    .replace('export async function signParams', 'async function signParams')

# Mock Date.now for fixed wts - actually signParams uses Math.floor(Date.now()/1000)
# Test genMixinKey only
test = test_code + """
const IMG='7cd084941338484aae1ad9425b84077c', SUB='4932caff0ff746eab6f01bf08b70ac45';
const mixin = genMixinKey(IMG, SUB);
console.log('mixin:', mixin === 'ea1db124af3c7062474693fa704f4ff8' ? 'PASS' : 'FAIL ' + mixin);
// test md5 directly via signParams internals - manual
const signed = { foo: '114', bar: '514', zab: 1919810, wts: 1702204169 };
const query = Object.keys(signed).sort().map(k => {
  const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return enc(k) + '=' + enc(String(signed[k]));
}).join('&');
const w_rid = md5(query + mixin);
console.log('w_rid:', w_rid === '8f6f2b5b3d485fe1886cec6a0be8c5d4' ? 'PASS' : 'FAIL ' + w_rid);
"""

with tempfile.NamedTemporaryFile(mode='w', suffix='.mjs', delete=False, encoding='utf-8') as tf:
    tf.write(test)
    tmp = tf.name

try:
    r = subprocess.run(['node', tmp], capture_output=True, text=True, timeout=15)
    print('Node output:', r.stdout.strip() or r.stderr.strip())
except FileNotFoundError:
    print('Node not installed - cannot verify JS MD5')

# 测试非 wbi 的旧 playurl 接口是否仍可用
import urllib.request, json, time, re

def get_keys():
    nav = json.loads(urllib.request.urlopen('https://api.bilibili.com/x/web-interface/nav').read())
    wbi = nav['data']['wbi_img']
    img = re.search(r'/([^/]+)\.\w+$', wbi['img_url']).group(1)
    sub = re.search(r'/([^/]+)\.\w+$', wbi['sub_url']).group(1)
    return img, sub

MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
def sign(p, img, sub):
    import urllib.parse
    mixin = ''.join((img+sub)[i] for i in MIXIN_TAB)[:32]
    wts = int(time.time())
    s = {**p, 'wts': wts}
    q = '&'.join(f'{urllib.parse.quote(str(k), safe="")}={urllib.parse.quote(str(v), safe="")}' for k,v in sorted(s.items()))
    return {**p, 'wts': wts, 'w_rid': hashlib.md5((q+mixin).encode()).hexdigest()}

img, sub = get_keys()
aid, cid = 80433022, 137649199

# 旧接口（无 wbi）
old_url = f'https://api.bilibili.com/x/player/playurl?avid={aid}&cid={cid}&qn=80&fnval=16&fourk=1&platform=pc'
try:
    old = json.loads(urllib.request.urlopen(old_url).read())
    print('Old playurl code:', old.get('code'), old.get('message'))
except Exception as e:
    print('Old playurl error:', e)

import urllib.parse
p = sign({'avid': aid, 'cid': cid, 'qn': 80, 'fnval': 16, 'fourk': 1, 'platform': 'pc'}, img, sub)
wbi_url = 'https://api.bilibili.com/x/player/wbi/playurl?' + urllib.parse.urlencode(p)
wbi = json.loads(urllib.request.urlopen(wbi_url).read())
print('WBI playurl code:', wbi.get('code'), 'formats:', len(wbi.get('data',{}).get('support_formats') or []))

finally:
    if os.path.exists(tmp):
        os.unlink(tmp)

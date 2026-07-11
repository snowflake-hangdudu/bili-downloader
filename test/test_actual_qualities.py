"""检查该视频实际有哪些清晰度可下载"""
import urllib.request, json

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
REF = 'https://www.bilibili.com/'

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': REF})
    return json.loads(urllib.request.urlopen(req, timeout=15).read())

aid, cid = 116847202537805, 39574962346
d = get(f'https://api.bilibili.com/x/player/playurl?avid={aid}&cid={cid}&qn=80&fnval=16&fourk=1&platform=pc')['data']

print('support_formats:')
for f in d.get('support_formats') or []:
    print(f"  qn={f['quality']} {f.get('new_description')}")

print('\ndash.video ids:')
for v in (d.get('dash') or {}).get('video') or []:
    u = v.get('baseUrl') or v.get('base_url','')
    print(f"  id={v['id']} codec={v.get('codecs')} host={u.split('/')[2] if u else '?'}")

print('\ndash.audio:')
for a in (d.get('dash') or {}).get('audio') or []:
    u = a.get('baseUrl') or a.get('base_url','')
    print(f"  id={a['id']} host={u.split('/')[2] if u else '?'} mcdn={':8082' in u}")

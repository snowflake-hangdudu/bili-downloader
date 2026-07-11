import urllib.request, re, json

url = 'https://www.bilibili.com/video/BV1GJ411x7h7'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'})
html = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', errors='ignore')

print('HTML length:', len(html))
for name in ['__INITIAL_STATE__', '__NEXT_DATA__', '__playinfo__', 'videoData', 'pinia']:
    print(f'{name}:', name in html)

scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.S)
print('script count:', len(scripts))
for i, s in enumerate(scripts):
    if any(k in s for k in ['aid', 'bvid', 'videoData', 'INITIAL', 'playurl', 'cid']):
        print(f'--- script {i} len={len(s)} ---')
        print(s[:800])

# og tags
for m in re.finditer(r'<meta\s+[^>]+>', html):
    tag = m.group()
    if 'og:' in tag or 'video' in tag.lower():
        print('meta:', tag[:150])

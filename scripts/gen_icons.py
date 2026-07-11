"""从源图生成扩展图标（工具栏小尺寸优先裁切放大）"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'icons')
SOURCE = os.path.join(ROOT, 'assets', 'icon-source.png')

# 工具栏主要用 16 / 32，尽量铺满画布
SIZES = {
    'icon128.png': 1.0,
    'icon48.png': 1.0,
    'icon32.png': 1.0,
    'icon16.png': 1.0,
}


def crop_to_content(img, margin_ratio=0.04):
    alpha = img.split()[3]
    bbox = alpha.getbbox()
    if not bbox:
        return img
    w, h = img.size
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    m = int(max(bw, bh) * margin_ratio)
    x0 = max(0, x0 - m)
    y0 = max(0, y0 - m)
    x1 = min(w, x1 + m)
    y1 = min(h, y1 + m)
    cropped = img.crop((x0, y0, x1, y1))
    side = max(cropped.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    ox = (side - cropped.width) // 2
    oy = (side - cropped.height) // 2
    canvas.paste(cropped, (ox, oy), cropped)
    return canvas


def make_icon(src, size):
    inner = size
    resized = src.resize((inner, inner), Image.Resampling.LANCZOS)
    if size <= 32:
        # 小尺寸锐化：先放大再缩回，边缘更清晰
        big = src.resize((size * 4, size * 4), Image.Resampling.LANCZOS)
        resized = big.resize((size, size), Image.Resampling.LANCZOS)
    return resized


def main():
    if not os.path.isfile(SOURCE):
        raise SystemExit('缺少源图: ' + SOURCE)

    raw = Image.open(SOURCE).convert('RGBA')
    src = crop_to_content(raw, margin_ratio=0.02)
    os.makedirs(OUT_DIR, exist_ok=True)

    for name, _ratio in SIZES.items():
        size = int(name.replace('icon', '').replace('.png', ''))
        out = os.path.join(OUT_DIR, name)
        make_icon(src, size).save(out, 'PNG', optimize=True)
        print('OK', out, size)


if __name__ == '__main__':
    main()

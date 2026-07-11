"""生成 Edge 商店素材：logo 300x300、推广图 440x280"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, 'store')
SOURCE = os.path.join(ROOT, 'assets', 'icon-source.png')

BG = (15, 23, 42)
ACCENT = (37, 99, 235)


def load_icon(size):
    src = Image.open(SOURCE).convert('RGBA')
    alpha = src.split()[3]
    bbox = alpha.getbbox()
    if bbox:
        src = src.crop(bbox)
    side = max(src.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(src, ((side - src.width) // 2, (side - src.height) // 2), src)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def make_logo():
    out = os.path.join(STORE, 'logo-300.png')
    load_icon(300).save(out, 'PNG')
    print('OK', out)


def make_tile():
    w, h = 440, 280
    img = Image.new('RGB', (w, h), BG)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        r = int(BG[0] + (ACCENT[0] - BG[0]) * t * 0.35)
        g = int(BG[1] + (ACCENT[1] - BG[1]) * t * 0.35)
        b = int(BG[2] + (ACCENT[2] - BG[2]) * t * 0.35)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    icon = load_icon(140)
    img.paste(icon, (36, (h - 140) // 2), icon)

    # 简单文字区域（无中文字体时用英文，商店页以表单中文为准）
    draw.rounded_rectangle([210, 88, 410, 192], radius=16, fill=(30, 41, 59))
    draw.text((228, 108), 'Bili Video', fill=(255, 255, 255))
    draw.text((228, 132), 'Download MP4', fill=(148, 163, 184))
    draw.text((228, 158), 'v1.0.0', fill=(96, 165, 250))

    out = os.path.join(STORE, 'tile-440x280.png')
    img.save(out, 'PNG')
    print('OK', out)


def main():
    os.makedirs(STORE, exist_ok=True)
    if not os.path.isfile(SOURCE):
        raise SystemExit('缺少 assets/icon-source.png')
    make_logo()
    make_tile()


if __name__ == '__main__':
    main()

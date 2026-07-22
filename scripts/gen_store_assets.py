"""商店素材：粉底图标 + 深色推广条"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, 'store')
SOURCE = os.path.join(ROOT, 'assets', 'icon-source.png')

BG = (15, 23, 42)
PINK = (251, 114, 153)


def load_icon(size):
    src = Image.open(SOURCE).convert('RGBA')
    return src.resize((size, size), Image.Resampling.LANCZOS)


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
        r = int(BG[0] + (PINK[0] - BG[0]) * t * 0.35)
        g = int(BG[1] + (PINK[1] - BG[1]) * t * 0.2)
        b = int(BG[2] + (PINK[2] - BG[2]) * t * 0.25)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    icon = load_icon(140)
    img.paste(icon, (36, (h - 140) // 2), icon)
    draw.rounded_rectangle([210, 88, 410, 192], radius=18, fill=(30, 41, 59))
    draw.text((228, 108), 'Bili Downloader', fill=(255, 255, 255))
    draw.text((228, 132), 'Video · MP4 · Free', fill=(148, 163, 184))
    draw.rounded_rectangle([228, 158, 300, 178], radius=8, fill=PINK)
    draw.text((238, 160), 'v1.0.0', fill=(255, 255, 255))
    out = os.path.join(STORE, 'tile-440x280.png')
    img.save(out, 'PNG')
    print('OK', out)


def main():
    os.makedirs(STORE, exist_ok=True)
    make_logo()
    make_tile()


if __name__ == '__main__':
    main()

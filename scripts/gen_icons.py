"""生成各尺寸；16px 粉底白符极简。"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'icons')
SOURCE = os.path.join(ROOT, 'assets', 'icon-source.png')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_icon_source import render_icon  # noqa: E402

SIZES = (16, 32, 48, 128)
PINK = (251, 114, 153)
PINK_DEEP = (232, 90, 133)
WHITE = (255, 255, 255, 255)


def rounded_mask(size, ratio=0.22):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=max(1, int(size * ratio)), fill=255
    )
    return m


def make_simple_16():
    size = 64
    img = Image.new('RGBA', (size, size), (*PINK, 255))
    d = ImageDraw.Draw(img)
    img.putalpha(rounded_mask(size, 0.22))
    # 天线
    d.ellipse([18, 2, 28, 12], fill=WHITE)
    d.ellipse([36, 2, 46, 12], fill=WHITE)
    d.rectangle([21, 10, 25, 18], fill=WHITE)
    d.rectangle([39, 10, 43, 18], fill=WHITE)
    # TV 框
    d.rounded_rectangle([10, 14, 54, 38], radius=6, fill=WHITE)
    d.rounded_rectangle([15, 18, 49, 34], radius=4, fill=(*PINK_DEEP, 255))
    d.polygon([(24, 20), (24, 32), (42, 26)], fill=WHITE)
    # 下载
    cx = 32
    d.polygon([(cx, 54), (cx - 12, 40), (cx + 12, 40)], fill=WHITE)
    d.rounded_rectangle([cx - 5, 34, cx + 5, 42], radius=4, fill=WHITE)
    d.rounded_rectangle([cx - 14, 54, cx + 14, 58], radius=2, fill=WHITE)
    return img.resize((16, 16), Image.Resampling.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    src = render_icon(1024)
    src.save(SOURCE, 'PNG', optimize=True)
    print('OK', SOURCE)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f'icon{size}.png')
        if size == 16:
            img = make_simple_16()
        elif size <= 32:
            big = render_icon(size * 4, radius_ratio=0.2)
            big = big.filter(ImageFilter.UnsharpMask(radius=1.1, percent=140, threshold=2))
            img = big.resize((size, size), Image.Resampling.LANCZOS)
        else:
            img = render_icon(size)
        img.save(path, 'PNG', optimize=True)
        print('OK', path, size)


if __name__ == '__main__':
    main()

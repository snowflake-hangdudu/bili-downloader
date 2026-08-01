"""从 YouTube 源图模板生成 B 站主题色版图标

映射：红色(#7a222e系) → B站蓝(#00A1D6)，白色保持，
其余(黑/透明背景) → 透明。形状与 YouTube 图标完全一致。
"""
import os
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'icons')
OUT_SRC = os.path.join(ROOT, 'assets', 'icon-source.png')

YT_SOURCE = os.path.join(ROOT, '..', 'youtube-downloader', 'assets', 'icon-source.png')

SIZES = (16, 32, 48, 128)
BLUE = (0, 161, 214)      # B站蓝 #00A1D6


def is_redish(r, g, b):
    return r > 60 and g < 75 and b < 75 and r > g + 20


def convert(src_path):
    img = Image.open(src_path).convert('RGBA')
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                continue  # 保持透明
            if is_redish(r, g, b):
                px[x, y] = (*BLUE, 255)
            elif r > 190 and g > 190 and b > 190:
                px[x, y] = (255, 255, 255, 255)  # 白色保持
            else:
                px[x, y] = (0, 0, 0, 0)  # 其他（黑背景）→ 透明
    return img


def rounded_mask(size, radius):
    from PIL import ImageDraw
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def crop_to_content(img, margin=0.01):
    alpha = img.split()[3]
    bbox = alpha.getbbox()
    if not bbox:
        return img
    w, h = img.size
    x0, y0, x1, y1 = bbox
    m = int(max(x1 - x0, y1 - y0) * margin)
    x0 = max(0, x0 - m); y0 = max(0, y0 - m)
    x1 = min(w, x1 + m); y1 = min(h, y1 + m)
    img = img.crop((x0, y0, x1, y1))
    side = max(img.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    ox = (side - img.width) // 2
    oy = (side - img.height) // 2
    canvas.paste(img, (ox, oy), img)
    return canvas


def main():
    if not os.path.isfile(YT_SOURCE):
        raise SystemExit('缺少 YouTube 源图: ' + YT_SOURCE)
    os.makedirs(OUT_DIR, exist_ok=True)
    src = convert(YT_SOURCE)
    src = crop_to_content(src)
    src.save(OUT_SRC, 'PNG', optimize=True)
    print('OK', OUT_SRC)
    for size in SIZES:
        if size <= 32:
            big = src.resize((size * 4, size * 4), Image.Resampling.LANCZOS)
            big = big.filter(ImageFilter.UnsharpMask(radius=1.1, percent=140, threshold=2))
            img = big.resize((size, size), Image.Resampling.LANCZOS)
        else:
            img = src.resize((size, size), Image.Resampling.LANCZOS)
        img.save(os.path.join(OUT_DIR, f'icon{size}.png'), 'PNG', optimize=True)
        print('OK', os.path.join(OUT_DIR, f'icon{size}.png'), size)


if __name__ == '__main__':
    main()

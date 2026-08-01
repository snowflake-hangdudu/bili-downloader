"""黑白极简播放键图标（自绘，仿 YouTube 播放键结构）

深色圆角方形 + 白色播放三角：播放三角按经典比例绘制
（尖端偏左、右侧竖直边、光学居中），三个角圆角处理。
符合扩展黑白云极简主题。
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'icon-source.png')

SIZE = 1024
BG = (17, 17, 17)               # #111 近黑底
WHITE = (255, 255, 255, 255)


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def rounded_polygon(draw, pts, radius, fill):
    """多边形 + 顶点同色圆盘 → 圆角多边形"""
    draw.polygon(pts, fill=fill)
    for (x, y) in pts:
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=fill)


def draw_mark(draw, size):
    s = float(size)
    # 经典播放三角：尖端偏左，右侧竖直边，光学重心居中
    x1 = s * 0.36          # 尖端
    x2 = s * 0.62          # 竖直边
    y1 = s * 0.30          # 上角
    y2 = s * 0.70          # 下角
    cy = s * 0.50
    pts = [(x1, cy), (x2, y1), (x2, y2)]
    r = s * 0.030
    rounded_polygon(draw, pts, r, WHITE)


def render_icon(size, radius_ratio=0.20):
    base = Image.new('RGBA', (size, size), (*BG, 255))
    mark = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw_mark(ImageDraw.Draw(mark), size)
    composed = Image.alpha_composite(base, mark)
    composed.putalpha(rounded_mask(size, radius=max(2, int(size * radius_ratio))))
    return composed


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    render_icon(SIZE).save(OUT, 'PNG', optimize=True)
    print('OK', OUT)


if __name__ == '__main__':
    main()

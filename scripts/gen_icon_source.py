"""市场启发版（自绘，非抄袭）

评估同类扩展常见做法：
1. 粉红实心底（#FB7299）— 小尺寸一眼联想到 B 站
2. 白色粗符号 — 对比强，16px 可读
3. TV 头轮廓 + 下载语义 — 功能清晰
4. 避免蓝环+粉三角+粉箭叠太多细节（深色底在视频页易糊）

本版：粉圆角底 + 白 TV 窗（天线）+ 窗内播放 + 窗下下载箭/托
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'icon-source.png')

SIZE = 1024
PINK = (251, 114, 153)       # #FB7299
PINK_DEEP = (232, 90, 133)
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def gradient_bg(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (0.3 * x + 0.7 * y) / size
            c = lerp(PINK, PINK_DEEP, 0.15 + t * 0.7)
            dist = math.hypot(x - size * 0.35, y - size * 0.3) / size
            c = lerp(c, (255, 180, 200), max(0.0, 1.0 - dist * 2.4) * 0.22)
            px[x, y] = c
    return img


def draw_mark(draw, size):
    s = float(size)
    cx = s * 0.5

    # —— 白 TV 窗（横屏圆角）——
    frame = [s * 0.18, s * 0.20, s * 0.82, s * 0.58]
    fr = s * 0.09
    stroke = max(8, int(s * 0.07))

    # 天线
    ant_w = s * 0.055
    ant_h = s * 0.10
    for ax in (s * 0.36, s * 0.64):
        y1 = frame[1] + stroke * 0.3
        y0 = y1 - ant_h
        draw.rounded_rectangle(
            [ax - ant_w / 2, y0, ax + ant_w / 2, y1],
            radius=ant_w / 2,
            fill=WHITE,
        )
        br = ant_w * 0.95
        draw.ellipse([ax - br, y0 - br, ax + br, y0 + br], fill=WHITE)

    # 外框实心白 → 挖空粉底（描边）
    draw.rounded_rectangle(frame, radius=fr, fill=WHITE)
    inner = [
        frame[0] + stroke,
        frame[1] + stroke,
        frame[2] - stroke,
        frame[3] - stroke,
    ]
    # 窗内填粉（与底同系），播放三角用白
    draw.rounded_rectangle(inner, radius=max(2, fr - stroke), fill=(*PINK_DEEP, 255))

    # 窗内白播放
    cy = (frame[1] + frame[3]) / 2
    pw, ph = s * 0.14, s * 0.16
    ox = s * 0.015
    draw.polygon(
        [
            (cx - pw * 0.45 + ox, cy - ph / 2),
            (cx - pw * 0.45 + ox, cy + ph / 2),
            (cx + pw * 0.7 + ox, cy),
        ],
        fill=WHITE,
    )

    # —— 窗下白下载箭 + 托 ——
    sw = s * 0.11
    y0 = frame[3] - stroke * 0.2
    y1 = s * 0.70
    tip = s * 0.82
    hw = s * 0.28
    draw.polygon(
        [
            (cx - sw / 2, y0),
            (cx + sw / 2, y0),
            (cx + sw / 2, y1),
            (cx + hw / 2, y1),
            (cx, tip),
            (cx - hw / 2, y1),
            (cx - sw / 2, y1),
        ],
        fill=WHITE,
    )
    draw.ellipse([cx - sw / 2, y0 - sw / 2, cx + sw / 2, y0 + sw / 2], fill=WHITE)

    tw, tt = s * 0.36, s * 0.07
    ty = tip + s * 0.02
    draw.rounded_rectangle([cx - tw / 2, ty, cx + tw / 2, ty + tt], radius=tt / 2, fill=WHITE)
    # 托两侧短臂
    ta = s * 0.08
    draw.rounded_rectangle([cx - tw / 2, ty - ta + tt, cx - tw / 2 + tt, ty + tt], radius=tt / 2, fill=WHITE)
    draw.rounded_rectangle([cx + tw / 2 - tt, ty - ta + tt, cx + tw / 2, ty + tt], radius=tt / 2, fill=WHITE)


def render_icon(size, radius_ratio=0.22):
    base = gradient_bg(size).convert('RGBA')
    mark = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw_mark(ImageDraw.Draw(mark), size)

    if size >= 64:
        a = mark.split()[3]
        sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        sh.putalpha(a.point(lambda v: int(v * 0.22)))
        sh = sh.filter(ImageFilter.GaussianBlur(max(2, size // 70)))
        layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        layer.paste(sh, (0, max(1, size // 90)), sh)
        composed = Image.alpha_composite(base, layer)
        composed = Image.alpha_composite(composed, mark)
    else:
        composed = Image.alpha_composite(base, mark)

    composed.putalpha(rounded_mask(size, radius=max(2, int(size * radius_ratio))))
    return composed


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    render_icon(SIZE).save(OUT, 'PNG', optimize=True)
    print('OK', OUT)


if __name__ == '__main__':
    main()

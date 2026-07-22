"""Generate 12 aesthetic icon iterations (dark + cyan ring + pink play/download)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "icon-iters"
OUT.mkdir(parents=True, exist_ok=True)

BLUE = (0, 161, 214, 255)
PINK = (251, 114, 153, 255)
BG = (15, 23, 42, 255)
BG2 = (10, 16, 28, 255)


def rounded_bg(size: int, bg: tuple, radius_ratio: float = 0.22) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=bg)
    return img


def apply_squircle_mask(img: Image.Image, ratio: float = 0.22) -> Image.Image:
    size = img.size[0]
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * ratio), fill=255)
    out = img.copy()
    out.putalpha(m)
    return out


def thick_line(draw, p0, p1, width, color):
    """Rounded-cap thick line via capsule geometry."""
    x0, y0 = p0
    x1, y1 = p1
    draw.line([p0, p1], fill=color, width=width)
    r = width / 2
    draw.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=color)
    draw.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=color)


def draw_arc_ring(draw, cx, cy, r, stroke, color, gap_deg=52):
    half = gap_deg / 2.0
    start = 90 + half
    end = 90 - half + 360
    bbox = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(bbox, start=start, end=end, fill=color, width=stroke)
    # round the gap ends
    for ang in (start, end):
        rad = math.radians(ang)
        # PIL angles: 0=east, CCW
        x = cx + r * math.cos(rad)
        y = cy + r * math.sin(rad)
        rr = stroke / 2
        draw.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color)


def draw_antennas(draw, cx, cy, r, stroke, color, style="ball"):
    """TV antennas sitting on the ring crown."""
    spread = r * 0.26
    stem = r * (0.18 if style == "short" else 0.22)
    y_base = cy - r + stroke * 0.35
    stem_w = max(int(stroke * 0.50), 16)
    ball = max(int(stroke * 0.38), 12)

    for sign in (-1, 1):
        x0 = cx + sign * spread
        if style == "tilt":
            x1 = x0 + sign * stem * 0.28
        else:
            x1 = x0
        y1 = y_base - stem
        thick_line(draw, (x0, y_base), (x1, y1), stem_w, color)
        draw.ellipse([x1 - ball, y1 - ball, x1 + ball, y1 + ball], fill=color)


def draw_play(draw, cx, cy, size, color):
    """Solid play triangle — optically shifted left for balance."""
    s = size
    ox = -s * 0.05
    pts = [
        (cx - s * 0.36 + ox, cy - s * 0.40),
        (cx - s * 0.36 + ox, cy + s * 0.40),
        (cx + s * 0.50 + ox, cy),
    ]
    draw.polygon(pts, fill=color)


def draw_download(draw, cx, cy, scale, stroke, color, with_tray=True):
    """Clean download: rounded shaft + solid chevron + U tray.
    `scale` ≈ half-height of the whole mark; cy is visual center.
    """
    # shaft from upper third to mid
    top = cy - scale * 0.72
    mid = cy + scale * 0.08
    thick_line(draw, (cx, top), (cx, mid), stroke, color)

    # solid arrow head
    aw = scale * 0.62
    tip_y = mid + scale * 0.58
    head = [
        (cx - aw, mid - scale * 0.02),
        (cx + aw, mid - scale * 0.02),
        (cx, tip_y),
    ]
    draw.polygon(head, fill=color)

    if with_tray:
        ty = tip_y + scale * 0.18
        tw = scale * 0.78
        th = scale * 0.32
        thick_line(draw, (cx - tw, ty), (cx - tw, ty + th), stroke, color)
        thick_line(draw, (cx + tw, ty), (cx + tw, ty + th), stroke, color)
        thick_line(draw, (cx - tw, ty + th), (cx + tw, ty + th), stroke, color)


def soft_glow(base: Image.Image, color, blur=20, alpha=70) -> Image.Image:
    mask = base.split()[-1]
    tint = Image.new("RGBA", base.size, (*color[:3], alpha))
    tint.putalpha(mask.point(lambda a: min(255, int(a * 0.85))))
    tint = tint.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(tint, base)


def tight_fill(img: Image.Image, bg: tuple, fill_ratio: float = 0.90, radius_ratio: float = 0.22) -> Image.Image:
    """Scale graphic so it fills most of the squircle, trimming empty margin."""
    size = img.size[0]
    # detect content vs solid bg (ignore near-bg pixels)
    br, bg_, bb = bg[:3]
    px = img.load()
    minx, miny, maxx, maxy = size, size, 0, 0
    found = False
    for y in range(size):
        for x in range(size):
            r, g, b, a = px[x, y]
            if a < 20:
                continue
            if abs(r - br) + abs(g - bg_) + abs(b - bb) < 28:
                continue
            found = True
            if x < minx:
                minx = x
            if y < miny:
                miny = y
            if x > maxx:
                maxx = x
            if y > maxy:
                maxy = y
    if not found:
        return img

    pad = 8
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(size - 1, maxx + pad)
    maxy = min(size - 1, maxy + pad)
    crop = img.crop((minx, miny, maxx + 1, maxy + 1))
    cw, ch = crop.size
    target = int(size * fill_ratio)
    scale = min(target / cw, target / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)

    out = rounded_bg(size, bg, radius_ratio)
    ox = (size - nw) // 2
    oy = (size - nh) // 2
    out.paste(crop, (ox, oy), crop)
    return apply_squircle_mask(out, radius_ratio)


def compose(v: dict) -> Image.Image:
    size = 1024
    bg = v.get("bg", BG)
    img = rounded_bg(size, bg)
    d = ImageDraw.Draw(img)

    cx = size // 2
    cy = size // 2 + v.get("cy_shift", 18)
    r = v.get("r", 300)
    stroke = v.get("stroke", 54)
    gap = v.get("gap", 54)
    blue = v.get("blue", BLUE)
    pink = v.get("pink", PINK)

    if v.get("outer_ring"):
        d.ellipse(
            [cx - r - 36, cy - r - 36, cx + r + 36, cy + r + 36],
            outline=(*blue[:3], 55),
            width=5,
        )

    # antennas first so ring overlaps bases cleanly
    if v.get("antennas", True):
        draw_antennas(d, cx, cy, r, stroke, blue, style=v.get("ant_style", "ball"))

    draw_arc_ring(d, cx, cy, r, stroke, blue, gap_deg=gap)

    if v.get("play_on", True):
        play_s = v.get("play", 210)
        draw_play(d, cx, cy - v.get("play_up", 18), play_s, pink)

    if v.get("download", True):
        # Center download in ring when no play; otherwise sit in bottom gap
        if v.get("play_on", True):
            dl_cy = cy + r - v.get("dl_inset", 8)
        else:
            dl_cy = cy + v.get("dl_cy_shift", 28)
        draw_download(
            d,
            cx,
            dl_cy,
            v.get("dl_scale", 100),
            v.get("dl_stroke", 34),
            pink,
            with_tray=v.get("tray", True),
        )

    if v.get("glow"):
        img = soft_glow(img, blue, blur=24, alpha=50)
        img = soft_glow(img, pink, blur=14, alpha=35)

    if v.get("tight_fill"):
        img = tight_fill(img, bg, fill_ratio=v.get("fill_ratio", 0.90))
    else:
        img = apply_squircle_mask(img, 0.22)
    if v.get("contrast"):
        a = img.split()[-1]
        rgb = ImageEnhance.Contrast(img.convert("RGB")).enhance(v["contrast"])
        img = rgb.convert("RGBA")
        img.putalpha(a)
    if v.get("color"):
        a = img.split()[-1]
        rgb = ImageEnhance.Color(img.convert("RGB")).enhance(v["color"])
        img = rgb.convert("RGBA")
        img.putalpha(a)
    return img


VARIANTS = [
    dict(name="01", ant_style="ball", tray=True, gap=52, stroke=52, r=298, play=200, notes="基准：球头天线+断环"),
    dict(name="02", ant_style="ball", tray=True, gap=58, stroke=60, r=292, play=208, dl_stroke=38, notes="加粗，16px 可读"),
    dict(name="03", ant_style="short", tray=True, gap=54, stroke=50, r=304, play=188, play_up=12, notes="短天线+更多留白"),
    dict(name="04", ant_style="tilt", tray=True, gap=52, stroke=52, r=298, play=200, notes="微倾天线 TV 感"),
    dict(name="05", antennas=False, tray=True, gap=48, stroke=54, r=308, play=218, notes="无天线极简"),
    dict(name="06", ant_style="ball", tray=True, gap=70, stroke=52, r=296, play=192, dl_scale=112, dl_stroke=36, cy_shift=8, notes="宽断口突出下载"),
    dict(name="07", ant_style="ball", tray=True, gap=54, stroke=52, r=298, play=200, glow=True, notes="微霓虹光晕"),
    dict(name="08", ant_style="ball", tray=True, gap=52, stroke=54, r=300, play=206, bg=BG2, contrast=1.1, color=1.05, notes="更深底+饱和"),
    dict(name="09", ant_style="short", tray=False, gap=46, stroke=52, r=300, play=212, dl_scale=108, notes="无托盘更轻"),
    dict(name="10", ant_style="ball", tray=True, gap=54, stroke=50, r=288, play=196, outer_ring=True, notes="外圈层次"),
    dict(name="11", ant_style="ball", tray=True, gap=56, stroke=56, r=294, play=204, play_up=16, dl_scale=102, dl_stroke=36, bg=BG2, contrast=1.06, notes="候选：重量均衡"),
    dict(
        name="12",
        ant_style="ball",
        tray=True,
        gap=58,
        stroke=56,
        r=292,
        play=212,
        play_up=20,
        dl_scale=104,
        dl_stroke=36,
        dl_inset=4,
        bg=BG2,
        contrast=1.07,
        color=1.04,
        notes="旧定稿：含粉播放三角",
    ),
    # 13 — no play, big download, fill canvas
    dict(
        name="13",
        play_on=False,
        ant_style="short",
        tray=True,
        gap=88,
        stroke=70,
        r=420,
        cy_shift=48,
        dl_scale=310,
        dl_stroke=70,
        dl_cy_shift=20,
        tight_fill=True,
        fill_ratio=0.94,
        bg=BG2,
        contrast=1.06,
        color=1.04,
        notes="★定稿：去三角、放大下载、收紧留白",
    ),
]


def export_sizes(final: Image.Image) -> None:
    for size in (16, 32, 48, 128):
        if size <= 32:
            big = final.resize((size * 4, size * 4), Image.Resampling.LANCZOS)
            big = big.filter(ImageFilter.UnsharpMask(radius=1.15, percent=150, threshold=2))
            out = big.resize((size, size), Image.Resampling.LANCZOS)
        else:
            out = final.resize((size, size), Image.Resampling.LANCZOS)
        out.save(ROOT / "icons" / f"icon{size}.png", "PNG", optimize=True)

    final.resize((300, 300), Image.Resampling.LANCZOS).save(ROOT / "store" / "logo-300.png", "PNG")

    w, h = 440, 280
    tile = Image.new("RGB", (w, h), (10, 16, 28))
    td = ImageDraw.Draw(tile)
    for y in range(h):
        t = y / h
        td.line(
            [(0, y), (w, y)],
            fill=(int(10 + 16 * t), int(16 + 20 * (1 - t)), int(28 + 34 * (1 - t))),
        )
    ic = final.resize((152, 152), Image.Resampling.LANCZOS)
    tile.paste(ic, (30, (h - 152) // 2), ic)
    td.rounded_rectangle([208, 84, 414, 196], radius=16, fill=(26, 35, 50))
    td.rectangle([226, 116, 358, 126], fill=(255, 255, 255))
    td.rectangle([226, 138, 318, 146], fill=(148, 163, 184))
    td.rounded_rectangle([226, 158, 266, 178], radius=6, fill=(0, 161, 214))
    td.rounded_rectangle([274, 158, 314, 178], radius=6, fill=(251, 114, 153))
    tile.save(ROOT / "store" / "tile-440x280.png", "PNG")


def main() -> None:
    lines = [
        "图标迭代说明（审美评审）",
        "",
        "基准：深色底 + 蓝断环 + 粉播放 + 粉下载（第二参考图）",
        "",
        "| 代 | 文件 | 评审 |",
        "|----|------|------|",
    ]
    for v in VARIANTS:
        im = compose(v)
        path = OUT / f"icon-iter-{v['name']}.png"
        im.save(path, "PNG", optimize=True)
        mark = "★定稿：" if v["name"] == "13" else ""
        lines.append(f"| {v['name']} | `icon-iter-{v['name']}.png` | {mark}{v['notes']} |")
        print(v["name"], v["notes"])

    final = compose(VARIANTS[-1])
    final.save(OUT / "icon-iter-13-final.png", "PNG", optimize=True)
    final.save(ROOT / "assets" / "icon-source.png", "PNG", optimize=True)
    export_sizes(final)

    lines += [
        "",
        "定稿：`assets/icon-source.png` / `icons/icon*.png`",
        "重生：`python scripts/gen_icon_iters.py`",
    ]
    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("DONE", len(VARIANTS), "iters")


if __name__ == "__main__":
    main()

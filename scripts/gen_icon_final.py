"""Final extension icon — Chrome/Edge store aesthetic.

Guidelines applied (developer.chrome.com/docs/webstore/images):
- Artwork ~75–80% of canvas (≈96/128), not edge-to-edge
- Circular mark diameter ~80–85% max; leave breathing room
- 2–3 colors, flat, front-facing, no baked store chrome
- Strong silhouette that still reads at 16px
- Subtle outer glow so dark icons work on dark toolbars
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
ITERS = OUT / "icon-iters"
ITERS.mkdir(parents=True, exist_ok=True)

BLUE = (0, 161, 214, 255)
PINK = (251, 114, 153, 255)
BG = (15, 23, 42, 255)  # matches panel --bdl-bg
SIZE = 1024


def rounded_bg(size: int, bg: tuple, ratio: float = 0.22) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * ratio), fill=bg
    )
    return img


def squircle_mask(img: Image.Image, ratio: float = 0.22) -> Image.Image:
    s = img.size[0]
    m = Image.new("L", (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * ratio), fill=255)
    out = img.copy()
    out.putalpha(m)
    return out


def thick_line(draw, p0, p1, width, color):
    draw.line([p0, p1], fill=color, width=width)
    r = width / 2
    for x, y in (p0, p1):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def soft_glow(base: Image.Image, color, blur=18, alpha=55) -> Image.Image:
    """Subtle halo for dark-toolbar readability (Chrome store tip)."""
    mask = base.split()[-1]
    tint = Image.new("RGBA", base.size, (*color[:3], alpha))
    tint.putalpha(mask.point(lambda a: min(255, int(a * 0.7))))
    tint = tint.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(tint, base)


def compose() -> Image.Image:
    img = rounded_bg(SIZE, BG)
    d = ImageDraw.Draw(img)

    # Moderate / airy — closer to popular extension icons (more padding than
    # the previous full-bleed). Content ≈ 68% of canvas.
    cx = SIZE / 2
    cy = SIZE / 2 + 10
    r = 348          # diameter ≈ 68%
    stroke = 46      # refined line weight
    gap = 52

    # Antennas — short, vertical, ball tips
    spread = r * 0.27
    stem = r * 0.17
    stem_w = max(int(stroke * 0.55), 18)
    ball = max(int(stroke * 0.40), 12)
    y_base = cy - r + stroke * 0.30
    for sign in (-1, 1):
        x = cx + sign * spread
        y1 = y_base - stem
        thick_line(d, (x, y_base), (x, y1), stem_w, BLUE)
        d.ellipse([x - ball, y1 - ball, x + ball, y1 + ball], fill=BLUE)

    half = gap / 2
    start, end = 90 + half, 90 - half + 360
    d.arc([cx - r, cy - r, cx + r, cy + r], start=start, end=end, fill=BLUE, width=stroke)
    for ang in (start, end):
        rad = math.radians(ang)
        x = cx + r * math.cos(rad)
        y = cy + r * math.sin(rad)
        rr = stroke / 2
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=BLUE)

    # Download — balanced inside ring (~42% of inner diameter)
    inner = 2 * (r - stroke / 2)
    scale = inner * 0.42
    sw = scale * 0.26
    aw = scale * 0.55
    dl_cy = cy + 6
    top = dl_cy - scale * 0.52
    neck = dl_cy + scale * 0.02
    tip = dl_cy + scale * 0.46

    arrow = [
        (cx - sw / 2, top),
        (cx + sw / 2, top),
        (cx + sw / 2, neck),
        (cx + aw, neck),
        (cx, tip),
        (cx - aw, neck),
        (cx - sw / 2, neck),
    ]
    d.polygon(arrow, fill=PINK)
    d.ellipse([cx - sw / 2, top - sw / 2, cx + sw / 2, top + sw / 2], fill=PINK)

    tray_w = max(int(stroke * 0.95), 32)
    ty = tip + scale * 0.14
    tw = scale * 0.60
    th = scale * 0.24
    thick_line(d, (cx - tw, ty), (cx - tw, ty + th), tray_w, PINK)
    thick_line(d, (cx + tw, ty), (cx + tw, ty + th), tray_w, PINK)
    thick_line(d, (cx - tw, ty + th), (cx + tw, ty + th), tray_w, PINK)

    # Very light glow only — avoid “neon blob” look
    img = soft_glow(img, BLUE, blur=12, alpha=28)

    img = squircle_mask(img)
    a = img.split()[-1]
    rgb = ImageEnhance.Contrast(img.convert("RGB")).enhance(1.03)
    img = rgb.convert("RGBA")
    img.putalpha(a)
    return img


def export(img: Image.Image) -> None:
    img.save(OUT / "icon-source.png", "PNG", optimize=True)
    img.save(ITERS / "icon-iter-14-moderate.png", "PNG", optimize=True)

    for size in (16, 32, 48, 128):
        if size <= 32:
            # Slightly simplify weight at tiny sizes via unsharp after supersample
            big = img.resize((size * 4, size * 4), Image.Resampling.LANCZOS)
            big = big.filter(ImageFilter.UnsharpMask(radius=1.0, percent=130, threshold=2))
            out = big.resize((size, size), Image.Resampling.LANCZOS)
        else:
            out = img.resize((size, size), Image.Resampling.LANCZOS)
        out.save(ROOT / "icons" / f"icon{size}.png", "PNG", optimize=True)

    img.resize((300, 300), Image.Resampling.LANCZOS).save(ROOT / "store" / "logo-300.png", "PNG")

    w, h = 440, 280
    tile = Image.new("RGB", (w, h), (15, 23, 42))
    td = ImageDraw.Draw(tile)
    for y in range(h):
        t = y / h
        td.line(
            [(0, y), (w, y)],
            fill=(int(15 + 12 * t), int(23 + 14 * (1 - t)), int(42 + 20 * (1 - t))),
        )
    ic = img.resize((132, 132), Image.Resampling.LANCZOS)
    tile.paste(ic, (40, (h - 132) // 2), ic)
    td.rounded_rectangle([200, 88, 400, 192], radius=14, fill=(26, 35, 50))
    td.rectangle([218, 118, 340, 128], fill=(255, 255, 255))
    td.rectangle([218, 140, 300, 148], fill=(148, 163, 184))
    td.rounded_rectangle([218, 160, 256, 178], radius=5, fill=(0, 161, 214))
    td.rounded_rectangle([264, 160, 302, 178], radius=5, fill=(251, 114, 153))
    tile.save(ROOT / "store" / "tile-440x280.png", "PNG")


def main() -> None:
    img = compose()
    export(img)
    # quick fill report
    px = img.load()
    br, bg, bb = BG[:3]
    minx = miny = SIZE
    maxx = maxy = 0
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = px[x, y]
            if a < 20:
                continue
            if abs(r - br) + abs(g - bg) + abs(b - bb) < 30:
                continue
            minx = min(minx, x)
            miny = min(miny, y)
            maxx = max(maxx, x)
            maxy = max(maxy, y)
    span = maxx - minx
    print(f"OK moderate icon — content width {span}/{SIZE} = {100*span/SIZE:.1f}%")


if __name__ == "__main__":
    main()

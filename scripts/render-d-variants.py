#!/usr/bin/env python3
"""Compare D parameter variations for small-size legibility."""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path("/Users/njx/openclaw_data/openclaw_workbench/.brand-candidates")
OUT.mkdir(parents=True, exist_ok=True)

BRAND_TEAL = (15, 118, 110)
BRAND_DEEP = (13, 92, 86)
WHITE = (255, 255, 255)


def gradient_bg(size):
    img = Image.new("RGB", (size, size), BRAND_TEAL)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(BRAND_TEAL[0] + (BRAND_DEEP[0] - BRAND_TEAL[0]) * t)
        g = int(BRAND_TEAL[1] + (BRAND_DEEP[1] - BRAND_TEAL[1]) * t)
        b = int(BRAND_TEAL[2] + (BRAND_DEEP[2] - BRAND_TEAL[2]) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    return img


def claw(size, n_claws, claw_thick_ratio, claw_w_ratio, cap_thick_ratio=None):
    img = gradient_bg(size).convert("RGBA")
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    if cap_thick_ratio is None:
        cap_thick_ratio = claw_thick_ratio * 0.95
    cap_w = size * claw_w_ratio
    cap_thick = size * cap_thick_ratio
    top_y = cy - size * 0.18
    draw.rounded_rectangle(
        [(cx - cap_w / 2, top_y - cap_thick / 2),
         (cx + cap_w / 2, top_y + cap_thick / 2)],
        radius=cap_thick / 2, fill=WHITE
    )
    stroke_w = size * claw_thick_ratio
    n = n_claws
    claw_top = top_y + cap_thick / 2 - size * 0.01
    claw_bottom = cy + size * 0.22
    claw_total_w = size * claw_w_ratio
    for i in range(n):
        offset = (i - (n - 1) / 2) * (claw_total_w / max(n - 1, 1))
        x = cx + offset
        ext = size * 0.10 if (i == 0 or i == n - 1) else 0
        draw.rounded_rectangle(
            [(x - stroke_w / 2, claw_top),
             (x + stroke_w / 2, claw_bottom + ext)],
            radius=stroke_w / 2, fill=WHITE
        )
    return img.convert("RGB")


def build_variants_sheet():
    """Render multiple parameter variations across multiple sizes for visual diff."""
    variants = [
        ("v1_thick_4",   dict(n_claws=4, claw_thick_ratio=0.18, claw_w_ratio=0.74)),
        ("v2_thin_4",    dict(n_claws=4, claw_thick_ratio=0.13, claw_w_ratio=0.78)),
        ("v3_thin_3",    dict(n_claws=3, claw_thick_ratio=0.16, claw_w_ratio=0.66)),
        ("v4_thin_3_w",  dict(n_claws=3, claw_thick_ratio=0.15, claw_w_ratio=0.74)),
        ("v5_thick_3",   dict(n_claws=3, claw_thick_ratio=0.20, claw_w_ratio=0.62)),
        ("v6_3_thinner", dict(n_claws=3, claw_thick_ratio=0.13, claw_w_ratio=0.70)),
    ]
    sizes = [16, 22, 29, 40, 60, 120, 256]
    # Layout: rows = variants, cols = sizes. Plus a "big" 1024 on the right.
    ROW_H = 280
    PAD = 14
    LABEL_W = 110
    total_w = LABEL_W + sum(sizes) + PAD * (len(sizes) + 1) + 200
    total_h = ROW_H * len(variants) + PAD * 2
    sheet = Image.new("RGB", (total_w, total_h), (240, 240, 240))
    draw = ImageDraw.Draw(sheet)
    for ri, (vname, vparams) in enumerate(variants):
        row_y = PAD + ri * ROW_H
        # Label
        try:
            from PIL import ImageFont
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
        except Exception:
            font = ImageFont.load_default()
        draw.text((10, row_y + 20), vname, fill=(40, 40, 40), font=font)
        # Render sizes
        x = LABEL_W
        for s in sizes:
            img = claw(s, **vparams)
            y = row_y + (ROW_H - s) - 20
            sheet.paste(img, (x, y))
            x += s + PAD
    sheet.save(OUT / "D_variants_comparison.png", "PNG")
    print(f"OK: variants at {OUT / 'D_variants_comparison.png'}")


if __name__ == "__main__":
    build_variants_sheet()

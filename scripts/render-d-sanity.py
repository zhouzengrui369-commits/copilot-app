#!/usr/bin/env python3
"""Render claw glyph at small sizes to check legibility (iOS settings 16/22/29, Spotlight 40, App 60)."""
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


def claw(size, n_claws=4, claw_thick_ratio=0.18, cap_thick_ratio=0.16,
         cap_w_ratio=0.74, claw_w_ratio=0.74, outer_extend=0.16):
    img = gradient_bg(size).convert("RGBA")
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2

    # Top horizontal cap
    cap_w = size * cap_w_ratio
    cap_thick = size * cap_thick_ratio
    top_y = cy - size * 0.20
    draw.rounded_rectangle(
        [(cx - cap_w / 2, top_y - cap_thick / 2),
         (cx + cap_w / 2, top_y + cap_thick / 2)],
        radius=cap_thick / 2, fill=WHITE
    )

    stroke_w = size * claw_thick_ratio
    n = n_claws
    claw_top = top_y + cap_thick / 2 - size * 0.005
    claw_bottom = cy + size * 0.24
    claw_total_w = size * claw_w_ratio
    for i in range(n):
        offset = (i - (n - 1) / 2) * (claw_total_w / (n - 1))
        x = cx + offset
        ext = size * outer_extend if (i == 0 or i == n - 1) else 0
        draw.rounded_rectangle(
            [(x - stroke_w / 2, claw_top),
             (x + stroke_w / 2, claw_bottom + ext)],
            radius=stroke_w / 2, fill=WHITE
        )
    return img.convert("RGB")


def main():
    sizes = [16, 22, 29, 40, 60, 76, 120, 180, 1024]
    # Render at exact size (iOS does its own subpixel aa, but checking structure)
    for s in sizes:
        claw(s).save(OUT / f"D_sanity_{s}.png", "PNG")

    # Build a "sizes" sheet: 16, 22, 29, 40, 60, 76, 120, 180 side-by-side on a label
    PAD = 20
    LABEL_H = 30
    widths = [s for s in sizes if s <= 180]
    total_w = PAD * (len(widths) + 1) + sum(widths)
    total_h = max(widths) + LABEL_H + PAD * 2
    sheet = Image.new("RGB", (total_w, total_h), (245, 245, 245))
    draw = ImageDraw.Draw(sheet)
    for i, s in enumerate(widths):
        x = PAD + i * PAD + sum(widths[:i])
        y = (max(widths) - s) + PAD  # bottom-align
        sheet.paste(claw(s), (x, y))
    sheet.save(OUT / f"D_sanity_sizes.png", "PNG")
    print(f"OK: D sanity at {OUT / 'D_sanity_sizes.png'}")


if __name__ == "__main__":
    main()

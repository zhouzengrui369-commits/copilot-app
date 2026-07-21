#!/usr/bin/env python3
"""Generate 5 brand mark candidates for NJX to review.

Each is rendered as a 1024x1024 master + a small 256x256 preview.
Brand tokens: teal #0f766e (primary), white foreground, optional deep teal #0d5c56.

Candidates:
  A. OC wordmark         (current — for comparison)
  B. Concentric rings    (workbench "kernel" — depth + system vibe)
  C. OpenClaw dot grid   (3x3 dot grid = 3 agent orchestration)
  D. Claw glyph          (stylized 爪 radical, minimalist)
  E. Compass             (claw = grab + orient; "find your way" / orchestrator)
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

OUT_DIR = Path("/Users/njx/openclaw_data/openclaw_workbench/.brand-candidates")
OUT_DIR.mkdir(parents=True, exist_ok=True)

BRAND_TEAL = (15, 118, 110)
BRAND_DEEP = (13, 92, 86)
BRAND_SOFT = (220, 252, 231)
WHITE = (255, 255, 255)


def base(size=1024, rounded=True):
    img = Image.new("RGB", (size, size), BRAND_TEAL)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(BRAND_TEAL[0] + (BRAND_DEEP[0] - BRAND_TEAL[0]) * t)
        g = int(BRAND_TEAL[1] + (BRAND_DEEP[1] - BRAND_TEAL[1]) * t)
        b = int(BRAND_TEAL[2] + (BRAND_DEEP[2] - BRAND_TEAL[2]) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    if rounded:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [(0, 0), (size - 1, size - 1)], radius=int(size * 0.22), fill=255
        )
        result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        result.paste(img.convert("RGBA"), (0, 0), mask)
        return result.convert("RGB")
    return img


def get_font(size, weight="bold"):
    """Try SFNS / Helvetica / Arial."""
    for path in [
        f"/System/Library/Fonts/SFNS{weight}.ttf",
        f"/System/Library/Fonts/SFNSDisplay{weight}.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def text_centered(draw, text, font, cx, cy, fill, shadow_offset=(0, 0), shadow_color=(0, 0, 0, 0)):
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = cx - text_w / 2 - bbox[0]
    y = cy - text_h / 2 - bbox[1]
    if shadow_color[3] > 0:
        # shadow drawn on a separate layer
        sx = cx - text_w / 2 - bbox[0] + shadow_offset[0]
        sy = cy - text_h / 2 - bbox[1] + shadow_offset[1]
        return (x, y, sx, sy)
    return (x, y, None, None)


def add_soft_shadow(canvas, draw_at, text, font, offset=4, alpha=70, blur=12):
    """Add a soft white shadow for legibility. draw_at = (x, y)."""
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sx, sy = draw_at
    sd.text((sx + offset, sy + offset), text, font=font, fill=(0, 0, 0, alpha))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=blur))
    canvas_rgba = canvas.convert("RGBA")
    canvas_rgba.alpha_composite(shadow)
    return canvas_rgba


# === Candidate A: OC wordmark (current) ===
def make_A(size=1024):
    img = base(size).convert("RGBA")
    draw = ImageDraw.Draw(img)
    font = get_font(int(size * 0.52))
    text = "OC"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) / 2 - bbox[0]
    y = (size - text_h) / 2 - bbox[1] - size * 0.02
    # Soft shadow
    shadow_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow_layer).text(
        (x + size * 0.010, y + size * 0.014), text,
        font=font, fill=(0, 0, 0, 70)
    )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=size * 0.010))
    img.alpha_composite(shadow_layer)
    draw = ImageDraw.Draw(img)
    draw.text((x, y), text, font=font, fill=WHITE)
    return img.convert("RGB")


# === Candidate B: Concentric rings (workbench "kernel") ===
def make_B(size=1024):
    img = base(size).convert("RGBA")
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    # 3 concentric white rings, no fill
    outer_r = int(size * 0.36)
    mid_r = int(size * 0.24)
    inner_r = int(size * 0.12)
    # Slight stroke variation for depth
    draw.ellipse(
        [(cx - outer_r, cy - outer_r), (cx + outer_r, cy + outer_r)],
        outline=WHITE, width=int(size * 0.022)
    )
    draw.ellipse(
        [(cx - mid_r, cy - mid_r), (cx + mid_r, cy + mid_r)],
        outline=WHITE, width=int(size * 0.020)
    )
    # Center solid disc (the "kernel")
    draw.ellipse(
        [(cx - inner_r, cy - inner_r), (cx + inner_r, cy + inner_r)],
        fill=WHITE
    )
    return img.convert("RGB")


# === Candidate C: 3x3 dot grid (3 agents orchestrating) ===
def make_C(size=1024):
    img = base(size).convert("RGBA")
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    spacing = size * 0.14
    dot_r = size * 0.075
    # Center dot is the focal/active one (solid + bigger)
    for row in range(3):
        for col in range(3):
            x = cx + (col - 1) * spacing
            y = cy + (row - 1) * spacing
            r = dot_r * 1.3 if (row == 1 and col == 1) else dot_r
            draw.ellipse(
                [(x - r, y - r), (x + r, y + r)],
                fill=WHITE if (row == 1 and col == 1) else None,
                outline=WHITE, width=int(size * 0.020)
            )
    return img.convert("RGB")


# === Candidate D: Stylized 爪 (claw) glyph ===
def make_D(size=1024):
    """Custom-drawn 爪 radical using lines: 4 vertical strokes + top horizontal cap.
    Reads as a literal "claw" / "grab" shape, much more iconic than the CJK character."""
    img = base(size).convert("RGBA")
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    # Top horizontal cap
    cap_w = size * 0.42
    cap_thick = size * 0.06
    top_y = cy - size * 0.22
    draw.rounded_rectangle(
        [(cx - cap_w / 2, top_y - cap_thick / 2),
         (cx + cap_w / 2, top_y + cap_thick / 2)],
        radius=cap_thick / 2, fill=WHITE
    )
    # 4 vertical strokes (the claws)
    stroke_w = size * 0.06
    n = 4
    claw_top = top_y + cap_thick / 2
    claw_bottom = cy + size * 0.26
    claw_total_w = size * 0.42
    for i in range(n):
        # Slightly outward-curving positions
        offset = (i - (n - 1) / 2) * (claw_total_w / (n - 1))
        x = cx + offset
        # Outer claws are slightly longer
        if i == 0 or i == n - 1:
            ext = size * 0.04
        else:
            ext = 0
        # Use rounded line (line caps)
        draw.rounded_rectangle(
            [(x - stroke_w / 2, claw_top),
             (x + stroke_w / 2, claw_bottom + ext)],
            radius=stroke_w / 2, fill=WHITE
        )
    return img.convert("RGB")


# === Candidate E: Compass / claw-mark fusion ===
def make_E(size=1024):
    """A diamond / compass needle that subtly reads as a claw arrow.
    Represents "find your way" / orchestrator with intention."""
    img = base(size).convert("RGBA")
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    # Diamond rotated 45°
    d = size * 0.34
    points = [(cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy)]
    draw.polygon(points, fill=WHITE)
    # Inner cut-out to make it a hollow compass-needle
    inner_d = d * 0.45
    inner_points = [(cx, cy - inner_d), (cx + inner_d, cy), (cx, cy + inner_d), (cx - inner_d, cy)]
    # Cut using background color (or mask)
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    ImageDraw.Draw(mask).polygon(inner_points, fill=0)
    result = Image.new("RGBA", img.size, (0, 0, 0, 0))
    result.paste(img.convert("RGBA"), (0, 0), mask)
    return result.convert("RGB")


def main():
    candidates = {
        "A_OC":         make_A,
        "B_rings":      make_B,
        "C_dotgrid":    make_C,
        "D_claw_glyph": make_D,
        "E_compass":    make_E,
    }
    # Render two sizes: 1024 master + 256 preview
    for name, fn in candidates.items():
        master = fn(1024)
        master.save(OUT_DIR / f"{name}_1024.png", "PNG")
        preview = fn(256)
        preview.save(OUT_DIR / f"{name}_256.png", "PNG")
        print(f"  wrote {name}: 1024 + 256")

    # Build a side-by-side comparison sheet
    sheet = Image.new("RGB", (5 * 280 + 6 * 20, 320), (240, 240, 240))
    draw = ImageDraw.Draw(sheet)
    font = get_font(18)
    for i, (name, _) in enumerate(candidates.items()):
        preview = Image.open(OUT_DIR / f"{name}_256.png")
        x = 20 + i * 280
        sheet.paste(preview, (x, 20))
        # Label
        label = {
            "A_OC":         "A · OC wordmark (current)",
            "B_rings":      "B · Concentric rings (kernel)",
            "C_dotgrid":    "C · 3x3 dot grid (3 agents)",
            "D_claw_glyph": "D · Claw glyph (custom)",
            "E_compass":    "E · Compass needle (orient)",
        }[name]
        draw.text((x, 290), label, fill=(40, 40, 40), font=font)
    sheet.save(OUT_DIR / "_comparison_sheet.png", "PNG")
    print(f"\nOK: comparison sheet at {OUT_DIR / '_comparison_sheet.png'}")


if __name__ == "__main__":
    main()

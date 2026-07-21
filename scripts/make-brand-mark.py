#!/usr/bin/env python3
"""Generate OpenClaw brand mark (mobile + desktop + web unified).

Brand: teal #0f766e rounded-square + white 3-claw glyph (custom 爪 symbol).
Output: 1024x1024 master PNG + iOS / Android / Desktop icon sets + claw SVG.
"""
import subprocess
import sys
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT_DIR = Path(__file__).resolve().parents[1]
MOBILE_ASSETS = ROOT_DIR / "apps/mobile/assets/images"
MOBILE_EXPO_ICON_ASSETS = ROOT_DIR / "apps/mobile/assets/expo.icon/Assets"
DESKTOP_BUILD = ROOT_DIR / "apps/desktop/build"
DESKTOP_ICONSET = DESKTOP_BUILD / "icon.iconset"
WEB_PUBLIC = ROOT_DIR / "apps/web/public"

BRAND_TEAL = (15, 118, 110)   # #0f766e
BRAND_DEEP = (13, 92, 86)     # #0d5c56
WHITE = (255, 255, 255)

# Claw glyph parameters (v5: 3 claws, short + thick + tight cap — readable down to 16px)
# v4 had thin 0.15 strokes + long 0.74 spread + outer-claw extension, which at
# 16/32/64 px rendered as a "π" character (2 long outer legs + horizontal cap
# + faint middle). v5 trades the long legs for compact, equal-length claws with
# a tight cap — 3-claw semantic survives down to 16x16.
N_CLAWS = 3
CLAW_THICK_RATIO = 0.20      # stroke width (was 0.15) — survives 16px downsample
CLAW_W_RATIO = 0.55          # spread (was 0.74) — cap stays tight, no π silhouette
CAP_THICK_RATIO = 0.13       # cap thickness (was 0.15)
OUTER_EXTEND = 0.00          # outer claws equal length (was 0.10) — symmetry
CLAW_TOP_OFFSET = 0.01       # claws touch cap (was -0.01 micro-gap)
CLAW_BOTTOM_OFFSET = 0.18    # claws slightly shorter (was 0.22) — more square


def _draw_claw(draw: ImageDraw.ImageDraw, size: int) -> None:
    """Draw the 3-claw glyph centered on canvas (assumes background already drawn)."""
    cx, cy = size // 2, size // 2
    cap_w = size * CLAW_W_RATIO
    cap_thick = size * CAP_THICK_RATIO
    top_y = cy - size * 0.18
    # Cap (horizontal pill)
    draw.rounded_rectangle(
        [(cx - cap_w / 2, top_y - cap_thick / 2),
         (cx + cap_w / 2, top_y + cap_thick / 2)],
        radius=cap_thick / 2, fill=WHITE
    )
    # Claws
    stroke_w = size * CLAW_THICK_RATIO
    claw_top = top_y + cap_thick / 2 + size * CLAW_TOP_OFFSET
    claw_bottom = cy + size * CLAW_BOTTOM_OFFSET
    claw_total_w = size * CLAW_W_RATIO
    for i in range(N_CLAWS):
        offset = (i - (N_CLAWS - 1) / 2) * (claw_total_w / max(N_CLAWS - 1, 1))
        x = cx + offset
        ext = size * OUTER_EXTEND if (i == 0 or i == N_CLAWS - 1) else 0
        draw.rounded_rectangle(
            [(x - stroke_w / 2, claw_top),
             (x + stroke_w / 2, claw_bottom + ext)],
            radius=stroke_w / 2, fill=WHITE
        )


def make_master(size: int, rounded: bool = True) -> Image.Image:
    """Create a square brand mark at the given pixel size."""
    # Teal gradient bg
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
            [(0, 0), (size - 1, (size - 1))], radius=int(size * 0.22), fill=255
        )
        img_rgba = img.convert("RGBA")
        result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        result.paste(img_rgba, (0, 0), mask)
        img = result.convert("RGB")

    # Subtle soft shadow under glyph
    shadow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_layer)
    _draw_claw(shadow_draw, size)
    # Shift + blur for soft drop shadow
    shifted = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shifted.paste(shadow_layer, (int(size * 0.006), int(size * 0.010)))
    shifted = shifted.filter(ImageFilter.GaussianBlur(radius=size * 0.012))
    base = img.convert("RGBA")
    base.alpha_composite(shifted)

    # Glyph on top
    draw_top = ImageDraw.Draw(base)
    _draw_claw(draw_top, size)
    return base


def make_claw_svg(size: int = 64) -> str:
    """Return an inline SVG string for the claw glyph (used in mobile hero / web sidebar).

    viewBox 0 0 100, so callers can size freely. Glyph is white (use currentColor).
    """
    # Reuse the v4 proportions, normalized to 100x100
    cx, cy = 50, 50
    cap_w = CLAW_W_RATIO * 100
    cap_thick = CAP_THICK_RATIO * 100
    cap_y = cy - 18
    cap_rx = cap_thick / 2
    stroke_w = CLAW_THICK_RATIO * 100
    claw_total_w = CLAW_W_RATIO * 100
    claw_top = cap_y + cap_thick / 2 - 1
    claw_bottom = cy + CLAW_BOTTOM_OFFSET * 100
    parts = [
        f'<rect x="{cx - cap_w/2:.2f}" y="{cap_y - cap_thick/2:.2f}" '
        f'width="{cap_w:.2f}" height="{cap_thick:.2f}" '
        f'rx="{cap_rx:.2f}" ry="{cap_rx:.2f}" fill="currentColor"/>'
    ]
    for i in range(N_CLAWS):
        offset = (i - (N_CLAWS - 1) / 2) * (claw_total_w / max(N_CLAWS - 1, 1))
        x = cx + offset
        ext = OUTER_EXTEND * 100 if (i == 0 or i == N_CLAWS - 1) else 0
        parts.append(
            f'<rect x="{x - stroke_w/2:.2f}" y="{claw_top:.2f}" '
            f'width="{stroke_w:.2f}" height="{claw_bottom + ext - claw_top:.2f}" '
            f'rx="{stroke_w/2:.2f}" ry="{stroke_w/2:.2f}" fill="currentColor"/>'
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
        f'width="{size}" height="{size}">'
        + "".join(parts) +
        '</svg>'
    )


def main():
    if "--check" in sys.argv:
        targets = [
            MOBILE_ASSETS / "icon.png",
            MOBILE_ASSETS / "splash-icon.png",
            DESKTOP_BUILD / "icon.icns",
            WEB_PUBLIC / "brand-mark.svg",
        ]
        missing = [t for t in targets if not t.exists()]
        if missing:
            print(f"FAIL: missing {missing}")
            sys.exit(1)
        print("OK: all brand assets present")
        return

    # ---------- SVG (web + mobile hero in-view) ----------
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    svg_content = make_claw_svg(64)
    (WEB_PUBLIC / "brand-mark.svg").write_text(svg_content)
    print(f"  wrote {WEB_PUBLIC / 'brand-mark.svg'} (vector claw glyph)")

    # ---------- mobile (iOS + Android + splash) ----------
    MOBILE_ASSETS.mkdir(parents=True, exist_ok=True)
    MOBILE_EXPO_ICON_ASSETS.mkdir(parents=True, exist_ok=True)

    master_1024 = make_master(1024, rounded=True)
    master_1024.save(MOBILE_ASSETS / "icon.png", "PNG")
    print(f"  wrote {MOBILE_ASSETS / 'icon.png'} (1024x1024 claw icon)")

    splash_512 = make_master(512, rounded=True)
    splash_512.save(MOBILE_ASSETS / "splash-icon.png", "PNG")
    print(f"  wrote {MOBILE_ASSETS / 'splash-icon.png'} (512x512)")

    # Android adaptive foreground (claw glyph on transparent — Android composites on bg)
    android_fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    inner_size = int(1024 * 0.7)
    inner = make_master(inner_size, rounded=True).convert("RGBA")
    offset = (1024 - inner_size) // 2
    android_fg.paste(inner, (offset, offset), inner)
    android_fg.save(MOBILE_ASSETS / "android-icon-foreground.png", "PNG")
    print(f"  wrote {MOBILE_ASSETS / 'android-icon-foreground.png'} (1024x1024)")

    # Android monochrome (themed icons: white claw on transparent)
    mono = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    mono_draw = ImageDraw.Draw(mono)
    _draw_claw(mono_draw, 1024)
    mono.save(MOBILE_ASSETS / "android-icon-monochrome.png", "PNG")
    print(f"  wrote {MOBILE_ASSETS / 'android-icon-monochrome.png'} (1024x1024)")

    # Expo app icon assets
    expo_claw = make_master(512, rounded=True).convert("RGBA")
    expo_claw.save(MOBILE_EXPO_ICON_ASSETS / "expo-symbol 2.png", "PNG")
    print(f"  wrote {MOBILE_EXPO_ICON_ASSETS / 'expo-symbol 2.png'} (512x512)")

    # ---------- desktop (macOS .icns via iconutil) ----------
    DESKTOP_BUILD.mkdir(parents=True, exist_ok=True)
    if DESKTOP_ICONSET.exists():
        shutil.rmtree(DESKTOP_ICONSET)
    DESKTOP_ICONSET.mkdir(parents=True, exist_ok=True)

    sizes = [
        (16, "16x16"),
        (32, "16x16@2x"),
        (32, "32x32"),
        (64, "32x32@2x"),
        (128, "128x128"),
        (256, "128x128@2x"),
        (256, "256x256"),
        (512, "256x256@2x"),
        (512, "512x512"),
        (1024, "512x512@2x"),
    ]
    seen = set()
    for px, name in sizes:
        if name in seen:
            continue
        seen.add(name)
        png_path = DESKTOP_ICONSET / f"icon_{name}.png"
        img = make_master(px, rounded=False)
        img.save(png_path, "PNG")
        print(f"  wrote {png_path} ({px}x{px})")

    icon_icns = DESKTOP_BUILD / "icon.icns"
    try:
        subprocess.run(
            ["iconutil", "-c", "icns", str(DESKTOP_ICONSET), "-o", str(icon_icns)],
            check=True,
        )
    except subprocess.CalledProcessError:
        if icon_icns.exists() and icon_icns.stat().st_size > 0:
            print(f"WARN: iconutil rejected regenerated iconset; keeping existing {icon_icns}")
        else:
            raise
    print(f"\nOK: {icon_icns} ({icon_icns.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

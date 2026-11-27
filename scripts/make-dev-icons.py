#!/usr/bin/env python3
"""Make the TuxNotes Dev icons: the normal icon with an orange DEV badge.

Reads src-tauri/icons/icon.png and writes src-tauri/icons/dev/*.png in the sizes the
normal icon comes in. Needs Pillow (python3-pil) and a bold font (DejaVu Sans Bold).
Run it again after changing the normal icon:  python3 scripts/make-dev-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
OUT = ICONS / "dev"
FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
]
SIZES = {"32x32.png": 32, "64x64.png": 64, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512}
BADGE = (232, 89, 12, 255)  # orange-red, clearly different from the yellow header


def font(size):
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    raise SystemExit("No DejaVu Sans Bold font found (install fonts-dejavu-core).")


def dev_icon():
    base = Image.open(ICONS / "icon.png").convert("RGBA").resize((1024, 1024), Image.LANCZOS)
    draw = ImageDraw.Draw(base)
    # A wide pill over the lower half of the page, with a white outline so it stands out.
    box = (190, 560, 834, 840)
    draw.rounded_rectangle(box, radius=140, fill=(255, 255, 255, 255))
    inner = (box[0] + 22, box[1] + 22, box[2] - 22, box[3] - 22)
    draw.rounded_rectangle(inner, radius=118, fill=BADGE)
    f = font(190)
    left, top, right, bottom = draw.textbbox((0, 0), "DEV", font=f)
    cx, cy = (inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2
    draw.text((cx - (left + right) / 2, cy - (top + bottom) / 2), "DEV", font=f, fill=(255, 255, 255, 255))
    return base


def main():
    OUT.mkdir(exist_ok=True)
    big = dev_icon()
    for name, size in SIZES.items():
        big.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print(f"wrote {OUT.relative_to(ROOT) / name}")


if __name__ == "__main__":
    main()

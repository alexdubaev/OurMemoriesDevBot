"""Build the original comments outline icon and update only its asset records."""

from __future__ import annotations

import hashlib
import json
import argparse
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "icons"
PUBLIC_OUT_DIR = ROOT / "webapp" / "public" / "assets" / "icons"
MANIFEST = ROOT / "assets" / "manifest.json"
COLORS = {"default": (117, 106, 113), "active": (168, 55, 80), "white": (255, 255, 255)}

# Cubic segments are sampled on the supersampled canvas, then stroked with
# rounded joins. This keeps the small WebP contour smooth without vector assets.
CONTOUR = (
    ("M", 24, 7),
    ("C", 13, 7, 5, 14, 5, 25),
    ("L", 5, 39),
    ("C", 5, 50, 12, 57, 23, 57),
    ("L", 28, 57),
    ("C", 26, 60, 23, 64, 21, 66),
    ("C", 19, 68, 22, 70, 25, 68),
    ("C", 31, 64, 37, 60, 41, 57),
    ("L", 50, 57),
    ("C", 61, 57, 67, 50, 67, 39),
    ("L", 67, 25),
    ("C", 67, 14, 61, 7, 50, 7),
    ("Z",),
)


def render(size: int, color: tuple[int, int, int]) -> Image.Image:
    scale = 8
    image = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    factor = size / 72 * scale
    points: list[tuple[float, float]] = []
    current = (0.0, 0.0)
    for segment in CONTOUR:
        if segment[0] == "M":
            current = (segment[1], segment[2])
            points.append(current)
        elif segment[0] == "L":
            current = (segment[1], segment[2])
            points.append(current)
        elif segment[0] == "C":
            p0 = current
            p1 = (segment[1], segment[2])
            p2 = (segment[3], segment[4])
            p3 = (segment[5], segment[6])
            for step in range(1, 25):
                t = step / 24
                u = 1 - t
                points.append((
                    u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
                ))
            current = p3
    pts = [(round(x * factor), round(y * factor)) for x, y in points]
    width = max(3, round(4.3 * factor))
    draw.line(pts + [pts[0]], fill=(*color, 255), width=width, joint="curve")
    radius = width // 2
    for x, y in pts:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, 255))
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview-dir", type=Path, help="Optional directory for light/dark review previews")
    args = parser.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT_DIR.mkdir(parents=True, exist_ok=True)
    new_items = []
    rendered: dict[str, Image.Image] = {}
    for state, color in COLORS.items():
        for density, pixels in ((2, 48), (3, 72)):
            name = f"comments-{state}@{density}x.webp"
            path = OUT_DIR / name
            public_path = PUBLIC_OUT_DIR / name
            image = render(pixels, color)
            image.save(path, "WEBP", lossless=True, method=6, exact=True)
            raw = path.read_bytes()
            public_path.write_bytes(raw)
            new_items.append({
                "path": f"assets/icons/{name}", "usage": "runtime-icon",
                "width": pixels, "height": pixels, "alpha": True,
                "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            })
            if density == 3:
                rendered[state] = image

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["items"] = [item for item in manifest["items"] if not item["path"].startswith("assets/icons/comments-")]
    manifest["items"].extend(new_items)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if args.preview_dir:
        args.preview_dir.mkdir(parents=True, exist_ok=True)
        preview = Image.new("RGB", (660, 120), "#FBF8F5")
        dark = Image.new("RGB", (660, 120), "#302A2E")
        for index, state in enumerate(("default", "active", "white")):
            icon = rendered[state].resize((66, 66), Image.Resampling.LANCZOS)
            preview.paste(icon, (index * 110 + 22, 17), icon)
            dark.paste(icon, (index * 110 + 22, 17), icon)
            ImageDraw.Draw(preview).text((index * 110 + 15, 98), state, fill="#302A2E")
            ImageDraw.Draw(dark).text((index * 110 + 15, 98), state, fill="#FBF8F5")
        preview.save(args.preview_dir / "comments-light.png")
        dark.save(args.preview_dir / "comments-dark.png")


if __name__ == "__main__":
    main()

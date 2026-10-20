"""Build the original comments outline icon and update only its asset records."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "icons"
MANIFEST = ROOT / "assets" / "manifest.json"
PREVIEW_DIR = Path("D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.scratch/COM-3")
COLORS = {"default": (117, 106, 113), "active": (168, 55, 80), "white": (255, 255, 255)}
def render(size: int, color: tuple[int, int, int]) -> Image.Image:
    # Draw at 4x size then downsample to retain a crisp, antialiased outline.
    scale = 4
    image = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    # A softly rounded polygon gives stable, reproducible raster curves at icon size.
    points = [
        (25, 9), (17, 9), (12, 14), (12, 22), (12, 41), (12, 49),
        (17, 54), (25, 54), (27, 54), (21, 64), (20, 66), (22, 67),
        (24, 66), (39, 54), (57, 54), (65, 54), (70, 49), (70, 41),
        (70, 22), (70, 14), (65, 9), (57, 9),
    ]
    # The reduced contour is drawn with curved joints; the tail remains part of the outline.
    pts = [(round(x * size / 72 * scale), round(y * size / 72 * scale)) for x, y in points]
    width = max(3, round(5.4 * size / 72 * scale))
    draw.line(pts + [pts[0]], fill=(*color, 255), width=width, joint="curve")
    # Rounded caps soften the line endpoints at the tail joins.
    radius = width // 2
    for x, y in pts:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, 255))
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    new_items = []
    rendered: dict[str, Image.Image] = {}
    for state, color in COLORS.items():
        for density, pixels in ((2, 48), (3, 72)):
            name = f"comments-{state}@{density}x.webp"
            path = OUT_DIR / name
            image = render(pixels, color)
            image.save(path, "WEBP", lossless=True, method=6, exact=True)
            raw = path.read_bytes()
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

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    preview = Image.new("RGB", (660, 120), "#FBF8F5")
    dark = Image.new("RGB", (660, 120), "#302A2E")
    for index, state in enumerate(("default", "active", "white")):
        icon = rendered[state].resize((66, 66), Image.Resampling.LANCZOS)
        preview.paste(icon, (index * 110 + 22, 27), icon)
        dark.paste(icon, (index * 110 + 22, 27), icon)
        ImageDraw.Draw(preview).text((index * 110 + 15, 98), state, fill="#302A2E")
        ImageDraw.Draw(dark).text((index * 110 + 15, 98), state, fill="#FBF8F5")
    preview.save(PREVIEW_DIR / "comments-light.png")
    dark.save(PREVIEW_DIR / "comments-dark.png")


if __name__ == "__main__":
    main()

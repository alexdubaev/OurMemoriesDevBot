"""Encoding/downscaling only; generated originals remain unchanged outside Git."""
import hashlib
import json
import argparse
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
target = root / "src/dev/ui-v2/assets"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('generated_directory', type=Path, help='Directory containing the three unchanged generated PNG masters')
generated = parser.parse_args().generated_directory
sources = [
    ("portrait", "exec-7438f055-e716-4892-85a8-5ab9f83396b9.png", "Fictional child hugging a terrier, portrait, natural light."),
    ("family", "exec-5708d487-b7fb-44c1-a5f9-898eac46b8fe.png", "Fictional parents and daughter walking together in a park, landscape."),
    ("painting", "exec-d2ca66ad-9849-4814-a016-b2c59d9bd6b8.png", "Fictional child painting at a kitchen table, landscape."),
]
target.mkdir(parents=True, exist_ok=True)
manifest = []
for name, filename, prompt in sources:
    im = Image.open(generated / filename).convert("RGB")
    im.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    destination = target / (name + ".webp")
    im.save(destination, "WEBP", quality=82, method=6)
    payload = destination.read_bytes()
    manifest.append(dict(path=destination.name, usage="synthetic-demo-only", generator="built-in image_gen", prompt=prompt, width=im.width, height=im.height, alpha=False, bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest()))
    assert len(payload) <= 180_000
(target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print([(m["path"], m["bytes"]) for m in manifest])

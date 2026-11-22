"""Restore the checksum-verified offline album prototype without network or dependencies."""
from __future__ import annotations
import base64
import hashlib
import io
from pathlib import Path, PurePosixPath
import tarfile

EXPECTED_SHA256 = "e9fe1a698d2993d2a3ce095419001fc67f0142c0ce5c31ae29bef2395bacaab7"
MAX_UNPACKED = 2_000_000

def main() -> None:
    root = Path(__file__).resolve().parent
    parts = [(root / "reference-archive" / f"source-{n:02d}.b64").read_bytes() for n in range(1, 4)]
    archive = base64.b64decode(b"".join(parts), validate=True)
    if hashlib.sha256(archive).hexdigest() != EXPECTED_SHA256:
        raise RuntimeError("Reference checksum mismatch; no files written")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:xz") as tar:
        files = []
        total = 0
        names = set()
        for member in tar.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or "\\" in member.name or path.parts[:1] != ("reference",):
                raise RuntimeError(f"Unsafe archive path: {member.name}")
            if member.name in names:
                raise RuntimeError("Duplicate archive entry")
            names.add(member.name)
            if not member.isfile():
                raise RuntimeError("Only regular source files are permitted")
            total += member.size
            if total > MAX_UNPACKED:
                raise RuntimeError("Unpacked source size exceeds limit")
            target = root.joinpath(*path.parts)
            for parent in [target, *target.parents]:
                if parent == root:
                    break
                if parent.is_symlink():
                    raise RuntimeError("Symlink in target path")
            if not target.resolve().is_relative_to(root):
                raise RuntimeError("Target escapes package")
            stream = tar.extractfile(member)
            if stream is None:
                raise RuntimeError("Cannot read source")
            data = stream.read()
            if len(data) != member.size:
                raise RuntimeError("Truncated source")
            if target.exists() and (not target.is_file() or target.read_bytes() != data):
                raise RuntimeError(f"Refusing to overwrite changed file: {member.name}")
            files.append((target, data))
        for target, data in files:
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                with target.open("xb") as output:
                    output.write(data)
    print(f"Verified {EXPECTED_SHA256}; restored {len(files)} source files")
    print("Next: cd reference && node build.cjs")
    print("Open reference/index.html. This is a local prototype, not production.")

if __name__ == "__main__":
    main()

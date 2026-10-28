#!/usr/bin/env python3
"""Prepare a Docker daemon config with bounded build-cache retention."""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any


class ConfigError(ValueError):
    """The source config or requested paths are unsafe or incompatible."""


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ConfigError("configuration contains duplicate object keys")
        result[key] = value
    return result


def _checked_path(path_value: str | os.PathLike[str], *, allow_missing_leaf: bool) -> Path:
    path = Path(os.path.abspath(os.fspath(path_value)))
    parts = path.parts
    current = Path(parts[0])
    for index, part in enumerate(parts[1:], start=1):
        current = current / part
        is_leaf = index == len(parts) - 1
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            if is_leaf and allow_missing_leaf:
                continue
            raise ConfigError("path component does not exist") from None
        if stat.S_ISLNK(mode):
            raise ConfigError("symbolic links are not allowed in config paths")
        if not is_leaf and not stat.S_ISDIR(mode):
            raise ConfigError("config path parent is not a directory")
    return path


def _read_source(path: Path) -> dict[str, Any]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        raise ConfigError("cannot open source config safely") from None
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ConfigError("source config must be a regular file")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            raw = source.read()
    except OSError:
        raise ConfigError("cannot read source config safely") from None
    finally:
        os.close(descriptor)

    try:
        value = json.loads(raw, object_pairs_hook=_reject_duplicate_keys)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ConfigError("source config is not valid JSON") from None
    if not isinstance(value, dict):
        raise ConfigError("source config must contain a JSON object")
    return value


def _candidate_config(source: dict[str, Any]) -> dict[str, Any]:
    candidate = dict(source)
    builder = candidate.get("builder", {})
    if not isinstance(builder, dict):
        raise ConfigError("builder config must be a JSON object")
    builder = dict(builder)

    gc = builder.get("gc", {})
    if not isinstance(gc, dict):
        raise ConfigError("builder GC config must be a JSON object")
    gc = dict(gc)
    if "policy" in gc:
        raise ConfigError("existing custom builder GC policy requires an explicit review")

    gc["enabled"] = True
    gc["defaultKeepStorage"] = "2GB"
    builder["gc"] = gc
    candidate["builder"] = builder
    candidate["live-restore"] = True
    return candidate


def prepare_config(
    source_path: str | os.PathLike[str], output_path: str | os.PathLike[str]
) -> None:
    """Write a candidate config exclusively with mode 0600; never alter source."""
    source = _checked_path(source_path, allow_missing_leaf=False)
    output = _checked_path(output_path, allow_missing_leaf=True)
    source_value = _read_source(source)
    candidate = _candidate_config(source_value)
    encoded = (json.dumps(candidate, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(output, flags, 0o600)
    except FileExistsError:
        raise ConfigError("output path already exists") from None
    except OSError:
        raise ConfigError("cannot create output config safely") from None

    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        else:
            os.chmod(output, 0o600)
        with os.fdopen(descriptor, "wb", closefd=False) as target:
            target.write(encoded)
            target.flush()
            os.fsync(target.fileno())
    except OSError:
        try:
            output.unlink()
        except OSError:
            pass
        raise ConfigError("cannot write output config safely") from None
    finally:
        os.close(descriptor)


def activate_config(source_path: str, target_path: str) -> None:
    """Atomically replace daemon config; a failed write leaves the old file intact."""
    source = _checked_path(source_path, allow_missing_leaf=False)
    target = _checked_path(target_path, allow_missing_leaf=False)
    value = _read_source(source)
    target_stat = target.lstat()
    if not stat.S_ISREG(target_stat.st_mode) or target_stat.st_nlink != 1:
        raise ConfigError("active config must be a regular unlinked file")
    encoded = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    descriptor, temporary = tempfile.mkstemp(prefix=".memoly-daemon-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.fchown(output.fileno(), target_stat.st_uid, target_stat.st_gid)
            os.fchmod(output.fileno(), stat.S_IMODE(target_stat.st_mode))
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="existing regular Docker daemon JSON config")
    parser.add_argument("output", help="new candidate config path (must not exist)")
    parser.add_argument("--activate", action="store_true", help="atomically activate validated candidate to existing config (Linux)")
    args = parser.parse_args(argv)
    try:
        if args.activate:
            activate_config(args.source, args.output)
        else:
            prepare_config(args.source, args.output)
    except ConfigError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    print("Docker daemon config operation completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

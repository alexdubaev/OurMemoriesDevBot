#!/usr/bin/env python3
"""Bounded, metadata-only memoLy host sampler. Production paths are intentionally fixed."""
import datetime as dt
import hashlib
import json
import os
import stat
import tempfile
import time

ROOT = "/opt/memoly"
MEDIA = "/opt/memoly/data/storage"
BACKUPS = "/opt/memoly/backups"
OUTPUT = "/opt/memoly/diagnostics/control/snapshot.json"
EVIDENCE = "/opt/memoly/backups/control-evidence.json"
MAX_ENTRIES = 125_000
MAX_SECONDS = 12


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def filesystem(path, scope):
    if stat.S_ISLNK(os.lstat(path).st_mode):
        raise OSError("fixed mount path is a symlink")
    info = os.statvfs(path)
    device = os.stat(path, follow_symlinks=False).st_dev
    identity = "fs-" + hashlib.sha256(str(device).encode("ascii")).hexdigest()[:20]
    block = info.f_frsize or info.f_bsize
    capacity = info.f_blocks * block
    available = info.f_bavail * block
    used = max(0, (info.f_blocks - info.f_bfree) * block)
    return {"id": identity, "scope": scope, "usedBytes": str(used), "availableBytes": str(available),
            "capacityBytes": str(capacity), "parentResourceId": None}


def inventory(root, deadline):
    total = 0
    files = 0
    visited = 0
    stack = [root]
    while stack:
        if visited >= MAX_ENTRIES:
            raise TimeoutError("inventory cap reached")
        if time.monotonic() >= deadline:
            raise TimeoutError("inventory deadline reached")
        current = stack.pop()
        with os.scandir(current) as entries:
            for entry in entries:
                if time.monotonic() >= deadline:
                    raise TimeoutError("inventory deadline reached")
                if visited >= MAX_ENTRIES:
                    raise TimeoutError("inventory cap reached")
                visited += 1
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    stack.append(entry.path)
                elif entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_size
                    files += 1
                if visited >= MAX_ENTRIES:
                    raise TimeoutError("inventory cap reached")
                if time.monotonic() >= deadline:
                    raise TimeoutError("inventory deadline reached")
    return {"usedBytes": str(total), "entries": files}


def prior_media_observation():
    try:
        with open(OUTPUT, "r", encoding="utf-8") as handle:
            previous = json.load(handle)
        media = previous.get("media")
        observed = previous.get("mediaObservedAt")
        today = dt.datetime.now(dt.timezone.utc).date().isoformat()
        if isinstance(media, dict) and set(media) == {"usedBytes", "entries"} and isinstance(media.get("usedBytes"), str) and media["usedBytes"].isdigit() and isinstance(media.get("entries"), int) and not isinstance(media["entries"], bool) and isinstance(observed, str) and observed[:10] == today:
            return {"usedBytes": media["usedBytes"], "entries": media["entries"]}, observed
    except (OSError, ValueError, TypeError):
        pass
    return None, None


def prior_backup_observation():
    try:
        with open(OUTPUT, "r", encoding="utf-8") as handle:
            previous = json.load(handle)
        backup = previous.get("backupStorage")
        observed = previous.get("backupStorageObservedAt")
        today = dt.datetime.now(dt.timezone.utc).date().isoformat()
        if isinstance(backup, dict) and isinstance(backup.get("usedBytes"), str) and backup["usedBytes"].isdigit() and isinstance(backup.get("entries"), int) and not isinstance(backup["entries"], bool) and isinstance(observed, str) and observed[:10] == today:
            return {"usedBytes": backup["usedBytes"], "entries": backup["entries"]}, observed
    except (OSError, ValueError, TypeError):
        pass
    return None, None


def backup_evidence():
    """Read only an explicitly reviewed allowlist file; never return path/name fields."""
    try:
        info = os.lstat(EVIDENCE)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            return {"artifactAt": None, "validation": "unknown", "restoreTestAt": None}
        with open(EVIDENCE, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        allowed = {"artifactAt", "validation", "restoreTestAt"}
        if set(value) - allowed:
            return {"artifactAt": None, "validation": "unknown", "restoreTestAt": None}
        validation = value.get("validation")
        if validation not in ("valid", "invalid", "unknown"):
            validation = "unknown"
        def timestamp(item):
            if not isinstance(item, str) or len(item) > 40:
                return None
            try:
                dt.datetime.fromisoformat(item.replace("Z", "+00:00"))
                return item
            except ValueError:
                return None
        return {"artifactAt": timestamp(value.get("artifactAt")), "validation": validation,
                "restoreTestAt": timestamp(value.get("restoreTestAt"))}
    except (OSError, ValueError, TypeError):
        return {"artifactAt": None, "validation": "unknown", "restoreTestAt": None}


def atomic_write(payload):
    os.makedirs(os.path.dirname(OUTPUT), mode=0o755, exist_ok=True)
    os.chmod(os.path.dirname(OUTPUT), 0o755)
    descriptor, temporary = tempfile.mkstemp(prefix=".snapshot-", dir=os.path.dirname(OUTPUT))
    try:
        os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, OUTPUT)
        os.chmod(OUTPUT, 0o644)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def collect():
    observed = utc_now()
    filesystems = [filesystem(ROOT, "host"), filesystem(MEDIA, "media"), filesystem(BACKUPS, "backups")]
    host_id = filesystems[0]["id"]
    for item in filesystems[1:]:
        if item["id"] == host_id:
            item["parentResourceId"] = host_id
    previous, previous_at = prior_media_observation()
    media, media_at = previous, previous_at
    if media is None:
        media = inventory(MEDIA, time.monotonic() + MAX_SECONDS)
        media_at = observed
    previous_backup, previous_backup_at = prior_backup_observation()
    backup_storage, backup_storage_at = previous_backup, previous_backup_at
    backup_fs = next(item for item in filesystems if item["scope"] == "backups")
    if backup_storage is None:
        backup_storage = inventory(BACKUPS, time.monotonic() + MAX_SECONDS)
        backup_storage_at = observed
    backup_storage = {**backup_storage, "resourceId": "backup-logical-files", "parentResourceId": backup_fs["parentResourceId"], **backup_evidence()}
    snapshot = {"version": 1, "observedAt": observed, "mediaObservedAt": media_at,
                "backupStorageObservedAt": backup_storage_at, "filesystems": filesystems,
                "media": media, "backupStorage": backup_storage, "backup": backup_evidence()}
    if len(json.dumps(snapshot, separators=(",", ":"))) > 65_536:
        raise ValueError("snapshot limit")
    atomic_write(snapshot)


if __name__ == "__main__":
    collect()

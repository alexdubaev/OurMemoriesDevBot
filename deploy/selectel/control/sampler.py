#!/usr/bin/env python3
"""Bounded, metadata-only memoLy host sampler. Production paths are intentionally fixed."""
import datetime as dt
import hashlib
import json
import os
import posixpath
import re
import stat
import tempfile
import time

ROOT = "/opt/memoly"
MEDIA = "/opt/memoly/data/storage"
BACKUPS = "/opt/memoly/backups"
CONTROL = "/opt/memoly/control"
METRICS = "/opt/memoly/control/metrics"
OUTPUT = "/opt/memoly/control/metrics/snapshot.json"
RELEASE_EVIDENCE = "/opt/memoly/control/release-evidence.json"
BACKUP_EVIDENCE = "/opt/memoly/backups/control-evidence.json"
MAX_ENTRIES = 125_000
MAX_SECONDS = 12


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def timestamp_is_safe(value):
    if not isinstance(value, str) or len(value) > 40 or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value):
        return False
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=1)


def require_root_owned_path(path, final_kind, final_mode=None, allow_missing=False):
    """Reject symlinks and writable/unowned ancestors before root reads or writes."""
    if not isinstance(path, str) or not path.startswith("/") or "\0" in path:
        raise PermissionError("fixed host path must be absolute")
    absolute = posixpath.normpath(path)
    parts = absolute.strip("/").split("/")
    current = "/"
    for index, part in enumerate(parts):
        current = posixpath.join(current, part)
        final = index == len(parts) - 1
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            if final and allow_missing:
                return
            raise
        mode = info.st_mode
        if stat.S_ISLNK(mode) or info.st_uid != 0 or mode & 0o022:
            raise PermissionError("unsafe fixed host path")
        if final:
            if final_kind == "file" and not stat.S_ISREG(mode):
                raise PermissionError("unsafe fixed host file")
            if final_kind == "directory" and not stat.S_ISDIR(mode):
                raise PermissionError("unsafe fixed host directory")
            if final_mode is not None and stat.S_IMODE(mode) != final_mode:
                raise PermissionError("unexpected fixed host path mode")
        elif not stat.S_ISDIR(mode):
            raise PermissionError("unsafe fixed host path ancestor")


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
        require_root_owned_path(BACKUPS, "directory")
        info = os.lstat(BACKUP_EVIDENCE)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            return {"artifactAt": None, "validation": "unknown", "restoreTestAt": None}
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            return {"artifactAt": None, "validation": "unknown", "restoreTestAt": None}
        with open(BACKUP_EVIDENCE, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        allowed = {"artifactAt", "validation", "restoreTestAt"}
        if set(value) != allowed:
            return {"artifactAt": None, "validation": "unknown", "restoreTestAt": None}
        validation = value.get("validation")
        if validation not in ("valid", "invalid", "unknown"):
            validation = "unknown"
        artifact_at = value.get("artifactAt")
        restore_test_at = value.get("restoreTestAt")
        if not timestamp_is_safe(artifact_at) or (restore_test_at is not None and not timestamp_is_safe(restore_test_at)):
            return {"artifactAt": None, "validation": "unknown", "restoreTestAt": None}
        return {"artifactAt": artifact_at, "validation": validation, "restoreTestAt": restore_test_at}
    except (OSError, ValueError, TypeError):
        return {"artifactAt": None, "validation": "unknown", "restoreTestAt": None}


def release_evidence():
    """Read a strict success receipt written by the guarded release entry point."""
    try:
        require_root_owned_path(CONTROL, "directory", 0o755)
        info = os.lstat(RELEASE_EVIDENCE)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 4096:
            return None
        with open(RELEASE_EVIDENCE, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        allowed = {"backendSha", "staticSha", "migrationCatalogCount", "migrationStatus", "lastSuccessfulReleaseAt"}
        if set(value) != allowed:
            return None
        if not isinstance(value["backendSha"], str) or not re.fullmatch(r"[0-9a-f]{40}", value["backendSha"]):
            return None
        if not isinstance(value["staticSha"], str) or not re.fullmatch(r"[0-9a-f]{40}", value["staticSha"]):
            return None
        count = value["migrationCatalogCount"]
        if isinstance(count, bool) or not isinstance(count, int) or count < 0 or count > 1_000_000 or value["migrationStatus"] != "up_to_date":
            return None
        timestamp = value["lastSuccessfulReleaseAt"]
        if not timestamp_is_safe(timestamp):
            return None
        return {key: value[key] for key in allowed}
    except (OSError, ValueError, TypeError):
        return None


def write_backup_evidence(artifact_at):
    """Record only a freshly validated archive; never erase a separate restore test."""
    require_root_owned_path(BACKUPS, "directory")
    if not isinstance(artifact_at, str) or len(artifact_at) > 40:
        raise ValueError("invalid backup artifact timestamp")
    if not timestamp_is_safe(artifact_at):
        raise ValueError("invalid backup artifact timestamp")
    try:
        info = os.lstat(BACKUP_EVIDENCE)
    except FileNotFoundError:
        info = None
    if info is not None:
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 4096:
            raise PermissionError("unsafe existing backup evidence")
        with open(BACKUP_EVIDENCE, "r", encoding="utf-8") as handle:
            existing = json.load(handle)
        allowed = {"artifactAt", "validation", "restoreTestAt"}
        if set(existing) != allowed or existing.get("validation") not in ("valid", "invalid", "unknown"):
            raise ValueError("unrecognized existing backup evidence")
        for key in ("artifactAt", "restoreTestAt"):
            value = existing.get(key)
            if value is not None and (not isinstance(value, str) or timestamp_is_safe(value) is False):
                raise ValueError("malformed existing backup evidence")
        if existing.get("restoreTestAt") is not None:
            raise ValueError("preserving separately verified restore evidence requires an explicit review")
    payload = {"artifactAt": artifact_at, "validation": "valid", "restoreTestAt": None}
    directory = os.path.dirname(BACKUP_EVIDENCE)
    descriptor, temporary = tempfile.mkstemp(prefix=".control-evidence-", dir=directory)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, BACKUP_EVIDENCE)
        require_root_owned_path(BACKUP_EVIDENCE, "file", 0o600)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def atomic_write(payload):
    require_root_owned_path(METRICS, "directory", 0o755)
    require_root_owned_path(OUTPUT, "file", 0o644, allow_missing=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".snapshot-", dir=METRICS)
    try:
        os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, OUTPUT)
        require_root_owned_path(OUTPUT, "file", 0o644)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def collect():
    require_root_owned_path(CONTROL, "directory", 0o755)
    require_root_owned_path(METRICS, "directory", 0o755)
    require_root_owned_path(os.path.join(CONTROL, "sampler.py"), "file", 0o644)
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
                "media": media, "backupStorage": backup_storage, "backup": backup_evidence(),
                "release": release_evidence()}
    if len(json.dumps(snapshot, separators=(",", ":"))) > 65_536:
        raise ValueError("snapshot limit")
    atomic_write(snapshot)


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == "--write-backup-evidence":
        write_backup_evidence(sys.argv[2])
    else:
        collect()

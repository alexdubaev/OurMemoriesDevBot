import importlib.util
import json
import os
import stat
import tempfile
import datetime as dt
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


MODULE = Path(__file__).with_name("sampler.py")
SPEC = importlib.util.spec_from_file_location("memoly_control_sampler", MODULE)
sampler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sampler)


class HostSamplerTests(unittest.TestCase):
    def set_fixture_paths(self, root):
        host, media, backups = root / "host", root / "media", root / "backups"
        control, metrics = root / "control", root / "control" / "metrics"
        for path in (host, media, backups, metrics):
            path.mkdir(parents=True, exist_ok=True)
        sampler.ROOT, sampler.MEDIA, sampler.BACKUPS = map(str, (host, media, backups))
        sampler.CONTROL, sampler.METRICS = map(str, (control, metrics))
        sampler.OUTPUT = str(metrics / "snapshot.json")
        sampler.RELEASE_EVIDENCE = str(control / "release-evidence.json")
        sampler.BACKUP_EVIDENCE = str(backups / "control-evidence.json")
        return host, media, backups, control, metrics, Path(sampler.OUTPUT)

    @staticmethod
    def fake_root_metadata(path):
        info = os.stat(path, follow_symlinks=False)
        return SimpleNamespace(st_mode=(stat.S_IFDIR | 0o755) if stat.S_ISDIR(info.st_mode) else (stat.S_IFREG | 0o600),
                               st_uid=0, st_size=info.st_size)

    @staticmethod
    def old_timestamp(minutes=5):
        return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes)).isoformat(timespec="seconds").replace("+00:00", "Z")

    def test_synthetic_inventory_ignores_symlinks_and_counts_regular_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            host, media, backups, control, metrics, output = self.set_fixture_paths(root)
            (media / "one.bin").write_bytes(b"12345")
            (media / "nested").mkdir()
            (media / "nested" / "two.bin").write_bytes(b"xx")
            external = root / "private.bin"
            external.write_bytes(b"x" * 99)
            try:
                (media / "link.bin").symlink_to(external)
            except OSError:
                pass
            fs = type("StatVfs", (), {"f_frsize": 4096, "f_bsize": 4096, "f_blocks": 10, "f_bfree": 4, "f_bavail": 3})()
            with mock.patch.object(sampler, "require_root_owned_path"), \
                 mock.patch.object(sampler.os, "statvfs", create=True, return_value=fs), \
                 mock.patch.object(sampler.os, "fchmod", create=True):
                sampler.collect()
            result = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(result["media"]["usedBytes"], "7")
            self.assertEqual(result["media"]["entries"], 2)
            self.assertEqual(set(result), {"version", "observedAt", "mediaObservedAt", "backupStorageObservedAt", "filesystems", "media", "backupStorage", "backup", "release"})
            self.assertIsNone(result["release"])
            self.assertNotIn("private.bin", json.dumps(result))
            self.assertTrue(output.stat().st_mode & 0o444)

    def test_backup_evidence_allowlist_rejects_paths_and_filenames(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            evidence = root / "control-evidence.json"
            evidence.write_text(json.dumps({"artifactAt": "2026-10-25T10:00:00Z", "validation": "valid", "restoreTestAt": None, "path": "/private"}), encoding="utf-8")
            actual_lstat = os.lstat
            def lstat(path):
                return self.fake_root_metadata(path) if str(path) == str(evidence) else actual_lstat(path)
            with mock.patch.object(sampler, "require_root_owned_path"), mock.patch.object(sampler.os, "lstat", side_effect=lstat):
                sampler.BACKUPS = str(root)
                sampler.BACKUP_EVIDENCE = str(evidence)
                self.assertEqual(sampler.backup_evidence(), {"artifactAt": None, "validation": "unknown", "restoreTestAt": None})

    def test_release_evidence_accepts_only_bounded_success_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            control = root / "control"
            control.mkdir()
            evidence = control / "release-evidence.json"
            receipt = {"backendSha": "a" * 40, "staticSha": "b" * 40, "migrationCatalogCount": 57,
                       "migrationStatus": "up_to_date", "lastSuccessfulReleaseAt": self.old_timestamp()}
            evidence.write_text(json.dumps(receipt), encoding="utf-8")
            actual_lstat = os.lstat
            def lstat(path):
                return self.fake_root_metadata(path) if str(path) == str(evidence) else actual_lstat(path)
            with mock.patch.object(sampler, "require_root_owned_path"), mock.patch.object(sampler.os, "lstat", side_effect=lstat):
                sampler.CONTROL = str(control)
                sampler.RELEASE_EVIDENCE = str(evidence)
                self.assertEqual(sampler.release_evidence(), receipt)
                evidence.write_text(json.dumps({**receipt, "secret": "never emit"}), encoding="utf-8")
                self.assertIsNone(sampler.release_evidence())
                evidence.write_text(json.dumps({**receipt, "lastSuccessfulReleaseAt": "2999-10-25T10:00:00Z"}), encoding="utf-8")
                self.assertIsNone(sampler.release_evidence())
                evidence.write_text(json.dumps({**receipt, "lastSuccessfulReleaseAt": self.old_timestamp().replace("Z", "+00:00")}), encoding="utf-8")
                self.assertIsNone(sampler.release_evidence())

    def test_receipt_timestamp_requires_iso_utc_z(self):
        self.assertTrue(sampler.timestamp_is_safe(self.old_timestamp()))
        past = self.old_timestamp()
        self.assertFalse(sampler.timestamp_is_safe(past.replace("Z", "+00:00")))
        self.assertFalse(sampler.timestamp_is_safe(past.replace("T", " ", 1)))

    def test_backup_receipt_is_atomic_structural_evidence_and_rejects_unknown_or_future_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backups = root / "backups"
            backups.mkdir()
            receipt = backups / "control-evidence.json"
            sampler.BACKUPS, sampler.BACKUP_EVIDENCE = str(backups), str(receipt)
            actual_lstat = os.lstat
            def lstat(path):
                return self.fake_root_metadata(path) if str(path) == str(receipt) else actual_lstat(path)
            with mock.patch.object(sampler, "require_root_owned_path"), mock.patch.object(sampler.os, "fchmod", create=True), \
                 mock.patch.object(sampler.os, "lstat", side_effect=lstat):
                first_at = self.old_timestamp()
                sampler.write_backup_evidence(first_at)
                valid = receipt.read_text(encoding="utf-8")
                self.assertEqual(json.loads(valid), {"artifactAt": first_at, "validation": "valid", "restoreTestAt": None})
                receipt.write_text(json.dumps({"artifactAt": "2026-10-25T10:00:00Z", "validation": "valid", "restoreTestAt": None, "extra": True}), encoding="utf-8")
                invalid = receipt.read_text(encoding="utf-8")
                with self.assertRaises(ValueError):
                    sampler.write_backup_evidence(self.old_timestamp(4))
                self.assertEqual(receipt.read_text(encoding="utf-8"), invalid)
                receipt.write_text(json.dumps({"artifactAt": "2999-10-25T10:00:00Z", "validation": "valid", "restoreTestAt": None}), encoding="utf-8")
                future = receipt.read_text(encoding="utf-8")
                with mock.patch.object(sampler.os, "lstat", side_effect=lambda path: self.fake_root_metadata(path) if str(path) == str(receipt) else actual_lstat(path)):
                    with self.assertRaises(ValueError):
                        sampler.write_backup_evidence(self.old_timestamp(4))
                self.assertEqual(receipt.read_text(encoding="utf-8"), future)
                receipt.write_text(json.dumps({"artifactAt": first_at, "validation": "valid", "restoreTestAt": self.old_timestamp(10)}), encoding="utf-8")
                with mock.patch.object(sampler.os, "lstat", side_effect=lambda path: self.fake_root_metadata(path) if str(path) == str(receipt) else actual_lstat(path)):
                    with self.assertRaises(ValueError):
                        sampler.write_backup_evidence(self.old_timestamp(4))

    def test_root_owned_path_rejects_symlinks_and_group_or_world_writable_ancestors(self):
        paths = ["/", "/opt", "/opt/memoly", "/opt/memoly/control", "/opt/memoly/control/metrics", "/opt/memoly/control/metrics/snapshot.json"]
        actual_lstat = os.lstat
        safe = {path: SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0) for path in paths[:-1]}
        safe[paths[-1]] = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0)
        with mock.patch.object(sampler.os, "lstat", side_effect=lambda path: safe[str(path)]):
            sampler.require_root_owned_path(paths[-1], "file", 0o644)
            safe["/opt/memoly"] = SimpleNamespace(st_mode=stat.S_IFDIR | 0o775, st_uid=0)
            with self.assertRaises(PermissionError):
                sampler.require_root_owned_path(paths[-1], "file", 0o644)
            safe["/opt/memoly"] = SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0)
            with self.assertRaises(PermissionError):
                sampler.require_root_owned_path(paths[-1], "file", 0o644)

    def test_inventory_entry_cap_fails_instead_of_returning_partial_total(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index in range(4):
                (root / f"file-{index}").write_bytes(b"x")
            with mock.patch.object(sampler, "MAX_ENTRIES", 2):
                with self.assertRaises(TimeoutError):
                    sampler.inventory(str(root), sampler.time.monotonic() + 5)

    def test_inventory_stat_error_fails_instead_of_returning_partial_total(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "file.bin").write_bytes(b"sample")
            with mock.patch.object(sampler.os.DirEntry, "stat", side_effect=PermissionError("denied")):
                with self.assertRaises(PermissionError):
                    sampler.inventory(str(root), sampler.time.monotonic() + 5)

    def test_incomplete_inventory_keeps_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            host, media, backups, control, metrics, output = self.set_fixture_paths(root)
            output.write_text('{"previous":"good"}', encoding="utf-8")
            fs = type("StatVfs", (), {"f_frsize": 4096, "f_bsize": 4096, "f_blocks": 10, "f_bfree": 4, "f_bavail": 3})()
            with mock.patch.object(sampler, "require_root_owned_path"), \
                 mock.patch.object(sampler.os, "statvfs", create=True, return_value=fs), \
                 mock.patch.object(sampler.os, "fchmod", create=True), \
                 mock.patch.object(sampler, "inventory", side_effect=[{"usedBytes": "0", "entries": 0}, PermissionError("denied")]):
                with self.assertRaises(PermissionError):
                    sampler.collect()
            self.assertEqual(output.read_text(encoding="utf-8"), '{"previous":"good"}')


if __name__ == "__main__":
    unittest.main()

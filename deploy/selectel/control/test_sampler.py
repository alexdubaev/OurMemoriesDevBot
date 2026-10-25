import importlib.util
import json
import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path


MODULE = Path(__file__).with_name("sampler.py")
SPEC = importlib.util.spec_from_file_location("memoly_control_sampler", MODULE)
sampler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sampler)


class HostSamplerTests(unittest.TestCase):
    def test_synthetic_inventory_ignores_symlinks_and_reports_only_bounded_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            host, media, backups, output = (root / "host", root / "media", root / "backups", root / "diagnostics" / "control" / "snapshot.json")
            for path in (host, media, backups):
                path.mkdir(parents=True)
            (media / "one.bin").write_bytes(b"12345")
            external = root / "private.bin"
            external.write_bytes(b"x" * 99)
            try:
                (media / "link.bin").symlink_to(external)
            except OSError:
                pass
            sampler.ROOT, sampler.MEDIA, sampler.BACKUPS, sampler.OUTPUT = map(str, (host, media, backups, output))
            sampler.EVIDENCE = str(backups / "control-evidence.json")
            fs = type("StatVfs", (), {"f_frsize": 4096, "f_bsize": 4096, "f_blocks": 10, "f_bfree": 4, "f_bavail": 3})()
            with mock.patch.object(sampler.os, "statvfs", create=True, return_value=fs), \
                 mock.patch.object(sampler.os, "fchmod", create=True):
                sampler.collect()
            result = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(result["media"]["usedBytes"], "5")
            self.assertEqual(result["media"]["entries"], 1)
            self.assertEqual(set(result), {"version", "observedAt", "mediaObservedAt", "backupStorageObservedAt", "filesystems", "media", "backupStorage", "backup"})
            self.assertNotIn("private.bin", json.dumps(result))
            self.assertTrue(output.stat().st_mode & 0o444)

    def test_backup_metadata_allowlist_rejects_paths_and_filenames(self):
        with tempfile.TemporaryDirectory() as temporary:
            evidence = Path(temporary) / "control-evidence.json"
            sampler.EVIDENCE = str(evidence)
            evidence.write_text(json.dumps({"artifactAt": "2026-10-25T10:00:00Z", "validation": "valid", "restoreTestAt": None, "path": "/private"}), encoding="utf-8")
            self.assertEqual(sampler.backup_evidence(), {"artifactAt": None, "validation": "unknown", "restoreTestAt": None})

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
            root=Path(temporary)
            host,media,backups,output=(root/'host',root/'media',root/'backups',root/'diagnostics'/'control'/'snapshot.json')
            for path in (host,media,backups): path.mkdir(parents=True)
            output.parent.mkdir(parents=True)
            output.write_text('{"previous":"good"}',encoding='utf-8')
            sampler.ROOT,sampler.MEDIA,sampler.BACKUPS,sampler.OUTPUT=map(str,(host,media,backups,output))
            sampler.EVIDENCE=str(backups/'control-evidence.json')
            fs=type('StatVfs',(),{'f_frsize':4096,'f_bsize':4096,'f_blocks':10,'f_bfree':4,'f_bavail':3})()
            with mock.patch.object(sampler.os,'statvfs',create=True,return_value=fs), \
                 mock.patch.object(sampler.os,'fchmod',create=True), \
                 mock.patch.object(sampler,'inventory',side_effect=[{'usedBytes':'0','entries':0},PermissionError('denied')]):
                with self.assertRaises(PermissionError): sampler.collect()
            self.assertEqual(output.read_text(encoding='utf-8'),' {"previous":"good"}'.strip())


if __name__ == "__main__":
    unittest.main()

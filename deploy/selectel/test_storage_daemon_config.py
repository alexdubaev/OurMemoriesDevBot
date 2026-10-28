"""Tests for the guarded Docker daemon config candidate generator."""

from __future__ import annotations

import importlib.util
import json
import os
import stat
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


SCRIPT = Path(__file__).with_name("storage-daemon-config.py")
SPEC = importlib.util.spec_from_file_location("storage_daemon_config", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class StorageDaemonConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.source = self.root / "daemon.json"
        self.output = self.root / "candidate.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_source(self, contents: str) -> None:
        self.source.write_text(contents, encoding="utf-8")

    def prepare(self) -> dict[str, object]:
        MODULE.prepare_config(self.source, self.output)
        return json.loads(self.output.read_text(encoding="utf-8"))

    def test_preserves_unrelated_config_and_writes_private_candidate(self) -> None:
        self.write_source(json.dumps({
            "log-driver": "local",
            "log-opts": {"max-size": "15m", "max-file": "3"},
            "features": {"containerd-snapshotter": False},
            "live-restore": False,
            "builder": {"gc": {"enabled": False, "defaultKeepStorage": "99GB"}, "other": "keep"},
        }))

        candidate = self.prepare()

        self.assertEqual(candidate["log-driver"], "local")
        self.assertEqual(candidate["log-opts"], {"max-size": "15m", "max-file": "3"})
        self.assertEqual(candidate["features"], {"containerd-snapshotter": False})
        self.assertTrue(candidate["live-restore"])
        self.assertEqual(candidate["builder"], {
            "gc": {"enabled": True, "defaultKeepStorage": "2GB"},
            "other": "keep",
        })
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertIn('"live-restore": false', self.source.read_text(encoding="utf-8"))

    def test_rejects_invalid_json_duplicate_keys_and_nonobject_roots(self) -> None:
        for contents in ("{", '{"x": 1, "x": 2}', "[]", "null"):
            with self.subTest(contents=contents):
                self.write_source(contents)
                with self.assertRaises(MODULE.ConfigError):
                    MODULE.prepare_config(self.source, self.output)
                self.assertFalse(self.output.exists())

    def test_rejects_incompatible_or_custom_gc_config(self) -> None:
        for contents in ('{"builder": []}', '{"builder": {"gc": []}}',
                         '{"builder": {"gc": {"policy": []}}}'):
            with self.subTest(contents=contents):
                self.write_source(contents)
                with self.assertRaises(MODULE.ConfigError):
                    MODULE.prepare_config(self.source, self.output)
                self.assertFalse(self.output.exists())

    def test_rejects_symlinked_input_and_parent_paths(self) -> None:
        self.write_source("{}")
        input_link = self.root / "source-link.json"
        try:
            input_link.symlink_to(self.source)
        except (OSError, NotImplementedError):
            self.skipTest("symbolic links are unavailable on this filesystem")
        with self.assertRaises(MODULE.ConfigError):
            MODULE.prepare_config(input_link, self.output)

        parent_link = self.root / "parent-link"
        parent_link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(MODULE.ConfigError):
            MODULE.prepare_config(self.source, parent_link / "candidate.json")

    def test_rejects_existing_output_and_output_symlink(self) -> None:
        self.write_source("{}")
        self.output.write_text("preserve", encoding="utf-8")
        with self.assertRaises(MODULE.ConfigError):
            MODULE.prepare_config(self.source, self.output)
        self.assertEqual(self.output.read_text(encoding="utf-8"), "preserve")

        self.output.unlink()
        target = self.root / "existing-target.json"
        target.write_text("preserve", encoding="utf-8")
        try:
            self.output.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("symbolic links are unavailable on this filesystem")
        with self.assertRaises(MODULE.ConfigError):
            MODULE.prepare_config(self.source, self.output)
        self.assertEqual(target.read_text(encoding="utf-8"), "preserve")

    def test_reapplying_to_generated_config_keeps_values_idempotent(self) -> None:
        self.write_source('{"log-driver":"local","builder":{"gc":{"enabled":false}}}')
        first = self.prepare()
        second_source = self.root / "candidate.json"
        second_output = self.root / "candidate-again.json"

        MODULE.prepare_config(second_source, second_output)

        second = json.loads(second_output.read_text(encoding="utf-8"))
        self.assertEqual(first, second)
        self.assertEqual(second["builder"]["gc"], {"enabled": True, "defaultKeepStorage": "2GB"})
        self.assertTrue(second["live-restore"])

    @unittest.skipUnless(os.name == "posix", "Linux daemon activation")
    def test_atomic_activation_preserves_mode_and_old_config_on_failed_replace(self) -> None:
        self.write_source('{"log-driver":"local"}')
        self.source.chmod(0o640)
        candidate = self.prepare()
        previous = self.source.read_bytes()
        with patch.object(MODULE.os, "replace", side_effect=OSError("injected I/O failure")):
            with self.assertRaises(OSError):
                MODULE.activate_config(str(self.output), str(self.source))
        self.assertEqual(self.source.read_bytes(), previous)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["candidate.json", "daemon.json"])
        MODULE.activate_config(str(self.output), str(self.source))
        self.assertEqual(json.loads(self.source.read_text()), candidate)
        self.assertEqual(stat.S_IMODE(self.source.stat().st_mode), 0o640)


if __name__ == "__main__":
    unittest.main()

"""Read-only Holographic Projects checks: folder search, model bytes, layouts."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app.api import files as files_api
from app.db.database import Database
from app.db.store import IntentStore
from app.files.paths import PathAccessError
from app.files.service import FileService
from app.files.store import FileStore
from app.modules import PermissionManager
from app.modules.registry import MODULE_BY_ID
from app.modules.service import _ENFORCED


class HoloFileServiceTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self._tmp.name))
        self.engineering = self.root / "Engineering"
        self.engineering.mkdir()
        (self.engineering / "Engineer notes.md").write_text("# Notes", encoding="utf-8")
        (self.engineering / "diagram.glb").write_bytes(b"glTF-not-real")
        (self.engineering / "scene.gltf").write_text("{}", encoding="utf-8")
        (self.engineering / "mesh.bin").write_bytes(b"binary")
        (self.engineering / "install.bat").write_text("echo nope", encoding="utf-8")
        (self.engineering / "Engineering Archive").mkdir()
        (self.root / "Personal").mkdir()
        (self.root / "node_modules").mkdir()

        database = Database(self.root / "holo-test.sqlite3")
        self.audit = IntentStore(database)
        self.service = FileService(FileStore(database), self.audit)
        self.service.add_root(str(self.engineering))
        self.permissions = PermissionManager(self.audit)

    def tearDown(self):
        self._tmp.cleanup()

    def test_folder_search_returns_directories_only(self):
        result = self.service.search("engineering", kind="folder")
        names = [item["name"] for item in result["matches"]]
        self.assertIn("Engineering Archive", names)
        self.assertNotIn("Engineer notes.md", names)
        for item in result["matches"]:
            self.assertEqual(item["type"], "folder")
            self.assertEqual(item["kind"], "folder")

    def test_default_search_still_returns_files_not_directories(self):
        result = self.service.search("engineer")
        self.assertEqual([item["name"] for item in result["matches"]], ["Engineer notes.md"])

    def test_model_read_accepts_glb_and_gltf_only(self):
        data, media = self.service.read_model(str(self.engineering / "diagram.glb"))
        self.assertEqual(data, b"glTF-not-real")
        self.assertEqual(media, "model/gltf-binary")
        _, gltf_media = self.service.read_model(str(self.engineering / "scene.gltf"))
        self.assertEqual(gltf_media, "model/gltf+json")
        with self.assertRaises(PathAccessError):
            self.service.read_model(str(self.engineering / "Engineer notes.md"))
        events = {row["event"] for row in self.audit.list_audit(20)}
        self.assertIn("file_read", events)

    def test_raw_read_allows_sidecars_and_blocks_scripts(self):
        data, _ = self.service.read_raw(str(self.engineering / "mesh.bin"))
        self.assertEqual(data, b"binary")
        with self.assertRaises(PathAccessError):
            self.service.read_raw(str(self.engineering / "install.bat"))

    def test_model_read_outside_allowed_root_is_rejected(self):
        outside = Path(os.path.realpath(tempfile.mkdtemp()))
        try:
            target = outside / "outside.glb"
            target.write_bytes(b"nope")
            with self.assertRaises(PathAccessError):
                self.service.read_model(str(target))
        finally:
            try:
                outside.rmdir()
            except OSError:
                pass

    def test_holo_layout_is_preserved_and_sanitized(self):
        cards = [
            {
                "id": "holo-1",
                "path": str(self.engineering),
                "x": 0,
                "y": 0,
                "w": 100,
                "h": 100,
                "z": 1,
                "holo": {
                    "root": str(self.engineering),
                    "expanded": [str(self.engineering), 42, str(self.engineering / "Engineering Archive")],
                    "camera": {"position": [1, 2, 3], "target": [0, 0, 0]},
                    "filterImages": True,
                    "unexpected": "ignored",
                },
            }
        ]
        saved = self.service.save_layout("holo-layout", "Engineering view", cards)
        holo = saved["cards"][0]["holo"]
        self.assertEqual(holo["root"], str(self.engineering))
        self.assertEqual(len(holo["expanded"]), 2)
        self.assertEqual(holo["camera"], {"position": [1.0, 2.0, 3.0], "target": [0.0, 0.0, 0.0]})
        self.assertTrue(holo["filterImages"])
        self.assertNotIn("unexpected", holo)

    def test_layout_without_holo_stays_compatible(self):
        saved = self.service.save_layout(
            "plain",
            "Plain",
            [{"id": "c1", "path": "C:\\Allowed\\a.md"}],
        )
        self.assertNotIn("holo", saved["cards"][0])


class HoloPermissionAndSurfaceTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        database = Database(Path(self._tmp.name) / "perms.sqlite3")
        self.permissions = PermissionManager(IntentStore(database))

    def tearDown(self):
        self._tmp.cleanup()

    def test_module_is_registered_and_enforced(self):
        module = MODULE_BY_ID.get("holo-projects")
        self.assertIsNotNone(module)
        self.assertEqual(module.name, "Holographic Projects")
        self.assertEqual(module.permissions, ("file_access",))
        self.assertIn(("holo-projects", "file_access"), _ENFORCED)

    def test_either_module_grant_unlocks_the_shared_read_api(self):
        with mock.patch.object(files_api, "get_permissions", return_value=self.permissions):
            with self.assertRaises(HTTPException) as denied:
                files_api._enforce()
            self.assertEqual(denied.exception.status_code, 403)

            self.permissions.set_permission("holo-projects", "file_access", True)
            files_api._enforce()

    def test_no_file_write_endpoint_exists(self):
        from app.main import app

        write_methods = {"PUT", "PATCH", "DELETE"}
        offenders = []
        for route in app.routes:
            path = getattr(route, "path", "")
            methods = set(getattr(route, "methods", set()) or set())
            if not path.startswith("/files/"):
                continue
            # Revoking a folder grant is configuration, not a file write.
            if path == "/files/roots" and methods == {"DELETE"}:
                continue
            if methods & write_methods:
                offenders.append((path, sorted(methods)))
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()

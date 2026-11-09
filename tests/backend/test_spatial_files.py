import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.db.database import Database
from app.db.store import IntentStore
from app.files.paths import (
    PathAccessError,
    ensure_openable,
    is_openable,
    is_within,
    normalize_root,
    resolve_allowed,
)
from app.files.service import FileService, PreviewUnavailable
from app.files.store import FileStore
from app.modules import PermissionDenied, PermissionManager


class PathSafetyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self._tmp.name))
        self.outside = Path(os.path.realpath(tempfile.mkdtemp()))

    def tearDown(self):
        self._tmp.cleanup()
        try:
            self.outside.rmdir()
        except OSError:
            pass

    def test_relative_and_empty_paths_are_rejected(self):
        with self.assertRaises(PathAccessError):
            normalize_root("documents")
        with self.assertRaises(PathAccessError):
            resolve_allowed("file.txt", [self.root])
        with self.assertRaises(PathAccessError):
            resolve_allowed("", [self.root])

    @unittest.skipUnless(os.name == "nt", "drive roots only exist on Windows")
    def test_drive_root_is_not_allowed(self):
        with self.assertRaises(PathAccessError):
            normalize_root(Path(self.root).anchor)

    def test_parent_traversal_cannot_escape_allowed_root(self):
        allowed = self.root / "allowed"
        allowed.mkdir()
        secret = self.root / "secret.txt"
        secret.write_text("private", encoding="utf-8")
        with self.assertRaises(PathAccessError):
            resolve_allowed(str(allowed / ".." / "secret.txt"), [allowed])

    def test_path_outside_root_is_rejected(self):
        file = self.outside / "note.txt"
        file.write_text("x", encoding="utf-8")
        with self.assertRaises(PathAccessError):
            resolve_allowed(str(file), [self.root])

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_symlink_escape_is_rejected(self):
        link = self.root / "escape"
        target = self.outside / "linked.txt"
        target.write_text("x", encoding="utf-8")
        try:
            link.symlink_to(target)
        except OSError as exc:
            self.skipTest(f"symlink creation not permitted: {exc}")
        with self.assertRaises(PathAccessError):
            resolve_allowed(str(link), [self.root])

    def test_realpath_escape_is_rejected_even_without_link_privileges(self):
        """Windows without developer mode cannot create symlinks, so this test
        simulates the exact realpath result a symlink would produce."""
        link = self.root / "escape.txt"
        target = self.outside / "linked.txt"
        target.write_text("x", encoding="utf-8")
        link.write_text("placeholder", encoding="utf-8")
        realpath = os.path.realpath

        def fake_realpath(path):
            if os.path.normcase(str(path)) == os.path.normcase(str(link)):
                return str(target)
            return realpath(path)

        with mock.patch("app.files.paths.os.path.realpath", side_effect=fake_realpath):
            with self.assertRaises(PathAccessError):
                resolve_allowed(str(link), [self.root])

    @unittest.skipUnless(os.name == "nt", "drive comparison only exists on Windows")
    def test_different_drives_are_not_within(self):
        other = "Z:\\not-bozz\\file.txt"
        self.assertFalse(is_within(other, self.root))

    def test_executables_are_never_openable(self):
        for name in ("run.exe", "run.bat", "run.cmd", "run.ps1", "run.sh", "run.js", "run.lnk"):
            path = self.root / name
            path.write_text("nope", encoding="utf-8")
            self.assertFalse(is_openable(path), name)
            with self.assertRaises(PathAccessError):
                ensure_openable(path)
        text = self.root / "notes.txt"
        text.write_text("ok", encoding="utf-8")
        ensure_openable(text)


class FileServiceTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self._tmp.name))
        library = self.root / "Library"
        library.mkdir()
        (library / "Engineering notes.md").write_text("# Notes", encoding="utf-8")
        (library / "photo.png").write_bytes(b"not-a-real-image")
        deps = library / "node_modules"
        deps.mkdir()
        (deps / "engineering-secret.js").write_text("hidden", encoding="utf-8")
        deep = library / "Projects"
        deep.mkdir()
        (deep / "logo.svg").write_text("<svg/>", encoding="utf-8")
        self.library = library

        database = Database(Path(self.root) / "bozz-test.sqlite3")
        self.audit = IntentStore(database)
        self.store = FileStore(database)
        self.service = FileService(self.store, self.audit)
        self.permissions = PermissionManager(self.audit)
        self.permissions.set_permission("spatial-desktop", "file_access", True)

    def tearDown(self):
        self._tmp.cleanup()

    def test_folder_grant_is_persisted_and_audited(self):
        self.service.add_root(str(self.library))
        self.assertEqual([item["path"] for item in self.service.roots()], [str(self.library)])
        events = {row["event"] for row in self.audit.list_audit(20)}
        self.assertIn("folder_grant", events)
        self.assertTrue(self.service.remove_root(str(self.library)))
        self.assertEqual(self.service.roots(), [])

    def test_listing_reports_real_entries(self):
        self.service.add_root(str(self.library))
        listing = self.service.list_dir(str(self.library))
        names = [entry["name"] for entry in listing["entries"]]
        self.assertIn("Engineering notes.md", names)
        note = next(entry for entry in listing["entries"] if entry["name"].endswith(".md"))
        self.assertEqual(note["kind"], "markdown")
        self.assertTrue(note["openable"])

    def test_search_skips_dependency_folders(self):
        self.service.add_root(str(self.library))
        result = self.service.search("engineering")
        self.assertEqual([item["name"] for item in result["matches"]], ["Engineering notes.md"])
        self.assertFalse(result["cached"])

    def test_search_respects_kind_filter_and_cache(self):
        self.service.add_root(str(self.library))
        first = self.service.search("photo", kind="image")
        self.assertEqual(first["count"], 1)
        second = self.service.search("photo", kind="image")
        self.assertTrue(second["cached"])

    def test_search_can_sort_by_latest_modified(self):
        self.service.add_root(str(self.library))
        older = self.library / "latest-old.png"
        newer = self.library / "latest-new.png"
        older.write_bytes(b"old")
        newer.write_bytes(b"new")
        os.utime(older, (1_600_000_000, 1_600_000_000))
        os.utime(newer, (1_700_000_000, 1_700_000_000))
        os.utime(self.library / "photo.png", (1_500_000_000, 1_500_000_000))
        result = self.service.search("latest", kind="image", sort="recent")
        self.assertEqual([item["name"] for item in result["matches"]], ["latest-new.png", "latest-old.png"])
        latest = self.service.search("", kind="image", sort="recent", limit=1)
        self.assertEqual(latest["matches"][0]["name"], "latest-new.png")

    def test_find_task_is_read_only_and_reports_real_matches(self):
        self.service.add_root(str(self.library))
        task = self.service.create_find_task("logo")
        self.assertEqual(task["status"], "reported")
        self.assertFalse(task["approval_required"])
        self.assertEqual(task["approval_state"], "not_requested")
        self.assertTrue(task["done_allowed"])
        self.assertEqual(task["verification_evidence"][0]["source"], "filesystem")
        self.assertEqual([item["name"] for item in task["matches"]], ["logo.svg"])
        events = {row["event"] for row in self.audit.list_audit(20)}
        self.assertIn("search", events)

    def test_find_task_reports_no_matches_honestly(self):
        self.service.add_root(str(self.library))
        task = self.service.create_find_task("does-not-exist-anywhere")
        self.assertEqual(task["status"], "reported")
        self.assertEqual(task["matches"], [])
        self.assertIn("No files matching", task["message"])

    def test_cancelled_search_reports_cancellation(self):
        self.service.add_root(str(self.library))
        result = self.service.search("anything", cancelled=lambda: True)
        self.assertTrue(result["cancelled"])

    def test_text_preview_is_limited(self):
        self.service.add_root(str(self.library))
        big = self.library / "big.txt"
        big.write_text("a" * 5_000, encoding="utf-8")
        preview = self.service.preview(str(big))
        self.assertEqual(preview["preview_kind"], "text")
        self.assertEqual(len(preview["text"]), 4 * 1024)
        self.assertTrue(preview["truncated"])

    def test_image_preview_and_thumbnail(self):
        from PIL import Image

        self.service.add_root(str(self.library))
        image_path = self.library / "real.png"
        Image.new("RGB", (900, 600), (20, 40, 60)).save(image_path)
        preview = self.service.preview(str(image_path))
        self.assertEqual(preview["preview_kind"], "image")
        self.assertIn("/api/files/thumbnail", preview["thumbnail_url"])
        data, digest = self.service.thumbnail(str(image_path))
        self.assertTrue(data.startswith(b"\x89PNG"))
        self.assertEqual(len(digest), 64)
        with self.assertRaises(PreviewUnavailable):
            self.service.thumbnail(str(self.library / "Engineering notes.md"))

    def test_folder_preview_reports_folder_without_listing_children(self):
        self.service.add_root(str(self.library))
        preview = self.service.preview(str(self.library / "Projects"))
        self.assertEqual(preview["type"], "folder")
        self.assertEqual(preview["kind"], "folder")
        self.assertEqual(preview["preview_kind"], "icon")
        self.assertIn("Folder", preview["reason"])
        self.assertNotIn("entries", preview)

    def test_open_task_requires_approval_and_records_audit(self):
        self.service.add_root(str(self.library))
        task = self.service.create_open_task(str(self.library / "Engineering notes.md"))
        self.assertEqual(task["status"], "awaiting_approval")
        self.assertEqual(task["module"], "spatial-desktop")
        self.assertTrue(task["approval_required"])
        self.assertFalse(task["done_allowed"])
        events = {row["event"] for row in self.audit.list_audit(20)}
        self.assertIn("open_request", events)
        with self.assertRaises(PathAccessError):
            self.service.approve_open(task["id"], "wrong-challenge-value", True)

    def test_executable_open_task_is_blocked(self):
        self.service.add_root(str(self.library))
        script = self.library / "install.bat"
        script.write_text("echo nope", encoding="utf-8")
        with self.assertRaises(PathAccessError):
            self.service.create_open_task(str(script))

    def test_approved_open_verifies_with_filesystem_evidence(self):
        self.service.add_root(str(self.library))
        target = self.library / "Engineering notes.md"
        task = self.service.create_open_task(str(target))
        with mock.patch.object(self.service, "_open_with_os") as opener:
            result = self.service.approve_open(task["id"], task["approval_id"], True)
        opener.assert_called_once()
        self.assertEqual(result["status"], "reported")
        self.assertTrue(result["done_allowed"])
        self.assertEqual(result["verification_evidence"][0]["source"], "filesystem")
        self.assertTrue(target.is_file())

    def test_permission_is_off_by_default_and_gates_reads(self):
        fresh_db = Database(Path(self.root) / "fresh.sqlite3")
        fresh_permissions = PermissionManager(IntentStore(fresh_db))
        with self.assertRaises(PermissionDenied):
            fresh_permissions.enforce("spatial-desktop", ["file_access"])


class LayoutStoreTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        database = Database(Path(self._tmp.name) / "layouts.sqlite3")
        self.service = FileService(FileStore(database), IntentStore(database))

    def tearDown(self):
        self._tmp.cleanup()

    def test_layout_round_trip_and_rename(self):
        cards = [
            {"id": "c1", "path": "C:\\Allowed\\notes.md", "x": 10, "y": 20, "w": 200, "h": 150, "z": 1}
        ]
        saved = self.service.save_layout("layout-1", "Work", cards)
        self.assertEqual(saved["name"], "Work")
        self.assertEqual(saved["cards"][0]["path"], "C:\\Allowed\\notes.md")
        self.assertEqual(len(self.service.list_layouts()), 1)
        renamed = self.service.rename_layout("layout-1", "Work v2")
        self.assertEqual(renamed["name"], "Work v2")
        loaded = self.service.get_layout("layout-1")
        self.assertEqual(loaded["cards"][0]["id"], "c1")
        self.assertTrue(self.service.delete_layout("layout-1"))
        self.assertIsNone(self.service.get_layout("layout-1"))

    def test_layout_rejects_too_many_cards(self):
        cards = [{"id": f"c{i}", "path": "C:\\x"} for i in range(501)]
        with self.assertRaises(ValueError):
            self.service.save_layout("too-big", "Too big", cards)


if __name__ == "__main__":
    unittest.main()

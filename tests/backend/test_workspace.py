import tempfile
import unittest
from pathlib import Path

from app.tools.workspace import (
    ConflictError,
    InvalidPathError,
    PathEscapeError,
    TooLargeError,
    WorkspaceTools,
)


class WorkspaceSandboxTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name) / "workspace"
        self.tools = WorkspaceTools(
            self.root,
            max_read_bytes=64,
            max_write_bytes=64,
            max_search_results=5,
        )

    def tearDown(self):
        self._temp.cleanup()

    def test_relative_paths_outside_the_workspace_are_rejected(self):
        for path in ("../outside.txt", "../../secret.txt", "demo/../../outside.txt"):
            with self.subTest(path=path), self.assertRaises(PathEscapeError):
                self.tools.check_path(path)

    def test_absolute_windows_and_unc_paths_are_rejected(self):
        for path in ("/etc/passwd", "C:/Windows/win.ini", r"C:\Windows", "~/.ssh/id_rsa", r"\\server\share\file"):
            with self.subTest(path=path), self.assertRaises(PathEscapeError):
                self.tools.check_path(path)

    def test_internal_and_malformed_paths_are_rejected(self):
        for path in (".trash/old.txt", "notes.txt:secret", "", "   "):
            with self.subTest(path=path), self.assertRaises(InvalidPathError):
                self.tools.check_path(path)

    def test_write_read_roundtrip_and_verification(self):
        result = self.tools.write_file("demo/hello.txt", "Hello from BOZZ")
        self.assertTrue(result["created"])
        self.assertEqual(result["bytes_written"], 15)

        read_back = self.tools.read_file("demo/hello.txt")
        self.assertEqual(read_back["content"], "Hello from BOZZ")
        self.assertEqual(read_back["sha256"], result["sha256"])

        action = {"type": "workspace.write", "target": "demo/hello.txt", "payload": {"content": "Hello from BOZZ", "overwrite": False}}
        ok, detail = self.tools.verify(action, result)
        self.assertTrue(ok, detail)

    def test_write_does_not_silently_overwrite(self):
        self.tools.write_file("notes.txt", "first")
        with self.assertRaises(ConflictError):
            self.tools.write_file("notes.txt", "second")

        result = self.tools.write_file("notes.txt", "second", overwrite=True)
        self.assertTrue(result["overwritten"])
        self.assertIsNotNone(result["backup"])
        backup = self.root / result["backup"]
        self.assertTrue(backup.is_file())
        self.assertEqual(backup.read_text(encoding="utf-8"), "first")
        self.assertEqual(self.tools.read_file("notes.txt")["content"], "second")

    def test_size_limits_are_enforced(self):
        with self.assertRaises(TooLargeError):
            self.tools.write_file("big.txt", "x" * 65)
        self.tools.write_file("small.txt", "x" * 60)
        with self.assertRaises(TooLargeError):
            self.tools.append_file("small.txt", "y" * 10)

    def test_append_and_binary_rejection(self):
        self.tools.append_file("log.txt", "line one\n")
        result = self.tools.append_file("log.txt", "line two\n")
        self.assertEqual(result["total_bytes"], 18)
        self.assertEqual(self.tools.read_file("log.txt")["content"], "line one\nline two\n")

        binary = self.root / "image.bin"
        binary.write_bytes(b"\x89PNG\x00\x01")
        with self.assertRaises(ConflictError):
            self.tools.read_file("image.bin")

    def test_delete_moves_to_trash_and_verifies(self):
        self.tools.write_file("keep/remove.txt", "data")
        result = self.tools.delete_path("keep/remove.txt")
        self.assertFalse((self.root / "keep/remove.txt").exists())
        self.assertTrue((self.root / result["trash_path"]).is_file())

        action = {"type": "workspace.delete", "target": "keep/remove.txt", "payload": {}}
        ok, detail = self.tools.verify(action, result)
        self.assertTrue(ok, detail)

    def test_move_verifies_and_refuses_conflicts(self):
        self.tools.write_file("a.txt", "alpha")
        self.tools.write_file("b.txt", "beta")
        result = self.tools.move_path("a.txt", "renamed/a.txt")
        self.assertTrue((self.root / "renamed/a.txt").is_file())
        action = {"type": "workspace.move", "target": "a.txt", "payload": {"destination": "renamed/a.txt"}}
        ok, detail = self.tools.verify(action, result)
        self.assertTrue(ok, detail)

        with self.assertRaises(ConflictError):
            self.tools.move_path("renamed/a.txt", "b.txt")

    def test_list_and_search_skip_internal_trash(self):
        self.tools.write_file("notes/todo.txt", "buy gold")
        self.tools.write_file("notes/done.txt", "buy nothing")
        listing = self.tools.list_dir(".")
        self.assertIn("notes", [entry["name"] for entry in listing["entries"]])

        matches = self.tools.search("gold", ".")
        self.assertEqual(matches["count"], 1)
        self.assertEqual(matches["matches"][0]["path"], "notes/todo.txt")

        self.tools.delete_path("notes/todo.txt")
        self.assertEqual(self.tools.search("gold", ".")["count"], 0)
        names = [entry["name"] for entry in self.tools.list_dir(".")["entries"]]
        self.assertNotIn(".trash", names)

    def test_stats_excludes_trash(self):
        self.tools.write_file("one.txt", "1")
        self.tools.write_file("two.txt", "22")
        before = self.tools.stats()
        self.assertEqual(before["files"], 2)
        self.assertEqual(before["bytes"], 3)
        self.tools.delete_path("two.txt")
        after = self.tools.stats()
        self.assertEqual(after["files"], 1)
        self.assertEqual(after["bytes"], 1)


if __name__ == "__main__":
    unittest.main()

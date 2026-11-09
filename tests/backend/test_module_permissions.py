import tempfile
import unittest
from pathlib import Path

from app.db.database import Database
from app.db.store import IntentStore
from app.modules import MODULES, ModuleService, PermissionDenied, PermissionManager
from app.modules.permissions import PermissionError as ModulePermissionError


class ModulePermissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = IntentStore(Database(Path(self.temp.name) / "bozz.sqlite3"))
        self.manager = PermissionManager(self.store, clock=lambda: "2026-01-01T00:00:00+00:00")

    def test_every_declared_permission_is_off_by_default(self):
        self.assertEqual(len(MODULES), 10)
        self.assertIn("holo-projects", {module.id for module in MODULES})
        for module in MODULES:
            grants = self.manager.grants(module.id)
            self.assertEqual(set(grants), set(module.permissions))
            self.assertFalse(any(grants.values()), f"{module.id} started granted")

    def test_grant_and_revoke_persist_and_are_audited(self):
        result = self.manager.set_permission("intent-map", "file_access", True)
        self.assertTrue(result["granted"])
        self.assertTrue(self.manager.is_granted("intent-map", "file_access"))

        recreated = PermissionManager(self.store)
        self.assertTrue(recreated.is_granted("intent-map", "file_access"))

        recreated.set_permission("intent-map", "file_access", False)
        self.assertFalse(recreated.is_granted("intent-map", "file_access"))
        events = [(entry["event"], entry["outcome"]) for entry in self.store.list_audit(20)]
        self.assertIn(("permission_grant", "granted"), events)
        self.assertIn(("permission_revoke", "revoked"), events)

    def test_declared_permissions_only(self):
        with self.assertRaises(ModulePermissionError):
            self.manager.set_permission("hgi", "file_access", True)
        with self.assertRaises(ModulePermissionError):
            self.manager.set_permission("not-a-module", "file_access", True)
        with self.assertRaises(ModulePermissionError):
            self.manager.set_permission("hgi", "not-a-permission", True)

    def test_enforce_raises_and_records_a_real_denial(self):
        with self.assertRaises(PermissionDenied) as caught:
            self.manager.enforce("intent-map", ["file_access"], intent_id="intent-1")
        self.assertEqual(caught.exception.missing, ["file_access"])
        self.assertIn("File access folder permission is off", str(caught.exception))
        self.assertEqual(self.manager.recent_denials(5)[0]["event"], "permission_denied")

        self.manager.set_permission("intent-map", "file_access", True)
        self.manager.enforce("intent-map", ["file_access"])

    def test_module_service_reports_all_modules_and_enforcement(self):
        service = ModuleService(self.manager)
        snapshot = service.snapshot()
        self.assertEqual(snapshot["registry_version"], "1.0.0")
        self.assertEqual({item["id"] for item in snapshot["modules"]}, {module.id for module in MODULES})
        allowed = {"Not connected", "Simulation", "Ready", "Error"}
        self.assertTrue({item["status"] for item in snapshot["modules"]} <= allowed)

        intent_map = service.module("intent-map")
        file_access = next(item for item in intent_map["permissions"] if item["id"] == "file_access")
        self.assertFalse(file_access["granted"])
        self.assertTrue(file_access["enforced"])

        updated = service.set_permission("intent-map", "file_access", True)
        self.assertTrue(updated["permissions"][0]["granted"])


if __name__ == "__main__":
    unittest.main()

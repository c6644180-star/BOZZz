from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.bids.service import BidService
from app.db.database import Database
from app.db.store import IntentStore
from app.identities.service import IdentityService
from app.preferences.service import PreferenceService


class ManagementServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database = Database(Path(self.temp_dir.name) / "bozz-test.db")
        database.initialize()
        self.store = IntentStore(database)
        self.identities = IdentityService(self.store)
        self.preferences = PreferenceService(self.store)
        self.bids = BidService(self.store)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_identity_create_update_switch_archive_and_delete(self) -> None:
        first = self.identities.create_identity(owner_id="owner-a", name="Default")
        second = self.identities.create_identity(owner_id="owner-a", name="Research")
        self.assertEqual(self.identities.get_identity(first.id)["name"], "Default")

        renamed = self.identities.rename_identity(first.id, "Personal")
        self.assertEqual(renamed["name"], "Personal")
        edited = self.identities.edit_identity(first.id, greeting="Ready")
        self.assertEqual(edited["greeting"], "Ready")

        switched = self.identities.switch_identity(first.id, caller_owner_id="owner-a")
        self.assertIn("memory_boundary_report", switched)
        with self.assertRaises(PermissionError):
            self.identities.switch_identity(first.id, caller_owner_id="owner-b")

        self.assertTrue(self.identities.delete_identity(first.id, caller_owner_id="owner-a"))
        archived = self.identities.archive_identity(second.id, caller_owner_id="owner-a")
        self.assertEqual(archived["status"], "archived")

    def test_preference_profile_requires_owned_identity_and_persists(self) -> None:
        identity = self.identities.create_identity(owner_id="owner-a", name="Default")
        with self.assertRaises(PermissionError):
            self.preferences.create_preference_profile(
                owner_id="owner-b", identity_id=identity.id, name="Wrong owner"
            )

        profile = self.preferences.create_preference_profile(
            owner_id="owner-a",
            identity_id=identity.id,
            name="Work",
            visual_preferences={"theme": "dark"},
        )
        self.assertEqual(profile["visual_preferences"], {"theme": "dark"})
        updated = self.preferences.edit_preference_profile(
            profile["id"], visual_preferences={"theme": "light"}
        )
        self.assertEqual(updated["visual_preferences"], {"theme": "light"})
        self.assertEqual(len(self.preferences.list_preference_profiles(owner_id="owner-a")), 1)
        with self.assertRaises(PermissionError):
            self.preferences.apply_preference_change(profile["id"], caller_owner_id="owner-a")
        reset = self.preferences.reset_preference_profile(
            profile["id"], caller_owner_id="owner-a"
        )
        self.assertEqual(reset["visual_preferences"], {})
        self.assertTrue(
            self.preferences.delete_preference_profile(
                profile["id"], caller_owner_id="owner-a"
            )
        )

    def test_bid_create_filters_edit_archive_and_delete(self) -> None:
        first = self.bids.create_bid(
            owner_id="owner-a", title="Gesture control", description="Hands-free desktop",
            category="desktop", intended_outcome="Control BOZZ with gestures",
        )
        self.bids.create_bid(
            owner_id="owner-a", title="Market analyzer", description="Market research",
            category="finance",
        )
        self.bids.create_bid(
            owner_id="owner-b", title="Private idea", description="Other owner",
            category="desktop",
        )

        filtered = self.bids.list_bids(
            owner_id="owner-a", status="captured", category="desktop"
        )
        self.assertEqual([item["bid_id"] for item in filtered], [first["bid_id"]])

        edited = self.bids.edit_bid(first["bid_id"], ai_interpretation="Gesture workflow")
        self.assertEqual(edited["version"], 2)
        archived = self.bids.archive_bid(first["bid_id"], caller_owner_id="owner-a")
        self.assertEqual(archived["status"], "evolved")
        with self.assertRaises(PermissionError):
            self.bids.archive_bid(first["bid_id"], caller_owner_id="owner-b")
        self.assertTrue(self.bids.delete_bid(first["bid_id"], caller_owner_id="owner-a"))


if __name__ == "__main__":
    unittest.main()

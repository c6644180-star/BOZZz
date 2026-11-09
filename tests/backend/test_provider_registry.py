import unittest

from app.ai.base import ProviderStatus
from app.ai.registry import ProviderRegistry
from app.core.config import Settings


class FakeProvider:
    provider_name = "fake"

    def __init__(self, available: bool = True):
        self._available = available

    @property
    def configured_model(self) -> str:
        return "fake-small"

    def status(self) -> ProviderStatus:
        return ProviderStatus(self._available, self.provider_name, "fake-small", ["fake-small"])

    def chat(self, message: str, history: list[dict[str, str]]) -> str:
        return f"echo:{message}:{len(history)}"


class ProviderRegistryTests(unittest.TestCase):
    def test_registry_selects_default_and_lists_statuses(self):
        registry = ProviderRegistry({"fake": FakeProvider()})
        self.assertEqual(registry.default().provider_name, "fake")
        self.assertEqual(registry.get("fake").chat("hi", []), "echo:hi:0")
        self.assertEqual(len(registry.statuses()), 1)

    def test_registry_rejects_unknown_or_missing_default(self):
        with self.assertRaises(KeyError):
            ProviderRegistry({"fake": FakeProvider()}, default_name="missing")
        with self.assertRaises(ValueError):
            ProviderRegistry({})
        registry = ProviderRegistry({"fake": FakeProvider()})
        with self.assertRaises(KeyError):
            registry.get("other")

    def test_settings_paths_stay_inside_the_project_data_area(self):
        settings = Settings(data_dir=Settings().data_dir)
        self.assertEqual(settings.workspace_dir, settings.data_dir / "workspace")
        self.assertEqual(settings.database_path, settings.data_dir / "bozz.sqlite3")
        self.assertTrue(settings.data_dir.name == "data")


if __name__ == "__main__":
    unittest.main()

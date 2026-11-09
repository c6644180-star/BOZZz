import unittest

from app.ai.ollama import OllamaProvider
from app.core.config import Settings


class OllamaProviderTests(unittest.TestCase):
    def test_provider_reports_an_unreachable_local_service_honestly(self):
        provider = OllamaProvider(Settings(ollama_base_url="http://127.0.0.1:1", ollama_model="missing"))
        status = provider.status()
        self.assertFalse(status.available)
        self.assertEqual(status.provider, "ollama")
        self.assertEqual(status.configured_model, "missing")

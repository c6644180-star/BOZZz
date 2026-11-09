import unittest

from app.main import app


class ApiContractTests(unittest.TestCase):
    def test_required_foundation_routes_are_registered(self):
        paths = {route.path for route in app.routes if hasattr(route, "path")}
        for route in app.routes:
            router = getattr(route, "original_router", None)
            if router:
                paths.update(child.path for child in router.routes if hasattr(child, "path"))
        expected = {
            "/health",
            "/ai/status",
            "/chat",
            "/intents",
            "/intents/{intent_id}",
            "/intents/{intent_id}/approve",
            "/intents/{intent_id}/execute",
            "/intents/{intent_id}/reject",
            "/audit",
            "/workspace",
            "/modules",
            "/modules/{module_id}",
            "/modules/{module_id}/permissions",
            "/files/roots",
            "/files/list",
            "/files/search",
            "/files/find",
            "/files/preview",
            "/files/thumbnail",
            "/files/open",
            "/files/open/{intent_id}",
            "/files/open/{intent_id}/approve",
            "/spatial/layouts",
            "/spatial/layouts/{layout_id}",
            "/bci/provider",
            "/bci/provider/confirm",
            "/bci/settings",
            "/bci/style",
            "/bci/conversations",
            "/bci/conversations/delete-all",
            "/bci/conversations/{conversation_id}",
            "/bci/conversations/{conversation_id}/drafts",
            "/bci/conversations/{conversation_id}/actions",
            "/bci/import/preview",
            "/bci/import",
            "/bci/drafts/{draft_id}",
            "/desktop/status",
            "/desktop/enable",
            "/desktop/stop",
            "/ws/desktop",
        }
        self.assertTrue(expected.issubset(paths), expected - paths)

    def test_no_bci_send_route_exists(self):
        paths = {route.path for route in app.routes if hasattr(route, "path")}
        for path in paths:
            if not path.startswith("/bci"):
                continue
            self.assertNotIn("send", path.casefold(), path)
            self.assertNotIn("smtp", path.casefold(), path)


if __name__ == "__main__":
    unittest.main()

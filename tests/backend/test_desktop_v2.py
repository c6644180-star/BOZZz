import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

from app.core.config import Settings
from app.db.database import Database
from app.db.store import IntentStore
from app.desktop import DesktopController
from app.desktop.actions import (
    ActionRegistry,
    ActionValidationError,
    AllowlistError,
    AllowlistStore,
    normalize_url,
    validate_app_path,
)


class FakeDriver:
    def __init__(self, size=(1000, 800)):
        self._size = size
        self.calls = []
        self.cursor = (0, 0)

    def size(self):
        return self._size

    def move_to(self, x, y):
        self.calls.append(("move_to", x, y))
        self.cursor = (x, y)

    def cursor_position(self):
        return self.cursor

    def click(self):
        self.calls.append(("click",))

    def double_click(self):
        self.calls.append(("double_click",))

    def mouse_down(self):
        self.calls.append(("mouse_down",))

    def mouse_up(self):
        self.calls.append(("mouse_up",))

    def scroll(self, amount):
        self.calls.append(("scroll", amount))


class FakeSystem:
    def __init__(self):
        self.capabilities = {
            "mouse": True,
            "keyboard": True,
            "volume": True,
            "media": True,
            "brightness": True,
            "window": True,
            "screenshot": True,
            "app_launch": True,
        }
        self.typed = []
        self.launched = []
        self.urls = []
        self.hotkeys = []
        self.media_calls = []
        self.volume_calls = []
        self._title = "Editor"

    def volume(self, direction):
        self.volume_calls.append(direction)

    def volume_level(self):
        return 0.5

    def muted(self):
        return False

    def media(self, name):
        self.media_calls.append(name)

    def write_text(self, text):
        self.typed.append(text)

    def launch_app(self, path):
        self.launched.append(path)
        return 4321

    def pid_alive(self, pid):
        return pid == 4321

    def open_url(self, url):
        self.urls.append(url)
        return True

    def hotkey(self, keys):
        self.hotkeys.append(tuple(keys))

    def active_window_title(self):
        return self._title

    def switch_window(self):
        self._title = "Browser"

    def show_desktop(self):
        self._title = "Program Manager"

    def minimize_active(self):
        self._title = "Editor"

    def minimized(self):
        return False

    def browser(self, direction):
        self.hotkeys.append((direction,))


class DesktopV2Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.log_path = root / "desktop-actions.log"
        self.settings = Settings(
            data_dir=root,
            desktop_min_confidence=0.7,
            desktop_rate_limit=120,
            desktop_area=0.8,
            desktop_edge_margin=10,
            desktop_idle_seconds=10,
        )
        self.registry = ActionRegistry()
        self.allowlist = AllowlistStore(root / "allowlist.json", self.registry)
        self.driver = FakeDriver()
        self.system = FakeSystem()
        self.controller = DesktopController(
            self.settings,
            driver=self.driver,
            log_path=self.log_path,
            hotkey_enabled=False,
            registry=self.registry,
            allowlist=self.allowlist,
            store=IntentStore(Database(self.settings.database_path)),
        )
        self.controller._system = self.system

    def tearDown(self):
        self.temp.cleanup()

    def enable(self):
        self.controller.enable(True)
        self.assertTrue(self.controller.status()["enabled"])

    # ------------------------------------------------------------ tier rules
    def test_config_has_all_three_tiers_and_unknown_ids_are_refused(self):
        tiers = {spec.tier for spec in self.registry.actions}
        self.assertEqual(tiers, {1, 2, 3})
        self.enable()
        result = self.controller.process_action("shell.run.do_something", source="ui")
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(self.system.media_calls, [])

    def test_every_tier_3_action_is_blocked_before_any_os_call(self):
        self.enable()
        tier_3 = [spec for spec in self.registry.actions if spec.tier == 3]
        self.assertTrue(tier_3)
        for spec in tier_3:
            result = self.controller.process_action(spec.id, source="ui")
            self.assertEqual(result["status"], "blocked", spec.id)
            self.assertEqual(result["message"], "This action is blocked for safety.")
        self.assertEqual(self.driver.calls, [])
        self.assertEqual(self.system.typed, [])
        self.assertEqual(self.system.launched, [])

    def test_tier_1_runs_immediately_and_reports_verification_honestly(self):
        self.enable()
        result = self.controller.process_action(
            "mouse.move", {"x": 0.5, "y": 0.5}, source="ui"
        )
        self.assertTrue(result["accepted"])
        self.assertTrue(result["verified"])
        self.assertEqual(result["status"], "verified")
        missed = self.controller.process_action("media.play_pause", source="ui")
        self.assertEqual(missed["status"], "executed")
        self.assertFalse(missed["verified"])
        self.assertEqual(self.system.media_calls, ["play_pause"])

    def test_tier_2_requires_approval_and_executes_only_after_it(self):
        self.enable()
        self.allowlist.add_app("Test App", sys.executable, confirm=True)
        result = self.controller.process_action("app.launch", {"name": "Test App"}, source="ui")
        self.assertEqual(result["status"], "approval_required")
        self.assertEqual(self.system.launched, [])
        approval_id = result["approval"]["approval_id"]
        approved = self.controller.approve(approval_id, True, via="ui")
        self.assertTrue(approved["accepted"])
        self.assertTrue(approved["verified"])
        self.assertEqual(self.system.launched, [str(Path(sys.executable).resolve())])

    def test_tier_2_denied_never_reaches_the_os(self):
        self.enable()
        self.allowlist.add_app("Test App", sys.executable, confirm=True)
        result = self.controller.process_action("app.launch", {"path": sys.executable}, source="ui")
        denied = self.controller.approve(result["approval"]["approval_id"], False, via="ui")
        self.assertEqual(denied["status"], "rejected")
        self.assertEqual(self.system.launched, [])

    def test_tier_2_approval_expires_and_cannot_execute(self):
        self.enable()
        self.allowlist.add_app("Test App", sys.executable, confirm=True)
        result = self.controller.process_action("app.launch", {"path": sys.executable}, source="ui")
        approval_id = result["approval"]["approval_id"]
        self.controller._pending[approval_id].expires_at = time.monotonic() - 1
        self.assertEqual(self.controller.pending(), [])
        expired = self.controller.approve(approval_id, True, via="ui")
        self.assertEqual(expired["status"], "rejected")
        self.assertEqual(self.system.launched, [])

    # ------------------------------------------------------------- allowlist
    def test_non_allowlisted_app_is_blocked(self):
        self.enable()
        result = self.controller.process_action(
            "app.launch", {"path": r"C:\Windows\System32\calc.exe"}, source="ui"
        )
        self.assertEqual(result["status"], "blocked")
        self.assertIn("allowlist", result["message"].lower())
        self.assertEqual(self.system.launched, [])

    def test_non_http_schemes_are_blocked(self):
        self.enable()
        for url in ("file:///C:/Windows", "javascript:alert(1)", "ftp://example.com"):
            result = self.controller.process_action("url.open", {"url": url}, source="ui")
            self.assertEqual(result["status"], "blocked", url)
        self.assertEqual(self.system.urls, [])

    def test_allowlisted_and_typed_https_urls_need_approval(self):
        self.enable()
        listed = self.controller.process_action(
            "url.open", {"url": "https://www.youtube.com"}, source="ui"
        )
        self.assertEqual(listed["status"], "approval_required")
        typed = self.controller.process_action(
            "url.open", {"url": "example.com"}, source="ui"
        )
        self.assertEqual(typed["status"], "approval_required")
        self.assertEqual(self.system.urls, [])
        self.controller.approve(listed["approval"]["approval_id"], True, via="ui")
        self.controller.approve(typed["approval"]["approval_id"], True, via="ui")
        self.assertEqual(
            self.system.urls,
            ["https://www.youtube.com/", "https://example.com/"],
        )

    def test_app_path_validation_rejects_scripts_and_missing_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "danger.bat"
            script.write_text("echo hi", encoding="utf-8")
            with self.assertRaises(AllowlistError):
                validate_app_path(str(script))
            with self.assertRaises(AllowlistError):
                validate_app_path(str(Path(folder) / "missing.exe"))
        with self.assertRaises(AllowlistError):
            self.allowlist.add_app("No confirm", sys.executable, confirm=False)

    def test_url_normalisation_rejects_credentials_and_spaces(self):
        for value in (
            "http://user:pass@example.com",
            "https://exa mple.com",
            "mailto:someone@example.com",
        ):
            with self.assertRaises(AllowlistError):
                normalize_url(value)

    # -------------------------------------------------------------- validation
    def test_parameter_schema_is_typed_and_bounded(self):
        cases = [
            ("mouse.move", {}),
            ("mouse.move", {"x": 1.2, "y": 0.5}),
            ("mouse.move", {"x": "0.5", "y": 0.5}),
            ("mouse.move", {"x": 0.5, "y": 0.5, "shell": "dir"}),
            ("mouse.scroll", {"delta": 1_000_000}),
            ("dictation.type", {"text": "x" * 2_000}),
        ]
        for action_id, params in cases:
            with self.assertRaises(ActionValidationError, msg=f"{action_id} {params}"):
                self.registry.validate_params(action_id, params)

    def test_process_action_rejects_invalid_params_without_an_os_call(self):
        self.enable()
        result = self.controller.process_action(
            "mouse.move", {"x": 9, "y": 9}, source="ui"
        )
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(self.driver.calls, [])

    def test_rate_limiter_drops_excess_actions(self):
        self.controller.rate_limit = 1
        self.enable()
        first = self.controller.process_action("media.play_pause", source="ui")
        second = self.controller.process_action("media.next", source="ui")
        self.assertTrue(first["accepted"])
        self.assertEqual(second["status"], "rejected")
        self.assertIn("rate limit", second["message"].lower())
        self.assertEqual(self.system.media_calls, ["play_pause"])

    def test_coordinate_mapping_honours_position_and_clamps_edges(self):
        self.assertEqual(self.controller.map_point(0.0, 0.0), (110, 90))
        self.assertEqual(self.controller.map_point(1.0, 1.0), (890, 710))
        centred = self.controller.map_point(0.5, 0.5)
        self.assertEqual(centred, (500, 400))
        self.controller.update_config({"position_x": 0.5, "position_y": -0.5})
        self.assertEqual(self.controller.map_point(0.0, 0.0), (210, 10))
        self.assertEqual(self.controller.map_point(1.0, 1.0), (990, 630))

    # ----------------------------------------------------------- auto-disable
    def test_hidden_tab_auto_disables_after_ten_seconds(self):
        self.enable()
        self.controller.set_presence(hidden=True)
        reason = self.controller.evaluate_auto_disable(time.monotonic() + 11)
        self.assertIn("background", reason)
        self.assertFalse(self.controller.status()["enabled"])

    def test_lost_gesture_tracking_auto_disables_after_two_seconds(self):
        self.enable()
        result = self.controller.process_action(
            "mouse.move", {"x": 0.5, "y": 0.5}, source="gesture", confidence=0.95
        )
        self.assertTrue(result["accepted"])
        now = time.monotonic()
        self.controller._last_gesture_action_at = now - 3
        self.controller._last_tracking = now - 3
        reason = self.controller.evaluate_auto_disable(now)
        self.assertIn("tracked", reason)
        self.assertFalse(self.controller.status()["enabled"])

    def test_idle_timeout_auto_disables(self):
        self.enable()
        now = time.monotonic()
        self.controller._last_activity = now - 20
        reason = self.controller.evaluate_auto_disable(now)
        self.assertIn("no input", reason)
        self.assertFalse(self.controller.status()["enabled"])

    def test_bridge_disconnect_auto_disables(self):
        self.controller.bridge_connected()
        self.enable()
        status = self.controller.bridge_disconnected()
        self.assertFalse(status["enabled"])
        self.assertIn("socket", status["disable_reason"])

    def test_emergency_stop_latches_and_clears_pending_and_dictation(self):
        self.enable()
        self.controller._dictation_active = True
        self.allowlist.add_app("Test App", sys.executable, confirm=True)
        self.controller.process_action("app.launch", {"path": sys.executable}, source="ui")
        stopped = self.controller.emergency_stop("test")
        self.assertTrue(stopped["emergency_stopped"])
        self.assertFalse(stopped["enabled"])
        self.assertFalse(stopped["dictation"]["active"])
        self.assertEqual(stopped["pending_approvals"], [])

    # --------------------------------------------------------------- dictation
    def test_dictation_never_types_outside_its_explicit_mode(self):
        self.enable()
        result = self.controller.dictation_type("hello world")
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(self.system.typed, [])

    def test_dictation_requires_approval_then_types_and_stops(self):
        self.enable()
        started = self.controller.run_text("start dictation", source="voice")
        self.assertEqual(started["status"], "awaiting_approval")
        approved = self.controller.approve(
            started["approval"]["approval_id"], True, via="voice"
        )
        self.assertTrue(approved["accepted"])
        self.assertTrue(self.controller.status()["dictation"]["active"])
        typed = self.controller.dictation_type("hello world")
        self.assertTrue(typed["accepted"])
        self.assertEqual(self.system.typed, ["hello world"])
        self.controller.stop_dictation()
        after = self.controller.dictation_type("more text")
        self.assertEqual(after["status"], "rejected")
        self.assertEqual(self.system.typed, ["hello world"])

    def test_dictation_character_limit_stops_the_mode(self):
        self.enable()
        self.controller._dictation_active = True
        self.controller._dictation_last_at = time.monotonic()
        self.controller.registry.dictation_max_total = 5
        result = self.controller.dictation_type("too many characters")
        self.assertEqual(result["status"], "rejected")
        self.assertFalse(self.controller.status()["dictation"]["active"])
        self.assertEqual(self.system.typed, [])

    def test_dictated_text_is_never_written_to_the_audit_log(self):
        self.enable()
        self.controller._dictation_active = True
        self.controller._dictation_last_at = time.monotonic()
        self.controller.dictation_type("my private words")
        log_text = self.log_path.read_text(encoding="utf-8")
        self.assertNotIn("my private words", log_text)
        audit_text = json.dumps(self.controller.recent_audit(100))
        self.assertNotIn("my private words", audit_text)
        self.assertIn("chars=", log_text)

    # ------------------------------------------------------------------ voice
    def test_voice_commands_map_to_allowlisted_actions(self):
        self.enable()
        scroll = self.controller.run_text("scroll down", source="voice")
        self.assertEqual(scroll["action_id"], "mouse.scroll")
        self.assertEqual(scroll["status"], "executed")
        self.assertFalse(scroll["result"]["verified"])
        self.assertIn("not verified", scroll["message"])
        self.assertIn(("scroll", 600), self.driver.calls)
        self.assertEqual(self.controller.run_text("hello there", source="voice")["handled"], False)

    def test_ambiguous_and_unsafe_voice_commands_never_execute(self):
        self.enable()
        clarify = self.controller.run_text("stop", source="voice")
        self.assertTrue(clarify["handled"])
        self.assertEqual(clarify["status"], "needs_clarification")
        blocked = self.controller.run_text("delete all files", source="voice")
        self.assertEqual(blocked["status"], "blocked")
        typing = self.controller.run_text("type hello", source="voice")
        self.assertEqual(typing["status"], "blocked")
        self.assertEqual(self.driver.calls, [])
        self.assertEqual(self.system.typed, [])
        self.assertEqual(self.system.launched, [])

    def test_voice_tier_2_queues_approval_and_records_intent_stages(self):
        self.enable()
        self.allowlist.add_app("Test App", sys.executable, confirm=True)
        result = self.controller.run_text("open Test App", source="voice")
        self.assertEqual(result["status"], "awaiting_approval")
        self.assertEqual(result["intent"]["module"], "hgi")
        self.assertIn("device_control", result["intent"]["required_permissions"])
        steps = {item["step"]: item["status"] for item in result["intent"]["steps"]}
        self.assertEqual(steps["UNDERSTAND"], "done")
        self.assertEqual(steps["PLAN"], "done")
        self.assertEqual(steps["APPROVE"], "pending")
        approved = self.controller.approve(
            result["approval"]["approval_id"], True, via="voice"
        )
        self.assertTrue(approved["verified"])
        self.assertEqual(approved["intent"]["status"], "reported")


if __name__ == "__main__":
    unittest.main()

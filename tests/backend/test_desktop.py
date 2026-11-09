import tempfile
import unittest
from pathlib import Path

from app.core.config import Settings
from app.desktop import DesktopController


class FakeDriver:
    def __init__(self, size=(1000, 800)):
        self._size = size
        self.calls = []

    def size(self):
        return self._size

    def move_to(self, x, y):
        self.calls.append(("move_to", x, y))

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


class DesktopControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.log_path = Path(self.temp.name) / "desktop-actions.log"
        self.settings = Settings(
            data_dir=Path(self.temp.name),
            desktop_min_confidence=0.7,
            desktop_rate_limit=50,
            desktop_area=0.8,
            desktop_edge_margin=10,
        )
        self.driver = FakeDriver()
        self.controller = DesktopController(
            self.settings, driver=self.driver, log_path=self.log_path, hotkey_enabled=False
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_disabled_by_default(self):
        status = self.controller.status()
        self.assertFalse(status["enabled"])
        self.assertFalse(status["emergency_stopped"])
        result = self.controller.process({"type": "move", "x": 0.5, "y": 0.5, "confidence": 0.99})
        self.assertFalse(result["accepted"])
        self.assertEqual(self.driver.calls, [])

    def test_token_is_random_and_compared_exactly(self):
        other = DesktopController(self.settings, driver=FakeDriver(), hotkey_enabled=False)
        self.assertNotEqual(self.controller.token, other.token)
        self.assertTrue(self.controller.token_valid(self.controller.token))
        self.assertFalse(self.controller.token_valid(self.controller.token + "x"))
        self.assertFalse(self.controller.token_valid(None))

    def test_maps_normalised_point_into_control_rect_with_margins(self):
        # 80% of 1000x800 is 800x640 centred at (100, 80), inner box 780x620.
        self.assertEqual(self.controller.map_point(0.0, 0.0), (110, 90))
        self.assertEqual(self.controller.map_point(1.0, 1.0), (890, 710))
        self.assertEqual(self.controller.map_point(0.5, 0.5), (500, 400))
        self.assertEqual(self.controller.map_point(-3.0, 9.0), (110, 710))

    def test_enable_and_click_reaches_driver(self):
        self.controller.enable(True)
        self.assertTrue(self.controller.status()["enabled"])
        result = self.controller.process({"type": "click", "x": 0.5, "y": 0.5, "confidence": 0.9})
        self.assertTrue(result["accepted"])
        self.assertIn(("move_to", 500, 400), self.driver.calls)
        self.assertIn(("click",), self.driver.calls)
        self.controller.enable(False)
        self.assertFalse(self.controller.status()["enabled"])

    def test_low_confidence_is_rejected(self):
        self.controller.enable(True)
        result = self.controller.process({"type": "click", "x": 0.5, "y": 0.5, "confidence": 0.4})
        self.assertFalse(result["accepted"])
        self.assertIn("confidence", result["reason"].lower())
        self.assertEqual(self.driver.calls, [])

    def test_rate_limit_drops_excess_commands(self):
        self.controller.rate_limit = 2
        self.controller.enable(True)
        first = self.controller.process({"type": "move", "x": 0.1, "y": 0.1, "confidence": 0.9})
        second = self.controller.process({"type": "move", "x": 0.2, "y": 0.2, "confidence": 0.9})
        third = self.controller.process({"type": "move", "x": 0.3, "y": 0.3, "confidence": 0.9})
        self.assertTrue(first["accepted"])
        self.assertTrue(second["accepted"])
        self.assertFalse(third["accepted"])
        self.assertIn("rate limit", third["reason"].lower())

    def test_drag_requires_start_and_end_releases_button(self):
        self.controller.enable(True)
        early = self.controller.process({"type": "drag_move", "x": 0.5, "y": 0.5, "confidence": 0.9})
        self.assertFalse(early["accepted"])
        start = self.controller.process({"type": "drag_start", "x": 0.4, "y": 0.4, "confidence": 0.9})
        self.assertTrue(start["accepted"])
        move = self.controller.process({"type": "drag_move", "x": 0.6, "y": 0.6, "confidence": 0.9})
        self.assertTrue(move["accepted"])
        # Release must pass even when confidence collapses.
        end = self.controller.process({"type": "drag_end", "x": 0.6, "y": 0.6, "confidence": 0.01})
        self.assertTrue(end["accepted"])
        self.assertIn(("mouse_down",), self.driver.calls)
        self.assertIn(("mouse_up",), self.driver.calls)

    def test_scroll_is_clamped(self):
        self.controller.enable(True)
        result = self.controller.process({"type": "scroll", "delta": 99_999, "confidence": 0.9})
        self.assertTrue(result["accepted"])
        self.assertIn(("scroll", DesktopController.MAX_SCROLL), self.driver.calls)

    def test_non_mouse_commands_are_rejected(self):
        self.controller.enable(True)
        for command in ({"type": "type_text", "text": "hi"}, {"type": "key", "key": "enter"}, {"type": "shell", "cmd": "dir"}):
            result = self.controller.process({**command, "confidence": 0.99})
            self.assertFalse(result["accepted"])
        self.assertEqual(self.driver.calls, [])

    def test_emergency_stop_latches_and_blocks_commands(self):
        self.controller.enable(True)
        stopped = self.controller.emergency_stop("test")
        self.assertTrue(stopped["emergency_stopped"])
        self.assertFalse(stopped["enabled"])
        again = self.controller.enable(True)
        self.assertFalse(again["enabled"])
        result = self.controller.process({"type": "move", "x": 0.5, "y": 0.5, "confidence": 0.99})
        self.assertFalse(result["accepted"])

    def test_audit_log_records_actions_without_camera_data(self):
        self.controller.enable(True)
        self.controller.process({"type": "click", "x": 0.5, "y": 0.5, "confidence": 0.9})
        text = self.log_path.read_text(encoding="utf-8")
        self.assertIn("enabled", text)
        self.assertIn("click", text)
        self.assertNotIn("landmark", text.lower())
        self.assertNotIn("camera", text.lower())


if __name__ == "__main__":
    unittest.main()

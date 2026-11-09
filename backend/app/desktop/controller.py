from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import json
import math
import secrets
import threading
import time
import uuid
from typing import Any, Protocol

from app.core.config import Settings
from app.core.logging import configure_logging
from app.db.store import IntentRecord, IntentStore
from app.desktop.actions import (
    ActionError,
    ActionRegistry,
    ActionSpec,
    ActionValidationError,
    AllowlistError,
    AllowlistStore,
    BlockedAction,
    validate_app_path,
)
from app.desktop.commands import ParsedCommand, parse_command


class DesktopFailsafe(RuntimeError):
    """Raised when pyautogui's corner fail-safe trips."""


class DesktopDriver(Protocol):
    def size(self) -> tuple[int, int]: ...

    def move_to(self, x: int, y: int) -> None: ...

    def click(self) -> None: ...

    def double_click(self) -> None: ...

    def mouse_down(self) -> None: ...

    def mouse_up(self) -> None: ...

    def scroll(self, amount: int) -> None: ...


class PyAutoGuiDriver:
    """Thin wrapper so the controller never imports a keyboard or shell tool."""

    def __init__(self) -> None:
        import pyautogui  # local import keeps the API importable on headless hosts

        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0
        self._pg = pyautogui

    def _call(self, function: Any, *args: Any) -> Any:
        try:
            return function(*args)
        except self._pg.FailSafeException as exc:  # type: ignore[attr-defined]
            raise DesktopFailsafe("pyautogui fail-safe tripped (pointer in a screen corner)") from exc

    def size(self) -> tuple[int, int]:
        size = self._call(self._pg.size)
        return int(size[0]), int(size[1])

    def move_to(self, x: int, y: int) -> None:
        self._call(self._pg.moveTo, x, y, 0)

    def click(self) -> None:
        self._call(self._pg.click)

    def double_click(self) -> None:
        self._call(self._pg.doubleClick)

    def mouse_down(self) -> None:
        self._call(self._pg.mouseDown)

    def mouse_up(self) -> None:
        self._call(self._pg.mouseUp)

    def scroll(self, amount: int) -> None:
        self._call(self._pg.scroll, amount)


@dataclass(frozen=True)
class ControlRect:
    left: float
    top: float
    width: float
    height: float
    margin: int


@dataclass
class PendingApproval:
    id: str
    action: ActionSpec
    params: dict[str, Any]
    source: str
    created_at: str
    expires_at: float
    intent_id: str | None = None
    target: str | None = None


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return minimum if value < minimum else maximum if value > maximum else value


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _pictures_directory() -> Path:
    pictures = Path.home() / "Pictures"
    pictures.mkdir(parents=True, exist_ok=True)
    return pictures


class DesktopController:
    """Session-scoped, localhost-only desktop action service.

    Safety invariants:
    - disabled until an explicit enable call (which the API gates on the
      ``hgi/device_control`` permission);
    - a random token is generated once at startup and checked by the socket;
    - every action id comes from ``config/desktop_actions.json`` and every
      parameter is validated against its typed schema;
    - Tier 1 may run immediately, Tier 2 needs a fresh approval, Tier 3 is
      refused before any OS call;
    - gestures below the confidence floor or above the rate limit are dropped;
    - emergency stop latches until the backend process restarts;
    - the audit log contains action metadata only, never camera, audio or
      dictated text.
    """

    MAX_SCROLL = 1200
    MOVE_TYPES = {"move", "click", "double_click", "drag_start", "drag_move", "drag_end", "scroll"}
    ACTION_TARGETS = {
        "mouse.move": "screen",
        "mouse.click": "screen",
        "mouse.double_click": "screen",
        "mouse.right_click": "screen",
        "mouse.drag_start": "screen",
        "mouse.drag_move": "screen",
        "mouse.drag_end": "screen",
        "mouse.scroll": "screen",
    }

    def __init__(
        self,
        settings: Settings,
        driver: DesktopDriver | None = None,
        log_path: Path | None = None,
        hotkey_enabled: bool = True,
        *,
        registry: ActionRegistry | None = None,
        allowlist: AllowlistStore | None = None,
        store: IntentStore | None = None,
    ) -> None:
        self.settings = settings
        self.min_confidence = _clamp(float(settings.desktop_min_confidence), 0.5, 0.99)
        self.rate_limit = max(1, int(settings.desktop_rate_limit))
        self.area = _clamp(float(settings.desktop_area), 0.3, 1.0)
        self.margin = max(0, int(settings.desktop_edge_margin))
        self.position_x = _clamp(float(settings.desktop_position_x), -0.5, 0.5)
        self.position_y = _clamp(float(settings.desktop_position_y), -0.5, 0.5)
        self.click_delay_ms = max(0, int(settings.desktop_click_delay_ms))
        self.idle_seconds = max(10, int(settings.desktop_idle_seconds))
        self.emergency_hotkey = settings.desktop_emergency_hotkey
        self.hotkey_enabled = hotkey_enabled

        self.registry = registry or ActionRegistry()
        allowlist_path = settings.desktop_allowlist_path.strip()
        self.allowlist = allowlist or AllowlistStore(
            Path(allowlist_path) if allowlist_path else settings.data_dir / "desktop_allowlist.json",
            self.registry,
        )
        self._store = store

        self.token = secrets.token_urlsafe(32)
        self.enabled = False
        self.emergency_stopped = False
        self.detail: str | None = None
        self.dragging = False
        self.pyautogui_loaded = False
        self.pynput_loaded = False
        self.screen: tuple[int, int] | None = None
        self._driver: DesktopDriver | None = None
        self._system: Any = None
        self._times: deque[float] = deque()
        self._lock = threading.RLock()
        self._hotkey: Any = None
        self._move_log_at = 0.0
        self._move_log_skipped = 0
        self._last_mouse_db_audit = 0.0
        self._logger = configure_logging(settings.log_level).getChild("desktop")
        self._log_path = log_path or (settings.data_dir / "desktop-actions.log")

        self._pending: dict[str, PendingApproval] = {}
        self._actions: deque[dict[str, Any]] = deque(maxlen=10)
        self._dictation_active = False
        self._dictation_total = 0
        self._dictation_last_at = 0.0
        self._dictation_started_at = 0.0
        self._bridge_connected = False
        self._bridge_count = 0
        self._mic_on = False
        self._paused = False
        self._last_activity = time.monotonic()
        self._last_tracking = time.monotonic()
        self._last_gesture_action_at = 0.0
        self._last_action_source: str | None = None
        self._hidden_since: float | None = None
        self._disable_reason: str | None = None

        if driver is not None:
            self._driver = driver
            self.pyautogui_loaded = True
            try:
                self.screen = driver.size()
            except Exception:  # noqa: BLE001 - status must stay usable
                self.screen = None
        else:
            self._load_driver()

        try:
            import pynput  # noqa: F401

            self.pynput_loaded = True
        except Exception:  # noqa: BLE001 - optional dependency
            self.pynput_loaded = False

    # ------------------------------------------------------------------ setup

    def _load_driver(self) -> None:
        try:
            from app.desktop.system_driver import WindowsSystemDriver

            system = WindowsSystemDriver(enable_hotkeys=self.hotkey_enabled)
            self._system = system
            self._driver = system
            self.pyautogui_loaded = True
            self.screen = self._driver.size()
            return
        except Exception as exc:  # noqa: BLE001 - machine may be headless
            self._logger.info("full desktop driver unavailable: %s", exc)
        try:
            self._driver = PyAutoGuiDriver()
            self.pyautogui_loaded = True
            self.screen = self._driver.size()
        except Exception as exc:  # noqa: BLE001 - machine may be headless
            self._driver = None
            self.pyautogui_loaded = False
            self.screen = None
            self.detail = f"Desktop automation is unavailable: {exc}"

    # ----------------------------------------------------------------- status

    def _state_chip(self) -> str:
        if self.emergency_stopped:
            return "Emergency stopped"
        if not self.enabled:
            return "Off"
        if self._paused:
            return "Paused"
        if not self._bridge_connected:
            return "Armed"
        return "Active"

    def capabilities(self) -> dict[str, bool]:
        if self._system is not None:
            try:
                return dict(self._system.capabilities)
            except Exception:  # noqa: BLE001
                pass
        return {
            "mouse": self._driver is not None,
            "keyboard": False,
            "volume": False,
            "media": False,
            "brightness": False,
            "window": False,
            "screenshot": False,
            "app_launch": False,
        }

    def pending(self) -> list[dict[str, Any]]:
        with self._lock:
            self._prune_approvals_locked()
            now = time.monotonic()
            return [
                {
                    "approval_id": item.id,
                    "action_id": item.action.id,
                    "label": item.action.label,
                    "tier": item.action.tier,
                    "source": item.source,
                    "target": item.target,
                    "expires_in_ms": max(0, int(round((item.expires_at - now) * 1000))),
                }
                for item in sorted(self._pending.values(), key=lambda entry: entry.expires_at)
            ]

    def status(self) -> dict[str, Any]:
        with self._lock:
            recent = list(self._actions)
            dictation_remaining = 0
            if self._dictation_active:
                remaining = self.registry.dictation_max_total - self._dictation_total
                dictation_remaining = max(0, remaining)
            return {
                "version": 2,
                "state": self._state_chip(),
                "available": self._driver is not None,
                "enabled": self.enabled,
                "emergency_stopped": self.emergency_stopped,
                "token": self.token,
                "pyautogui": self.pyautogui_loaded,
                "pynput": self.pynput_loaded,
                "hotkey": self._hotkey is not None,
                "screen": {"width": self.screen[0], "height": self.screen[1]} if self.screen else None,
                "min_confidence": self.min_confidence,
                "rate_limit": self.rate_limit,
                "area": round(self.area, 3),
                "position": {"x": round(self.position_x, 3), "y": round(self.position_y, 3)},
                "edge_margin": self.margin,
                "click_delay_ms": self.click_delay_ms,
                "idle_seconds": self.idle_seconds,
                "detail": self.detail,
                "disable_reason": self._disable_reason,
                "bridge": {"connected": self._bridge_connected, "connections": self._bridge_count},
                "mic_on": self._mic_on,
                "paused": self._paused,
                "capabilities": self.capabilities(),
                "dictation": {
                    "active": self._dictation_active,
                    "remaining_chars": dictation_remaining,
                    "max_chars": self.registry.dictation_max_total,
                    "max_chars_per_utterance": self.registry.dictation_max_chars,
                },
                "pending_approvals": self.pending(),
                "recent_actions": recent,
                "last_action": recent[0] if recent else None,
                "allowlist": {
                    "apps": len(self.allowlist.snapshot()["apps"]),
                    "urls": len(self.allowlist.snapshot()["urls"]),
                    "shortcuts": len([item for item in self.allowlist.snapshot()["shortcuts"] if item["enabled"]]),
                },
                "approval_ttl_ms": self.registry.approval_ttl_ms,
            }

    def token_valid(self, token: str | None) -> bool:
        if not token:
            return False
        return secrets.compare_digest(token, self.token)

    # --------------------------------------------------------------- lifecycle

    def enable(self, enabled: bool) -> dict[str, Any]:
        with self._lock:
            if not enabled:
                self._release_drag_locked()
                self._stop_dictation_locked("control turned off")
                self._reject_all_pending_locked("Desktop control was turned off.")
                if self.enabled:
                    self._audit("disabled")
                    self._db_audit("desktop_disable", outcome="disabled", detail="Control turned off.")
                self.enabled = False
                self._stop_hotkey()
                self._bridge_connected = self._bridge_count > 0
                return self.status()

            if self.emergency_stopped:
                self.detail = "Emergency stop is latched. Restart the backend after checking the pointer and control area."
                return self.status()
            if self._driver is None:
                self.detail = self.detail or "No desktop driver is available on this machine."
                return self.status()
            if not self.enabled:
                self.enabled = True
                self.detail = None
                self._disable_reason = None
                self._paused = False
                now = time.monotonic()
                self._last_activity = now
                self._last_tracking = now
                self._hidden_since = None
                self._audit("enabled", f"screen={self.screen} area={round(self.area, 3)}")
                self._db_audit(
                    "desktop_enable",
                    outcome="enabled",
                    detail=f"Desktop control enabled | screen={self.screen} | device_control permission required.",
                )
                self._start_hotkey()
            return self.status()

    def disable(self, reason: str) -> dict[str, Any]:
        """Turn control off without latching the emergency stop."""
        with self._lock:
            if not self.enabled:
                return self.status()
            self._auto_disable_locked(reason)
            return self.status()

    def emergency_stop(self, reason: str = "manual") -> dict[str, Any]:
        with self._lock:
            self._release_drag_locked()
            self._stop_dictation_locked("emergency stop")
            self._reject_all_pending_locked("Emergency stop.")
            was_enabled = self.enabled
            self.enabled = False
            self.emergency_stopped = True
            self._paused = False
            self.detail = f"Emergency stop latched: {reason}. Restart the backend to clear it."
            self._audit("emergency_stop", f"reason={reason} was_enabled={was_enabled}")
            self._db_audit(
                "desktop_emergency_stop",
                outcome="stopped",
                detail=f"Emergency stop: {reason}.",
            )
            self._remember(
                {
                    "action_id": "control.emergency_stop",
                    "label": "Emergency stop",
                    "tier": 1,
                    "status": "verified",
                    "verified": True,
                    "source": "ui",
                    "detail": f"Latched: {reason}.",
                }
            )
            self._stop_hotkey(threaded=True)
            return self.status()

    def release_drag(self) -> None:
        with self._lock:
            self._release_drag_locked()

    def _release_drag_locked(self) -> None:
        if not self.dragging:
            return
        self.dragging = False
        try:
            if self._driver is not None:
                self._driver.mouse_up()
            self._audit("drag_released", "safety release")
        except Exception:  # noqa: BLE001 - never mask an emergency release
            self._logger.warning("desktop drag release failed")

    # ---------------------------------------------------------------- presence

    def set_presence(
        self,
        *,
        hidden: bool | None = None,
        mic_on: bool | None = None,
        paused: bool | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if hidden is not None:
                if hidden:
                    if self._hidden_since is None:
                        self._hidden_since = time.monotonic()
                else:
                    self._hidden_since = None
                    self._last_activity = time.monotonic()
            if mic_on is not None:
                self._mic_on = bool(mic_on)
            if paused is not None:
                self._paused = bool(paused)
            return self.status()

    def note_tracking(self, now: float | None = None) -> None:
        with self._lock:
            self._last_tracking = time.monotonic() if now is None else now

    def bridge_connected(self) -> None:
        with self._lock:
            self._bridge_count += 1
            self._bridge_connected = True
            self._last_activity = time.monotonic()
            self._audit("bridge_connected", f"connections={self._bridge_count}")

    def bridge_disconnected(self) -> dict[str, Any]:
        with self._lock:
            self._bridge_count = max(0, self._bridge_count - 1)
            self._bridge_connected = self._bridge_count > 0
            self._audit("bridge_disconnected", f"connections={self._bridge_count}")
            if not self._bridge_connected and self.enabled:
                self._auto_disable_locked("the local bridge socket disconnected")
            return self.status()

    def evaluate_auto_disable(self, now: float | None = None) -> str | None:
        with self._lock:
            reason = self._auto_disable_reason_locked(time.monotonic() if now is None else now)
            if reason:
                self._auto_disable_locked(reason)
            return reason

    def _auto_disable_reason_locked(self, now: float) -> str | None:
        if not self.enabled or self.emergency_stopped:
            return None
        if self._hidden_since is not None and now - self._hidden_since >= 10.0:
            return "this tab was in the background for more than 10 s"
        if (
            self._last_action_source == "gesture"
            and self._last_gesture_action_at > 0
            and now - self._last_gesture_action_at >= 2.0
            and now - self._last_tracking >= 2.0
        ):
            return "no hand was tracked for 2 s"
        if self.idle_seconds > 0 and now - self._last_activity >= self.idle_seconds:
            return f"no input for {self.idle_seconds} s"
        return None

    def _auto_disable_locked(self, reason: str) -> None:
        if not self.enabled and not self.emergency_stopped:
            return
        self._release_drag_locked()
        self._stop_dictation_locked("auto-disable")
        self._reject_all_pending_locked("Desktop control auto-disabled.")
        was_enabled = self.enabled
        self.enabled = False
        self._paused = False
        self._disable_reason = reason
        self.detail = f"Desktop control auto-disabled: {reason}."
        self._audit("auto_disabled", reason)
        if was_enabled:
            self._db_audit("desktop_auto_disable", outcome="disabled", detail=f"Auto-disabled: {reason}.")
        self._stop_hotkey(threaded=True)

    # ------------------------------------------------------------------ mapping

    def control_rect(self) -> ControlRect | None:
        if not self.screen:
            return None
        width, height = self.screen
        rect_width = width * self.area
        rect_height = height * self.area
        left = _clamp((width - rect_width) / 2 + width * self.position_x, 0.0, max(0.0, width - rect_width))
        top = _clamp((height - rect_height) / 2 + height * self.position_y, 0.0, max(0.0, height - rect_height))
        return ControlRect(
            left=left,
            top=top,
            width=rect_width,
            height=rect_height,
            margin=self.margin,
        )

    def map_point(self, x: float, y: float) -> tuple[int, int] | None:
        rect = self.control_rect()
        if rect is None:
            return None
        inner_w = max(1.0, rect.width - rect.margin * 2)
        inner_h = max(1.0, rect.height - rect.margin * 2)
        mapped_x = rect.left + rect.margin + _clamp(x, 0.0, 1.0) * inner_w
        mapped_y = rect.top + rect.margin + _clamp(y, 0.0, 1.0) * inner_h
        return int(round(mapped_x)), int(round(mapped_y))

    # ---------------------------------------------------------------- commands

    def _allow_rate(self, now: float) -> bool:
        while self._times and now - self._times[0] > 1.0:
            self._times.popleft()
        if len(self._times) >= self.rate_limit:
            return False
        self._times.append(now)
        return True

    def process(self, command: dict[str, Any]) -> dict[str, Any]:
        request_type = command.get("type")
        with self._lock:
            reason = self._auto_disable_reason_locked(time.monotonic())
            if reason:
                self._auto_disable_locked(reason)
            if not self.enabled:
                return {"accepted": False, "type": request_type, "reason": self.detail or "Desktop control is disabled."}
            if self.emergency_stopped:
                return {"accepted": False, "type": request_type, "reason": "Emergency stop is latched."}
            if self._driver is None:
                return {"accepted": False, "type": request_type, "reason": "No desktop driver is available."}

            if request_type == "configure":
                return self._configure(command)
            if request_type not in self.MOVE_TYPES:
                return {"accepted": False, "type": request_type, "reason": "Only mouse move, click, drag and scroll are allowed."}

            if request_type == "drag_end":
                # Releasing the button must never be blocked by a confidence collapse.
                return self._drag_end(command, bypass_confidence=True)

            confidence = _finite(command.get("confidence"))
            if confidence is None:
                return {"accepted": False, "type": request_type, "reason": "Missing confidence."}
            if confidence < self.min_confidence:
                return {"accepted": False, "type": request_type, "reason": "Below the desktop confidence floor."}
            now = time.monotonic()
            if not self._allow_rate(now):
                return {"accepted": False, "type": request_type, "reason": "Rate limit reached."}

            try:
                if request_type == "scroll":
                    delta = _finite(command.get("delta"))
                    if delta is None:
                        return {"accepted": False, "type": request_type, "reason": "Invalid scroll delta."}
                    amount = int(round(_clamp(delta, -self.MAX_SCROLL, self.MAX_SCROLL)))
                    self._driver.scroll(amount)
                    self._audit("scroll", f"delta={amount}")
                    self._mouse_done("mouse.scroll", "Scroll", f"Scroll delta {amount}.", source="gesture")
                    return {"accepted": True, "type": request_type}

                x = _finite(command.get("x"))
                y = _finite(command.get("y"))
                if x is None or y is None:
                    return {"accepted": False, "type": request_type, "reason": "Invalid normalised coordinates."}
                point = self.map_point(x, y)
                if point is None:
                    return {"accepted": False, "type": request_type, "reason": "Screen size is unavailable."}
                pixel_x, pixel_y = point

                if request_type == "move":
                    self._driver.move_to(pixel_x, pixel_y)
                    self._audit_move(pixel_x, pixel_y)
                elif request_type == "click":
                    self._driver.move_to(pixel_x, pixel_y)
                    self._driver.click()
                    self._audit("click", f"x={pixel_x} y={pixel_y}")
                    self._mouse_done("mouse.click", "Left click", f"Pointer reached {pixel_x}, {pixel_y}.", source="gesture")
                elif request_type == "double_click":
                    self._driver.move_to(pixel_x, pixel_y)
                    self._driver.double_click()
                    self._audit("double_click", f"x={pixel_x} y={pixel_y}")
                    self._mouse_done("mouse.double_click", "Double click", f"Pointer reached {pixel_x}, {pixel_y}.", source="gesture")
                elif request_type == "drag_start":
                    self._driver.move_to(pixel_x, pixel_y)
                    self._driver.mouse_down()
                    self.dragging = True
                    self._audit("drag_start", f"x={pixel_x} y={pixel_y}")
                elif request_type == "drag_move":
                    if not self.dragging:
                        return {"accepted": False, "type": request_type, "reason": "No active drag."}
                    self._driver.move_to(pixel_x, pixel_y)
                    self._audit_move(pixel_x, pixel_y, dragging=True)
                elif request_type == "drag_end":
                    return self._drag_end(command)
                self._last_action_source = "gesture"
                self._last_gesture_action_at = now
                self._last_activity = now
                return {"accepted": True, "type": request_type}
            except DesktopFailsafe as exc:
                self._logger.warning("desktop fail-safe triggered: %s", exc)
                self.emergency_stop("pyautogui corner fail-safe")
                return {"accepted": False, "type": request_type, "reason": "Fail-safe tripped; emergency stop is latched."}
            except Exception as exc:  # noqa: BLE001 - keep the socket alive
                self._logger.exception("desktop command failed: %s", request_type)
                return {"accepted": False, "type": request_type, "reason": f"Desktop action failed: {exc}"}

    def _drag_end(self, command: dict[str, Any], bypass_confidence: bool = False) -> dict[str, Any]:
        if not self.dragging:
            return {"accepted": False, "type": "drag_end", "reason": "No active drag."}
        try:
            x = _finite(command.get("x"))
            y = _finite(command.get("y"))
            if x is not None and y is not None:
                point = self.map_point(x, y)
                if point is not None:
                    self._driver.move_to(point[0], point[1])  # type: ignore[union-attr]
            self._driver.mouse_up()  # type: ignore[union-attr]
            self.dragging = False
            self._audit("drag_end")
            self._mouse_done("mouse.drag_end", "Release the drag", "Mouse button released.", source="gesture")
            self._last_action_source = "gesture"
            self._last_gesture_action_at = time.monotonic()
            self._last_activity = self._last_gesture_action_at
            return {"accepted": True, "type": "drag_end"}
        except DesktopFailsafe as exc:
            self.emergency_stop(f"fail-safe during drag release: {exc}")
            return {"accepted": False, "type": "drag_end", "reason": "Fail-safe tripped during release."}
        except Exception as exc:  # noqa: BLE001
            self._logger.exception("desktop drag_end failed")
            return {"accepted": False, "type": "drag_end", "reason": f"Drag release failed: {exc}"}

    def _configure(self, command: dict[str, Any]) -> dict[str, Any]:
        area = _finite(command.get("area"))
        if area is not None:
            self.area = _clamp(area, 0.3, 1.0)
        px = _finite(command.get("position_x", command.get("positionX")))
        py = _finite(command.get("position_y", command.get("positionY")))
        if px is not None:
            self.position_x = _clamp(px, -0.5, 0.5)
        if py is not None:
            self.position_y = _clamp(py, -0.5, 0.5)
        margin = _finite(command.get("edge_margin", command.get("edgeMargin")))
        if margin is not None:
            self.margin = int(_clamp(margin, 0, 100))
        click_delay = _finite(command.get("click_delay_ms", command.get("clickDelayMs")))
        if click_delay is not None:
            self.click_delay_ms = int(_clamp(click_delay, 0, 500))
        idle = _finite(command.get("idle_seconds", command.get("idleSeconds")))
        if idle is not None:
            self.idle_seconds = int(_clamp(idle, 10, 3600))
        self._audit("configure", f"area={round(self.area, 3)} margin={self.margin} idle={self.idle_seconds}")
        return {
            "accepted": True,
            "type": "configure",
            "area": round(self.area, 3),
            "position": {"x": round(self.position_x, 3), "y": round(self.position_y, 3)},
            "edge_margin": self.margin,
            "click_delay_ms": self.click_delay_ms,
            "idle_seconds": self.idle_seconds,
        }

    # ------------------------------------------------------------- action API

    def process_action(
        self,
        action_id: str,
        params: dict[str, Any] | None = None,
        *,
        source: str = "gesture",
        confidence: float | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            reason = self._auto_disable_reason_locked(time.monotonic())
            if reason:
                self._auto_disable_locked(reason)
            if not self.enabled:
                return self._reject("Desktop control is off. Turn it on in the Desktop Control panel.", action_id)
            if self.emergency_stopped:
                return self._reject("Emergency stop is latched. Restart the backend after checking the controls.", action_id)
            spec = self.registry.get(action_id)
            if spec is None:
                self._audit("blocked_unknown", action_id)
                self._db_audit(
                    "desktop_blocked", action_type=action_id, outcome="blocked",
                    detail="Unknown desktop action id was refused.",
                )
                return self._reject(f"Unknown desktop action '{action_id}' was refused.", action_id)
            if spec.tier == 3:
                self._blocked_result(spec, "tier_3")
                return {
                    "accepted": False,
                    "status": "blocked",
                    "action_id": spec.id,
                    "label": spec.label,
                    "tier": 3,
                    "message": "This action is blocked for safety.",
                }
            try:
                clean = self.registry.validate_params(spec.id, params)
            except ActionValidationError as exc:
                self._audit("invalid", f"{spec.id}: {exc}")
                return self._reject(str(exc), spec.id)
            if source == "gesture":
                value = _finite(confidence)
                if value is None:
                    return self._reject("Gesture action is missing its confidence.", spec.id)
                if value < self.min_confidence:
                    return self._reject("Below the gesture confidence floor; nothing was executed.", spec.id)
            prepared, preview = self._prepare_locked(spec, clean)
            if prepared is None:
                return {
                    "accepted": False,
                    "status": "blocked",
                    "action_id": spec.id,
                    "label": spec.label,
                    "tier": spec.tier,
                    "message": preview,
                }
            if spec.tier == 2:
                return self._queue_approval_locked(spec, prepared, source, target=preview, intent_id=None)
            return self._execute_locked(spec, prepared, source=source)

    def run_text(self, text: str, *, source: str = "voice") -> dict[str, Any]:
        parsed = parse_command(text, self.registry, dictation_active=self._dictation_active)
        if not parsed.handled:
            return {
                "handled": False,
                "understood": False,
                "status": "not_desktop",
                "message": "",
                "result": None,
                "approval": None,
                "intent": None,
            }
        with self._lock:
            intent_id = uuid.uuid4().hex
            created = _iso_now()
            actions: list[dict[str, Any]] = []
            if parsed.action_id:
                spec = self.registry.get(parsed.action_id)
                actions.append(
                    {
                        "type": "desktop.action",
                        "target": parsed.action_id,
                        "payload": {"action_id": parsed.action_id, "params": parsed.params},
                        "description": parsed.label or parsed.action_id,
                        "preview": parsed.message,
                        "risk": spec.risk if spec else "low",
                        "reversible": False,
                    }
                )
            plan = {
                "actions": actions,
                "warnings": [],
                "examples": [],
                "approval_required": True,
                "module": "hgi",
                "required_permissions": ["device_control"],
                "source": source,
            }
            approval_id = None
            status = "needs_clarification"
            if parsed.kind == "blocked":
                status = "blocked"
            elif parsed.kind == "action" and parsed.tier == 1:
                status = "approved"
            elif parsed.kind == "action" and parsed.tier == 2:
                status = "awaiting_approval"
                approval_id = secrets.token_urlsafe(24)
            elif parsed.kind == "action" and parsed.tier == 3:
                status = "blocked"

            record = IntentRecord(
                id=intent_id,
                raw_text=text.strip(),
                status=status,
                plan_json=json.dumps(plan, ensure_ascii=False),
                approval_id=approval_id,
                approval_required=True,
                created_at=created,
                updated_at=created,
            )
            self._store_required().create_intent(record)
            steps = {
                "UNDERSTAND": ("done", parsed.explanation or parsed.message),
                "PLAN": (
                    "done" if parsed.kind == "action" else "blocked",
                    parsed.message if parsed.kind != "action" else f"Planned {parsed.label} (Tier {parsed.tier}).",
                ),
                "APPROVE": ("pending", "Waiting for explicit approval."),
                "EXECUTE": ("pending", "Not started."),
                "VERIFY": ("pending", "Not started."),
                "REPORT": ("pending", "Not started."),
            }
            self._write_steps(intent_id, steps, created)
            self._db_audit(
                "desktop_propose", action_type=parsed.action_id, risk=parsed.tier and f"tier{parsed.tier}",
                outcome=status, detail=f"Voice command parsed as {parsed.kind} (Tier {parsed.tier}).",
                intent_id=intent_id,
            )

            action_label = parsed.action_id or ""
            result: dict[str, Any] | None = None
            approval: dict[str, Any] | None = None
            message = parsed.message

            if parsed.kind == "clarify":
                self._store_required().append_audit(
                    intent_id=intent_id, event="report", outcome="needs_clarification",
                    detail=parsed.message, created_at=_iso_now(),
                )
                self._store_required().update_intent(intent_id, "needs_clarification", _iso_now())
                self._set_step(intent_id, "APPROVE", "skipped", "Clarification needed before a plan exists.")
                self._set_step(intent_id, "EXECUTE", "skipped", "Nothing was executed.")
                self._set_step(intent_id, "VERIFY", "skipped", "Nothing to verify.")
                self._set_step(intent_id, "REPORT", "done", "Clarification requested; nothing was executed.")
            elif parsed.kind == "blocked":
                self._blocked_result(None, parsed.action_id or "voice_command")
                self._set_step(intent_id, "APPROVE", "blocked", "Tier 3 actions have no approval override.")
                self._set_step(intent_id, "EXECUTE", "skipped", "Nothing was executed.")
                self._set_step(intent_id, "VERIFY", "skipped", "Nothing to verify.")
                self._set_step(intent_id, "REPORT", "done", "This action is blocked for safety.")
                self._store_required().update_intent(intent_id, "blocked", _iso_now())
                message = "This action is blocked for safety."
            elif parsed.kind == "action" and parsed.action_id and parsed.tier == 1:
                spec = self.registry.require(parsed.action_id)
                prepared, preview = self._prepare_locked(spec, parsed.params)
                if prepared is None:
                    result = self._reject(preview, spec.id)
                    status = "blocked"
                    message = preview
                    self._set_step(intent_id, "APPROVE", "skipped", "The action failed allowlist checks.")
                    self._finish_intent(intent_id, result, intent=None, blocked=True)
                else:
                    self._store_required().append_step(intent_id, "APPROVE", "done", "Tier 1 runs immediately; no prompt is required.", _iso_now())
                    self._set_step(intent_id, "EXECUTE", "running", "Running now.")
                    result = self._execute_locked(spec, prepared, source=source, intent_id=intent_id)
                    status = str(result.get("status", "failed"))
                    message = str(result.get("message", ""))
                    self._finish_intent(intent_id, result, intent=intent_id)
                action_label = spec.label
            elif parsed.kind == "action" and parsed.action_id and parsed.tier == 2:
                spec = self.registry.require(parsed.action_id)
                prepared, preview = self._prepare_locked(spec, parsed.params)
                if prepared is None:
                    result = self._reject(preview, spec.id)
                    status = "blocked"
                    message = preview
                    self._set_step(intent_id, "APPROVE", "skipped", "The action failed allowlist checks.")
                    self._finish_intent(intent_id, result, intent=None, blocked=True)
                else:
                    queued = self._queue_approval_locked(spec, prepared, source, target=preview, intent_id=intent_id)
                    approval = queued.get("approval")
                    status = "awaiting_approval"
                    message = queued.get("message", "")
                action_label = spec.label
            elif parsed.kind == "action" and parsed.tier == 3:
                self._set_step(intent_id, "APPROVE", "blocked", "Tier 3 actions have no approval override.")
                self._set_step(intent_id, "EXECUTE", "skipped", "Nothing was executed.")
                self._set_step(intent_id, "VERIFY", "skipped", "Nothing to verify.")
                self._set_step(intent_id, "REPORT", "done", "This action is blocked for safety.")
                self._store_required().update_intent(intent_id, "blocked", _iso_now())
                message = "This action is blocked for safety."

            return {
                "handled": True,
                "understood": parsed.kind == "action",
                "status": status,
                "message": message,
                "kind": parsed.kind,
                "action_id": parsed.action_id,
                "label": action_label,
                "tier": parsed.tier,
                "result": result,
                "approval": approval,
                "intent": self._view_intent(intent_id),
            }

    def approve(self, approval_id: str, approve: bool, via: str = "ui") -> dict[str, Any]:
        with self._lock:
            self._prune_approvals_locked()
            pending = self._pending.pop(approval_id, None)
            if pending is None:
                return {
                    "accepted": False,
                    "status": "rejected",
                    "message": "That approval request is unknown or has expired. Nothing was executed.",
                }
            intent_id = pending.intent_id
            label = pending.action.label
            if not approve:
                self._store_required().append_audit(
                    intent_id=intent_id, event="desktop_rejected", action_type=pending.action.id,
                    target=pending.target, risk=f"tier{pending.action.tier}", outcome="rejected",
                    detail=f"Rejected via {via}.", created_at=_iso_now(),
                )
                self._audit("approval_rejected", f"{pending.action.id} via={via}")
                self._remember(
                    {
                        "action_id": pending.action.id, "label": label, "tier": pending.action.tier,
                        "status": "rejected", "verified": False, "source": via,
                        "detail": "Rejected by the user.",
                    }
                )
                if intent_id:
                    self._reject_intent(intent_id, f"Rejected via {via}.")
                return {
                    "accepted": False,
                    "status": "rejected",
                    "action_id": pending.action.id,
                    "label": label,
                    "message": f"Rejected. {label} was not executed.",
                    "intent": self._view_intent(intent_id) if intent_id else None,
                }

            self._store_required().append_audit(
                intent_id=intent_id, event="desktop_approved", action_type=pending.action.id,
                target=pending.target, risk=f"tier{pending.action.tier}", outcome="approved",
                detail=f"Approved via {via}.", created_at=_iso_now(),
            )
            if intent_id:
                self._set_step(intent_id, "APPROVE", "done", f"Approved via {via}.")
                self._set_step(intent_id, "EXECUTE", "running", "Running now.")
            result = self._execute_locked(pending.action, pending.params, source=via, approved=True, intent_id=intent_id)
            if intent_id:
                self._finish_intent(intent_id, result, intent=intent_id)
            return {
                **result,
                "message": result.get("message", ""),
                "intent": self._view_intent(intent_id) if intent_id else None,
            }

    def reject(self, approval_id: str, via: str = "ui") -> dict[str, Any]:
        return self.approve(approval_id, False, via)

    def _queue_approval_locked(
        self,
        spec: ActionSpec,
        params: dict[str, Any],
        source: str,
        *,
        target: str | None,
        intent_id: str | None,
    ) -> dict[str, Any]:
        approval_id = secrets.token_urlsafe(24)
        now = time.monotonic()
        expires_at = now + self.registry.approval_ttl_ms / 1000
        self._pending[approval_id] = PendingApproval(
            id=approval_id,
            action=spec,
            params=params,
            source=source,
            created_at=_iso_now(),
            expires_at=expires_at,
            intent_id=intent_id,
            target=target,
        )
        if intent_id:
            self._store_required().append_audit(
                intent_id=intent_id, event="desktop_approval_requested", action_type=spec.id,
                target=target, risk=f"tier{spec.tier}", outcome="pending",
                detail=f"Waiting for approval via {source}.", created_at=_iso_now(),
            )
        self._audit("approval_requested", f"{spec.id} source={source} ttl={self.registry.approval_ttl_ms}ms")
        message = (
            f"{spec.label} needs your approval. Approve or deny within "
            f"{round(self.registry.approval_ttl_ms / 1000)} s. "
            "Say approve, hold a thumbs-up for 1.5 s, or use the on-screen buttons. A single pinch cannot approve."
        )
        return {
            "accepted": False,
            "status": "approval_required",
            "action_id": spec.id,
            "label": spec.label,
            "tier": spec.tier,
            "message": message,
            "approval": {
                "approval_id": approval_id,
                "action_id": spec.id,
                "label": spec.label,
                "tier": spec.tier,
                "source": source,
                "target": target,
                "expires_in_ms": int(round((expires_at - now) * 1000)),
            },
        }

    # ---------------------------------------------------------------- executor

    def _prepare_locked(self, spec: ActionSpec, params: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
        clean = dict(params)
        if spec.id == "app.launch":
            name = str(clean.get("name") or "").strip() or None
            path = str(clean.get("path") or "").strip() or None
            entry = self.allowlist.resolve_app(name, path)
            if entry is None:
                query = path or name or "that app"
                return None, (
                    f"'{query}' is not on your app allowlist. Add its exact .exe path in "
                    "Desktop Control → Apps, then try again."
                )
            clean = {"name": entry.label, "path": entry.path}
            return clean, entry.path
        if spec.id == "url.open":
            query = str(clean.get("url") or "").strip()
            entry = self.allowlist.resolve_url(query)
            if entry is not None:
                clean["url"] = entry.url
                return clean, entry.url
            try:
                clean["url"] = validate_url(query)
            except AllowlistError as exc:
                return None, str(exc)
            return clean, clean["url"]
        if spec.id.startswith("shortcut."):
            if not self.allowlist.shortcut_allowed(spec.id):
                return None, f"{spec.label} is turned off in the shortcut allowlist."
            return clean, spec.id
        return clean, self.ACTION_TARGETS.get(spec.id, spec.id)

    def _execute_locked(
        self,
        spec: ActionSpec,
        params: dict[str, Any],
        *,
        source: str,
        approved: bool = False,
        intent_id: str | None = None,
    ) -> dict[str, Any]:
        reason = self._auto_disable_reason_locked(time.monotonic())
        if reason:
            self._auto_disable_locked(reason)
        if not self.enabled:
            return self._reject(self.detail or "Desktop control is off; nothing was executed.", spec.id, intent_id)
        if self.emergency_stopped:
            return self._reject("Emergency stop is latched; nothing was executed.", spec.id, intent_id)
        if spec.tier == 3:
            self._blocked_result(spec, "tier_3", intent_id)
            return {
                "accepted": False, "status": "blocked", "action_id": spec.id,
                "label": spec.label, "tier": 3, "message": "This action is blocked for safety.",
            }
        if spec.tier == 2 and not approved:
            return self._reject("Tier 2 actions need approval; nothing was executed.", spec.id, intent_id)
        if self._driver is None:
            return self._reject("No desktop driver is available; nothing was executed.", spec.id, intent_id)
        now = time.monotonic()
        if not self._allow_rate(now):
            return self._reject("Rate limit reached; the action was dropped.", spec.id, intent_id)

        target = str(params.get("path") or params.get("url") or self.ACTION_TARGETS.get(spec.id, spec.id))
        try:
            detail, ok = self._dispatch_locked(spec, params)
        except BlockedAction as exc:
            self._blocked_result(spec, "executor", intent_id)
            return {
                "accepted": False, "status": "blocked", "action_id": spec.id,
                "label": spec.label, "tier": spec.tier, "message": str(exc),
            }
        except (AllowlistError, ActionError) as exc:
            message = str(exc) or "The action was refused by the allowlist."
            self._audit("allowlist_refused", f"{spec.id}: {message}")
            self._db_audit(
                "desktop_blocked", action_type=spec.id, target=target, risk=f"tier{spec.tier}",
                outcome="blocked", detail=message, intent_id=intent_id,
            )
            self._remember(
                {
                    "action_id": spec.id, "label": spec.label, "tier": spec.tier,
                    "status": "blocked", "verified": False, "source": source, "detail": message,
                }
            )
            return {
                "accepted": False, "status": "blocked", "action_id": spec.id,
                "label": spec.label, "tier": spec.tier, "message": message,
            }
        except DesktopFailsafe as exc:
            self.emergency_stop(f"pyautogui fail-safe during {spec.id}")
            return {
                "accepted": False, "status": "failed", "action_id": spec.id,
                "label": spec.label, "tier": spec.tier,
                "message": f"Fail-safe tripped ({exc}). Emergency stop is latched.",
            }
        except Exception as exc:  # noqa: BLE001 - report a real failure, never fake success
            self._logger.exception("desktop action failed: %s", spec.id)
            message = f"{spec.label} failed: {exc}"
            self._audit("failed", f"{spec.id}: {exc}")
            self._db_audit(
                "desktop_execute", action_type=spec.id, target=target, risk=f"tier{spec.tier}",
                outcome="error", detail=message, intent_id=intent_id,
            )
            self._remember(
                {
                    "action_id": spec.id, "label": spec.label, "tier": spec.tier,
                    "status": "failed", "verified": False, "source": source, "detail": message,
                }
            )
            return {
                "accepted": False, "status": "failed", "action_id": spec.id,
                "label": spec.label, "tier": spec.tier, "message": message,
            }

        status = "verified" if ok else "executed"
        message = f"{spec.label} — verified. {detail}" if ok else f"{spec.label} — executed, not verified. {detail}"
        self._last_activity = time.monotonic()
        self._last_action_source = source
        if source == "gesture":
            self._last_gesture_action_at = self._last_activity
        self._audit("action", f"{spec.id} status={status}")
        self._db_audit(
            "desktop_execute", action_type=spec.id, target=target, risk=f"tier{spec.tier}",
            outcome=status, detail=detail, intent_id=intent_id,
        )
        self._remember(
            {
                "action_id": spec.id, "label": spec.label, "tier": spec.tier,
                "status": status, "verified": ok, "source": source, "detail": detail,
            }
        )
        return {
            "accepted": True,
            "status": status,
            "ok": True,
            "verified": ok,
            "action_id": spec.id,
            "label": spec.label,
            "tier": spec.tier,
            "detail": detail,
            "message": message,
            "target": target,
        }

    def _dispatch_locked(self, spec: ActionSpec, params: dict[str, Any]) -> tuple[str, bool]:
        driver = self._driver
        system = self._system
        action = spec.id

        def require_system() -> Any:
            if system is None:
                raise AllowlistError(f"{spec.label} is not available with the current desktop driver.")
            return system

        if action.startswith("mouse."):
            if action == "mouse.scroll":
                amount = int(round(float(params["delta"])))
                driver.scroll(amount)  # type: ignore[union-attr]
                return f"Scroll delta {amount} was sent; the scroll position is not exposed by the operating system.", False
            if action == "mouse.drag_end":
                x = _finite(params.get("x"))
                y = _finite(params.get("y"))
                if x is not None and y is not None:
                    point = self.map_point(x, y)
                    if point is not None:
                        driver.move_to(point[0], point[1])  # type: ignore[union-attr]
                driver.mouse_up()  # type: ignore[union-attr]
                self.dragging = False
                return "Mouse button released.", False
            x, y = self._point(params)
            driver.move_to(x, y)  # type: ignore[union-attr]
            if action == "mouse.move":
                return self._verify_pointer(x, y, effect=None)
            if action == "mouse.click":
                driver.click()  # type: ignore[union-attr]
                return self._verify_pointer(x, y, effect="click")
            if action == "mouse.double_click":
                driver.double_click()  # type: ignore[union-attr]
                return self._verify_pointer(x, y, effect="double-click")
            if action == "mouse.right_click":
                if system is None or not hasattr(system, "right_click"):
                    raise AllowlistError("Right click is not available with the current desktop driver.")
                system.right_click()
                return self._verify_pointer(x, y, effect="right-click")
            if action == "mouse.drag_start":
                driver.mouse_down()  # type: ignore[union-attr]
                self.dragging = True
                return self._verify_pointer(x, y, effect="drag start")
            if action == "mouse.drag_move":
                if not self.dragging:
                    raise AllowlistError("There is no active drag to move.")
                return self._verify_pointer(x, y, effect="drag move")
            raise AllowlistError(f"Unsupported mouse action '{action}'.")

        if action.startswith("volume."):
            audio = require_system()
            before_level = audio.volume_level() if hasattr(audio, "volume_level") else None
            before_mute = audio.muted() if hasattr(audio, "muted") else None
            if action == "volume.mute":
                if not hasattr(audio, "toggle_mute"):
                    raise AllowlistError("Mute is not available with the current desktop driver.")
                audio.toggle_mute()
                after = audio.muted() if hasattr(audio, "muted") else None
                if before_mute is not None and after is not None and after != before_mute:
                    return f"Mute {'is on' if after else 'is off'} (verified).", True
                return "Mute was toggled, but the system did not report the new state.", False
            audio.volume("up" if action == "volume.up" else "down")
            after_level = audio.volume_level() if hasattr(audio, "volume_level") else None
            if before_level is not None and after_level is not None and abs(after_level - before_level) > 0.001:
                return f"Volume changed from {round(before_level * 100)}% to {round(after_level * 100)}% (verified).", True
            return "The volume key was sent, but the system did not report a measurable level change.", False

        if action.startswith("media."):
            media = {"media.play_pause": "play_pause", "media.next": "next", "media.previous": "previous"}[action]
            require_system().media(media)
            return "The media key was sent; the player state cannot be observed by BOZZ.", False

        if action.startswith("brightness."):
            screen = require_system()
            before = screen.brightness_level() if hasattr(screen, "brightness_level") else None
            screen.brightness("up" if action == "brightness.up" else "down")
            after = screen.brightness_level() if hasattr(screen, "brightness_level") else None
            if before is not None and after is not None and before != after:
                return f"Brightness changed from {before}% to {after}% (verified).", True
            return "The brightness key was sent, but the display level could not be confirmed.", False

        if action == "window.switch":
            window = require_system()
            before = window.active_window_title()
            window.switch_window()
            time.sleep(0.15)
            after = window.active_window_title()
            if after and after != before:
                return f"Active window is now '{after}' (verified).", True
            return f"Alt+Tab was sent; the active window still reports '{after or 'unknown'}'.", False

        if action == "window.show_desktop":
            window = require_system()
            window.show_desktop()
            time.sleep(0.15)
            after = window.active_window_title()
            if after in (None, "", "Program Manager"):
                return "The desktop is in front (verified).", True
            return f"Win+D was sent; the foreground window still reports '{after}'.", False

        if action == "window.minimize":
            window = require_system()
            window.minimize_active()
            time.sleep(0.1)
            state = window.minimized()
            if state is True:
                return "The active window is minimised (verified).", True
            return "The minimise request was sent, but the window does not report as minimised.", False

        if action == "window.maximize":
            window = require_system()
            window.maximize_active()
            time.sleep(0.1)
            state = window.minimized()
            if state is False:
                return "The active window is not minimised after maximise (verified).", True
            return "The maximise request was sent, but the window state did not change.", False

        if action.startswith("browser."):
            browser = require_system()
            browser.browser(action.split(".", 1)[1])
            return "The browser shortcut was sent; the page state cannot be observed by BOZZ.", False

        if action == "screenshot.capture":
            screen = require_system()
            path = screen.screenshot(_pictures_directory())
            exists = Path(path).is_file()
            size = Path(path).stat().st_size if exists else 0
            if exists and size > 0:
                return f"Saved to {path} ({size} bytes) and the file exists (verified).", True
            return f"Screenshot was requested at {path}, but the file could not be confirmed.", False

        if action == "dictation.start":
            self._dictation_active = True
            self._dictation_total = 0
            self._dictation_started_at = time.monotonic()
            self._dictation_last_at = self._dictation_started_at
            self._audit("dictation_start")
            return "Dictation mode is on. Speak, then say 'stop dictation' or press the stop button.", True

        if action == "dictation.stop":
            was_active = self._dictation_active
            self._stop_dictation_locked("voice command")
            if was_active:
                return "Dictation mode is off (verified).", True
            return "Dictation was already off.", False

        if action == "control.emergency_stop":
            self.emergency_stop("voice command")
            return "Emergency stop is latched; camera, gestures and desktop control were stopped.", True

        if action == "app.launch":
            entry = self.allowlist.resolve_app(str(params.get("name") or ""), str(params.get("path") or ""))
            if entry is None:
                raise AllowlistError("That app is no longer on the allowlist.")
            path = validate_app_path(entry.path)
            process_pid = require_system().launch_app(path)
            time.sleep(0.35)
            alive = require_system().pid_alive(process_pid)
            if alive:
                return f"Started {entry.label} (pid {process_pid}) and the process is alive (verified).", True
            return f"Launch of {entry.label} was requested (pid {process_pid}), but the process did not stay alive.", False

        if action == "url.open":
            url = validate_url(str(params.get("url") or ""))
            opened = require_system().open_url(url)
            if opened:
                return f"Asked the default browser to open {url}; the browser destination cannot be observed.", False
            return f"The system refused to open {url}.", False

        if action.startswith("shortcut."):
            keys = spec.keys
            if not keys:
                raise AllowlistError("That shortcut has no key definition.")
            require_system().hotkey(keys)
            return f"Sent {'+'.join(key.upper() for key in keys)}; the app effect cannot be observed.", False

        if action == "dictation.type":
            if not self._dictation_active:
                raise AllowlistError("Text can only be typed while Dictation mode is on.")
            return "Text is only typed through the dictation endpoint.", False

        raise AllowlistError(f"Action '{action}' has no executor.")

    def _point(self, params: dict[str, Any]) -> tuple[int, int]:
        x = _finite(params.get("x"))
        y = _finite(params.get("y"))
        if x is None or y is None:
            raise ActionValidationError("Normalised x and y coordinates are required.")
        point = self.map_point(x, y)
        if point is None:
            raise ActionValidationError("Screen size is unavailable.")
        return point

    def _verify_pointer(self, x: int, y: int, *, effect: str | None) -> tuple[str, bool]:
        getter = getattr(self._driver, "cursor_position", None)
        if getter is None:
            return f"Pointer moved to {x}, {y}; the driver cannot confirm the final position.", False
        try:
            px, py = getter()
        except Exception:  # noqa: BLE001
            return f"Pointer moved to {x}, {y}; the final position could not be read.", False
        if abs(int(px) - x) > 3 or abs(int(py) - y) > 3:
            return f"Pointer reports {px}, {py} instead of {x}, {y}.", False
        if effect is None:
            return f"Pointer is at {x}, {y} (verified).", True
        return f"Pointer reached {x}, {y}; the {effect} effect itself cannot be observed.", False

    def _reject(self, reason: str, action_id: str, intent_id: str | None = None) -> dict[str, Any]:
        spec = self.registry.get(action_id)
        self._audit("rejected", f"{action_id}: {reason}")
        self._db_audit(
            "desktop_rejected", action_type=action_id, outcome="rejected", detail=reason, intent_id=intent_id,
        )
        self._remember(
            {
                "action_id": action_id,
                "label": spec.label if spec else action_id,
                "tier": spec.tier if spec else None,
                "status": "rejected",
                "verified": False,
                "source": "command",
                "detail": reason,
            }
        )
        return {
            "accepted": False,
            "status": "rejected",
            "action_id": action_id,
            "message": reason,
        }

    def _blocked_result(self, spec: ActionSpec | None, reason: str, intent_id: str | None = None) -> None:
        action_id = spec.id if spec else reason
        label = spec.label if spec else "Blocked command"
        self._audit("blocked", f"{action_id}: {reason}")
        self._db_audit(
            "desktop_blocked", action_type=action_id, risk="high", outcome="blocked",
            detail="Tier 3 action refused before any operating-system call.", intent_id=intent_id,
        )
        self._remember(
            {
                "action_id": action_id, "label": label, "tier": 3,
                "status": "blocked", "verified": False, "source": "command",
                "detail": "This action is blocked for safety.",
            }
        )

    # ------------------------------------------------------------------- audit

    def _remember(self, entry: dict[str, Any]) -> None:
        self._actions.appendleft({**entry, "at": _iso_now()})

    def _mouse_done(self, action_id: str, label: str, detail: str, *, source: str) -> None:
        now = time.monotonic()
        self._remember(
            {
                "action_id": action_id, "label": label, "tier": 1,
                "status": "executed", "verified": False, "source": source, "detail": detail,
            }
        )
        if now - self._last_mouse_db_audit >= 1.0:
            self._last_mouse_db_audit = now
            self._db_audit(
                "desktop_execute", action_type=action_id, target="screen", risk="tier1",
                outcome="executed", detail=detail,
            )

    def _audit_move(self, x: int, y: int, dragging: bool = False) -> None:
        now = time.monotonic()
        if now - self._move_log_at < 1.0:
            self._move_log_skipped += 1
            return
        skipped = self._move_log_skipped
        self._move_log_skipped = 0
        self._move_log_at = now
        action = "drag_move" if dragging else "move"
        suffix = f" suppressed_since_last={skipped}" if skipped else ""
        self._audit(action, f"x={x} y={y}{suffix}")

    def _audit(self, action: str, detail: str = "") -> None:
        stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        line = f"{stamp} {action} {detail}".rstrip()
        self._logger.info("desktop %s", line)
        try:
            self._log_path.parent.mkdir(parents=True, exist_ok=True)
            with self._log_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError:
            self._logger.warning("desktop audit log could not be written")

    def _store_required(self) -> IntentStore:
        if self._store is None:
            from app.db.database import Database

            self._store = IntentStore(Database(self.settings.database_path))
        return self._store

    def _db_audit(
        self,
        event: str,
        *,
        action_type: str | None = None,
        target: str | None = None,
        risk: str | None = None,
        outcome: str = "ok",
        detail: str = "",
        intent_id: str | None = None,
    ) -> None:
        try:
            self._store_required().append_audit(
                intent_id=intent_id,
                event=event,
                action_type=action_type,
                target=target,
                risk=risk,
                outcome=outcome,
                detail=detail[:500],
                created_at=_iso_now(),
            )
        except Exception:  # noqa: BLE001 - audit failure must not crash control
            self._logger.warning("desktop audit row could not be written")

    # --------------------------------------------------------------- allowlist

    def recent_audit(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._store_required().list_audit(min(max(limit, 1), 500))
        return [row for row in rows if str(row.get("event", "")).startswith("desktop_")]

    def allowlist_view(self) -> dict[str, Any]:
        return {
            "actions": self.registry.describe(),
            "allowlist": self.allowlist.snapshot(),
            "approval_ttl_ms": self.registry.approval_ttl_ms,
            "rate_limit_per_second": self.registry.rate_limit,
            "blocked_message": self.registry.blocked_message,
            "tiers": {
                "1": "Runs immediately when control is on.",
                "2": "Needs a fresh on-screen, voice or thumbs-up approval every time.",
                "3": "Blocked with no override in this version.",
            },
            "dictation": {
                "max_chars_per_utterance": self.registry.dictation_max_chars,
                "max_total_chars": self.registry.dictation_max_total,
                "idle_timeout_sec": self.registry.dictation_idle_seconds,
            },
        }

    def add_app(self, label: str, path: str, confirm: bool) -> dict[str, Any]:
        entry = self.allowlist.add_app(label, path, confirm)
        self._db_audit("desktop_allowlist", action_type="app.add", target=entry["path"], outcome="ok", detail=f"Added app {entry['label']}.")
        return entry

    def remove_app(self, path: str, confirm: bool) -> None:
        self.allowlist.remove_app(path, confirm)
        self._db_audit("desktop_allowlist", action_type="app.remove", target=path, outcome="ok", detail="Removed an app from the allowlist.")

    def add_url(self, label: str, url: str, confirm: bool) -> dict[str, Any]:
        entry = self.allowlist.add_url(label, url, confirm)
        self._db_audit("desktop_allowlist", action_type="url.add", target=entry["url"], outcome="ok", detail=f"Added website {entry['label']}.")
        return entry

    def remove_url(self, url: str, confirm: bool) -> None:
        self.allowlist.remove_url(url, confirm)
        self._db_audit("desktop_allowlist", action_type="url.remove", target=url, outcome="ok", detail="Removed a website from the allowlist.")

    def set_shortcuts(self, ids: list[str], confirm: bool) -> dict[str, Any]:
        snapshot = self.allowlist.set_shortcuts(ids, confirm)
        self._db_audit("desktop_allowlist", action_type="shortcuts.set", outcome="ok", detail=f"Enabled {len(ids)} shortcut(s).")
        return snapshot

    def update_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            return self._configure(payload)

    def dictation_type(self, text: str) -> dict[str, Any]:
        with self._lock:
            if not self.enabled:
                return self._reject("Desktop control is off; dictated text was not typed.", "dictation.type")
            if self.emergency_stopped:
                return self._reject("Emergency stop is latched; dictated text was not typed.", "dictation.type")
            if not self._dictation_active:
                return self._reject("Dictation mode is off, so nothing was typed into the focused window.", "dictation.type")
            value = text.strip()
            if not value:
                return self._reject("There was no dictated text to type.", "dictation.type")
            try:
                clean = self.registry.validate_params("dictation.type", {"text": value})
            except ActionValidationError as exc:
                return self._reject(str(exc), "dictation.type")
            now = time.monotonic()
            if now - self._dictation_last_at > self.registry.dictation_idle_seconds:
                self._stop_dictation_locked("silence timeout")
                return self._reject(
                    f"Dictation stopped after {self.registry.dictation_idle_seconds} s of silence. Turn it on again to continue.",
                    "dictation.type",
                )
            if self._dictation_total + len(value) > self.registry.dictation_max_total:
                self._stop_dictation_locked("character limit")
                return self._reject(
                    f"Dictation stopped at the {self.registry.dictation_max_total}-character session limit. Nothing more was typed.",
                    "dictation.type",
                )
            if self._system is None:
                return self._reject("No keyboard driver is available; nothing was typed.", "dictation.type")
            if not self._allow_rate(now):
                return self._reject("Rate limit reached; dictated text was dropped.", "dictation.type")
            try:
                self._system.write_text(value)
            except Exception as exc:  # noqa: BLE001 - report the real failure
                self._logger.exception("dictation typing failed")
                return self._reject(f"Dictation typing failed: {exc}", "dictation.type")
            self._dictation_total += len(value)
            self._dictation_last_at = now
            self._last_activity = now
            self._audit("dictation_type", f"chars={len(value)} total={self._dictation_total}")
            self._db_audit(
                "desktop_execute", action_type="dictation.type", target="focused_window", risk="tier2",
                outcome="executed", detail=f"Typed {len(value)} dictated characters; content was not logged.",
            )
            self._remember(
                {
                    "action_id": "dictation.type", "label": "Type dictated text", "tier": 2,
                    "status": "executed", "verified": False, "source": "voice",
                    "detail": f"Typed {len(value)} characters; the target app cannot be verified.",
                }
            )
            return {
                "accepted": True,
                "status": "executed",
                "verified": False,
                "action_id": "dictation.type",
                "label": "Type dictated text",
                "tier": 2,
                "message": f"Typed {len(value)} dictated characters. The text itself was not logged and the target app cannot be verified.",
                "dictation": {
                    "active": True,
                    "remaining_chars": self.registry.dictation_max_total - self._dictation_total,
                },
            }

    def stop_dictation(self, reason: str = "user request") -> dict[str, Any]:
        with self._lock:
            was_active = self._dictation_active
            self._stop_dictation_locked(reason)
            return {
                "accepted": was_active,
                "status": "verified" if was_active else "executed",
                "message": "Dictation mode is off." if was_active else "Dictation was already off.",
                "dictation": {"active": False, "remaining_chars": self.registry.dictation_max_total},
            }

    def _stop_dictation_locked(self, reason: str) -> bool:
        if not self._dictation_active:
            return False
        self._dictation_active = False
        self._dictation_total = 0
        self._dictation_started_at = 0.0
        self._dictation_last_at = 0.0
        self._audit("dictation_stop", reason)
        self._db_audit("desktop_dictation_stop", action_type="dictation.stop", outcome="ok", detail=f"Dictation stopped: {reason}.")
        return True

    # -------------------------------------------------------------- approvals

    def _prune_approvals_locked(self) -> None:
        now = time.monotonic()
        expired = [key for key, item in self._pending.items() if item.expires_at <= now]
        for key in expired:
            item = self._pending.pop(key)
            self._audit("approval_expired", item.action.id)
            self._db_audit(
                "desktop_rejected", action_type=item.action.id, target=item.target,
                risk=f"tier{item.action.tier}", outcome="rejected",
                detail="Approval expired after the countdown; nothing was executed.", intent_id=item.intent_id,
            )
            self._remember(
                {
                    "action_id": item.action.id, "label": item.action.label, "tier": item.action.tier,
                    "status": "rejected", "verified": False, "source": item.source,
                    "detail": "Approval expired; nothing was executed.",
                }
            )
            if item.intent_id:
                self._reject_intent(item.intent_id, "Approval expired; nothing was executed.")

    def _reject_all_pending_locked(self, reason: str) -> None:
        for item in list(self._pending.values()):
            self._pending.pop(item.id, None)
            self._db_audit(
                "desktop_rejected", action_type=item.action.id, target=item.target,
                risk=f"tier{item.action.tier}", outcome="rejected", detail=reason,
            )
            if item.intent_id:
                self._reject_intent(item.intent_id, reason)

    # ------------------------------------------------------------ intents/view

    def _write_steps(self, intent_id: str, steps: dict[str, tuple[str, str]], at: str) -> None:
        store = self._store_required()
        for step in ("UNDERSTAND", "PLAN", "APPROVE", "EXECUTE", "VERIFY", "REPORT"):
            status, detail = steps[step]
            store.append_step(intent_id, step, status, detail, at)

    def _set_step(self, intent_id: str, step: str, status: str, detail: str) -> None:
        self._store_required().append_step(intent_id, step, status, detail, _iso_now())

    def _reject_intent(self, intent_id: str, reason: str) -> None:
        store = self._store_required()
        store.append_step(intent_id, "APPROVE", "error", reason, _iso_now())
        store.append_step(intent_id, "EXECUTE", "skipped", "Nothing was executed.", _iso_now())
        store.append_step(intent_id, "VERIFY", "skipped", "Nothing to verify.", _iso_now())
        store.append_step(intent_id, "REPORT", "done", reason, _iso_now())
        store.update_intent(intent_id, "rejected", _iso_now())
        store.append_audit(
            intent_id=intent_id, event="report", outcome="rejected", detail=reason, created_at=_iso_now(),
        )

    def _finish_intent(self, intent_id: str, result: dict[str, Any], *, intent: str | None, blocked: bool = False) -> None:
        del intent
        store = self._store_required()
        status = str(result.get("status", "failed"))
        ok = bool(result.get("verified"))
        detail = str(result.get("detail") or result.get("message") or "")
        if status in ("verified", "executed"):
            store.append_step(intent_id, "EXECUTE", "done", str(result.get("message", "")), _iso_now())
            verify_status = "done" if ok else "done"
            store.append_step(intent_id, "VERIFY", verify_status, detail, _iso_now())
            summary = (
                f"Completed and verified: {result.get('label')}."
                if ok
                else f"Executed, not verified: {result.get('label')}. {detail}"
            )
            report = {
                "summary": summary,
                "actions": [{"type": "desktop.action", "target": result.get("action_id"), "ok": True, "detail": detail}],
                "verification": [
                    {"action": 1, "ok": ok, "detail": detail, "source": "desktop_state"}
                ],
                "done_allowed": ok,
                "finished_at": _iso_now(),
            }
            final_status = "reported" if ok else "executed"
            store.append_step(intent_id, "REPORT", "done", summary, _iso_now())
            store.update_intent(intent_id, final_status, _iso_now(), json.dumps(report, ensure_ascii=False))
            store.append_audit(
                intent_id=intent_id, event="verify", action_type=result.get("action_id"),
                risk="tier1", outcome="ok" if ok else "unverified", detail=detail, created_at=_iso_now(),
            )
            store.append_audit(
                intent_id=intent_id, event="report", outcome=final_status, detail=summary, created_at=_iso_now(),
            )
            return
        if status == "blocked" or blocked:
            store.append_step(intent_id, "EXECUTE", "skipped", "Blocked before execution.", _iso_now())
            store.append_step(intent_id, "VERIFY", "skipped", "Nothing to verify.", _iso_now())
            store.append_step(intent_id, "REPORT", "done", detail or "Blocked for safety.", _iso_now())
            store.update_intent(intent_id, "blocked", _iso_now())
            return
        store.append_step(intent_id, "EXECUTE", "error", detail or "The action failed.", _iso_now())
        store.append_step(intent_id, "VERIFY", "skipped", "Verification was not reached.", _iso_now())
        store.append_step(intent_id, "REPORT", "done", detail or "The action failed.", _iso_now())
        store.update_intent(intent_id, "failed", _iso_now())

    def _view_intent(self, intent_id: str | None) -> dict[str, Any] | None:
        if not intent_id:
            return None
        record = self._store_required().get_intent(intent_id)
        if record is None:
            return None
        plan = json.loads(record["plan_json"])
        rows = self._store_required().list_steps(intent_id)
        latest: dict[str, dict[str, Any]] = {}
        for row in rows:
            latest[row["step"]] = {
                "step": row["step"], "status": row["status"], "detail": row["detail"], "at": row["created_at"],
            }
        steps = [
            latest.get(step, {"step": step, "status": "pending", "detail": "Not started.", "at": None})
            for step in ("UNDERSTAND", "PLAN", "APPROVE", "EXECUTE", "VERIFY", "REPORT")
        ]
        report = json.loads(record["report_json"]) if record.get("report_json") else None
        evidence = report.get("verification", []) if report else []
        approval_state = {
            "awaiting_approval": "pending",
            "approved": "approved",
            "reported": "approved",
            "executed": "approved",
            "rejected": "rejected",
            "needs_clarification": "not_requested",
            "blocked": "not_requested",
            "failed": "approved",
        }.get(record["status"], "not_requested")
        error_items = [
            {"stage": step["step"], "detail": step["detail"]}
            for step in steps
            if step["status"] in ("error", "blocked") and str(step["detail"]).strip()
        ]
        done_allowed = record["status"] == "reported" and bool(evidence) and all(item.get("ok") for item in evidence)
        task = {
            "id": record["id"],
            "module": "hgi",
            "stages": steps,
            "required_permissions": plan.get("required_permissions", ["device_control"]),
            "approval_state": approval_state,
            "errors": error_items,
            "verification_evidence": evidence,
            "done_allowed": done_allowed,
        }
        return {
            "id": record["id"],
            "text": record["raw_text"],
            "status": record["status"],
            "understood": record["status"] not in ("unrecognized", "blocked", "needs_clarification"),
            "approval_required": bool(record["approval_required"]),
            "approval_id": record["approval_id"],
            "module": "hgi",
            "required_permissions": plan.get("required_permissions", ["device_control"]),
            "approval_state": approval_state,
            "errors": error_items,
            "verification_evidence": evidence,
            "done_allowed": done_allowed,
            "task": task,
            "message": self._intent_message(record["status"], steps, report),
            "warnings": plan.get("warnings", []),
            "examples": plan.get("examples", []),
            "actions": [
                {key: value for key, value in action.items() if key != "payload"}
                for action in plan.get("actions", [])
            ],
            "steps": steps,
            "report": report,
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
        }

    @staticmethod
    def _intent_message(status: str, steps: list[dict[str, Any]], report: dict[str, Any] | None) -> str:
        by_step = {step["step"]: step for step in steps}
        if status == "awaiting_approval":
            return by_step["PLAN"]["detail"] + " Waiting for approval."
        if status == "needs_clarification":
            return by_step["UNDERSTAND"]["detail"] or by_step["PLAN"]["detail"]
        if status == "blocked":
            return by_step["PLAN"]["detail"]
        if status == "rejected":
            return "Rejected. Nothing was executed."
        if report:
            return str(report.get("summary", "Finished."))
        return status

    # ------------------------------------------------------------------ hotkey

    def _start_hotkey(self) -> None:
        if not self.hotkey_enabled or self._hotkey is not None:
            return
        if not self.pynput_loaded:
            self.detail = "The Ctrl+Alt+Q global hotkey needs pynput; use the Emergency Stop button."
            return
        try:
            from pynput import keyboard

            listener = keyboard.GlobalHotKeys({self.emergency_hotkey: self._on_hotkey})
            listener.daemon = True
            listener.start()
            self._hotkey = listener
            self._logger.info("desktop emergency hotkey registered")
        except Exception as exc:  # noqa: BLE001 - UI still offers the button
            self._hotkey = None
            self.detail = f"Global hotkey unavailable: {exc}. Use the Emergency Stop button."
            self._logger.warning("desktop emergency hotkey failed: %s", exc)

    def _stop_hotkey(self, threaded: bool = False) -> None:
        listener = self._hotkey
        self._hotkey = None
        if listener is None:
            return
        if threaded:
            threading.Thread(target=self._safe_hotkey_stop, args=(listener,), daemon=True).start()
            return
        self._safe_hotkey_stop(listener)

    @staticmethod
    def _safe_hotkey_stop(listener: Any) -> None:
        try:
            listener.stop()
        except Exception:  # noqa: BLE001 - listener may already be gone
            pass

    def _on_hotkey(self) -> None:
        self._logger.warning("desktop emergency hotkey pressed")
        self.emergency_stop("Ctrl+Alt+Q global hotkey")


def validate_url(value: str) -> str:
    """Public wrapper so the executor and tests share one URL rule."""
    from app.desktop.actions import normalize_url

    return normalize_url(value)

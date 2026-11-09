"""Typed operating-system driver used by the desktop action service.

Only the action executor in ``controller.py`` calls this module. It exposes a
small, fixed method set: there is no generic keyboard, no shell execution and
no arbitrary file operation. App launching uses an argument list with
``shell=False`` and an exact, pre-resolved allowlisted path.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Protocol
import os
import subprocess
import time
import webbrowser


class SystemUnavailable(RuntimeError):
    pass


class UnsupportedAction(RuntimeError):
    pass


class SystemDriver(Protocol):
    @property
    def capabilities(self) -> dict[str, bool]: ...

    def size(self) -> tuple[int, int]: ...

    def cursor_position(self) -> tuple[int, int]: ...

    def move_to(self, x: int, y: int) -> None: ...

    def click(self) -> None: ...

    def double_click(self) -> None: ...

    def right_click(self) -> None: ...

    def mouse_down(self) -> None: ...

    def mouse_up(self) -> None: ...

    def scroll(self, amount: int) -> None: ...

    def volume(self, direction: str) -> None: ...

    def volume_level(self) -> float | None: ...

    def muted(self) -> bool | None: ...

    def media(self, action: str) -> None: ...

    def brightness(self, direction: str) -> None: ...

    def brightness_level(self) -> int | None: ...

    def active_window_title(self) -> str | None: ...

    def minimized(self) -> bool | None: ...

    def minimize_active(self) -> None: ...

    def maximize_active(self) -> None: ...

    def switch_window(self) -> None: ...

    def show_desktop(self) -> None: ...

    def browser(self, action: str) -> None: ...

    def hotkey(self, keys: tuple[str, ...]) -> None: ...

    def write_text(self, text: str) -> None: ...

    def screenshot(self, directory: Path) -> Path: ...

    def launch_app(self, path: str) -> int: ...

    def pid_alive(self, pid: int) -> bool: ...

    def open_url(self, url: str) -> bool: ...


def _pictures_dir() -> Path:
    home = Path.home()
    pictures = home / "Pictures"
    if not pictures.is_dir():
        pictures = home / "Pictures"
        pictures.mkdir(parents=True, exist_ok=True)
    return pictures


class WindowsSystemDriver:
    """pyautogui + Windows API + pycaw with honest capability reporting."""

    MEDIA_KEYS = {
        "play_pause": "playpause",
        "next": "nexttrack",
        "previous": "prevtrack",
    }

    def __init__(self, *, enable_hotkeys: bool = True) -> None:
        import pyautogui

        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0
        self._pg = pyautogui
        self._enable_hotkeys = enable_hotkeys
        self._volume_controller: Any = None
        self._brightness_module: Any = None
        self._processes: dict[int, subprocess.Popen[Any]] = {}
        self._load_volume()
        self._load_brightness()

    # ------------------------------------------------------------ capability
    def _load_volume(self) -> None:
        try:
            from ctypes import cast, POINTER
            from comtypes import CLSCTX_ALL
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

            device = AudioUtilities.GetSpeakers()
            interface = getattr(device, "Activate", None)
            if interface is None:
                raise RuntimeError("Audio endpoint has no Activate method.")
            volume = interface(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            self._volume_controller = cast(volume, POINTER(IAudioEndpointVolume))
        except Exception:  # noqa: BLE001 - optional audio dependency
            self._volume_controller = None

    def _load_brightness(self) -> None:
        try:
            import screen_brightness_control as sbc

            self._brightness_module = sbc
        except Exception:  # noqa: BLE001 - optional brightness dependency
            self._brightness_module = None

    @property
    def capabilities(self) -> dict[str, bool]:
        return {
            "mouse": True,
            "keyboard": self._enable_hotkeys,
            "volume": self._volume_controller is not None,
            "media": True,
            "brightness": self._brightness_module is not None,
            "window": os.name == "nt",
            "screenshot": True,
            "app_launch": True,
        }

    # ------------------------------------------------------------------ mouse
    def size(self) -> tuple[int, int]:
        size = self._pg.size()
        return int(size[0]), int(size[1])

    def cursor_position(self) -> tuple[int, int]:
        point = self._pg.position()
        return int(point[0]), int(point[1])

    def move_to(self, x: int, y: int) -> None:
        self._pg.moveTo(x, y, 0)

    def click(self) -> None:
        self._pg.click()

    def double_click(self) -> None:
        self._pg.doubleClick()

    def right_click(self) -> None:
        self._pg.click(button="right")

    def mouse_down(self) -> None:
        self._pg.mouseDown()

    def mouse_up(self) -> None:
        self._pg.mouseUp()

    def scroll(self, amount: int) -> None:
        self._pg.scroll(amount)

    # ------------------------------------------------------------------ audio
    def volume(self, direction: str) -> None:
        if self._volume_controller is not None:
            step = 0.05
            current = float(self._volume_controller.GetMasterVolumeLevelScalar())
            target = max(0.0, min(1.0, current + (step if direction == "up" else -step)))
            self._volume_controller.SetMasterVolumeLevelScalar(target, None)
            return
        self._pg.press("volumeup" if direction == "up" else "volumedown")

    def volume_level(self) -> float | None:
        if self._volume_controller is None:
            return None
        try:
            return float(self._volume_controller.GetMasterVolumeLevelScalar())
        except Exception:  # noqa: BLE001
            return None

    def muted(self) -> bool | None:
        if self._volume_controller is None:
            return None
        try:
            return bool(self._volume_controller.GetMute())
        except Exception:  # noqa: BLE001
            return None

    def toggle_mute(self) -> None:
        if self._volume_controller is not None:
            current = bool(self._volume_controller.GetMute())
            self._volume_controller.SetMute(0 if current else 1, None)
            return
        self._pg.press("volumemute")

    def media(self, action: str) -> None:
        key = self.MEDIA_KEYS.get(action)
        if not key:
            raise UnsupportedAction(f"Unknown media action '{action}'.")
        self._pg.press(key)

    def brightness(self, direction: str) -> None:
        if self._brightness_module is not None:
            current = self._brightness_module.get_brightness()
            value = current[0] if isinstance(current, list) else current
            target = max(0, min(100, int(value) + (10 if direction == "up" else -10)))
            self._brightness_module.set_brightness(target)
            return
        self._pg.press("brightnessup" if direction == "up" else "brightnessdown")

    def brightness_level(self) -> int | None:
        if self._brightness_module is None:
            return None
        try:
            current = self._brightness_module.get_brightness()
            value = current[0] if isinstance(current, list) else current
            return int(value)
        except Exception:  # noqa: BLE001 - the display may not expose a level
            return None

    # ----------------------------------------------------------------- window
    def _foreground(self) -> int | None:
        if os.name != "nt":
            return None
        try:
            import ctypes

            return int(ctypes.windll.user32.GetForegroundWindow())
        except Exception:  # noqa: BLE001
            return None

    def active_window_title(self) -> str | None:
        handle = self._foreground()
        if not handle:
            return None
        try:
            import ctypes

            length = int(ctypes.windll.user32.GetWindowTextLengthW(handle))
            buffer = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(handle, buffer, length + 1)
            return buffer.value or None
        except Exception:  # noqa: BLE001
            return None

    def minimized(self) -> bool | None:
        handle = self._foreground()
        if not handle:
            return None
        try:
            import ctypes

            return bool(ctypes.windll.user32.IsIconic(handle))
        except Exception:  # noqa: BLE001
            return None

    def minimize_active(self) -> None:
        handle = self._foreground()
        if not handle:
            raise UnsupportedAction("No active window to minimise.")
        import ctypes

        ctypes.windll.user32.ShowWindow(handle, 6)

    def maximize_active(self) -> None:
        handle = self._foreground()
        if not handle:
            raise UnsupportedAction("No active window to maximise.")
        import ctypes

        ctypes.windll.user32.ShowWindow(handle, 3)

    def switch_window(self) -> None:
        self._pg.hotkey("alt", "tab")

    def show_desktop(self) -> None:
        self._pg.hotkey("win", "d")

    # ---------------------------------------------------------------- browser
    def browser(self, action: str) -> None:
        keys = {
            "back": ("alt", "left"),
            "forward": ("alt", "right"),
            "zoom_in": ("ctrl", "+"),
            "zoom_out": ("ctrl", "-"),
        }.get(action)
        if not keys:
            raise UnsupportedAction(f"Unknown browser action '{action}'.")
        self._pg.hotkey(*keys)

    def hotkey(self, keys: tuple[str, ...]) -> None:
        if not keys or len(keys) > 3:
            raise UnsupportedAction("Shortcut key list is invalid.")
        allowed = {"ctrl", "alt", "shift", "win", "c", "v", "z", "y", "s", "a", "t", "w"}
        if any(key not in allowed for key in keys):
            raise UnsupportedAction("Shortcut contains a key that is not allowlisted.")
        self._pg.hotkey(*keys)

    # ------------------------------------------------------------------ text
    def write_text(self, text: str) -> None:
        if not text:
            return
        for index, line in enumerate(text.replace("\r\n", "\n").split("\n")):
            if index:
                self._pg.press("enter")
            if line:
                self._pg.write(line, interval=0.01)

    # -------------------------------------------------------------- files/app
    def screenshot(self, directory: Path) -> Path:
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = directory / f"bozz-screenshot-{stamp}.png"
        counter = 1
        while path.exists():
            path = directory / f"bozz-screenshot-{stamp}-{counter}.png"
            counter += 1
        self._pg.screenshot(str(path))
        return path

    def launch_app(self, path: str) -> int:
        process = subprocess.Popen(  # noqa: S603 - explicit arg list, no shell
            [path],
            shell=False,
            close_fds=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._processes[process.pid] = process
        return int(process.pid)

    def pid_alive(self, pid: int) -> bool:
        process = self._processes.get(pid)
        if process is not None:
            return process.poll() is None
        if os.name != "nt":
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False
        try:
            import ctypes

            handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
            if not handle:
                return False
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        except Exception:  # noqa: BLE001
            return False

    def open_url(self, url: str) -> bool:
        try:
            return bool(webbrowser.open(url, new=2, autoraise=True))
        except Exception:  # noqa: BLE001
            return False

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)


def pictures_directory() -> Path:
    return _pictures_dir()

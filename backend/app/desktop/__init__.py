"""Local desktop control adapter for BOZZ gestures, voice and approvals."""

from app.desktop.actions import (
    ActionError,
    ActionRegistry,
    ActionSpec,
    ActionValidationError,
    AllowlistError,
    AllowlistStore,
    BlockedAction,
)
from app.desktop.commands import ParsedCommand, parse_command
from app.desktop.controller import (
    ControlRect,
    DesktopController,
    DesktopDriver,
    DesktopFailsafe,
)

__all__ = [
    "ActionError",
    "ActionRegistry",
    "ActionSpec",
    "ActionValidationError",
    "AllowlistError",
    "AllowlistStore",
    "BlockedAction",
    "ControlRect",
    "DesktopController",
    "DesktopDriver",
    "DesktopFailsafe",
    "ParsedCommand",
    "parse_command",
]

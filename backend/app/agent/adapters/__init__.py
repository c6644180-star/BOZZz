"""Execution adapters for the computer agent."""

from app.agent.adapters.accessibility import AccessibilityAdapter
from app.agent.adapters.base import AdapterError, AdapterUnavailable, ExecutionAdapter
from app.agent.adapters.browser import BrowserAdapter
from app.agent.adapters.desktop import DesktopAdapter
from app.agent.adapters.official_api import OfficialApiAdapter

__all__ = [
    "AccessibilityAdapter",
    "AdapterError",
    "AdapterUnavailable",
    "BrowserAdapter",
    "DesktopAdapter",
    "ExecutionAdapter",
    "OfficialApiAdapter",
]

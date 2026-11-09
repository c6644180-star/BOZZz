"""Replaceable local AI provider contracts.

Nothing in the application depends on a specific vendor. A provider adapter
reports honest availability and turns a bounded conversation into text. It may
never execute an action; actions flow through the intent and permission layers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class ProviderStatus:
    available: bool
    provider: str
    configured_model: str
    models: list[str]
    detail: str | None = None


class LocalProviderError(RuntimeError):
    """A local model service could not safely complete the requested operation."""


@runtime_checkable
class AIProvider(Protocol):
    provider_name: str

    @property
    def configured_model(self) -> str: ...

    def status(self) -> ProviderStatus: ...

    def chat(self, message: str, history: list[dict[str, str]]) -> str: ...

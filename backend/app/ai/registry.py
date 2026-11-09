"""Provider registry: one place to list and select replaceable local adapters."""

from __future__ import annotations

from functools import lru_cache

from app.ai.base import AIProvider, ProviderStatus
from app.ai.ollama import OllamaProvider
from app.core.config import get_settings


class ProviderRegistry:
    def __init__(self, providers: dict[str, AIProvider], default_name: str | None = None):
        if not providers:
            raise ValueError("At least one AI provider must be registered.")
        self._providers = dict(providers)
        self._default_name = default_name or next(iter(self._providers))
        if self._default_name not in self._providers:
            raise KeyError(f"Default provider '{self._default_name}' is not registered.")

    def get(self, name: str) -> AIProvider:
        try:
            return self._providers[name]
        except KeyError as exc:
            raise KeyError(f"Unknown AI provider '{name}'.") from exc

    def default(self) -> AIProvider:
        return self._providers[self._default_name]

    def statuses(self) -> list[ProviderStatus]:
        return [provider.status() for provider in self._providers.values()]


@lru_cache(maxsize=1)
def get_registry() -> ProviderRegistry:
    settings = get_settings()
    return ProviderRegistry(
        providers={"ollama": OllamaProvider(settings)},
        default_name="ollama",
    )

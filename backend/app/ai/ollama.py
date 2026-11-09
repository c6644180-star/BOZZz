from __future__ import annotations

from typing import Any
from urllib import error, request
import json

from app.ai.base import LocalProviderError, ProviderStatus
from app.core.config import Settings

__all__ = ["OllamaProvider", "LocalProviderError", "ProviderStatus"]


class OllamaProvider:
    """Adapter for a local Ollama HTTP service. Uses the standard library only."""

    provider_name = "ollama"

    def __init__(self, settings: Settings):
        self._base_url = settings.ollama_base_url.rstrip("/")
        self._model = settings.ollama_model
        self._timeout = settings.request_timeout_seconds

    @property
    def configured_model(self) -> str:
        return self._model

    def status(self) -> ProviderStatus:
        try:
            body = self._request_json("GET", "/api/tags")
            models = [item.get("name", "") for item in body.get("models", []) if item.get("name")]
            if self._model not in models:
                return ProviderStatus(
                    available=False,
                    provider=self.provider_name,
                    configured_model=self._model,
                    models=models,
                    detail=f'Configured model "{self._model}" is not installed.',
                )
            return ProviderStatus(True, self.provider_name, self._model, models)
        except LocalProviderError as exc:
            return ProviderStatus(False, self.provider_name, self._model, [], str(exc))

    def chat(self, message: str, history: list[dict[str, str]]) -> str:
        status = self.status()
        if not status.available:
            raise LocalProviderError(status.detail or "Local AI provider is unavailable.")

        messages = [
            {
                "role": "system",
                "content": (
                    "You are BOZZ, a local-first private personal AI assistant. "
                    "Be concise, helpful, and honest about your capabilities. "
                    "Never claim you completed an action you did not perform. "
                    "You cannot execute computer actions; the user reviews and approves "
                    "structured actions separately."
                ),
            },
            *history[-12:],
            {"role": "user", "content": message},
        ]
        body = self._request_json("POST", "/api/chat", {
            "model": self._model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.45, "num_predict": 480},
        })
        content = body.get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise LocalProviderError("The local model returned no response.")
        return content.strip()

    def _request_json(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = request.Request(
            f"{self._base_url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            with request.urlopen(req, timeout=self._timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:240]
            raise LocalProviderError(f"Ollama returned HTTP {exc.code}: {detail}") from exc
        except error.URLError as exc:
            raise LocalProviderError("Ollama is not reachable at the configured local address.") from exc
        except TimeoutError as exc:
            raise LocalProviderError("The local model took too long to respond.") from exc
        except json.JSONDecodeError as exc:
            raise LocalProviderError("Ollama returned an invalid response.") from exc

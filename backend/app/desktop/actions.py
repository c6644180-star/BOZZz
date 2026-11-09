"""Backend-enforced desktop action allowlist.

The only source of executable action ids is ``config/desktop_actions.json``.
The frontend can choose which of the documented Tier 2 apps, websites and
shortcuts are enabled, but it can never add a new action id or a raw key
combination. Every message is validated against the typed parameter schema
before it reaches an operating-system call.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit, urlunsplit
import json
import math
import re
import threading

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ACTIONS_PATH = REPO_ROOT / "config" / "desktop_actions.json"
BLOCKED_MESSAGE = "This action is blocked for safety."

ALLOWED_APP_SUFFIXES = frozenset({".exe", ".lnk"})
BLOCKED_APP_SUFFIXES = frozenset(
    {".bat", ".cmd", ".ps1", ".vbs", ".js", ".jse", ".wsf", ".msi", ".scr", ".com"}
)


class ActionError(Exception):
    """Base class for action validation and allowlist failures."""


class ActionValidationError(ActionError):
    pass


class AllowlistError(ActionError):
    pass


class BlockedAction(ActionError):
    def __init__(self, action_id: str, label: str):
        self.action_id = action_id
        self.label = label
        super().__init__(BLOCKED_MESSAGE)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class ParamSpec:
    kind: str
    required: bool = True
    minimum: float | None = None
    maximum: float | None = None
    max_length: int | None = None


@dataclass(frozen=True)
class ActionSpec:
    id: str
    tier: int
    label: str
    risk: str
    verify: str
    params: dict[str, ParamSpec] = field(default_factory=dict)
    keys: tuple[str, ...] = ()

    @property
    def executable(self) -> bool:
        return self.tier in (1, 2)


@dataclass(frozen=True)
class AppEntry:
    label: str
    path: str
    added_at: str


@dataclass(frozen=True)
class UrlEntry:
    label: str
    url: str
    added_at: str


class ActionRegistry:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else DEFAULT_ACTIONS_PATH
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        if int(payload.get("version", 0)) != 1:
            raise ActionError(f"Unsupported desktop action config version in {self.path}.")
        self.approval_ttl_ms = max(3_000, min(int(payload.get("approval_ttl_ms", 10_000)), 30_000))
        self.rate_limit = max(1, min(int(payload.get("rate_limit_per_second", 60)), 240))
        self.blocked_message = str(payload.get("blocked_message") or BLOCKED_MESSAGE)
        dictation = payload.get("dictation") or {}
        self.dictation_max_chars = max(50, min(int(dictation.get("max_chars_per_utterance", 600)), 2_000))
        self.dictation_max_total = max(
            self.dictation_max_chars, min(int(dictation.get("max_total_chars", 5_000)), 20_000)
        )
        self.dictation_idle_seconds = max(
            5, min(int(dictation.get("idle_timeout_sec", 30)), 120)
        )
        self.seed_urls = tuple(
            UrlEntry(str(item.get("label") or item.get("url")), str(item.get("url")), _iso_now())
            for item in payload.get("seed_urls", [])
        )
        self.seed_apps = tuple(
            AppEntry(str(item.get("label") or "App"), str(item.get("path")), _iso_now())
            for item in payload.get("seed_apps", [])
        )

        self._actions: dict[str, ActionSpec] = {}
        for raw in payload.get("actions", []):
            spec = self._parse_action(raw)
            if spec.id in self._actions:
                raise ActionError(f"Duplicate desktop action id '{spec.id}'.")
            self._actions[spec.id] = spec
        if not self._actions:
            raise ActionError("The desktop action allowlist is empty.")

    @staticmethod
    def _parse_action(raw: dict[str, Any]) -> ActionSpec:
        action_id = str(raw.get("id") or "").strip()
        if not action_id or any(char.isspace() for char in action_id):
            raise ActionError("Every desktop action needs a non-empty id without spaces.")
        tier = raw.get("tier")
        if tier not in (1, 2, 3):
            raise ActionError(f"Desktop action '{action_id}' has an invalid tier.")
        params: dict[str, ParamSpec] = {}
        for name, schema in (raw.get("params") or {}).items():
            if not isinstance(schema, dict):
                raise ActionError(f"Invalid parameter schema for '{action_id}.{name}'.")
            kind = str(schema.get("type") or "")
            if kind not in ("number", "string"):
                raise ActionError(f"Unsupported parameter type for '{action_id}.{name}'.")
            params[str(name)] = ParamSpec(
                kind=kind,
                required=schema.get("required", True) is not False,
                minimum=float(schema["min"]) if "min" in schema else None,
                maximum=float(schema["max"]) if "max" in schema else None,
                max_length=int(schema["maxLength"]) if "maxLength" in schema else None,
            )
        keys = tuple(str(key) for key in raw.get("keys", []))
        return ActionSpec(
            id=action_id,
            tier=int(tier),
            label=str(raw.get("label") or action_id),
            risk=str(raw.get("risk") or "low"),
            verify=str(raw.get("verify") or "none"),
            params=params,
            keys=keys,
        )

    def get(self, action_id: str) -> ActionSpec | None:
        return self._actions.get(action_id)

    def require(self, action_id: str) -> ActionSpec:
        spec = self.get(action_id)
        if spec is None:
            raise ActionValidationError(f"Unknown desktop action '{action_id}'.")
        return spec

    @property
    def actions(self) -> tuple[ActionSpec, ...]:
        return tuple(self._actions.values())

    @property
    def shortcut_ids(self) -> tuple[str, ...]:
        return tuple(spec.id for spec in self._actions.values() if spec.id.startswith("shortcut."))

    @property
    def tier1(self) -> tuple[ActionSpec, ...]:
        return tuple(spec for spec in self._actions.values() if spec.tier == 1)

    def describe(self) -> list[dict[str, Any]]:
        return [
            {
                "id": spec.id,
                "tier": spec.tier,
                "label": spec.label,
                "risk": spec.risk,
                "verify": spec.verify,
                "execute": spec.executable,
                "params": {
                    name: {
                        "type": item.kind,
                        "required": item.required,
                        "min": item.minimum,
                        "max": item.maximum,
                        "max_length": item.max_length,
                    }
                    for name, item in spec.params.items()
                },
            }
            for spec in self.actions
        ]

    def validate_params(self, action_id: str, params: Any) -> dict[str, Any]:
        spec = self.require(action_id)
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise ActionValidationError("Action parameters must be an object.")
        unknown = set(params) - set(spec.params)
        if unknown:
            raise ActionValidationError(
                f"Unexpected parameter(s) for '{action_id}': {', '.join(sorted(unknown))}."
            )
        clean: dict[str, Any] = {}
        for name, schema in spec.params.items():
            if name not in params:
                if schema.required:
                    raise ActionValidationError(f"Missing required parameter '{name}' for '{action_id}'.")
                continue
            value = params[name]
            if schema.kind == "number":
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ActionValidationError(f"Parameter '{name}' must be a number.")
                number = float(value)
                if not math.isfinite(number):
                    raise ActionValidationError(f"Parameter '{name}' must be finite.")
                if schema.minimum is not None and number < schema.minimum:
                    raise ActionValidationError(f"Parameter '{name}' is below {schema.minimum}.")
                if schema.maximum is not None and number > schema.maximum:
                    raise ActionValidationError(f"Parameter '{name}' is above {schema.maximum}.")
                clean[name] = number
            else:
                if not isinstance(value, str):
                    raise ActionValidationError(f"Parameter '{name}' must be text.")
                if schema.max_length is not None and len(value) > schema.max_length:
                    raise ActionValidationError(
                        f"Parameter '{name}' is longer than {schema.max_length} characters."
                    )
                if any(ord(char) < 32 and char not in "\n\t" for char in value):
                    raise ActionValidationError(f"Parameter '{name}' contains control characters.")
                clean[name] = value
        return clean


def normalize_url(value: str) -> str:
    raw = value.strip()
    if not raw or len(raw) > 2048:
        raise AllowlistError("Enter a website URL up to 2048 characters.")
    if any(char.isspace() for char in raw):
        raise AllowlistError("A website URL cannot contain spaces.")
    if "://" not in raw:
        # Reject non-web schemes before adding https; otherwise "javascript:x"
        # would silently become "https://javascript:x".
        prefix = re.match(r"^([a-zA-Z][a-zA-Z0-9+.-]*):", raw)
        if prefix:
            scheme = prefix.group(1)
            remainder = raw[len(scheme) + 1 :]
            looks_like_host = "." in scheme or (bool(remainder) and remainder[:1].isdigit())
            if not looks_like_host:
                raise AllowlistError("Only http:// and https:// websites are allowed.")
        raw = f"https://{raw}"
    parts = urlsplit(raw)
    if parts.scheme.lower() not in ("http", "https"):
        raise AllowlistError("Only http:// and https:// websites are allowed.")
    if not parts.netloc:
        raise AllowlistError("The website URL needs a host name.")
    if parts.username or parts.password:
        raise AllowlistError("Website URLs with embedded credentials are not allowed.")
    path = parts.path or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, parts.query, ""))


def validate_app_path(value: str) -> str:
    raw = value.strip().strip('"')
    if not raw or len(raw) > 1024:
        raise AllowlistError("Enter the full path to an app.")
    candidate = Path(raw)
    if not candidate.is_absolute():
        raise AllowlistError("The app path must be absolute, for example C:\\Windows\\System32\\notepad.exe.")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise AllowlistError(f"That app path does not exist: {exc}") from exc
    if not resolved.is_file():
        raise AllowlistError("The app path must point to a file, not a folder.")
    suffix = resolved.suffix.lower()
    if suffix in BLOCKED_APP_SUFFIXES:
        raise AllowlistError("Scripts, installers and command files cannot be launched from the allowlist.")
    if suffix not in ALLOWED_APP_SUFFIXES:
        raise AllowlistError("Only .exe and .lnk apps can be launched.")
    return str(resolved)


class AllowlistStore:
    """User-managed Tier 2 apps, websites and shortcut subset.

    It stores choices only. It never invents action ids and cannot widen the
    action registry loaded from ``config/desktop_actions.json``.
    """

    def __init__(self, path: Path, registry: ActionRegistry):
        self.path = Path(path)
        self.registry = registry
        self._lock = threading.RLock()
        self._data: dict[str, Any] | None = None

    def _load(self) -> dict[str, Any]:
        if self._data is not None:
            return self._data
        payload: dict[str, Any] | None = None
        if self.path.is_file():
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = None
        if not isinstance(payload, dict):
            payload = {}
        apps: list[dict[str, Any]] = []
        for raw in payload.get("apps", []):
            try:
                path = validate_app_path(str(raw.get("path") or ""))
            except AllowlistError:
                continue
            apps.append(
                {
                    "label": str(raw.get("label") or Path(path).stem),
                    "path": path,
                    "added_at": str(raw.get("added_at") or _iso_now()),
                }
            )
        if not apps:
            for seed in self.registry.seed_apps:
                try:
                    path = validate_app_path(seed.path)
                except AllowlistError:
                    continue
                apps.append({"label": seed.label, "path": path, "added_at": _iso_now()})
        urls: list[dict[str, Any]] = []
        for raw in payload.get("urls", []):
            try:
                url = normalize_url(str(raw.get("url") or ""))
            except AllowlistError:
                continue
            urls.append(
                {
                    "label": str(raw.get("label") or url),
                    "url": url,
                    "added_at": str(raw.get("added_at") or _iso_now()),
                }
            )
        if not urls:
            urls = [
                {"label": seed.label, "url": normalize_url(seed.url), "added_at": _iso_now()}
                for seed in self.registry.seed_urls
            ]
        allowed_shortcuts = set(self.registry.shortcut_ids)
        enabled = payload.get("shortcuts")
        shortcuts = (
            [item for item in enabled if item in allowed_shortcuts]
            if isinstance(enabled, list)
            else list(self.registry.shortcut_ids)
        )
        self._data = {"version": 1, "apps": apps, "urls": urls, "shortcuts": shortcuts}
        self._save()
        return self._data

    def _save(self) -> None:
        assert self._data is not None
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            data = self._load()
            enabled = set(data["shortcuts"])
            return {
                "apps": [dict(item) for item in data["apps"]],
                "urls": [dict(item) for item in data["urls"]],
                "shortcuts": [
                    {
                        "id": spec.id,
                        "label": spec.label,
                        "keys": list(spec.keys),
                        "enabled": spec.id in enabled,
                    }
                    for spec in self.registry.actions
                    if spec.id.startswith("shortcut.")
                ],
            }

    def add_app(self, label: str, path: str, confirm: bool) -> dict[str, Any]:
        if not confirm:
            raise AllowlistError("Adding an app needs explicit confirmation.")
        with self._lock:
            data = self._load()
            resolved = validate_app_path(path)
            if any(item["path"].casefold() == resolved.casefold() for item in data["apps"]):
                raise AllowlistError("That app is already on the allowlist.")
            entry = {
                "label": (label.strip() or Path(resolved).stem)[:120],
                "path": resolved,
                "added_at": _iso_now(),
            }
            data["apps"].append(entry)
            self._save()
            return dict(entry)

    def remove_app(self, path: str, confirm: bool) -> None:
        if not confirm:
            raise AllowlistError("Removing an app needs explicit confirmation.")
        with self._lock:
            data = self._load()
            before = len(data["apps"])
            data["apps"] = [
                item for item in data["apps"] if item["path"].casefold() != str(path).strip().casefold()
            ]
            if len(data["apps"]) == before:
                raise AllowlistError("That app is not on the allowlist.")
            self._save()

    def add_url(self, label: str, url: str, confirm: bool) -> dict[str, Any]:
        if not confirm:
            raise AllowlistError("Adding a website needs explicit confirmation.")
        with self._lock:
            data = self._load()
            normalized = normalize_url(url)
            if any(item["url"] == normalized for item in data["urls"]):
                raise AllowlistError("That website is already on the allowlist.")
            entry = {"label": (label.strip() or normalized)[:120], "url": normalized, "added_at": _iso_now()}
            data["urls"].append(entry)
            self._save()
            return dict(entry)

    def remove_url(self, url: str, confirm: bool) -> None:
        if not confirm:
            raise AllowlistError("Removing a website needs explicit confirmation.")
        with self._lock:
            data = self._load()
            normalized = normalize_url(url)
            before = len(data["urls"])
            data["urls"] = [item for item in data["urls"] if item["url"] != normalized]
            if len(data["urls"]) == before:
                raise AllowlistError("That website is not on the allowlist.")
            self._save()

    def set_shortcuts(self, ids: Iterable[str], confirm: bool) -> dict[str, Any]:
        if not confirm:
            raise AllowlistError("Changing shortcuts needs explicit confirmation.")
        requested = {str(item) for item in ids}
        unknown = requested - set(self.registry.shortcut_ids)
        if unknown:
            raise AllowlistError(f"Unknown shortcut id(s): {', '.join(sorted(unknown))}.")
        with self._lock:
            data = self._load()
            data["shortcuts"] = sorted(requested)
            self._save()
            return self.snapshot()

    def resolve_app(self, name: str | None, path: str | None) -> AppEntry | None:
        with self._lock:
            data = self._load()
        apps = [AppEntry(**item) for item in data["apps"]]
        if path:
            target = path.strip().casefold()
            for item in apps:
                if item.path.casefold() == target:
                    return item
            return None
        query = (name or "").strip().casefold()
        if not query:
            return None
        for item in apps:
            if query in (item.label.casefold(), Path(item.path).stem.casefold(), Path(item.path).name.casefold()):
                return item
        return None

    def resolve_url(self, query: str) -> UrlEntry | None:
        value = query.strip().casefold()
        with self._lock:
            data = self._load()
        urls = [UrlEntry(**item) for item in data["urls"]]
        for item in urls:
            if value in (item.label.casefold(), item.url.casefold()):
                return item
        matches = [
            item
            for item in urls
            if value and (value in item.label.casefold() or value in item.url.casefold())
        ]
        return matches[0] if len(matches) == 1 else None

    def is_url_listed(self, url: str) -> bool:
        try:
            normalized = normalize_url(url)
        except AllowlistError:
            return False
        with self._lock:
            data = self._load()
        return any(item["url"] == normalized for item in data["urls"])

    def shortcut_allowed(self, action_id: str) -> bool:
        with self._lock:
            data = self._load()
        return action_id in data["shortcuts"]

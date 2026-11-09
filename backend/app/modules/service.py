"""Read models for the module catalogue and error panel."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from app.modules.permissions import PermissionManager
from app.modules.registry import MODULES, PERMISSIONS, require_module

REGISTRY_VERSION = "1.0.0"

# Only server-enforced grants are marked. Declared-but-unconnected permissions
# stay visible without implying that this milestone already gates that feature.
_ENFORCED: frozenset[tuple[str, str]] = frozenset(
    {
        ("intent-map", "file_access"),
        ("spatial-desktop", "file_access"),
        ("holo-projects", "file_access"),
        ("bci", "message_data"),
        ("hgi", "device_control"),
    }
)


class ModuleService:
    def __init__(self, permissions: PermissionManager):
        self._permissions = permissions

    def modules(self) -> list[dict[str, Any]]:
        grants = self._permissions.all_grants()
        result: list[dict[str, Any]] = []
        for module in MODULES:
            items = []
            for permission_id in module.permissions:
                definition = next(p for p in PERMISSIONS if p.id == permission_id)
                items.append(
                    {
                        "id": definition.id,
                        "label": definition.label,
                        "description": definition.description,
                        "scope": definition.scope,
                        "risk": definition.risk,
                        "granted": bool(grants[module.id].get(permission_id, False)),
                        "enforced": (module.id, permission_id) in _ENFORCED,
                    }
                )
            result.append(
                {
                    "id": module.id,
                    "name": module.name,
                    "version": module.version,
                    "status": module.status,
                    "description": module.description,
                    "status_detail": module.status_detail,
                    "route": module.route,
                    "capabilities": list(module.capabilities),
                    "permissions": items,
                    "errors": list(module.errors),
                }
            )
        return result

    def module(self, module_id: str) -> dict[str, Any]:
        require_module(module_id)
        return next(item for item in self.modules() if item["id"] == module_id)

    def permission_catalog(self) -> list[dict[str, Any]]:
        return [asdict(item) for item in PERMISSIONS]

    def errors(self, limit: int = 10) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        for module in MODULES:
            for detail in module.errors:
                errors.append(
                    {
                        "module": module.id,
                        "title": f"{module.name} error",
                        "detail": detail,
                        "created_at": None,
                        "outcome": "error",
                    }
                )
        for entry in self._permissions.recent_denials(limit):
            errors.append(
                {
                    "module": entry["target"] or "unknown",
                    "title": "Permission denied",
                    "detail": entry["detail"],
                    "created_at": entry["created_at"],
                    "outcome": "error",
                }
            )
        return errors[:limit]

    def set_permission(
        self, module_id: str, permission_id: str, granted: bool
    ) -> dict[str, Any]:
        self._permissions.set_permission(module_id, permission_id, granted)
        return self.module(module_id)

    def snapshot(self) -> dict[str, Any]:
        return {
            "registry_version": REGISTRY_VERSION,
            "modules": self.modules(),
            "permissions": self.permission_catalog(),
            "errors": self.errors(),
        }

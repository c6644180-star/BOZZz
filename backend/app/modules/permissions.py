"""Default-off module permissions with local persistence and an audit trail."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Iterable

from app.db.store import IntentStore
from app.modules.registry import require_module, require_permission


class PermissionError(Exception):
    """Base class for permission failures."""


class PermissionDenied(PermissionError):
    def __init__(self, module_id: str, missing: list[str]):
        self.module_id = module_id
        self.missing = missing
        labels = ", ".join(require_permission(item).label for item in missing)
        super().__init__(
            f"{labels} permission is off for module '{module_id}'. "
            "Grant it in Settings → Module permissions."
        )


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class PermissionManager:
    """Reads and writes per-module grants.

    A missing row means OFF. Revoking writes an explicit ``granted = 0`` row so
    the change is visible in the store, and every grant/revoke/denial is appended
    to the existing audit log.
    """

    def __init__(self, store: IntentStore, *, clock: Callable[[], str] = _iso_now):
        self._store = store
        self._clock = clock

    def _validate(self, module_id: str, permission_id: str) -> tuple[Any, Any]:
        try:
            module = require_module(module_id)
        except ValueError as exc:
            raise PermissionError(str(exc)) from exc
        try:
            permission = require_permission(permission_id)
        except ValueError as exc:
            raise PermissionError(str(exc)) from exc
        if permission_id not in module.permissions:
            raise PermissionError(
                f"Module '{module_id}' does not declare the '{permission_id}' permission."
            )
        return module, permission

    def grants(self, module_id: str) -> dict[str, bool]:
        module = require_module(module_id)
        defaults = {permission_id: False for permission_id in module.permissions}
        for row in self._store.list_module_permissions(module_id):
            if row["permission"] in defaults:
                defaults[row["permission"]] = bool(row["granted"])
        return defaults

    def all_grants(self) -> dict[str, dict[str, bool]]:
        from app.modules.registry import MODULES

        return {module.id: self.grants(module.id) for module in MODULES}

    def is_granted(self, module_id: str, permission_id: str) -> bool:
        self._validate(module_id, permission_id)
        return self.grants(module_id).get(permission_id, False)

    def missing(self, module_id: str, permissions: Iterable[str] | None = None) -> list[str]:
        module = require_module(module_id)
        required = list(permissions) if permissions is not None else list(module.permissions)
        for permission_id in required:
            if permission_id not in module.permissions:
                raise PermissionError(
                    f"Module '{module_id}' does not declare the '{permission_id}' permission."
                )
        current = self.grants(module_id)
        return [permission_id for permission_id in required if not current.get(permission_id, False)]

    def enforce(
        self,
        module_id: str,
        permissions: Iterable[str] | None = None,
        *,
        intent_id: str | None = None,
    ) -> None:
        missing = self.missing(module_id, permissions)
        if not missing:
            return
        detail = (
            f"Denied {', '.join(missing)} for module '{module_id}': permission is off."
        )
        self._store.append_audit(
            intent_id=intent_id,
            event="permission_denied",
            action_type=",".join(missing),
            target=module_id,
            risk="high",
            outcome="error",
            detail=detail,
            created_at=self._clock(),
        )
        raise PermissionDenied(module_id, missing)

    def set_permission(self, module_id: str, permission_id: str, granted: bool) -> dict[str, Any]:
        module, permission = self._validate(module_id, permission_id)
        now = self._clock()
        self._store.set_module_permission(module_id, permission_id, granted, now)
        event = "permission_grant" if granted else "permission_revoke"
        outcome = "granted" if granted else "revoked"
        self._store.append_audit(
            intent_id=None,
            event=event,
            action_type=permission_id,
            target=module_id,
            risk=permission.risk,
            outcome=outcome,
            detail=(
                f"{permission.label} {outcome} for {module.name} "
                f"(scope: {permission.scope})."
            ),
            created_at=now,
        )
        return {
            "module_id": module_id,
            "permission": permission_id,
            "granted": bool(granted),
            "updated_at": now,
        }

    def recent_denials(self, limit: int = 20) -> list[dict[str, Any]]:
        entries = self._store.list_audit(max(limit * 5, 100))
        return [entry for entry in entries if entry["event"] == "permission_denied"][:limit]

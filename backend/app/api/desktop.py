from __future__ import annotations

import asyncio
from functools import lru_cache
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.desktop import DesktopController
from app.desktop.actions import ActionValidationError, AllowlistError
from app.modules import PermissionDenied

router = APIRouter(tags=["desktop-control"])
logger = configure_logging(get_settings().log_level)

# TestClient reports "testclient"; it never opens a real network socket.
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}
MAX_MESSAGE_CHARS = 8_000


@lru_cache(maxsize=1)
def get_desktop() -> DesktopController:
    settings = get_settings()
    controller = DesktopController(settings)
    logger.info(
        "desktop controller ready | version=2 | pyautogui=%s | pynput=%s | screen=%s",
        controller.pyautogui_loaded,
        controller.pynput_loaded,
        controller.screen,
    )
    return controller


def _enforce_permission() -> None:
    from app.api.modules import get_permissions

    try:
        get_permissions().enforce("hgi", ["device_control"])
    except PermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _permission_granted() -> bool:
    from app.api.modules import get_permissions

    try:
        return get_permissions().is_granted("hgi", "device_control")
    except Exception:  # noqa: BLE001 - failure to read the grant must fail closed
        return False


class EnableRequest(BaseModel):
    enabled: bool


class CommandRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    source: str = Field(default="voice", max_length=20)


class ActionRequest(BaseModel):
    action_id: str = Field(min_length=1, max_length=80)
    params: dict[str, Any] = Field(default_factory=dict)
    source: str = Field(default="ui", max_length=20)
    confidence: float | None = None


class ApprovalRequest(BaseModel):
    approve: bool = False
    via: str = Field(default="ui", max_length=20)


class DictationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1_000)


class ConfigRequest(BaseModel):
    area: float | None = Field(default=None, ge=0.3, le=1.0)
    position_x: float | None = Field(default=None, ge=-0.5, le=0.5)
    position_y: float | None = Field(default=None, ge=-0.5, le=0.5)
    edge_margin: float | None = Field(default=None, ge=0, le=100)
    click_delay_ms: float | None = Field(default=None, ge=0, le=500)
    idle_seconds: float | None = Field(default=None, ge=10, le=3600)


class PresenceRequest(BaseModel):
    hidden: bool | None = None
    mic_on: bool | None = None
    paused: bool | None = None


class AppAddRequest(BaseModel):
    label: str = Field(default="", max_length=120)
    path: str = Field(min_length=1, max_length=1024)
    confirm: bool = False


class AppRemoveRequest(BaseModel):
    path: str = Field(min_length=1, max_length=1024)
    confirm: bool = False


class UrlAddRequest(BaseModel):
    label: str = Field(default="", max_length=120)
    url: str = Field(min_length=1, max_length=2_048)
    confirm: bool = False


class UrlRemoveRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2_048)
    confirm: bool = False


class ShortcutsRequest(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=40)
    confirm: bool = False


@router.get("/desktop/status")
def desktop_status() -> dict[str, Any]:
    return get_desktop().status()


@router.post("/desktop/enable")
def desktop_enable(payload: EnableRequest) -> dict[str, Any]:
    if payload.enabled:
        _enforce_permission()
    status = get_desktop().enable(payload.enabled)
    if payload.enabled and not status["enabled"]:
        raise HTTPException(status_code=409, detail=status.get("detail") or "Desktop control could not start.")
    return status


@router.post("/desktop/stop")
def desktop_stop() -> dict[str, Any]:
    return get_desktop().emergency_stop("manual emergency stop from the BOZZ interface")


@router.get("/desktop/allowlist")
def desktop_allowlist() -> dict[str, Any]:
    return get_desktop().allowlist_view()


@router.post("/desktop/allowlist/apps")
def desktop_allowlist_add_app(payload: AppAddRequest) -> dict[str, Any]:
    try:
        return get_desktop().add_app(payload.label, payload.path, payload.confirm)
    except AllowlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/desktop/allowlist/apps/remove")
def desktop_allowlist_remove_app(payload: AppRemoveRequest) -> dict[str, Any]:
    try:
        get_desktop().remove_app(payload.path, payload.confirm)
    except AllowlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_desktop().allowlist_view()


@router.post("/desktop/allowlist/urls")
def desktop_allowlist_add_url(payload: UrlAddRequest) -> dict[str, Any]:
    try:
        return get_desktop().add_url(payload.label, payload.url, payload.confirm)
    except AllowlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/desktop/allowlist/urls/remove")
def desktop_allowlist_remove_url(payload: UrlRemoveRequest) -> dict[str, Any]:
    try:
        get_desktop().remove_url(payload.url, payload.confirm)
    except AllowlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_desktop().allowlist_view()


@router.post("/desktop/allowlist/shortcuts")
def desktop_allowlist_shortcuts(payload: ShortcutsRequest) -> dict[str, Any]:
    try:
        return get_desktop().set_shortcuts(payload.ids, payload.confirm)
    except AllowlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/desktop/command")
def desktop_command(payload: CommandRequest) -> dict[str, Any]:
    _enforce_permission()
    return get_desktop().run_text(payload.text, source=payload.source)


@router.post("/desktop/action")
def desktop_action(payload: ActionRequest) -> dict[str, Any]:
    _enforce_permission()
    return get_desktop().process_action(
        payload.action_id,
        payload.params,
        source=payload.source,
        confidence=payload.confidence,
    )


@router.get("/desktop/approvals")
def desktop_approvals() -> dict[str, Any]:
    return {"approvals": get_desktop().pending()}


@router.post("/desktop/approvals/{approval_id}")
def desktop_approval(approval_id: str, payload: ApprovalRequest) -> dict[str, Any]:
    return get_desktop().approve(approval_id, payload.approve, payload.via)


@router.post("/desktop/dictation")
def desktop_dictation(payload: DictationRequest) -> dict[str, Any]:
    _enforce_permission()
    return get_desktop().dictation_type(payload.text)


@router.post("/desktop/dictation/stop")
def desktop_dictation_stop() -> dict[str, Any]:
    return get_desktop().stop_dictation("stop button or voice command")


@router.post("/desktop/config")
def desktop_config(payload: ConfigRequest) -> dict[str, Any]:
    updates = {key: value for key, value in payload.model_dump().items() if value is not None}
    try:
        return get_desktop().update_config(updates)
    except ActionValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/desktop/presence")
def desktop_presence(payload: PresenceRequest) -> dict[str, Any]:
    return get_desktop().set_presence(hidden=payload.hidden, mic_on=payload.mic_on, paused=payload.paused)


@router.get("/desktop/audit")
def desktop_audit(limit: int = Query(default=50, ge=1, le=500)) -> dict[str, Any]:
    return {"entries": get_desktop().recent_audit(limit)}


def _state_message(controller: DesktopController, accepted: int, rejected: int, reason: str | None = None) -> str:
    status = controller.status()
    payload: dict[str, Any] = {
        "type": "state",
        "state": status["state"],
        "enabled": status["enabled"],
        "emergency_stopped": status["emergency_stopped"],
        "connected": True,
        "accepted": accepted,
        "rejected": rejected,
        "pending_approvals": status["pending_approvals"],
        "dictation": status["dictation"],
        "mic_on": status["mic_on"],
        "last_action": status["last_action"],
    }
    if reason:
        payload["reason"] = reason
    return json.dumps(payload)


@router.websocket("/ws/desktop")
async def desktop_socket(websocket: WebSocket) -> None:
    client_host = websocket.client.host if websocket.client else None
    if client_host not in LOCAL_HOSTS:
        await websocket.close(code=1008)
        return

    token = websocket.query_params.get("token")
    controller = get_desktop()
    if not controller.token_valid(token):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    controller.bridge_connected()
    stop = asyncio.Event()
    accepted = 0
    rejected = 0

    async def pump_states() -> None:
        last_emergency = controller.emergency_stopped
        last_enabled = controller.enabled
        last_pending = len(controller.pending())
        cycles = 0
        while not stop.is_set():
            await asyncio.sleep(0.5)
            cycles += 1
            if cycles % 4 == 0 and controller.enabled and not _permission_granted():
                controller.disable("the device control permission was revoked")
            reason = controller.evaluate_auto_disable()
            pending = len(controller.pending())
            if reason or controller.emergency_stopped != last_emergency or controller.enabled != last_enabled:
                last_emergency = controller.emergency_stopped
                last_enabled = controller.enabled
                last_pending = pending
                try:
                    await websocket.send_text(
                        _state_message(
                            controller,
                            accepted,
                            rejected,
                            reason
                            or ("Emergency stop is latched." if last_emergency else None)
                            or (None if last_enabled else "Desktop control was switched off."),
                        )
                    )
                except Exception:  # noqa: BLE001 - socket already closing
                    return
                continue
            if pending != last_pending:
                last_pending = pending
                try:
                    await websocket.send_text(_state_message(controller, accepted, rejected))
                except Exception:  # noqa: BLE001
                    return

    watcher = asyncio.create_task(pump_states())
    try:
        await websocket.send_text(_state_message(controller, accepted, rejected))
        while True:
            raw = await websocket.receive_text()
            if len(raw) > MAX_MESSAGE_CHARS:
                rejected += 1
                continue
            try:
                command = json.loads(raw)
            except json.JSONDecodeError:
                rejected += 1
                continue
            if not isinstance(command, dict):
                rejected += 1
                continue

            request_type = command.get("type")
            if request_type in ("heartbeat", "tracking", "presence"):
                controller.note_tracking()
                hidden = command.get("hidden")
                controller.set_presence(
                    hidden=hidden if isinstance(hidden, bool) else None,
                    mic_on=command.get("mic_on") if isinstance(command.get("mic_on"), bool) else None,
                    paused=command.get("paused") if isinstance(command.get("paused"), bool) else None,
                )
                continue

            if request_type == "action":
                if not _permission_granted():
                    controller.disable("the device control permission was revoked")
                    rejected += 1
                    await websocket.send_text(
                        _state_message(
                            controller,
                            accepted,
                            rejected,
                            "Device control permission is off. Desktop control is disabled.",
                        )
                    )
                    continue
                result = await asyncio.to_thread(
                    controller.process_action,
                    str(command.get("action_id") or ""),
                    command.get("params") if isinstance(command.get("params"), dict) else {},
                    source=str(command.get("source") or "gesture"),
                    confidence=command.get("confidence") if isinstance(command.get("confidence"), (int, float)) else None,
                )
                if result.get("accepted"):
                    accepted += 1
                else:
                    rejected += 1
                await websocket.send_text(json.dumps({"type": "result", **result}))
                continue

            result = await asyncio.to_thread(controller.process, command)
            if result.get("accepted"):
                accepted += 1
                continue
            rejected += 1
            reason = str(result.get("reason") or "Desktop command rejected.")
            if controller.emergency_stopped or "rate limit" not in reason.lower():
                await websocket.send_text(_state_message(controller, accepted, rejected, reason))
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - never crash the app from a socket
        logger.exception("desktop websocket failed")
    finally:
        stop.set()
        watcher.cancel()
        controller.release_drag()
        controller.bridge_disconnected()
        logger.info("desktop websocket closed | accepted=%d rejected=%d", accepted, rejected)

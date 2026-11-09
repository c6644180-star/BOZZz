"""Single source of truth for the BOZZ module catalogue.

Statuses describe the installed code path, not a sensor that happens to be idle.
A module is only ``Ready`` when this repository contains a working route or
frontend surface. Placeholder modules are explicitly ``Not connected``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ModuleStatus = Literal["Not connected", "Simulation", "Ready", "Error"]
Risk = Literal["low", "medium", "high"]

PERMISSION_IDS = (
    "file_access",
    "message_data",
    "camera",
    "microphone",
    "device_control",
    "messaging",
    "network",
)


@dataclass(frozen=True)
class PermissionDefinition:
    id: str
    label: str
    description: str
    scope: str
    risk: Risk


@dataclass(frozen=True)
class ModuleDefinition:
    id: str
    name: str
    version: str
    status: ModuleStatus
    permissions: tuple[str, ...]
    capabilities: tuple[str, ...]
    description: str
    route: str | None
    status_detail: str
    errors: tuple[str, ...] = ()


PERMISSIONS: tuple[PermissionDefinition, ...] = (
    PermissionDefinition(
        id="file_access",
        label="File access folder",
        description="Read and change files only inside the configured BOZZ workspace folder.",
        scope="data/workspace",
        risk="high",
    ),
    PermissionDefinition(
        id="message_data",
        label="Message data",
        description="Store and read conversation text in the local BOZZ database. Nothing is ever sent.",
        scope="Local SQLite conversations and drafts",
        risk="high",
    ),
    PermissionDefinition(
        id="camera",
        label="Camera",
        description="Use the camera for local gesture landmarks. Frames are never recorded or uploaded.",
        scope="Browser camera, only while Gesture Lab is running",
        risk="medium",
    ),
    PermissionDefinition(
        id="microphone",
        label="Microphone",
        description="Capture speech for voice commands and the live audio meter.",
        scope="Browser microphone, only while listening",
        risk="medium",
    ),
    PermissionDefinition(
        id="device_control",
        label="Device control",
        description=(
            "Control the local desktop only through the documented action allowlist. "
            "Off by default, with an emergency stop."
        ),
        scope="Local desktop adapters, enforced by config/desktop_actions.json",
        risk="high",
    ),
    PermissionDefinition(
        id="messaging",
        label="Messaging",
        description="Create or send messages on your behalf. Nothing is sent in this build.",
        scope="Future BCI/BCCI integrations",
        risk="high",
    ),
    PermissionDefinition(
        id="network",
        label="Network",
        description="Contact a remote service. BOZZ core chat stays on the configured local endpoint.",
        scope="Remote endpoints only when a module is connected",
        risk="medium",
    ),
)

PERMISSION_BY_ID = {item.id: item for item in PERMISSIONS}

MODULES: tuple[ModuleDefinition, ...] = (
    ModuleDefinition(
        id="voice",
        name="Voice",
        version="1.0.0",
        status="Ready",
        permissions=("microphone", "network"),
        capabilities=(
            "Browser speech recognition with live captions",
            "Server-side ElevenLabs speech with browser fallback",
            "Real analyser waveform and stop/pause controls",
        ),
        description="Spoken commands and replies through the existing command bar and voice service.",
        route="/chat",
        status_detail=(
            "Voice controls are installed. Microphone use still requires the browser prompt; "
            "network permission is declared for future unattended voice services."
        ),
    ),
    ModuleDefinition(
        id="intent-map",
        name="Intent Map",
        version="1.1.0",
        status="Ready",
        permissions=("file_access",),
        capabilities=(
            "UNDERSTAND → PLAN → APPROVE → EXECUTE → VERIFY → REPORT",
            "Server-side workspace permission check",
            "Filesystem verification evidence before a task can be reported done",
            "Append-only audit trail and recoverable file changes",
        ),
        description="Approval-bound workspace tasks with real verification evidence.",
        route="/intent-map",
        status_detail="The backend enforces file access on planning, workspace reads and execution.",
    ),
    ModuleDefinition(
        id="hgi",
        name="HGI",
        version="2.0.0",
        status="Ready",
        permissions=("camera", "device_control"),
        capabilities=(
            "One local MediaPipe camera pipeline with a typed gesture event bus",
            "Calibration, gesture classifier, cursor and desktop control modes",
            "Three-tier desktop action allowlist enforced by the backend",
            "On-screen approval for sensitive actions, dictation mode and emergency stop",
            "Audit trail for every executed, approved, rejected and blocked action",
        ),
        description="Hand Gesture Intelligence for local gesture and voice desktop input.",
        route="/gesture",
        status_detail=(
            "The engine is installed. The camera stays released until you start Gesture Lab, "
            "and desktop control stays off until you grant device control and switch it on."
        ),
    ),
    ModuleDefinition(
        id="spatial-desktop",
        name="Spatial Desktop",
        version="1.0.0",
        status="Ready",
        permissions=("file_access",),
        capabilities=(
            "Read-only cards for files and folders in folders you allow",
            "Local search and previews with no upload",
            "Approved OS open that blocks executables and scripts",
            "Saved card layouts stored as JSON in the local database",
        ),
        description="Read-only spatial workspace over folders you explicitly allow.",
        route="/spatial",
        status_detail=(
            "The workspace is installed and read-only. File access folders are off by default; "
            "the backend rejects any path outside an allowed folder."
        ),
    ),
    ModuleDefinition(
        id="holo-projects",
        name="Holographic Projects",
        version="1.0.0",
        status="Ready",
        permissions=("file_access",),
        capabilities=(
            "3D folder tree on the monitor from folders you explicitly allow",
            "Read-only model and sidecar byte reads for .glb and .gltf",
            "Hologram exploded view driven by the shared typed model control API",
            "Gesture input only through the existing HGI gesture event bus",
            "Named hologram views saved as JSON with the existing layouts API",
        ),
        description=(
            "A 3D folder workspace on the Projects page. It is a scene drawn on the monitor, "
            "not a real hologram, and it never writes, moves, renames or deletes a file."
        ),
        route="/projects",
        status_detail=(
            "The workspace is installed and read-only. File access is off by default; "
            "the backend rejects any path outside an allowed folder and exposes no file write endpoint."
        ),
    ),
    ModuleDefinition(
        id="l3dme",
        name="L3DME",
        version="1.0.0",
        status="Ready",
        permissions=(),
        capabilities=(
            "Local GLB and glTF file loading with a user file picker",
            "Orbit, zoom, pan, solid, wireframe and transparent modes",
            "Part selection, exploded view and a typed control API",
        ),
        description="Local 3D model viewer. Files stay in the browser and are never uploaded.",
        route="/3d",
        status_detail="The viewer is a frontend-only module; no model bytes reach the backend.",
    ),
    ModuleDefinition(
        id="bci",
        name="BCI",
        version="1.0.0",
        status="Ready",
        permissions=("message_data",),
        capabilities=(
            "Local conversation storage with retention controls",
            "Import plain text, JSON and user-exported WhatsApp chat files",
            "Summaries, unanswered questions, attention markers, drafts and translation",
            "Draft-only output with [CONFIRM] placeholders; no send path exists",
        ),
        description="Communication intelligence workspace. It drafts and summarises locally; it never sends.",
        route="/messages",
        status_detail=(
            "The local workspace is installed. No messaging transport, account or send endpoint exists. "
            "Message data is off by default."
        ),
    ),
    ModuleDefinition(
        id="bcci",
        name="BCCI",
        version="0.1.0",
        status="Not connected",
        permissions=("microphone", "messaging", "network"),
        capabilities=("Clearly labelled call-notification simulation", "Real calls (not connected)"),
        description="Future call control. The /calls page can only simulate a local notification.",
        route="/calls",
        status_detail="No telephony or call transport is connected.",
    ),
    ModuleDefinition(
        id="dei",
        name="DEI",
        version="0.0.0",
        status="Not connected",
        permissions=("device_control", "network"),
        capabilities=("Device registry and controls (planned)",),
        description="Future device environment integration. No devices are controlled here.",
        route="/devices-hub",
        status_detail="No device adapter is connected. The existing /devices page is unchanged.",
    ),
    ModuleDefinition(
        id="memory",
        name="Memory",
        version="1.0.0",
        status="Ready",
        permissions=(),
        capabilities=("Local notes stored in browser localStorage", "No server or cloud sync"),
        description="Browser-local notes and recall surface.",
        route="/memory",
        status_detail="Notes are stored only in this browser profile.",
    ),
)

MODULE_BY_ID = {module.id: module for module in MODULES}


def require_module(module_id: str) -> ModuleDefinition:
    try:
        return MODULE_BY_ID[module_id]
    except KeyError as exc:
        raise ValueError(f"Unknown BOZZ module '{module_id}'.") from exc


def require_permission(permission_id: str) -> PermissionDefinition:
    try:
        return PERMISSION_BY_ID[permission_id]
    except KeyError as exc:
        raise ValueError(f"Unknown permission '{permission_id}'.") from exc

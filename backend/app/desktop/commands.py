"""Deterministic voice grammar for Desktop Control v2.

Only phrases in this module can become desktop actions. The parser never
forwards free text to the operating system: it maps a small English/Tanglish
vocabulary onto action ids that already exist in ``config/desktop_actions.json``.
Anything ambiguous gets a clarification request; anything dangerous is refused
before a plan is created.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import re

from app.desktop.actions import ActionRegistry, BLOCKED_MESSAGE, normalize_url


@dataclass(frozen=True)
class ParsedCommand:
    handled: bool
    kind: str  # action | clarify | blocked | unknown
    action_id: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    label: str = ""
    tier: int | None = None
    message: str = ""
    explanation: str = ""


# Dangerous intent words. Any of these refuses the whole command, regardless of
# the surrounding sentence, because this build has no safe implementation for
# them and no override exists.
_TIER3_PATTERNS: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (re.compile(r"\b(shell|powershell|power shell|command prompt|cmd\.exe|cmd|terminal|bash)\b"), "shell.run", "Running a shell, PowerShell, cmd or terminal"),
    (re.compile(r"\b(run|execute|start)\b.*\b(script|bat|batch|vbs|msi|installer|exe|executable)\b"), "script.run", "Running a script or non-allowlisted executable"),
    (re.compile(r"\b(delete|erase|remove|wipe)\b.*\b(file|folder|directory|everything|all files)\b"), "file.delete", "Deleting files or folders"),
    (re.compile(r"\b(move|rename)\b.*\b(file|folder|directory)\b"), "file.move", "Moving or renaming files"),
    (re.compile(r"\bempty\b.*\b(recycle|trash|bin)\b|\brecycle bin\b.*\bempty\b"), "recycle.empty", "Emptying the recycle bin"),
    (re.compile(r"\b(change|open|edit)\b.*\b(system settings|registry|control panel|windows settings)\b"), "system.settings", "Changing system settings"),
    (re.compile(r"\b(install|uninstall|update|upgrade)\b.*\b(app|application|program|software|windows|driver)\b"), "app.install", "Installing or uninstalling software"),
    (re.compile(r"\b(password|passcode|pin|credentials?|api key|secret key)\b"), "password.read", "Reading or typing passwords or secrets"),
    (re.compile(r"\b(send|message|text|whatsapp|telegram|instagram|sms)\b.*\b(message|msg|chat|reply|dm)\b"), "message.send", "Sending messages"),
    (re.compile(r"\b(send|write|compose)\b.*\b(email|mail)\b"), "email.send", "Sending email"),
    (re.compile(r"\b(pay|payment|transfer|bank|upi|credit card|debit card)\b"), "finance.pay", "Financial actions"),
    (re.compile(r"\b(disable|turn off|stop)\b.*\b(antivirus|defender|firewall|security)\b"), "security.disable", "Disabling security software"),
    (re.compile(r"\b(shut ?down|power off|restart|reboot|log ?off|sign out|sleep the computer)\b"), "power.shutdown", "Shutting down, restarting or logging off"),
    (re.compile(r"\b(press|hold|hit)\b.*\b(key|keys|enter|escape|tab|ctrl|alt|shift|win)\b"), "keyboard.any", "Pressing keys that are not on the shortcut allowlist"),
)

# Web destinations that are safe Tier 2 targets when the user has not typed a
# full URL. They are opened only after the on-screen approval.
_WEB_WORDS = {
    "youtube": "https://www.youtube.com",
    "google": "https://www.google.com",
    "gmail": "https://mail.google.com",
    "maps": "https://www.google.com/maps",
    "github": "https://github.com",
    "wikipedia": "https://www.wikipedia.org",
    "chatgpt": "https://chatgpt.com",
    "spotify": "https://open.spotify.com",
    "netflix": "https://www.netflix.com",
}

_SHORTCUTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^(?:please )?(?:copy|copy this|copy that)$"), "shortcut.copy"),
    (re.compile(r"^(?:please )?(?:paste|paste this|paste that)$"), "shortcut.paste"),
    (re.compile(r"^(?:please )?(?:undo|undo that)$"), "shortcut.undo"),
    (re.compile(r"^(?:please )?(?:redo|redo that)$"), "shortcut.redo"),
    (re.compile(r"^(?:please )?save(?: this| the file)?$"), "shortcut.save"),
    (re.compile(r"^(?:please )?(?:select all|select everything)$"), "shortcut.select_all"),
    (re.compile(r"^(?:please )?(?:new tab|open a new tab)$"), "shortcut.new_tab"),
    (re.compile(r"^(?:please )?(?:close tab|close this tab)$"), "shortcut.close_tab"),
)


def _normalise(text: str) -> str:
    value = text.casefold().strip()
    value = re.sub(r"^(?:bozz|boss|boz|jarvis)[,\s]+", "", value)
    value = re.sub(r"[.!?,;:]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _looks_like_url(value: str) -> bool:
    lowered = value.casefold()
    if lowered.startswith(("http://", "https://")):
        return True
    if " " in lowered:
        return False
    return "." in lowered and not lowered.endswith(".")


def _action(registry: ActionRegistry, action_id: str, params: dict[str, Any] | None = None) -> ParsedCommand:
    spec = registry.get(action_id)
    if spec is None:
        return ParsedCommand(
            handled=True,
            kind="clarify",
            message=f"I do not have a safe action called '{action_id}'.",
            explanation="The command mapped to an action that is not installed.",
        )
    return ParsedCommand(
        handled=True,
        kind="action",
        action_id=spec.id,
        params=params or {},
        label=spec.label,
        tier=spec.tier,
        message=f"Understood: {spec.label}.",
        explanation=f"Matched '{spec.label}' (Tier {spec.tier}).",
    )


def _blocked(action_id: str, label: str) -> ParsedCommand:
    return ParsedCommand(
        handled=True,
        kind="blocked",
        action_id=action_id,
        label=label,
        tier=3,
        message=BLOCKED_MESSAGE,
        explanation=f"{label} is blocked in this version.",
    )


def _clarify(message: str, explanation: str) -> ParsedCommand:
    return ParsedCommand(
        handled=True,
        kind="clarify",
        message=message,
        explanation=explanation,
    )


def parse_command(
    text: str,
    registry: ActionRegistry,
    *,
    dictation_active: bool = False,
) -> ParsedCommand:
    """Map one utterance to an allowlisted action, a clarification, or a refusal."""
    phrase = _normalise(text)
    if not phrase:
        return ParsedCommand(handled=False, kind="unknown")

    # --- single-word wake trigger ---
    # If the user says just "bozz" (or "bozz" as the only word), treat it as
    # a wake-up trigger rather than a desktop action. This lets the AI start
    # listening/listening mode even when the app is minimized or idle.
    wake_words = ("bozz",)
    if phrase in wake_words:
        return ParsedCommand(
            handled=True,
            kind="action",
            action_id="wake.word",
            params={},
            label="Wake BOZZ AI",
            tier=1,
            message="Understood: wake word detected.",
            explanation="Matched wake word 'BOZZ' (Tier 1).",
        )

    for pattern, action_id, label in _TIER3_PATTERNS:
        if pattern.search(phrase):
            return _blocked(action_id, label)

    # Free typing is only allowed through the explicit dictation state.
    if phrase.startswith(("type this ", "type that ")):
        payload = phrase.split(" ", 2)[-1]
        if dictation_active and payload:
            return _action(registry, "dictation.type", {"text": payload})
        return _blocked("typing.free_text", "Typing free text outside dictation mode")
    if re.search(r"\b(type|write|insert)\b", phrase):
        return _blocked("typing.free_text", "Typing free text outside dictation mode")

    # ---------------------------------------------------------------- dictation
    if re.search(r"\b(stop|end|finish)\b.*\b(dictation|typing)\b", phrase) or phrase in (
        "stop dictation",
        "dictation stop",
    ):
        return _action(registry, "dictation.stop")
    if re.search(r"\b(start|begin|open)\b.*\b(dictation|typing)\b", phrase) or phrase in (
        "dictation start",
        "dictation mode",
        "type what i say",
    ):
        return _action(registry, "dictation.start")

    if phrase in ("stop", "stop pannu", "stop it"):
        return _clarify(
            "Do you want to stop dictation, pause media, or emergency stop all desktop control?",
            "The word 'stop' is ambiguous.",
        )
    if phrase in ("pause", "pause pannu"):
        return _clarify(
            "Do you want me to pause media, or pause gesture output? Say 'pause the video' or press P.",
            "The word 'pause' is ambiguous.",
        )
    if phrase in ("open", "open it", "open that"):
        return _clarify(
            "What should I open? Say 'open Notepad' or 'open YouTube'.",
            "The open target is missing.",
        )

    if phrase in ("emergency stop", "stop everything", "stop all control", "stop desktop control"):
        return _action(registry, "control.emergency_stop")

    # ------------------------------------------------------------------ volume
    if re.search(r"\b(unmute|mute)\b", phrase):
        return _action(registry, "volume.mute")
    if re.search(r"\b(volume|sound)\b.*\b(up|increase|raise|higher|jaasthi|jasthi|adhikam)\b", phrase) or phrase in (
        "louder",
        "increase volume",
    ):
        return _action(registry, "volume.up")
    if re.search(r"\b(volume|sound)\b.*\b(down|decrease|lower|kammi|kam)\b", phrase) or phrase in (
        "quieter",
        "decrease volume",
    ):
        return _action(registry, "volume.down")

    # ------------------------------------------------------------------- media
    if re.search(r"\b(next|skip)\b.*\b(track|song|video)\b", phrase) or phrase in ("next track", "next song"):
        return _action(registry, "media.next")
    if re.search(r"\b(previous|prev|last)\b.*\b(track|song|video)\b", phrase) or phrase in (
        "previous track",
        "previous song",
    ):
        return _action(registry, "media.previous")
    if re.search(r"\b(pause|play|resume)\b.*\b(video|music|song|movie|media|playback)\b", phrase) or phrase in (
        "pause pannu music",
        "play music",
        "resume music",
    ):
        return _action(registry, "media.play_pause")

    # --------------------------------------------------------------- brightness
    if re.search(r"\bbrightness\b.*\b(up|increase|raise|higher)\b", phrase):
        return _action(registry, "brightness.up")
    if re.search(r"\bbrightness\b.*\b(down|decrease|lower|kammi)\b", phrase):
        return _action(registry, "brightness.down")

    # ------------------------------------------------------------------ window
    if re.search(r"\b(switch|next|change)\b.*\b(window|app)\b", phrase) or phrase in ("alt tab", "window maathu"):
        return _action(registry, "window.switch")
    if re.search(r"\b(show|go to|open)\b.*\bdesktop\b", phrase) or phrase in ("desktop kaattu", "show my desktop"):
        return _action(registry, "window.show_desktop")
    if re.search(r"\bminimi[sz]e\b", phrase):
        return _action(registry, "window.minimize")
    if re.search(r"\bmaximi[sz]e\b", phrase):
        return _action(registry, "window.maximize")

    # ----------------------------------------------------------------- browser
    if re.search(r"\b(go|browser)\b.*\bback\b", phrase) or phrase in (
        "go back",
        "back",
        "previous page",
        "pinnaadi po",
    ):
        return _action(registry, "browser.back")
    if re.search(r"\b(go|browser)\b.*\bforward\b", phrase) or phrase in (
        "go forward",
        "forward",
        "next page",
        "munnadi po",
    ):
        return _action(registry, "browser.forward")
    if re.search(r"\bzoom\s+in\b", phrase):
        return _action(registry, "browser.zoom_in")
    if re.search(r"\bzoom\s+out\b", phrase):
        return _action(registry, "browser.zoom_out")

    # --------------------------------------------------------------- screenshot
    if re.search(r"\b(screenshot|screen shot|capture screen|capture the screen)\b", phrase):
        return _action(registry, "screenshot.capture")

    # ------------------------------------------------------------------ scroll
    if re.search(r"\bscroll\b.*\bdown\b|\bdown\b.*\bscroll\b", phrase):
        return _action(registry, "mouse.scroll", {"delta": 600})
    if re.search(r"\bscroll\b.*\bup\b|\bup\b.*\bscroll\b", phrase):
        return _action(registry, "mouse.scroll", {"delta": -600})

    # ---------------------------------------------------------------- shortcuts
    for pattern, action_id in _SHORTCUTS:
        if pattern.match(phrase):
            return _action(registry, action_id)

    # ------------------------------------------------------------------- apps
    launch = re.match(r"^(?:open|launch|start|run)\s+(.+)$", phrase)
    if launch:
        target = launch.group(1).strip()
        target = re.sub(r"^the\s+", "", target).strip()
        target = re.sub(r"\s+(?:website|site)$", "", target).strip()
        if target in ("app", "application"):
            return _clarify(
                "Which app should I open? Add it to the app allowlist first, then say its name.",
                "The app name is missing.",
            )
        if target in _WEB_WORDS:
            return _action(registry, "url.open", {"url": _WEB_WORDS[target]})
        if _looks_like_url(target):
            try:
                return _action(registry, "url.open", {"url": normalize_url(target)})
            except Exception:  # noqa: BLE001 - invalid URL returns a clarification
                return _clarify(
                    "That website address does not look valid. Use a full http or https address.",
                    "The URL could not be normalised.",
                )
        return _action(registry, "app.launch", {"name": target})

    for pattern, action_id in _SHORTCUTS:
        if pattern.match(phrase):
            return _action(registry, action_id)

    return ParsedCommand(handled=False, kind="unknown")

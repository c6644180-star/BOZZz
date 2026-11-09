"""Import parsers for plain text, JSON and user-exported WhatsApp chat files.

Parsing is local and deterministic. Nothing is parsed from a live messaging app,
no account is logged in and no network call is made.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable
import json
import re

MAX_IMPORT_BYTES = 2_000_000

_INVISIBLE = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\ufeff"), None)

_WHATSAPP_LINE = re.compile(
    r"^\[?(?P<date>\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}),?\s+"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?)\s*(?P<ampm>[AaPp]\.?[Mm]\.?)?\]?\s*"
    r"(?:[-\u2013\u2014]\s*)?(?P<sender>[^:\n]{1,80}?):\s?(?P<text>.*)$"
)

_SPEAKER_LINE = re.compile(r"^(?P<sender>[A-Za-z0-9 ._'+\-\u2019]{1,60}):\s+(?P<text>.+)$")

_OUTBOUND_NAMES = frozenset({"me", "you", "myself", "self"})

_DATE_FORMATS = ("%d/%m/%Y", "%m/%d/%Y", "%d/%m/%y", "%m/%d/%y", "%d.%m.%Y", "%m.%d.%Y", "%Y-%m-%d")


class BciImportError(ValueError):
    """The supplied file could not be understood as a conversation."""


def _clean(text: str) -> str:
    return text.translate(_INVISIBLE).strip()


def _direction(sender: str, outbound_names: Iterable[str]) -> str:
    names = {name.casefold() for name in outbound_names}
    return "outbound" if sender.strip().casefold() in names else "inbound"


def _parse_date(date_text: str, time_text: str, ampm: str | None) -> str:
    text = f"{date_text} {time_text}"
    formats = [f"{fmt} %H:%M:%S" for fmt in _DATE_FORMATS] + [f"{fmt} %H:%M" for fmt in _DATE_FORMATS]
    for fmt in formats:
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if ampm:
            hour = parsed.hour
            marker = ampm.casefold().replace(".", "")
            if marker.startswith("p") and hour < 12:
                hour += 12
            elif marker.startswith("a") and hour == 12:
                hour = 0
            parsed = parsed.replace(hour=hour)
        return parsed.isoformat(timespec="seconds")
    return ""


def _parse_whatsapp(content: str, outbound_names: Iterable[str]) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    skipped = 0
    for raw in content.splitlines():
        line = _clean(raw)
        if not line:
            continue
        match = _WHATSAPP_LINE.match(line)
        if match:
            sender = _clean(match.group("sender"))
            text = _clean(match.group("text"))
            if not text:
                continue
            messages.append(
                {
                    "sender": sender,
                    "text": text,
                    "direction": _direction(sender, outbound_names),
                    "sent_at": _parse_date(match.group("date"), match.group("time"), match.group("ampm")),
                }
            )
            continue
        if messages:
            messages[-1]["text"] = f"{messages[-1]['text']}\n{line}".strip()
        else:
            skipped += 1
    if not messages:
        raise BciImportError("No dated WhatsApp messages were recognised in this file.")
    return messages


def _strip_system_lines(content: str) -> tuple[str, int]:
    kept: list[str] = []
    skipped = 0
    for raw in content.splitlines():
        line = _clean(raw)
        if not line:
            continue
        if _WHATSAPP_LINE.match(line) or _SPEAKER_LINE.match(line) or kept:
            kept.append(line)
        else:
            skipped += 1
    return "\n".join(kept), skipped


def _parse_speaker_text(content: str, outbound_names: Iterable[str]) -> tuple[list[dict[str, str]], int]:
    messages: list[dict[str, str]] = []
    skipped = 0
    for raw in content.splitlines():
        line = _clean(raw)
        if not line:
            continue
        match = _SPEAKER_LINE.match(line)
        if match:
            sender = _clean(match.group("sender"))
            text = _clean(match.group("text"))
            if text:
                messages.append(
                    {
                        "sender": sender,
                        "text": text,
                        "direction": _direction(sender, outbound_names),
                        "sent_at": "",
                    }
                )
            continue
        if messages:
            messages[-1]["text"] = f"{messages[-1]['text']}\n{line}".strip()
        else:
            skipped += 1
    return messages, skipped


def _normalise_json_message(item: Any, index: int, outbound_names: Iterable[str]) -> dict[str, str] | None:
    if isinstance(item, str):
        text = _clean(item)
        return (
            {"sender": "Imported text", "text": text, "direction": "inbound", "sent_at": ""}
            if text
            else None
        )
    if not isinstance(item, dict):
        return None
    sender = ""
    for key in ("sender", "from", "author", "name", "user"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            sender = _clean(value)
            break
    text = ""
    for key in ("text", "body", "content", "message"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            text = _clean(value)
            break
    if not text:
        return None
    direction = item.get("direction")
    if direction not in ("inbound", "outbound"):
        direction = _direction(sender or "Imported text", outbound_names)
    sent_at = ""
    for key in ("sent_at", "timestamp", "time", "date", "created_at"):
        value = item.get(key)
        if isinstance(value, (int, float)):
            seconds = float(value)
            if seconds > 1_000_000_000_000:
                seconds /= 1000.0
            try:
                sent_at = datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat(timespec="seconds")
            except (OverflowError, OSError, ValueError):
                sent_at = ""
            break
        if isinstance(value, str) and value.strip():
            raw_value = _clean(value)
            try:
                sent_at = datetime.fromisoformat(raw_value.replace("Z", "+00:00")).isoformat(timespec="seconds")
            except ValueError:
                sent_at = ""
            break
    return {
        "sender": sender or "Imported contact",
        "text": text,
        "direction": direction,
        "sent_at": sent_at,
    }


def _parse_json(content: str, outbound_names: Iterable[str]) -> list[dict[str, str]]:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise BciImportError(f"This JSON file is not valid: {exc.msg}.") from exc
    if isinstance(payload, dict):
        for key in ("messages", "items", "chat", "history"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break
        else:
            raise BciImportError("This JSON file has no messages list.")
    if not isinstance(payload, list):
        raise BciImportError("This JSON file must contain a list of messages.")
    messages: list[dict[str, str]] = []
    for index, item in enumerate(payload):
        parsed = _normalise_json_message(item, index, outbound_names)
        if parsed:
            messages.append(parsed)
    if not messages:
        raise BciImportError("This JSON file contains no readable messages.")
    return messages


def format_limits(messages: list[dict[str, str]]) -> tuple[int, int]:
    return len(messages), sum(len(item["text"]) for item in messages)


def _parse_content(
    filename: str,
    content: str,
    outbound_names: Iterable[str],
) -> dict[str, Any]:
    text = content or ""
    if len(text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise BciImportError("This file is larger than 2 MB. Split it before importing.")
    if not text.strip():
        raise BciImportError("This file is empty.")
    name = (filename or "import.txt").strip()
    suffix = name.rsplit(".", 1)[-1].casefold() if "." in name else "txt"
    warnings: list[str] = []
    if suffix == "json":
        fmt = "json"
        messages = _parse_json(text, outbound_names)
    elif suffix in ("txt", "text", "chat", "log"):
        cleaned, skipped = _strip_system_lines(_clean(text))
        whatsapp_lines = sum(1 for line in cleaned.splitlines() if _WHATSAPP_LINE.match(line))
        speaker_messages, speaker_skipped = _parse_speaker_text(cleaned, outbound_names)
        if whatsapp_lines >= 2:
            fmt = "whatsapp"
            messages = _parse_whatsapp(cleaned, outbound_names)
            if skipped:
                warnings.append(f"{skipped} line(s) before the first message were ignored.")
        elif speaker_messages:
            fmt = "text"
            messages = speaker_messages
            if speaker_skipped or skipped:
                warnings.append("Lines without a speaker name were attached to the previous message.")
        else:
            fmt = "text"
            body = _clean(text)
            messages = [
                {
                    "sender": "Imported text",
                    "text": body,
                    "direction": "inbound",
                    "sent_at": "",
                }
            ]
            warnings.append("No speaker names were found, so the whole file is stored as one message.")
    else:
        raise BciImportError("Use a .txt or .json chat export. BOZZ does not read live app databases.")

    title = name.rsplit(".", 1)[0].replace("_", " ").strip() or "Imported conversation"
    return {"format": fmt, "title": title[:120], "messages": messages, "warnings": warnings}


def parse_import(
    filename: str,
    content: str,
    *,
    outbound_names: Iterable[str] = _OUTBOUND_NAMES,
) -> dict[str, Any]:
    """Parse a file into a preview payload without storing any message."""
    parsed = _parse_content(filename, content, outbound_names)
    messages = parsed["messages"]
    message_count, char_count = format_limits(messages)
    inbound = sum(1 for item in messages if item["direction"] == "inbound")
    dates = sorted(item["sent_at"] for item in messages if item["sent_at"])
    return {
        "format": parsed["format"],
        "title": parsed["title"],
        "source": parsed["format"],
        "message_count": message_count,
        "char_count": char_count,
        "inbound_count": inbound,
        "outbound_count": message_count - inbound,
        "first_at": dates[0] if dates else "",
        "last_at": dates[-1] if dates else "",
        "messages": messages[:50],
        "truncated": message_count > 50,
        "warnings": parsed["warnings"],
    }


def parse_import_full(
    filename: str,
    content: str,
    *,
    outbound_names: Iterable[str] = _OUTBOUND_NAMES,
) -> list[dict[str, str]]:
    """Parse every message for storage."""
    return _parse_content(filename, content, outbound_names)["messages"]

"""Local Communication Intelligence service.

The service stores conversations in SQLite, derives attention markers with local
rules, and turns every AI request into a real Intent Map task. There is no send
method, no messaging transport and no network call to any messaging app.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Mapping
import json
import re
import threading
import time
import uuid

from app.ai.base import AIProvider, LocalProviderError
from app.bci.parsers import BciImportError, parse_import, parse_import_full
from app.bci.store import BciStore
from app.db.store import IntentRecord, IntentStore

MAX_MESSAGES = 2_000
MAX_CHARS = 20_000
MAX_TITLE_CHARS = 200
RETENTION_OPTIONS = (0, 7, 30, 90)
DEFAULT_RETENTION_DAYS = 30
CLEANUP_INTERVAL_SECONDS = 3_600

ACTION_TYPES: Mapping[str, str] = {
    "summarise": "bci.summarise",
    "unanswered": "bci.unanswered",
    "attention": "bci.attention",
    "draft": "bci.draft",
    "rewrite": "bci.rewrite",
    "translate": "bci.translate",
}

SOURCE_VALUES = frozenset({"manual", "text", "json", "whatsapp", "simulation"})
FORMALITY_VALUES = ("casual", "neutral", "formal")
LENGTH_VALUES = ("short", "medium", "long")
TONE_VALUES = ("friendly", "neutral", "direct", "warm", "professional")

_LOCAL_PROVIDERS = frozenset({"ollama", "llamacpp", "lmstudio", "local"})

_MONEY = re.compile(r"(?:[\u20b9$\u20ac\u00a3]|(?:\b(?:Rs\.?|INR|USD|EUR|GBP))\s?)\s?\d[\d,.]*")
_URGENT = re.compile(
    r"\b(urgent|asap|immediately|deadline|due today|due tomorrow|today|tomorrow|tonight)\b",
    re.IGNORECASE,
)
_COMMIT = re.compile(r"\b(i will|i'll|we will|we'll|promise|commit|guarantee)\b", re.IGNORECASE)
_REQUEST = re.compile(
    r"\b(call me|send me|share|confirm|reply|let me know|can you|could you|please)\b",
    re.IGNORECASE,
)

_CONFIRM = re.compile(r"\[CONFIRM:\s*([^\]]{1,300})\]", re.IGNORECASE)
_GUARD_CURRENCY = re.compile(r"(?:[\u20b9$\u20ac\u00a3]|(?:\b(?:Rs\.?|INR|USD|EUR|GBP))\s?)\s?\d[\d,.]*")
_GUARD_PERCENT = re.compile(r"\b\d+(?:\.\d+)?\s?%")
_GUARD_TIME = re.compile(r"\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[ap]\.?m\.?)?\b", re.IGNORECASE)

_BASE_RULES = (
    "You are BOZZ Communication Intelligence, a local drafting workspace.\n"
    "Rules:\n"
    "- Work only from the conversation text provided.\n"
    "- Use only facts that appear in the conversation. Never invent facts, prices, dates, "
    "promises, commitments, names or numbers.\n"
    "- If a necessary detail is missing, write [CONFIRM: short question] inline instead of guessing.\n"
    "- Never claim a message was sent. You cannot send messages and this build has no send path.\n"
    "- Output only the requested result with no preamble.\n"
)


class BciError(Exception):
    """Base class for BCI failures."""


class BciNotFound(BciError):
    pass


class BciValidationError(BciError):
    pass


class ProviderUnavailable(BciError):
    pass


class ProviderConfirmationRequired(BciError):
    def __init__(self, provider: str):
        self.provider = provider
        super().__init__(
            f'"{provider}" is a remote provider. Confirm that conversation text may be sent to it '
            "before running an AI action."
        )


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _to_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def extract_placeholders(text: str) -> list[str]:
    seen: list[str] = []
    for match in _CONFIRM.finditer(text or ""):
        question = " ".join(match.group(1).split())
        if question and question not in seen:
            seen.append(question)
    return seen


def attention_reasons(text: str) -> list[str]:
    reasons: list[str] = []
    if text.rstrip().endswith("?"):
        reasons.append("question")
    if _MONEY.search(text):
        reasons.append("money")
    if _URGENT.search(text):
        reasons.append("time-sensitive")
    if _COMMIT.search(text):
        reasons.append("commitment")
    if _REQUEST.search(text) and "question" not in reasons:
        reasons.append("request")
    return reasons


def apply_confirm_guard(text: str, source: str) -> str:
    """Replace invented prices, percentages and times with a [CONFIRM] placeholder."""
    haystack = source.casefold()
    source_digits = re.sub(r"[^\d]", "", source)

    def guard(match: re.Match[str]) -> str:
        token = match.group(0)
        if token.casefold() in haystack:
            return token
        digits = re.sub(r"[^\d]", "", token)
        if digits and digits in source_digits:
            return token
        return f'[CONFIRM: verify "{token}" against the conversation]'

    guarded = _GUARD_CURRENCY.sub(guard, text)
    guarded = _GUARD_PERCENT.sub(guard, guarded)
    guarded = _GUARD_TIME.sub(guard, guarded)
    return guarded


class BciService:
    def __init__(
        self,
        store: BciStore,
        audit: IntentStore,
        provider: AIProvider,
        *,
        clock: Callable[[], str] = _iso_now,
    ):
        self._store = store
        self._audit = audit
        self._provider = provider
        self._clock = clock
        self._last_cleanup = 0.0
        self._cleanup_lock = threading.Lock()

    # -------------------------------------------------------------- provider
    def _provider_local(self) -> bool:
        explicit = getattr(self._provider, "is_local", None)
        if isinstance(explicit, bool):
            return explicit
        return self._provider.provider_name.casefold() in _LOCAL_PROVIDERS

    def provider_info(self) -> dict[str, Any]:
        status = self._provider.status()
        name = self._provider.provider_name
        local = self._provider_local()
        confirmed = local or self._store.is_provider_confirmed(name)
        return {
            "provider": name,
            "model": self._provider.configured_model,
            "available": status.available,
            "local": local,
            "detail": status.detail,
            "confirmed": confirmed,
            "requires_confirmation": not local and not confirmed,
        }

    def confirm_provider(self, provider: str, confirm: bool) -> dict[str, Any]:
        info = self.provider_info()
        if (provider or "").strip() != info["provider"]:
            raise BciValidationError("That provider is not the configured AI provider.")
        if not confirm:
            raise BciValidationError("The provider confirmation must be explicit.")
        if info["local"]:
            raise BciValidationError("The configured provider runs locally; no confirmation is required.")
        now = self._clock()
        self._store.confirm_provider(info["provider"], now)
        self._audit_event(
            "provider_confirm",
            "granted",
            f"Remote provider '{info['provider']}' confirmed for BCI AI actions.",
            action_type="message_data",
            target=info["provider"],
            risk="high",
        )
        return self.provider_info()

    def _ensure_provider(self) -> None:
        info = self.provider_info()
        if info["requires_confirmation"]:
            raise ProviderConfirmationRequired(info["provider"])

    # -------------------------------------------------------------- settings
    def _retention_days(self) -> int:
        raw = self._store.get_setting("retention_days")
        try:
            value = int(raw) if raw is not None else DEFAULT_RETENTION_DAYS
        except ValueError:
            value = DEFAULT_RETENTION_DAYS
        return value if value in RETENTION_OPTIONS else DEFAULT_RETENTION_DAYS

    def settings(self) -> dict[str, Any]:
        return {
            "retention_days": self._retention_days(),
            "options": list(RETENTION_OPTIONS),
        }

    def update_settings(self, retention_days: int) -> dict[str, Any]:
        if retention_days not in RETENTION_OPTIONS:
            raise BciValidationError("Retention must be 7, 30, 90 days, or until deleted.")
        self._store.set_setting("retention_days", str(retention_days))
        self._audit_event(
            "bci_settings",
            "updated",
            "Conversation retention updated. It applies to new conversations and is enforced by the cleanup job.",
            action_type="message_data",
            target="retention_days",
        )
        return self.settings()

    # ----------------------------------------------------------------- style
    def style(self) -> dict[str, Any]:
        stored = self._store.get_style()
        if stored:
            return {
                "language": stored["language"],
                "formality": stored["formality"],
                "length": stored["length"],
                "tone": stored["tone"],
                "expressions": stored["expressions"],
                "updated_at": stored["updated_at"],
            }
        return {
            "language": "English",
            "formality": "neutral",
            "length": "medium",
            "tone": "neutral",
            "expressions": [],
            "updated_at": None,
        }

    def save_style(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        language = str(payload.get("language") or "English").strip()[:40] or "English"
        formality = str(payload.get("formality") or "neutral").strip()
        length = str(payload.get("length") or "medium").strip()
        tone = str(payload.get("tone") or "neutral").strip()
        if formality not in FORMALITY_VALUES:
            raise BciValidationError("Formality must be casual, neutral or formal.")
        if length not in LENGTH_VALUES:
            raise BciValidationError("Length must be short, medium or long.")
        if tone not in TONE_VALUES:
            raise BciValidationError("Tone must be friendly, neutral, direct, warm or professional.")
        raw_expressions = payload.get("expressions") or []
        if not isinstance(raw_expressions, list):
            raise BciValidationError("Expressions must be a list of short phrases.")
        expressions = []
        for item in raw_expressions[:12]:
            if isinstance(item, str) and item.strip():
                expressions.append(item.strip()[:60])
        self._store.save_style(language, formality, length, tone, expressions, self._clock())
        self._audit_event(
            "bci_style",
            "updated",
            "Local style profile updated.",
            action_type="message_data",
            target="style",
        )
        return self.style()

    # ---------------------------------------------------------- conversations
    def _messages_with_flags(
        self, conversation_id: str
    ) -> tuple[list[dict[str, Any]], int, int]:
        messages = self._store.list_messages(conversation_id)
        unanswered_ids: set[str] = set()
        flagged = 0
        for index, message in enumerate(messages):
            reasons = attention_reasons(message["text"])
            message["attention"] = reasons
            if message["text"].rstrip().endswith("?") and message["direction"] == "inbound":
                replied = any(
                    later["direction"] == "outbound" for later in messages[index + 1 :]
                )
                if not replied:
                    unanswered_ids.add(message["id"])
            if reasons:
                flagged += 1
        for message in messages:
            message["unanswered"] = message["id"] in unanswered_ids
        return messages, flagged, len(unanswered_ids)

    def list_conversations(
        self,
        *,
        query: str | None = None,
        source: str | None = None,
        attention_only: bool = False,
    ) -> list[dict[str, Any]]:
        self.maybe_cleanup()
        wanted = (query or "").strip().casefold()
        wanted_source = (source or "").strip()
        result: list[dict[str, Any]] = []
        for row in self._store.list_conversations():
            messages, flagged, unanswered = self._messages_with_flags(row["id"])
            if wanted_source and row["source"] != wanted_source:
                continue
            if attention_only and not flagged and not unanswered:
                continue
            excerpt = ""
            if wanted:
                if wanted in row["title"].casefold():
                    excerpt = row["title"]
                else:
                    for message in messages:
                        if wanted in message["text"].casefold():
                            excerpt = f'{message["sender"]}: {message["text"][:200]}'
                            break
                if not excerpt:
                    continue
            result.append(
                {
                    **row,
                    "messages_count": len(messages),
                    "char_count": sum(len(item["text"]) for item in messages),
                    "needs_attention": flagged,
                    "unanswered_count": unanswered,
                    "search_excerpt": excerpt,
                }
            )
        return result

    def _conversation(self, conversation_id: str) -> dict[str, Any]:
        row = self._store.get_conversation(conversation_id)
        if row is None:
            raise BciNotFound(f"Conversation '{conversation_id}' was not found.")
        return row

    def get_conversation(self, conversation_id: str) -> dict[str, Any]:
        row = self._conversation(conversation_id)
        messages, flagged, unanswered = self._messages_with_flags(conversation_id)
        drafts = self._draft_views(self._store.list_drafts(conversation_id))
        return {
            **row,
            "messages": messages,
            "drafts": drafts,
            "messages_count": len(messages),
            "char_count": sum(len(item["text"]) for item in messages),
            "needs_attention": flagged,
            "unanswered_count": unanswered,
            "provider": self.provider_info(),
        }

    def _draft_views(self, drafts: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        views = []
        for draft in drafts:
            views.append(
                {
                    "id": draft["id"],
                    "conversation_id": draft["conversation_id"],
                    "text": draft["text"],
                    "language": draft["language"],
                    "tone": draft["tone"],
                    "placeholders": extract_placeholders(draft["text"]),
                    "created_at": draft["created_at"],
                    "updated_at": draft["updated_at"],
                    "not_sent": True,
                }
            )
        return views

    @staticmethod
    def _normalise_messages(messages: Iterable[Mapping[str, Any]], source: str) -> list[dict[str, Any]]:
        if not isinstance(messages, (list, tuple)):
            raise BciValidationError("Messages must be a list.")
        normalised: list[dict[str, Any]] = []
        for item in messages:
            if not isinstance(item, Mapping):
                continue
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            sender = str(item.get("sender") or "").strip()[:120]
            if not sender:
                sender = "Imported contact" if source != "manual" else "You"
            direction = item.get("direction")
            if direction not in ("inbound", "outbound"):
                direction = "outbound" if sender.casefold() in ("me", "you", "self") else "inbound"
            sent_at = str(item.get("sent_at") or "").strip()[:40]
            normalised.append(
                {
                    "id": uuid.uuid4().hex,
                    "sender": sender,
                    "text": text,
                    "direction": direction,
                    "sent_at": sent_at,
                }
            )
        if not normalised:
            raise BciValidationError("A conversation needs at least one message with text.")
        if len(normalised) > MAX_MESSAGES:
            raise BciValidationError(f"A conversation can hold at most {MAX_MESSAGES:,} messages.")
        total = sum(len(item["text"]) for item in normalised)
        if total > MAX_CHARS:
            raise BciValidationError(
                f"A conversation can hold at most {MAX_CHARS:,} characters; this one has {total:,}."
            )
        return normalised

    @staticmethod
    def _title(raw: str | None, fallback: str) -> str:
        title = (raw or "").strip()[:MAX_TITLE_CHARS]
        return title or fallback

    def create_conversation(
        self,
        *,
        title: str | None,
        source: str,
        messages: Iterable[Mapping[str, Any]],
    ) -> dict[str, Any]:
        source_value = (source or "manual").strip()
        if source_value not in SOURCE_VALUES:
            raise BciValidationError("Unknown conversation source.")
        normalised = self._normalise_messages(messages, source_value)
        now = self._clock()
        conversation_id = f"{source_value}-{uuid.uuid4().hex[:10]}"
        name = self._title(title, "Conversation")
        self._store.create_conversation(
            conversation_id,
            name,
            source_value,
            self._retention_days(),
            now,
            normalised,
        )
        self._audit_event(
            "bci_conversation",
            "ok",
            f"Stored a local conversation with {len(normalised)} message(s). Nothing was sent.",
            action_type="message_data",
            target=conversation_id,
        )
        return self.get_conversation(conversation_id)

    def update_conversation(
        self,
        conversation_id: str,
        *,
        title: str | None,
        retention_days: int | None,
    ) -> dict[str, Any]:
        self._conversation(conversation_id)
        clean_title = None
        if title is not None:
            clean_title = title.strip()[:MAX_TITLE_CHARS]
            if not clean_title:
                raise BciValidationError("A conversation title cannot be empty.")
        if retention_days is not None and retention_days not in RETENTION_OPTIONS:
            raise BciValidationError("Retention must be 7, 30, 90 days, or until deleted.")
        self._store.update_conversation(
            conversation_id,
            title=clean_title,
            retention_days=retention_days,
            updated_at=self._clock(),
        )
        self._audit_event(
            "bci_conversation",
            "updated",
            "Conversation details updated locally.",
            action_type="message_data",
            target=conversation_id,
        )
        return self.get_conversation(conversation_id)

    def delete_conversation(self, conversation_id: str) -> dict[str, Any]:
        row = self._conversation(conversation_id)
        self._store.delete_conversation(conversation_id)
        self._audit_event(
            "bci_delete",
            "deleted",
            f'Deleted the local conversation "{row["title"]}" and its drafts. No message was sent.',
            action_type="message_data",
            target=conversation_id,
            risk="high",
        )
        return {"deleted": True, "id": conversation_id}

    def delete_all(self, confirm: bool) -> dict[str, Any]:
        if not confirm:
            raise BciValidationError("Deleting every conversation requires explicit confirmation.")
        count = self._store.delete_all_conversations()
        self._audit_event(
            "bci_delete_all",
            "deleted",
            f"Deleted all {count} local conversation(s) and their drafts. No message was sent.",
            action_type="message_data",
            target="all conversations",
            risk="high",
        )
        return {"deleted": True, "count": count}

    # ---------------------------------------------------------------- import
    def preview_import(self, filename: str, content: str) -> dict[str, Any]:
        try:
            parsed = parse_import(filename, content)
        except BciImportError as exc:
            raise BciValidationError(str(exc)) from exc
        self._validate_import_limits(parsed)
        return parsed

    @staticmethod
    def _validate_import_limits(parsed: Mapping[str, Any]) -> None:
        if parsed["message_count"] > MAX_MESSAGES:
            raise BciValidationError(
                f"This file has {parsed['message_count']:,} messages; the limit is {MAX_MESSAGES:,}."
            )
        if parsed["char_count"] > MAX_CHARS:
            raise BciValidationError(
                f"This file has {parsed['char_count']:,} characters; the limit is {MAX_CHARS:,}."
            )

    def import_conversation(
        self, filename: str, content: str, *, title: str | None = None
    ) -> dict[str, Any]:
        try:
            parsed = parse_import(filename, content)
        except BciImportError as exc:
            raise BciValidationError(str(exc)) from exc
        self._validate_import_limits(parsed)
        messages = parse_import_full(filename, content)
        return self.create_conversation(
            title=title or parsed["title"],
            source=parsed["format"],
            messages=messages,
        )

    # ----------------------------------------------------------------- drafts
    def create_draft(
        self,
        conversation_id: str,
        *,
        text: str,
        language: str | None = None,
        tone: str | None = None,
    ) -> dict[str, Any]:
        self._conversation(conversation_id)
        body = (text or "").strip()
        if not body:
            raise BciValidationError("A draft needs text.")
        if len(body) > MAX_CHARS:
            raise BciValidationError(f"A draft can hold at most {MAX_CHARS:,} characters.")
        style = self.style()
        draft_id = uuid.uuid4().hex
        now = self._clock()
        self._store.create_draft(
            draft_id,
            conversation_id,
            body,
            (language or style["language"])[:40],
            (tone or style["tone"])[:40],
            now,
        )
        self._audit_event(
            "bci_draft",
            "ok",
            "A draft was saved locally. Drafts are never sent.",
            action_type="message_data",
            target=draft_id,
        )
        return self._draft_views([self._store.get_draft(draft_id) or {}])[0]

    def update_draft(
        self,
        draft_id: str,
        *,
        text: str | None,
        language: str | None,
        tone: str | None,
    ) -> dict[str, Any]:
        draft = self._store.get_draft(draft_id)
        if draft is None:
            raise BciNotFound(f"Draft '{draft_id}' was not found.")
        body = text.strip() if isinstance(text, str) else None
        if body is not None and not body:
            raise BciValidationError("A draft cannot be empty.")
        if body is not None and len(body) > MAX_CHARS:
            raise BciValidationError(f"A draft can hold at most {MAX_CHARS:,} characters.")
        self._store.update_draft(
            draft_id,
            text=body,
            language=(language or "").strip()[:40] or None,
            tone=(tone or "").strip()[:40] or None,
            updated_at=self._clock(),
        )
        self._audit_event(
            "bci_draft",
            "updated",
            "A local draft was edited. Nothing was sent.",
            action_type="message_data",
            target=draft_id,
        )
        return self._draft_views([self._store.get_draft(draft_id) or {}])[0]

    def delete_draft(self, draft_id: str) -> dict[str, Any]:
        if not self._store.delete_draft(draft_id):
            raise BciNotFound(f"Draft '{draft_id}' was not found.")
        self._audit_event(
            "bci_draft",
            "deleted",
            "A local draft was deleted. Nothing was sent.",
            action_type="message_data",
            target=draft_id,
        )
        return {"deleted": True, "id": draft_id}

    # -------------------------------------------------------------- retention
    def cleanup_expired(self, now: str | None = None) -> dict[str, Any]:
        now_dt = _to_datetime(now or self._clock()) or datetime.now(timezone.utc)
        deleted: list[str] = []
        for row in self._store.list_conversations(limit=500):
            days = int(row.get("retention_days") or 0)
            if days <= 0:
                continue
            anchor = _to_datetime(row.get("last_message_at") or row.get("updated_at"))
            if anchor is None:
                continue
            cutoff = now_dt - timedelta(days=days)
            if anchor < cutoff:
                if self._store.delete_conversation(row["id"]):
                    deleted.append(row["id"])
        if deleted:
            self._audit_event(
                "bci_retention_cleanup",
                "deleted",
                f"Retention cleanup deleted {len(deleted)} expired conversation(s). No message was sent.",
                action_type="message_data",
                target=f"{len(deleted)} conversation(s)",
            )
        return {"deleted": len(deleted), "ids": deleted}

    def maybe_cleanup(self) -> None:
        now = time.monotonic()
        if now - self._last_cleanup < CLEANUP_INTERVAL_SECONDS:
            return
        with self._cleanup_lock:
            if now - self._last_cleanup < CLEANUP_INTERVAL_SECONDS:
                return
            self._last_cleanup = now
        self.cleanup_expired()

    # ---------------------------------------------------------------- actions
    def run_action(
        self,
        conversation_id: str,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        if action not in ACTION_TYPES:
            raise BciValidationError("Unknown BCI action.")
        conversation = self._conversation(conversation_id)
        messages = self._store.list_messages(conversation_id)
        if not messages:
            raise BciValidationError("This conversation has no messages to work on.")
        body = dict(payload or {})
        self._validate_action_payload(action, body, conversation_id)
        local_rules = action in ("attention", "unanswered")
        if not local_rules:
            self._ensure_provider()

        action_type = ACTION_TYPES[action]
        now = self._clock()
        intent_id = uuid.uuid4().hex
        display = conversation["title"]
        if local_rules:
            preview = f"{len(messages)} message(s) → local rules (no provider call)"
            warnings = [
                "This action uses local rules over the stored messages. "
                "No text is sent to the AI provider or any messaging app.",
                "This build has no send endpoint, no SMTP and no messaging API.",
            ]
        else:
            preview = f"{len(messages)} message(s) → {self._provider.provider_name}/{self._provider.configured_model}"
            warnings = [
                f"Conversation text is sent to the configured AI provider "
                f"({self._provider.provider_name}). Nothing is sent to any messaging app.",
                "Drafts stay inside BOZZ. [CONFIRM: ...] placeholders block Copy until resolved.",
                "This build has no send endpoint, no SMTP and no messaging API.",
            ]
        plan_action = {
            "type": action_type,
            "target": display,
            "description": self._describe(action, conversation["title"]),
            "preview": preview,
            "risk": "low",
            "reversible": True,
        }
        plan = {
            "actions": [plan_action],
            "warnings": warnings,
            "examples": [],
            "approval_required": False,
            "module": "bci",
            "required_permissions": ["message_data"],
        }
        steps = {
            "UNDERSTAND": ("done", f'Recognised a request to {self._verb(action)} "{conversation["title"]}".'),
            "PLAN": (
                "done",
                f"One local rule pass planned over {len(messages)} stored message(s)."
                if local_rules
                else f"One local AI action planned over {len(messages)} stored message(s).",
            ),
            "APPROVE": ("skipped", "No message is sent and no external account is touched."),
            "EXECUTE": ("pending", "Not started."),
            "VERIFY": ("pending", "Not started."),
            "REPORT": ("pending", "Not started."),
        }
        record = IntentRecord(
            id=intent_id,
            raw_text=f"bci {action} {conversation['title']}"[:500],
            status="approved",
            plan_json=json.dumps(plan, ensure_ascii=False),
            approval_id=None,
            approval_required=False,
            created_at=now,
            updated_at=now,
        )
        self._insert_task(record, steps, now)
        self._audit_event(
            "bci_action",
            "started",
            f"Started {action_type} on {len(messages)} local message(s). Nothing was sent.",
            intent_id=intent_id,
            action_type=action_type,
            target=conversation_id,
        )

        attention_items: list[dict[str, Any]] = []
        if action == "attention":
            for message in messages:
                reasons = attention_reasons(message["text"])
                if reasons:
                    attention_items.append(
                        {
                            "message_id": message["id"],
                            "sender": message["sender"],
                            "sent_at": message["sent_at"],
                            "reasons": reasons,
                            "excerpt": message["text"][:240],
                        }
                    )
        unanswered_questions: list[dict[str, Any]] = []
        if action == "unanswered":
            for index, message in enumerate(messages):
                if not message["text"].rstrip().endswith("?") or message["direction"] != "inbound":
                    continue
                if any(later["direction"] == "outbound" for later in messages[index + 1 :]):
                    continue
                unanswered_questions.append(
                    {
                        "message_id": message["id"],
                        "sender": message["sender"],
                        "sent_at": message["sent_at"],
                        "text": message["text"][:500],
                    }
                )

        style = self.style()
        if local_rules:
            included = len(messages)
            lines: list[str] = []
            if action == "attention":
                if attention_items:
                    lines.append(f"{len(attention_items)} message(s) need attention:")
                    for item in attention_items:
                        reasons = ", ".join(item["reasons"])
                        lines.append(f"- {item['sender']} ({reasons}): {item['excerpt']}")
                else:
                    lines.append("No stored message matched the local attention rules.")
            else:
                if unanswered_questions:
                    lines.append(f"{len(unanswered_questions)} unanswered question(s):")
                    for item in unanswered_questions:
                        lines.append(f"- {item['sender']}: {item['text']}")
                else:
                    lines.append("No unanswered questions were found.")
            result_text = "\n".join(lines)
        else:
            transcript, included = self._transcript(messages)
            prompt = self._prompt(action, body, transcript, style, attention_items)
            try:
                output = self._provider.chat(prompt, [])
            except LocalProviderError as exc:
                return self._fail_task(
                    intent_id,
                    conversation_id,
                    action_type,
                    f"The AI action failed: {exc}",
                )
            except Exception as exc:  # provider adapters are replaceable; keep the task honest
                return self._fail_task(
                    intent_id,
                    conversation_id,
                    action_type,
                    f"The AI action failed: {exc}",
                )

            result_text = output.strip()
            if not result_text:
                return self._fail_task(
                    intent_id,
                    conversation_id,
                    action_type,
                    "The AI provider returned no text.",
                )

        source_text = "\n".join(item["text"] for item in messages)
        if action in ("draft", "rewrite", "translate"):
            result_text = apply_confirm_guard(result_text, source_text)
        placeholders = extract_placeholders(result_text)

        draft_view = None
        saved_note = "No draft was stored."
        if action == "draft":
            draft_view = self.create_draft(
                conversation_id,
                text=result_text,
                language=style["language"],
                tone=str(body.get("tone") or style["tone"]),
            )
            stored = self._store.get_draft(draft_view["id"])
            saved_note = (
                f'Draft {draft_view["id"]} was stored locally and read back with '
                f'{len(stored["text"]) if stored else 0} characters. It is labelled "Draft only, not sent".'
            )
        elif action == "rewrite" and body.get("draft_id"):
            draft_view = self.update_draft(str(body["draft_id"]), text=result_text, language=None, tone=None)
            saved_note = f'Draft {draft_view["id"]} was updated locally and read back.'
        elif action == "rewrite":
            saved_note = "The rewritten text was returned only; no draft was stored."

        finished = self._clock()
        if local_rules:
            provider_label = "local/rules"
            evidence_detail = (
                f"Local rules evaluated {len(messages)} stored message(s) and returned "
                f"{len(result_text):,} characters. No text was sent to any provider. "
                "No message was sent; this build has no send path."
            )
            evidence_source = "local_rules"
            execute_note = f"Local rules evaluated {action_type} over {len(messages)} stored message(s)."
            action_detail = f"Local rules evaluated {len(messages)} stored message(s)."
            completion = f"{action_type} completed with local rules. Nothing was sent."
        else:
            provider_label = f"{self._provider.provider_name}/{self._provider.configured_model}"
            evidence_detail = (
                f"The configured provider {provider_label} returned {len(result_text):,} characters "
                f"from {included} message(s). {saved_note} "
                "No message was sent; this build has no send path."
            )
            evidence_source = "model_response"
            execute_note = f"The provider returned text for {action_type}."
            action_detail = f"{provider_label} returned text from {included} message(s)."
            completion = f"{action_type} completed with {provider_label}. Nothing was sent."
        summary = self._summary(action, result_text, included, provider_label, placeholders, draft_view)
        self._audit.append_step(intent_id, "EXECUTE", "done", execute_note, finished)
        self._audit.append_step(intent_id, "VERIFY", "done", evidence_detail, finished)
        self._audit.append_step(intent_id, "REPORT", "done", summary, finished)
        report = {
            "summary": summary,
            "actions": [
                {
                    "index": 1,
                    "type": action_type,
                    "target": display,
                    "ok": True,
                    "detail": action_detail,
                }
            ],
            "verification": [
                {"action": 1, "ok": True, "detail": evidence_detail, "source": evidence_source}
            ],
            "finished_at": finished,
            "done_allowed": True,
        }
        self._audit.update_intent(intent_id, "reported", finished, json.dumps(report, ensure_ascii=False))
        self._audit_event(
            "bci_action",
            "ok",
            completion,
            intent_id=intent_id,
            action_type=action_type,
            target=conversation_id,
        )
        stored = self._audit.get_intent(intent_id)
        task_view = self.task_view(stored) if stored else {}
        return {
            **task_view,
            "result": {
                "kind": action,
                "text": result_text,
                "placeholders": placeholders,
                "draft": draft_view,
                "items": attention_items,
                "questions": unanswered_questions,
                "provider": "local" if local_rules else self._provider.provider_name,
                "model": "rules" if local_rules else self._provider.configured_model,
                "messages_used": included,
                "message_count": len(messages),
            },
        }

    def _validate_action_payload(
        self, action: str, payload: Mapping[str, Any], conversation_id: str
    ) -> None:
        if action in ("rewrite", "translate"):
            text = str(payload.get("text") or "").strip()
            draft_id = str(payload.get("draft_id") or "").strip()
            if not text and not draft_id:
                raise BciValidationError("This action needs a draft or some text to work on.")
            if text and len(text) > MAX_CHARS:
                raise BciValidationError(f"Text can hold at most {MAX_CHARS:,} characters.")
            if draft_id:
                draft = self._store.get_draft(draft_id)
                if draft is None or draft["conversation_id"] != conversation_id:
                    raise BciValidationError("That draft does not belong to this conversation.")
        if action == "translate":
            language = str(payload.get("language") or "").strip()
            if not language:
                raise BciValidationError("Choose a language to translate into.")
            if len(language) > 40:
                raise BciValidationError("The language name is too long.")
        if action == "draft" and len(str(payload.get("instruction") or "")) > 1_000:
            raise BciValidationError("The draft instruction is too long.")

    def _transcript(self, messages: list[dict[str, Any]], limit: int = 12_000) -> tuple[str, int]:
        def line(message: Mapping[str, Any]) -> str:
            stamp = f"[{message['sent_at']}] " if message.get("sent_at") else ""
            return (
                f"{stamp}{message['sender']} ({message['direction']}): "
                f"{str(message['text'])[:600]}"
            )

        lines = [line(message) for message in messages]
        total = sum(len(item) + 1 for item in lines)
        if total <= limit:
            return "\n".join(lines), len(lines)
        head: list[str] = []
        used = 0
        for item in lines:
            if used + len(item) + 1 > limit * 0.45:
                break
            head.append(item)
            used += len(item) + 1
        tail: list[str] = []
        used = 0
        for item in reversed(lines):
            if used + len(item) + 1 > limit * 0.45:
                break
            tail.append(item)
            used += len(item) + 1
        tail.reverse()
        return "\n".join(head + ["[... middle of the conversation shortened ...]"] + tail), len(head) + len(tail)

    def _prompt(
        self,
        action: str,
        payload: Mapping[str, Any],
        transcript: str,
        style: Mapping[str, Any],
        attention_items: list[dict[str, Any]],
    ) -> str:
        style_line = (
            f"User style profile: language={style['language']}, formality={style['formality']}, "
            f"length={style['length']}, tone={style['tone']}, "
            f"expressions={', '.join(style['expressions']) or 'none'}.\n"
        )
        if action == "summarise":
            instruction = "Summarise the conversation in at most 8 short sentences. Cover topics, decisions and open questions."
        elif action == "unanswered":
            instruction = (
                "List the questions from other people (inbound) that the user has not answered. "
                "Use short bullets. If none are unanswered, say so."
            )
        elif action == "attention":
            marks = [
                f"- {item['sender']}: {', '.join(item['reasons'])} — {item['excerpt'][:160]}"
                for item in attention_items
            ]
            instruction = (
                "Write a short priority briefing (at most 5 bullets) for the messages flagged by "
                "local rules below. Do not add facts that are not in the conversation.\n"
                + ("\n".join(marks) if marks else "No messages matched the local attention rules.")
            )
        elif action == "draft":
            extra = str(payload.get("instruction") or "").strip()
            instruction = (
                "Draft a reply from the user's perspective to the latest inbound message. "
                "Keep it ready for the user to review and copy. Use the style profile.\n"
                + (f"User instruction: {extra}\n" if extra else "")
                + style_line
            )
        elif action == "rewrite":
            target = self._action_text(payload)
            instruction = (
                "Rewrite the following user text so it sounds more natural while keeping every fact unchanged. "
                f"Additional instruction: {str(payload.get('instruction') or 'none')}.\n"
                + style_line
                + f"\nText to rewrite:\n{target}\n"
            )
        else:
            language = str(payload.get("language") or "").strip()
            target = self._action_text(payload)
            instruction = (
                f"Translate the following text into {language}. Keep facts unchanged. "
                "Output only the translation.\n"
                + f"\nText to translate:\n{target}\n"
            )
        return f"{_BASE_RULES}\n{instruction}\nConversation:\n{transcript}\n"

    def _action_text(self, payload: Mapping[str, Any]) -> str:
        text = str(payload.get("text") or "").strip()
        if text:
            return text[:MAX_CHARS]
        draft_id = str(payload.get("draft_id") or "").strip()
        draft = self._store.get_draft(draft_id) if draft_id else None
        return draft["text"][:MAX_CHARS] if draft else ""

    @staticmethod
    def _describe(action: str, title: str) -> str:
        verbs = {
            "summarise": "Summarise the conversation",
            "unanswered": "Find unanswered questions",
            "attention": "Brief the user on messages that need attention",
            "draft": "Draft a reply",
            "rewrite": "Rewrite a draft",
            "translate": "Translate a draft",
        }
        return f'{verbs[action]} "{title}". Nothing is sent anywhere.'

    @staticmethod
    def _verb(action: str) -> str:
        return {
            "summarise": "summarise",
            "unanswered": "find unanswered questions in",
            "attention": "review",
            "draft": "draft a reply to",
            "rewrite": "rewrite a draft for",
            "translate": "translate a draft for",
        }[action]

    @staticmethod
    def _summary(
        action: str,
        text: str,
        included: int,
        provider_label: str,
        placeholders: list[str],
        draft: Mapping[str, Any] | None,
    ) -> str:
        base = {
            "summarise": f"Summarised {included} message(s) with {provider_label}.",
            "unanswered": f"Reviewed {included} message(s) with local rules for unanswered questions.",
            "attention": f"Reviewed {included} message(s) with local attention rules.",
            "draft": f"Drafted a reply of {len(text):,} characters with {provider_label}.",
            "rewrite": f"Rewrote {len(text):,} characters with {provider_label}.",
            "translate": f"Produced a {len(text):,}-character translation with {provider_label}.",
        }[action]
        if draft:
            base += f' Stored locally as draft {draft["id"]} (Draft only, not sent).'
        if placeholders:
            base += f" {len(placeholders)} [CONFIRM] placeholder(s) must be resolved before Copy."
        base += " No message was sent."
        return base

    def _fail_task(
        self,
        intent_id: str,
        conversation_id: str,
        action_type: str,
        detail: str,
    ) -> dict[str, Any]:
        failed = self._clock()
        self._audit.append_step(intent_id, "EXECUTE", "error", detail, failed)
        self._audit.append_step(intent_id, "VERIFY", "skipped", "No output was produced, so there is nothing to verify.", failed)
        summary = f"{detail} Nothing was sent."
        self._audit.append_step(intent_id, "REPORT", "error", summary, failed)
        report = {
            "summary": summary,
            "actions": [{"index": 1, "type": action_type, "ok": False, "detail": detail}],
            "verification": [],
            "finished_at": failed,
            "done_allowed": False,
        }
        self._audit.update_intent(intent_id, "failed", failed, json.dumps(report, ensure_ascii=False))
        self._audit_event(
            "bci_action",
            "error",
            summary[:500],
            intent_id=intent_id,
            action_type=action_type,
            target=conversation_id,
        )
        stored = self._audit.get_intent(intent_id)
        return {**self.task_view(stored), "result": None} if stored else {"result": None}

    # ---------------------------------------------------------------- helpers
    def _audit_event(
        self,
        event: str,
        outcome: str,
        detail: str,
        *,
        action_type: str | None = None,
        target: str | None = None,
        risk: str = "low",
        intent_id: str | None = None,
    ) -> None:
        self._audit.append_audit(
            intent_id=intent_id,
            event=event,
            action_type=action_type,
            target=target,
            risk=risk,
            outcome=outcome,
            detail=detail,
            created_at=self._clock(),
        )

    def _insert_task(
        self,
        record: IntentRecord,
        steps: Mapping[str, tuple[str, str]],
        now: str,
    ) -> None:
        self._audit.create_intent(record)
        for step in ("UNDERSTAND", "PLAN", "APPROVE", "EXECUTE", "VERIFY", "REPORT"):
            status, detail = steps[step]
            self._audit.append_step(record.id, step, status, detail, now)

    def task_view(self, record: Mapping[str, Any]) -> dict[str, Any]:
        plan = json.loads(record["plan_json"])
        report = json.loads(record["report_json"]) if record.get("report_json") else None
        latest: dict[str, dict[str, Any]] = {}
        for row in self._audit.list_steps(record["id"]):
            latest[row["step"]] = {
                "step": row["step"],
                "status": row["status"],
                "detail": row["detail"],
                "at": row["created_at"],
            }
        steps = [
            latest.get(step, {"step": step, "status": "pending", "detail": "Not started.", "at": None})
            for step in ("UNDERSTAND", "PLAN", "APPROVE", "EXECUTE", "VERIFY", "REPORT")
        ]
        evidence = report.get("verification", []) if isinstance(report, dict) else []
        evidence = [dict(item) for item in evidence] if isinstance(evidence, list) else []
        errors = [
            {"stage": step["step"], "detail": step["detail"]}
            for step in steps
            if step["status"] in ("error", "blocked") and str(step["detail"]).strip()
        ]
        approval_state = "not_requested"
        done_allowed = record["status"] == "reported" and bool(evidence) and all(
            item.get("ok") is True for item in evidence
        )
        task = {
            "id": record["id"],
            "module": "bci",
            "stages": steps,
            "required_permissions": plan.get("required_permissions", ["message_data"]),
            "approval_state": approval_state,
            "errors": errors,
            "verification_evidence": evidence,
            "done_allowed": done_allowed,
        }
        return {
            "id": record["id"],
            "text": record["raw_text"],
            "status": record["status"],
            "understood": True,
            "approval_required": False,
            "approval_id": None,
            "module": "bci",
            "required_permissions": task["required_permissions"],
            "approval_state": approval_state,
            "errors": errors,
            "verification_evidence": evidence,
            "done_allowed": done_allowed,
            "task": task,
            "message": (report or {}).get("summary", "Waiting for the AI provider."),
            "warnings": plan.get("warnings", []),
            "examples": [],
            "actions": [
                {key: value for key, value in action.items() if key != "payload"}
                for action in plan.get("actions", [])
            ],
            "steps": steps,
            "report": report,
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
        }


__all__ = [
    "ACTION_TYPES",
    "BciError",
    "BciNotFound",
    "BciService",
    "BciValidationError",
    "CLEANUP_INTERVAL_SECONDS",
    "DEFAULT_RETENTION_DAYS",
    "MAX_CHARS",
    "MAX_MESSAGES",
    "ProviderConfirmationRequired",
    "ProviderUnavailable",
    "RETENTION_OPTIONS",
    "apply_confirm_guard",
    "attention_reasons",
    "extract_placeholders",
]

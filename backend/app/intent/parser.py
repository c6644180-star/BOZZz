"""Deterministic command understanding for the workspace intent workflow.

Parsing is intentionally rule-based and local. A language model is not asked
to invent actions: unsupported text is reported as not understood instead of
guessed. Every resulting action is still previewed and explicitly approved.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import re

EXAMPLE_COMMANDS = (
    "list files in demo",
    "read demo/hello.txt",
    "create file demo/hello.txt with content Hello from BOZZ",
    "append second line to demo/hello.txt",
    "search for hello in demo",
    "workspace status",
)

_FLAGS = re.IGNORECASE | re.DOTALL

_LIST = re.compile(
    r"^(?:please\s+)?(?:list|show|display)(?:\s+me)?"
    r"(?:\s+(?:the\s+)?(?:files|file|contents|workspace|folder|directory))?"
    r"(?:\s+(?:in|at|of)\s+(?P<path>.+))?$",
    _FLAGS,
)
_LS = re.compile(r"^(?:ls)\s*(?P<path>.*)$", _FLAGS)
_READ = re.compile(
    r"^(?:read|open|cat)\s+(?:(?:the\s+)?(?:file|document)\s+)?(?P<path>.+)$",
    _FLAGS,
)
_MKDIR = re.compile(
    r"^(?:create|make|mkdir)\s+(?:a\s+)?(?:new\s+)?(?:folder|directory)"
    r"\s+(?:(?:called|named)\s+)?(?P<path>.+)$",
    _FLAGS,
)
_MKDIR_SHORT = re.compile(r"^(?:mkdir)\s+(?P<path>.+)$", _FLAGS)
_WRITE_FILE = re.compile(
    r"^(?P<verb>create|make|write|overwrite)\s+(?:a\s+)?(?:new\s+)?file\s+"
    r"(?P<path>.+?)\s+"
    r"(?:with(?:\s+(?:the\s+)?content)?|containing|content:)\s*(?P<content>.*)$",
    _FLAGS,
)
_WRITE_TARGETED = re.compile(
    r"^(?P<verb>write|overwrite)\s+(?P<path>[^:]+?)\s*::\s*(?P<content>.*)$",
    _FLAGS,
)
_WRITE_LOOSE = re.compile(
    r"^(?P<verb>write|overwrite)\s+(?P<path>.+?)\s+(?:with|containing)\s+(?P<content>.*)$",
    _FLAGS,
)
_CREATE_EMPTY = re.compile(
    r"^(?:create|make)\s+(?:a\s+)?(?:new\s+)?file\s+(?P<path>.+)$",
    _FLAGS,
)
_APPEND = re.compile(
    r"^append\s+(?P<content>.+)\s+to\s+"
    r"(?:(?:the\s+)?(?:file|document)\s+)?(?P<path>[^:]+?)\s*$",
    _FLAGS,
)
_DELETE = re.compile(
    r"^(?:delete|remove)\s+(?:(?:the\s+)?(?:file|folder|directory)\s+)?(?P<path>.+)$",
    _FLAGS,
)
_MOVE = re.compile(
    r"^(?P<verb>move|rename)\s+"
    r"(?:(?:the\s+)?(?:file|folder|directory)\s+)?"
    r"(?P<src>.+?)\s+(?:to|into)\s+(?P<dst>.+)$",
    _FLAGS,
)
_SEARCH = re.compile(
    r"^(?:search|find)\s+(?:for\s+)?(?P<query>.+?)(?:\s+in\s+(?P<path>.+))?$",
    _FLAGS,
)
_STATS = re.compile(r"^(?:workspace\s+)?(?:status|stats|summary)$", _FLAGS)


@dataclass(frozen=True)
class ProposedAction:
    type: str
    target: str
    payload: dict[str, Any]
    description: str
    preview: str


@dataclass(frozen=True)
class ParseResult:
    understood: bool
    explanation: str
    actions: tuple[ProposedAction, ...] = field(default_factory=tuple)
    examples: tuple[str, ...] = field(default_factory=tuple)


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1].strip()
    return value


def _clean_path(value: str | None, default: str = ".") -> str:
    if value is None:
        return default
    path = _unquote(value)
    path = re.sub(r"^(?:the\s+)?(?:file|folder|directory)\s+", "", path, flags=re.IGNORECASE)
    path = path.strip().rstrip(";").strip()
    if (
        path.endswith(".")
        and not path.endswith("..")
        and len(path) > 1
        and not path.lower().endswith((".txt", ".md", ".json", ".csv", ".log"))
    ):
        path = path[:-1].strip()
    return path or default


def _preview_content(content: str, limit: int = 300) -> str:
    if len(content) <= limit:
        return content
    return f"{content[:limit]}… ({len(content)} characters total)"


def _write_action(path: str, content: str, overwrite: bool) -> ProposedAction:
    size = len(content.encode("utf-8"))
    verb = "Overwrite" if overwrite else "Create"
    description = f"{verb} '{path}' with {size} byte(s) of UTF-8 text."
    if overwrite:
        description += " Existing content is backed up under .trash first."
    return ProposedAction(
        type="workspace.write",
        target=path,
        payload={"content": content, "overwrite": overwrite},
        description=description,
        preview=_preview_content(content),
    )


def parse_command(text: str) -> ParseResult:
    command = text.strip()
    if not command:
        return ParseResult(False, "Enter a workspace command to review.", examples=EXAMPLE_COMMANDS)

    match = _STATS.match(command)
    if match:
        return ParseResult(True, "Summarise the workspace.", (ProposedAction(
            type="workspace.stats",
            target=".",
            payload={},
            description="Count files, folders, and bytes in the workspace.",
            preview="Read-only summary.",
        ),))

    match = _MKDIR.match(command) or _MKDIR_SHORT.match(command)
    if match:
        path = _clean_path(match.group("path"))
        return ParseResult(True, "Create a folder.", (ProposedAction(
            type="workspace.mkdir",
            target=path,
            payload={},
            description=f"Create the folder '{path}' (and any missing parent folders).",
            preview=path,
        ),))

    match = _WRITE_FILE.match(command) or _WRITE_TARGETED.match(command) or _WRITE_LOOSE.match(command)
    if match:
        path = _clean_path(match.group("path"))
        content = match.group("content") or ""
        overwrite = match.group("verb").lower() in ("write", "overwrite")
        return ParseResult(True, "Write a text file.", (_write_action(path, content, overwrite),))

    match = _CREATE_EMPTY.match(command)
    if match:
        path = _clean_path(match.group("path"))
        return ParseResult(True, "Create an empty text file.", (_write_action(path, "", False),))

    match = _APPEND.match(command)
    if match:
        content = match.group("content").strip()
        path = _clean_path(match.group("path"))
        return ParseResult(True, "Append text to a file.", (ProposedAction(
            type="workspace.append",
            target=path,
            payload={"content": content},
            description=f"Append {len(content.encode('utf-8'))} byte(s) to '{path}'.",
            preview=_preview_content(content),
        ),))

    match = _DELETE.match(command)
    if match:
        path = _clean_path(match.group("path"))
        return ParseResult(True, "Delete to the recoverable workspace trash.", (ProposedAction(
            type="workspace.delete",
            target=path,
            payload={},
            description=f"Move '{path}' to .trash. Nothing is permanently erased.",
            preview=f"{path} → .trash",
        ),))

    match = _MOVE.match(command)
    if match:
        source = _clean_path(match.group("src"))
        destination = _clean_path(match.group("dst"))
        if match.group("verb").lower() == "rename" and "/" not in destination.replace("\\", "/"):
            parent = source.rsplit("/", 1)[0] if "/" in source.replace("\\", "/") else ""
            destination = f"{parent}/{destination}" if parent else destination
        return ParseResult(True, "Move or rename a file.", (ProposedAction(
            type="workspace.move",
            target=source,
            payload={"destination": destination},
            description=f"Move '{source}' to '{destination}'.",
            preview=f"{source} → {destination}",
        ),))

    match = _SEARCH.match(command)
    if match:
        query = _unquote(match.group("query")).strip()
        path = _clean_path(match.group("path"))
        return ParseResult(True, "Search workspace text files.", (ProposedAction(
            type="workspace.search",
            target=path,
            payload={"query": query},
            description=f"Search for '{query}' in text files under '{path}' (max 20 matches).",
            preview=f"query: {query} · scope: {path}",
        ),))

    match = _LIST.match(command) or _LS.match(command)
    if match:
        path = _clean_path(match.groupdict().get("path"))
        return ParseResult(True, "List a folder.", (ProposedAction(
            type="workspace.list",
            target=path,
            payload={},
            description=f"List up to 500 entries in '{path}'.",
            preview=path,
        ),))

    match = _READ.match(command)
    if match:
        path = _clean_path(match.group("path"))
        return ParseResult(True, "Read a text file.", (ProposedAction(
            type="workspace.read",
            target=path,
            payload={},
            description=f"Read the UTF-8 text file '{path}'.",
            preview=path,
        ),))

    return ParseResult(
        False,
        "I can only plan explicit workspace actions in this milestone. "
        "Nothing was executed. Try one of the supported commands below.",
        examples=EXAMPLE_COMMANDS,
    )

"""Read-only path safety for the BOZZ Spatial Desktop.

Every path is resolved with ``realpath`` and must stay inside a folder the user
explicitly allowed. The helpers are pure so the rejection rules can be tested
without a database or an HTTP request.
"""

from __future__ import annotations

from pathlib import Path, PurePath
import os

# Executables and scripts are shown in the workspace but are never handed to the
# operating system. The four extras cover common Windows launcher formats.
BLOCKED_OPEN_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".exe",
        ".bat",
        ".cmd",
        ".ps1",
        ".msi",
        ".sh",
        ".js",
        ".vbs",
        ".lnk",
        ".com",
        ".scr",
        ".cpl",
        ".hta",
    }
)

IMAGE_EXTENSIONS = frozenset(
    {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".avif", ".heic"}
)
TEXT_EXTENSIONS = frozenset(
    {
        ".txt",
        ".log",
        ".csv",
        ".tsv",
        ".ini",
        ".cfg",
        ".conf",
        ".yaml",
        ".yml",
        ".json",
        ".xml",
        ".html",
        ".htm",
        ".css",
        ".ts",
        ".tsx",
        ".jsx",
        ".py",
        ".rs",
        ".go",
        ".java",
        ".c",
        ".h",
        ".cpp",
        ".sql",
    }
)
MARKDOWN_EXTENSIONS = frozenset({".md", ".markdown"})
PDF_EXTENSIONS = frozenset({".pdf"})
VIDEO_EXTENSIONS = frozenset({".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".wmv", ".ogv"})
MODEL_EXTENSIONS = frozenset({".glb", ".gltf", ".obj", ".fbx", ".stl", ".3ds", ".dae", ".usdz", ".ply"})

MAX_TEXT_PREVIEW_BYTES = 4 * 1024
MAX_IMAGE_BYTES = 40 * 1024 * 1024
THUMBNAIL_MAX_PIXELS = 512

SKIP_DIR_NAMES = frozenset(
    {
        "node_modules",
        ".git",
        ".hg",
        ".svn",
        "__pycache__",
        ".venv",
        "venv",
        ".tox",
        ".idea",
        ".vs",
        "$recycle.bin",
        "system volume information",
        "windows",
        "winsxs",
        "recovery",
        "perflogs",
    }
)


class PathAccessError(ValueError):
    """A path is invalid, outside every allowed folder, or unsafe to open."""


class PathNotFound(PathAccessError):
    """The path does not exist or cannot be read."""


def normalize_root(raw: str) -> Path:
    """Validate a folder the user wants to allow and return its canonical path."""
    text = (raw or "").strip().strip('"')
    if not text:
        raise PathAccessError("Enter an absolute folder path.")
    if not os.path.isabs(text):
        raise PathAccessError("Enter an absolute folder path, for example C:\\Users\\You\\Documents\\TestFolder.")
    resolved = Path(os.path.realpath(text))
    if not resolved.exists():
        raise PathNotFound(f"The folder does not exist: {resolved}")
    if not resolved.is_dir():
        raise PathAccessError(f"That path is not a folder: {resolved}")
    if resolved.parent == resolved:
        raise PathAccessError("Allow a specific folder, not an entire drive root.")
    return resolved


def is_within(target: str | PurePath, root: str | PurePath) -> bool:
    """True only when the resolved target is the root or inside it.

    ``commonpath`` raises ``ValueError`` for different drives, which is treated
    as "not inside". Symlink escapes and ``..`` are already resolved by
    ``realpath`` before this comparison.
    """
    try:
        target_real = os.path.normcase(os.path.realpath(str(target)))
        root_real = os.path.normcase(os.path.realpath(str(root)))
        return os.path.commonpath([target_real, root_real]) == root_real
    except (OSError, ValueError):
        return False


def resolve_allowed(raw: str, roots: list[Path]) -> Path:
    """Resolve a user-supplied path and require it to live inside an allowed root."""
    text = (raw or "").strip().strip('"')
    if not text:
        raise PathAccessError("A file path is required.")
    if not os.path.isabs(text):
        raise PathAccessError("Only absolute paths inside an allowed folder are accepted.")
    if not roots:
        raise PathAccessError("No folders are allowed yet. Add one in Settings → Permissions → File access.")
    resolved = Path(os.path.realpath(text))
    if not any(is_within(resolved, root) for root in roots):
        raise PathAccessError(
            f"Access denied: {resolved} is not inside an allowed folder. "
            "Add the folder in Settings → Permissions → File access."
        )
    if not resolved.exists():
        raise PathNotFound(f"The file or folder does not exist: {resolved}")
    return resolved


def ensure_openable(path: Path) -> None:
    """Reject executables, scripts and non-files before asking the OS to open them."""
    if not path.is_file():
        raise PathAccessError(f"Only files can be opened: {path.name}")
    suffix = path.suffix.lower()
    if suffix in BLOCKED_OPEN_EXTENSIONS:
        raise PathAccessError(
            f'BOZZ will not open "{path.name}": {suffix} files are executables or scripts. '
            "The card stays visible, but the OS open action is blocked."
        )


def classify(path: Path) -> str:
    """Return the real card type used by the frontend."""
    if path.is_dir():
        return "folder"
    suffix = path.suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in MARKDOWN_EXTENSIONS:
        return "markdown"
    if suffix in PDF_EXTENSIONS:
        return "pdf"
    if suffix in TEXT_EXTENSIONS:
        return "text"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in MODEL_EXTENSIONS:
        return "3d"
    return "other"


def is_openable(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() not in BLOCKED_OPEN_EXTENSIONS


def should_skip_dir(name: str, path: Path) -> bool:
    """Skip hidden/system and dependency folders during recursive search."""
    lowered = name.lower()
    if lowered in SKIP_DIR_NAMES or name.startswith("."):
        return True
    if os.name == "nt":
        try:
            attributes = getattr(path.stat(), "st_file_attributes", 0)
        except OSError:
            return True
        import stat

        if attributes & (stat.FILE_ATTRIBUTE_HIDDEN | stat.FILE_ATTRIBUTE_SYSTEM):
            return True
    return False


def search_key(path: Path) -> str:
    return os.path.normcase(os.path.realpath(str(path)))

"""SQLite persistence for BOZZ local state.

The database lives inside the repository's ignored ``data/`` directory. It is
opened per operation so FastAPI's threadpool can share it safely. The audit
table is append-only: there is intentionally no update or delete API.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
import sqlite3

SCHEMA_VERSION = 4

_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY,
    raw_text TEXT NOT NULL,
    status TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    report_json TEXT,
    approval_id TEXT,
    approval_required INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intents_created ON intents(created_at DESC);

CREATE TABLE IF NOT EXISTS intent_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intents(id),
    step TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steps_intent ON intent_steps(intent_id, id);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT,
    event TEXT NOT NULL,
    action_type TEXT,
    target TEXT,
    risk TEXT,
    outcome TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(id DESC);

CREATE TABLE IF NOT EXISTS module_permissions (
    module_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    granted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (module_id, permission)
);

CREATE TABLE IF NOT EXISTS allowed_folders (
    path TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    granted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spatial_layouts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cards_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bci_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    retention_days INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bci_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES bci_conversations(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    direction TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bci_messages_conversation
    ON bci_messages(conversation_id, sent_at, id);

CREATE TABLE IF NOT EXISTS bci_drafts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES bci_conversations(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'English',
    tone TEXT NOT NULL DEFAULT 'neutral',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bci_style (
    id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    formality TEXT NOT NULL,
    length TEXT NOT NULL,
    tone TEXT NOT NULL,
    expressions_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bci_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bci_provider_confirmations (
    provider TEXT PRIMARY KEY,
    confirmed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    state TEXT NOT NULL,
    dry_run INTEGER NOT NULL DEFAULT 1,
    plan_json TEXT,
    report_json TEXT,
    provider TEXT,
    model TEXT,
    planner TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON agent_tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    personality_config TEXT NOT NULL DEFAULT '{}',
    role TEXT NOT NULL DEFAULT 'assistant',
    greeting TEXT NOT NULL DEFAULT 'Hello!',
    voice_configuration TEXT NOT NULL DEFAULT '{}',
    appearance_configuration TEXT NOT NULL DEFAULT '{}',
    behaviour_configuration TEXT NOT NULL DEFAULT '{}',
    associated_projects TEXT NOT NULL DEFAULT '[]',
    approved_tool_references TEXT NOT NULL DEFAULT '[]',
    memory_ownership_settings TEXT NOT NULL DEFAULT '{}',
    creation_timestamp TEXT NOT NULL,
    updated_timestamp TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_identities_created ON identities(creation_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_identities_name ON identities(name);

CREATE TABLE IF NOT EXISTS preference_profiles (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    identity_id TEXT NOT NULL,
    name TEXT NOT NULL,
    visual_preferences TEXT NOT NULL DEFAULT '{}',
    ai_behaviour_preferences TEXT NOT NULL DEFAULT '{}',
    productivity_preferences TEXT NOT NULL DEFAULT '{}',
    accessibility_preferences TEXT NOT NULL DEFAULT '{}',
    functional_preferences TEXT NOT NULL DEFAULT '{}',
    privacy_preferences TEXT NOT NULL DEFAULT '{}',
    project_specific_settings TEXT NOT NULL DEFAULT '{}',
    creation_timestamp TEXT NOT NULL,
    updated_timestamp TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_preference_profiles_identity ON preference_profiles(identity_id);
CREATE INDEX IF NOT EXISTS idx_preference_profiles_name ON preference_profiles(name);

CREATE TABLE IF NOT EXISTS bids (
    bid_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    ai_interpretation TEXT,
    intended_outcome TEXT,
    category TEXT,
    related_project TEXT,
    creation_timestamp TEXT NOT NULL,
    updated_timestamp TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'captured',
    schema_version INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    suggestions TEXT NOT NULL DEFAULT '[]',
    approved_modifications TEXT NOT NULL DEFAULT '[]',
    dependencies TEXT NOT NULL DEFAULT '[]',
    related_ideas TEXT NOT NULL DEFAULT '[]',
    sharing_permissions TEXT NOT NULL DEFAULT 'private',
    implementation_references TEXT NOT NULL DEFAULT '[]',
    testing_evidence TEXT NOT NULL DEFAULT '[]',
    original_title TEXT NOT NULL,
    original_description TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bids_owner ON bids(owner_id);
CREATE INDEX IF NOT EXISTS idx_bids_category ON bids(category);
CREATE INDEX IF NOT EXISTS idx_bids_project ON bids(related_project);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);

CREATE TABLE IF NOT EXISTS agent_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    status TEXT NOT NULL,
    level TEXT NOT NULL,
    detail TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_task ON agent_steps(task_id, id);
"""


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def initialize(self) -> None:
        with self.transaction() as connection:
            connection.executescript(_SCHEMA)
            connection.execute(
                "INSERT OR REPLACE INTO schema_meta(key, value) VALUES('version', ?)",
                (str(SCHEMA_VERSION),),
            )

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def schema_version(self) -> int:
        with self.read() as connection:
            row = connection.execute(
                "SELECT value FROM schema_meta WHERE key = 'version'"
            ).fetchone()
        return int(row["value"]) if row else 0

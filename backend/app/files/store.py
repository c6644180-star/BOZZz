"""SQLite repositories for allowed folders and spatial layouts."""

from __future__ import annotations

from typing import Any
import json

from app.db.database import Database


class FileStore:
    def __init__(self, database: Database):
        self._db = database
        self._db.initialize()

    # ----------------------------------------------------------- allowed roots
    def list_roots(self) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                "SELECT path, label, granted_at FROM allowed_folders ORDER BY granted_at ASC"
            ).fetchall()
        return [dict(row) for row in rows]

    def add_root(self, path: str, label: str, granted_at: str) -> None:
        with self._db.transaction() as connection:
            connection.execute(
                """
                INSERT INTO allowed_folders(path, label, granted_at) VALUES (?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET label = excluded.label
                """,
                (path, label, granted_at),
            )

    def remove_root(self, path: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute("DELETE FROM allowed_folders WHERE path = ?", (path,))
            return cursor.rowcount > 0

    # ---------------------------------------------------------------- layouts
    def list_layouts(self) -> list[dict[str, Any]]:
        with self._db.read() as connection:
            rows = connection.execute(
                """
                SELECT id, name, cards_json, created_at, updated_at
                FROM spatial_layouts ORDER BY updated_at DESC
                """
            ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            try:
                card_count = len(json.loads(row["cards_json"]))
            except (json.JSONDecodeError, TypeError):
                card_count = 0
            result.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "card_count": card_count,
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
            )
        return result

    def get_layout(self, layout_id: str) -> dict[str, Any] | None:
        with self._db.read() as connection:
            row = connection.execute(
                "SELECT id, name, cards_json, created_at, updated_at FROM spatial_layouts WHERE id = ?",
                (layout_id,),
            ).fetchone()
        if not row:
            return None
        item = dict(row)
        try:
            item["cards"] = json.loads(item.pop("cards_json"))
        except json.JSONDecodeError:
            item["cards"] = []
        return item

    def save_layout(
        self,
        layout_id: str,
        name: str,
        cards: list[dict[str, Any]],
        created_at: str,
        updated_at: str,
        *,
        replace: bool,
    ) -> None:
        payload = json.dumps(cards, ensure_ascii=False)
        with self._db.transaction() as connection:
            if replace:
                cursor = connection.execute(
                    """
                    UPDATE spatial_layouts SET name = ?, cards_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (name, payload, updated_at, layout_id),
                )
                if cursor.rowcount:
                    return
            connection.execute(
                """
                INSERT INTO spatial_layouts(id, name, cards_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    cards_json = excluded.cards_json,
                    updated_at = excluded.updated_at
                """,
                (layout_id, name, payload, created_at, updated_at),
            )

    def rename_layout(self, layout_id: str, name: str, updated_at: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute(
                "UPDATE spatial_layouts SET name = ?, updated_at = ? WHERE id = ?",
                (name, updated_at, layout_id),
            )
            return cursor.rowcount > 0

    def delete_layout(self, layout_id: str) -> bool:
        with self._db.transaction() as connection:
            cursor = connection.execute("DELETE FROM spatial_layouts WHERE id = ?", (layout_id,))
            return cursor.rowcount > 0

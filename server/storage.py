"""SQLite-backed recipe store.

A recipe is a name plus an ordered list of ingredient strings. Recipes
are identified by client-generated UUIDs and carry an updated_at
timestamp (epoch milliseconds) so offline clients can sync with
last-write-wins semantics: an upsert older than the stored row is
ignored and the stored row is returned instead.
"""

import os
import sqlite3
import threading
import time
import uuid

DB_PATH = os.environ.get("RECIPES_DB", os.path.join("data", "recipes.db"))

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def now_ms() -> int:
    return int(time.time() * 1000)


def _migrate_from_int_ids(conn: sqlite3.Connection) -> None:
    """Upgrade a pre-sync database (INTEGER autoincrement ids) in place."""
    conn.executescript(
        """
        ALTER TABLE recipes RENAME TO recipes_old;
        ALTER TABLE ingredients RENAME TO ingredients_old;
        """
    )
    _create_tables(conn)
    for row in conn.execute("SELECT id, name FROM recipes_old").fetchall():
        new_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO recipes (id, name, updated_at) VALUES (?, ?, ?)",
            (new_id, row["name"], now_ms()),
        )
        conn.execute(
            """
            INSERT INTO ingredients (recipe_id, name, position)
            SELECT ?, name, position FROM ingredients_old WHERE recipe_id = ?
            """,
            (new_id, row["id"]),
        )
    conn.executescript("DROP TABLE ingredients_old; DROP TABLE recipes_old;")


def _create_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ingredients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            position INTEGER NOT NULL
        );
        """
    )


def _connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA foreign_keys = ON")
        recipe_columns = {
            row["name"]: row["type"]
            for row in _conn.execute("PRAGMA table_info(recipes)").fetchall()
        }
        if recipe_columns.get("id") == "INTEGER":
            _migrate_from_int_ids(_conn)
        else:
            _create_tables(_conn)
        _conn.commit()
    return _conn


def _row_to_recipe(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    ingredients = conn.execute(
        "SELECT name FROM ingredients WHERE recipe_id = ? ORDER BY position",
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"],
        "name": row["name"],
        "updated_at": row["updated_at"],
        "ingredients": [i["name"] for i in ingredients],
    }


def list_recipes() -> list[dict]:
    with _lock:
        conn = _connection()
        rows = conn.execute("SELECT * FROM recipes ORDER BY name COLLATE NOCASE").fetchall()
        return [_row_to_recipe(conn, r) for r in rows]


def get_recipe(recipe_id: str) -> dict | None:
    with _lock:
        conn = _connection()
        row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
        return _row_to_recipe(conn, row) if row else None


def upsert_recipe(
    recipe_id: str, name: str, ingredients: list[str], updated_at: int
) -> dict:
    """Create or update a recipe, last write wins.

    If the stored row is newer than updated_at the write is ignored and
    the stored row is returned, so replaying a stale offline edit can't
    clobber a more recent one.
    """
    with _lock:
        conn = _connection()
        row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
        if row is not None and row["updated_at"] > updated_at:
            return _row_to_recipe(conn, row)

        conn.execute(
            """
            INSERT INTO recipes (id, name, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                                          updated_at = excluded.updated_at
            """,
            (recipe_id, name, updated_at),
        )
        conn.execute("DELETE FROM ingredients WHERE recipe_id = ?", (recipe_id,))
        conn.executemany(
            "INSERT INTO ingredients (recipe_id, name, position) VALUES (?, ?, ?)",
            [(recipe_id, ing, pos) for pos, ing in enumerate(ingredients)],
        )
        conn.commit()
    return {
        "id": recipe_id,
        "name": name,
        "updated_at": updated_at,
        "ingredients": ingredients,
    }


def delete_recipe(recipe_id: str) -> bool:
    with _lock:
        conn = _connection()
        cur = conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
        conn.commit()
        return cur.rowcount > 0

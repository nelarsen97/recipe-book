"""SQLite-backed recipe store.

A recipe is a name plus an ordered list of ingredient strings.
"""

import os
import sqlite3
import threading

DB_PATH = os.environ.get("RECIPES_DB", os.path.join("data", "recipes.db"))

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA foreign_keys = ON")
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ingredients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                position INTEGER NOT NULL
            );
            """
        )
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
        "ingredients": [i["name"] for i in ingredients],
    }


def list_recipes() -> list[dict]:
    with _lock:
        conn = _connection()
        rows = conn.execute("SELECT * FROM recipes ORDER BY name COLLATE NOCASE").fetchall()
        return [_row_to_recipe(conn, r) for r in rows]


def get_recipe(recipe_id: int) -> dict | None:
    with _lock:
        conn = _connection()
        row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
        return _row_to_recipe(conn, row) if row else None


def create_recipe(name: str, ingredients: list[str]) -> dict:
    with _lock:
        conn = _connection()
        cur = conn.execute("INSERT INTO recipes (name) VALUES (?)", (name,))
        recipe_id = cur.lastrowid
        conn.executemany(
            "INSERT INTO ingredients (recipe_id, name, position) VALUES (?, ?, ?)",
            [(recipe_id, ing, pos) for pos, ing in enumerate(ingredients)],
        )
        conn.commit()
    return {"id": recipe_id, "name": name, "ingredients": ingredients}


def update_recipe(recipe_id: int, name: str, ingredients: list[str]) -> dict | None:
    with _lock:
        conn = _connection()
        cur = conn.execute("UPDATE recipes SET name = ? WHERE id = ?", (name, recipe_id))
        if cur.rowcount == 0:
            return None
        conn.execute("DELETE FROM ingredients WHERE recipe_id = ?", (recipe_id,))
        conn.executemany(
            "INSERT INTO ingredients (recipe_id, name, position) VALUES (?, ?, ?)",
            [(recipe_id, ing, pos) for pos, ing in enumerate(ingredients)],
        )
        conn.commit()
    return {"id": recipe_id, "name": name, "ingredients": ingredients}


def delete_recipe(recipe_id: int) -> bool:
    with _lock:
        conn = _connection()
        cur = conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
        conn.commit()
        return cur.rowcount > 0

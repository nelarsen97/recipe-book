"""Google Keep integration via the unofficial gkeepapi library.

Keep has no official API for personal Google accounts, so this uses
gkeepapi's reverse-engineered client. Login state is cached to disk so
server restarts resume the session instead of performing a fresh login
(Google rate-limits and sometimes flags frequent full logins).

If Keep auth fails the rest of the server keeps working; add_items()
raises KeepUnavailable with a human-readable reason instead.
"""

import json
import logging
import os
import threading

import gkeepapi

logger = logging.getLogger("keep")

STATE_FILE = os.environ.get("KEEP_STATE_FILE", os.path.join("data", "keep_state.json"))


class KeepUnavailable(Exception):
    """Keep could not be reached / authenticated / the note is missing."""


class KeepClient:
    def __init__(self) -> None:
        self._keep: gkeepapi.Keep | None = None
        self._lock = threading.Lock()
        self._last_error: str | None = None

    @property
    def last_error(self) -> str | None:
        return self._last_error

    def _env(self, name: str) -> str:
        value = os.environ.get(name, "").strip()
        if not value:
            raise KeepUnavailable(f"{name} is not set on the server")
        return value

    def _login(self) -> gkeepapi.Keep:
        if self._keep is not None:
            return self._keep

        email = self._env("GOOGLE_EMAIL")
        master_token = self._env("GOOGLE_MASTER_TOKEN")

        state = None
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE) as f:
                    state = json.load(f)
            except (OSError, json.JSONDecodeError):
                logger.warning("Ignoring unreadable Keep state cache %s", STATE_FILE)

        keep = gkeepapi.Keep()
        try:
            keep.authenticate(email, master_token, state=state, sync=True)
        except gkeepapi.exception.LoginException as exc:
            raise KeepUnavailable(f"Google Keep login failed: {exc}") from exc

        self._keep = keep
        self._save_state()
        logger.info("Logged in to Google Keep as %s", email)
        return keep

    def _save_state(self) -> None:
        if self._keep is None:
            return
        os.makedirs(os.path.dirname(STATE_FILE) or ".", exist_ok=True)
        with open(STATE_FILE, "w") as f:
            json.dump(self._keep.dump(), f)

    def _note(self, keep: gkeepapi.Keep) -> gkeepapi.node.List:
        note_id = self._env("KEEP_NOTE_ID")
        note = keep.get(note_id)
        if note is None:
            raise KeepUnavailable(
                f"Keep note {note_id!r} was not found in this account"
            )
        if not isinstance(note, gkeepapi.node.List):
            raise KeepUnavailable(
                f"Keep note {note_id!r} is a plain note, not a checklist"
            )
        return note

    def add_items(self, items: list[str]) -> dict:
        """Append items as unchecked checkboxes to the configured Keep note.

        Items already present and unchecked on the note are skipped so
        repeated taps don't pile up duplicates. Returns counts.
        """
        with self._lock:
            try:
                keep = self._login()
                keep.sync()
                note = self._note(keep)

                existing = {
                    item.text.strip().lower() for item in note.unchecked
                }
                added, skipped = [], []
                for raw in items:
                    text = raw.strip()
                    if not text:
                        continue
                    if text.lower() in existing:
                        skipped.append(text)
                        continue
                    note.add(
                        text,
                        False,
                        gkeepapi.node.NewListItemPlacementValue.Bottom,
                    )
                    existing.add(text.lower())
                    added.append(text)

                if added:
                    keep.sync()
                self._save_state()
                self._last_error = None
                return {"added": added, "skipped": skipped}
            except KeepUnavailable as exc:
                self._last_error = str(exc)
                raise
            except Exception as exc:  # gkeepapi raises assorted API errors
                # Drop the session so the next attempt logs in fresh.
                self._keep = None
                self._last_error = f"Google Keep sync failed: {exc}"
                raise KeepUnavailable(self._last_error) from exc

    def status(self) -> dict:
        return {
            "logged_in": self._keep is not None,
            "last_error": self._last_error,
        }


client = KeepClient()

#!/usr/bin/env python3
"""One-time setup helper.

Google Keep has no official API for personal accounts, so the server
logs in with a "master token" obtained through Google's Android sign-in
flow (via the gpsoauth library). This script walks you through getting
that token, and can list your Keep notes so you can copy the note ID of
your shopping list.

Usage:
    python get_master_token.py                # obtain a master token
    python get_master_token.py --list-notes   # print note titles + IDs

The master token grants broad access to the Google account — treat it
like a password. It only ever needs to live in the server's .env file.
"""

import argparse
import getpass
import sys

import gpsoauth

# Any stable hex string works as the "android id" for this flow.
ANDROID_ID = "recipe0123456789"

OAUTH_URL = "https://accounts.google.com/EmbeddedSetup"


def obtain_master_token() -> None:
    print(
        f"""
Step 1. Open this URL in a desktop browser (a private/incognito window
        is easiest) and sign in to the Google account whose Keep note
        the app should update:

        {OAUTH_URL}

Step 2. After signing in you'll land on a mostly blank / consent page.
        Open the browser dev tools (F12) -> Application/Storage ->
        Cookies -> accounts.google.com and copy the value of the cookie
        named "oauth_token". It starts with "oauth2_4/".

        (The cookie appears once you finish the sign-in flow; if you
        don't see it, click through any consent prompt first.)
"""
    )
    email = input("Google account email: ").strip()
    oauth_token = getpass.getpass('Value of the "oauth_token" cookie: ').strip()

    response = gpsoauth.exchange_token(email, oauth_token, ANDROID_ID)
    master_token = response.get("Token")
    if not master_token:
        print("\nToken exchange failed. Full response from Google:", file=sys.stderr)
        print(response, file=sys.stderr)
        print(
            "\nThe oauth_token cookie is single-use and expires within a few "
            "minutes - redo the sign-in flow and try again promptly.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(
        f"""
Success! Put these in server/.env:

    GOOGLE_EMAIL={email}
    GOOGLE_MASTER_TOKEN={master_token}

Next, run "python get_master_token.py --list-notes" to find the ID of
your shopping-list note for KEEP_NOTE_ID.
"""
    )


def list_notes() -> None:
    import os

    from dotenv import load_dotenv

    load_dotenv()
    email = os.environ.get("GOOGLE_EMAIL") or input("Google account email: ").strip()
    token = os.environ.get("GOOGLE_MASTER_TOKEN") or getpass.getpass("Master token: ").strip()

    import gkeepapi

    keep = gkeepapi.Keep()
    keep.authenticate(email, token)

    print("\nYour Keep notes (checklists marked with [list]):\n")
    for note in keep.all():
        if note.trashed or note.archived:
            continue
        kind = "[list]" if isinstance(note, gkeepapi.node.List) else "[note]"
        title = note.title or "(untitled)"
        print(f"  {kind} {note.id}   {title}")
    print(
        "\nCopy the ID of your shopping-list checklist into server/.env as "
        "KEEP_NOTE_ID. It must be a [list]; in the Keep app you can convert "
        'a note via "Show checkboxes".'
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-notes", action="store_true", help="list Keep notes and IDs")
    args = parser.parse_args()
    if args.list_notes:
        list_notes()
    else:
        obtain_master_token()

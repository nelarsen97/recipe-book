# Recipe Book

A personal cookbook app for Android with a "send my shopping list to Google Keep" button.

- Recipes are just a name plus a list of ingredients.
- Recipes live on a small self-hosted server, so every phone pointed at it sees the same cookbook.
- Open a recipe, check off the ingredients you **already have**, tap **Add to Google Keep** — the rest are appended as unchecked checkboxes to one hard-coded Keep note (your shopping list).

```
┌─────────────┐   HTTPS + API key    ┌──────────────────┐   unofficial API   ┌─────────────┐
│ Android app │ ───────────────────▶ │ server (FastAPI) │ ─────────────────▶ │ Google Keep │
│ (Expo RN)   │  recipes + /keep/add │ SQLite + gkeepapi│                    │  checklist  │
└─────────────┘                      └──────────────────┘                    └─────────────┘
```

> **Why a server?** Google Keep has no official API for personal accounts. The server uses
> [gkeepapi](https://github.com/kiwiz/gkeepapi), an unofficial client. It works well, but Google
> could break it someday; if that happens only the Keep button is affected — the cookbook itself
> keeps working.

## 1. Server setup

You need somewhere to run it that your phone can reach: a Raspberry Pi or home server on your
Wi-Fi, or a small cloud box (fly.io, a $4 VPS, ...).

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env`:

1. **`API_KEY`** — any long random string; the app must present it on every request:
   `python -c "import secrets; print(secrets.token_urlsafe(32))"`
2. **`GOOGLE_EMAIL` / `GOOGLE_MASTER_TOKEN`** — run `.venv/bin/python get_master_token.py` and
   follow the prompts (browser sign-in, copy one cookie, done).
   ⚠️ The master token grants broad access to the Google account — it never leaves the server's
   `.env`. If that makes you uneasy, use a dedicated Google account just for the shopping list.
3. **`KEEP_NOTE_ID`** — in the Keep app, make sure your shopping list is a **checklist**
   ("Show checkboxes"), then run `.venv/bin/python get_master_token.py --list-notes` and copy the
   ID of that note.

Run it:

```bash
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000     # directly
docker compose up -d --build                               # or via Docker
```

Recipes (SQLite) and the Keep session cache are stored in `server/data/` — back that folder up if
you care about your recipes.

Smoke test from another machine on the same network:

```bash
curl http://<server-ip>:8000/health
curl -X POST http://<server-ip>:8000/keep/add \
  -H "X-API-Key: <your API_KEY>" -H "Content-Type: application/json" \
  -d '{"items": ["test item from curl"]}'
```

then check that "test item from curl" showed up on the Keep note.

**Exposing it beyond your Wi-Fi:** if you want the app to work away from home, either put the
server behind a VPN like Tailscale (easiest and safest) or a reverse proxy with HTTPS. Don't
forward a plain-HTTP port to the internet — the API key would travel unencrypted.

## 2. Building the Android app (APK)

The app is Expo / React Native (`app/`). The easiest way to get an installable APK is an EAS cloud
build (free Expo account, no local Android SDK needed):

```bash
cd app
npm install
npx eas-cli build -p android --profile preview
```

When the build finishes, EAS prints a link — open it on the phone and install the APK (Android
will ask you to allow installs from the browser).

<details>
<summary>Alternative: build locally (requires Android SDK + JDK)</summary>

```bash
cd app
npm install
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# APK at android/app/build/outputs/apk/release/app-release.apk
```
</details>

For development you can also run `npx expo start` and open the project in the
[Expo Go](https://expo.dev/go) app without building anything.

## 3. First launch

1. Open the app → **Settings**.
2. Enter the server address (e.g. `http://192.168.1.20:8000`) and the `API_KEY` value.
3. Tap **Test connection** — it verifies both the server and the key.
4. Add a recipe (**+**), open it, check off what you have, and hit **Add to Google Keep**.

Duplicate protection: items already sitting unchecked on the Keep note are skipped, so tapping the
button twice won't double up your shopping list.

## Repo layout

| Path | What it is |
|---|---|
| `server/main.py` | FastAPI app: recipe CRUD + `/keep/add` + `/health` |
| `server/keep.py` | gkeepapi wrapper (login, session cache, append checkboxes) |
| `server/storage.py` | SQLite recipe store |
| `server/get_master_token.py` | one-time Google auth helper + Keep note ID lister |
| `app/src/app/` | screens (expo-router): list, recipe detail, edit, settings |
| `app/src/lib/api.ts` | typed client for the server |

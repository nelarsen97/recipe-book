# Getting Recipe Book up and running

Work through these in order — full details for every step are in [README.md](README.md).

## 1. Pick a home for the server

- [ ] Choose where the server will run: a machine that's always on and reachable from your phone
  - Easiest: a Raspberry Pi or old laptop on your home Wi-Fi
  - Alternative: a small cloud host (fly.io, cheap VPS)
- [ ] Note its local IP address (e.g. `192.168.1.20`) — you'll need it later
- [ ] Make sure Python 3.11+ (or Docker) is installed on it

## 2. Set up the server

- [ ] Clone this repo onto that machine
- [ ] `cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
- [ ] `cp .env.example .env`
- [ ] Generate an API key and put it in `.env` as `API_KEY`:
      `python -c "import secrets; print(secrets.token_urlsafe(32))"`

## 3. Connect it to Google Keep

- [ ] In the Google Keep app, open your shopping-list note and make sure it's a **checklist**
      (⋮ menu → "Show checkboxes" if it isn't)
- [ ] Run `.venv/bin/python get_master_token.py` and follow the prompts
      (browser sign-in → copy the `oauth_token` cookie → script prints your master token)
- [ ] Put `GOOGLE_EMAIL` and `GOOGLE_MASTER_TOKEN` in `.env`
      ⚠️ The master token is as sensitive as your password — it stays in `.env` and nowhere else
- [ ] Run `.venv/bin/python get_master_token.py --list-notes` and copy your shopping list's ID
      into `.env` as `KEEP_NOTE_ID`

## 4. Start the server and smoke-test it

- [ ] Start it: `.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000`
      (or `docker compose up -d --build` to keep it running permanently)
- [ ] From another device: `curl http://<server-ip>:8000/health` returns `"ok": true`
- [ ] Send a test item (see README §1 for the full curl command) and confirm it appears
      as an unchecked checkbox on your Keep note 🎉

## 5. Install the app

- [ ] One-time: enable GitHub Pages — repo **Settings → Pages → Source: Deploy from a branch →
      `gh-pages` / root** (the branch already exists; GitHub won't let CI flip this switch itself)
- [ ] CI keeps it fresh: every merge to `main` reruns the "Android APK" workflow and republishes
- [ ] Open https://nelarsen97.github.io/recipe-book/ on your phone and install the APK
      (allow "install from unknown sources" if Android asks)
- [ ] (Alternative: EAS cloud build — see README §2)

## 6. First launch

- [ ] Open the app → **Settings**
- [ ] Enter the server address (`http://<server-ip>:8000`) and your `API_KEY`
- [ ] Tap **Test connection** — should say "Connected!"
- [ ] Add your first recipe, open it, check off what you have, tap **Add to Google Keep**
- [ ] Check your Keep note — the missing ingredients should be there

## Optional, later

- [ ] Set up [Tailscale](https://tailscale.com) on the server + phone so the app also works
      away from home (don't expose plain HTTP to the internet)
- [ ] Back up `server/data/` occasionally — it holds your recipes
- [ ] Install the app on any other phones and point them at the same server

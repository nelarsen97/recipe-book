---
name: verify
description: Build, launch, and drive the recipe-book Expo app (web) to verify changes end-to-end.
---

# Verifying the recipe-book app

The app is Expo + expo-router with react-native-web, so changes can be
verified in a headless browser without an Android device.

## Launch

```bash
cd app
npm install                       # node_modules is not checked in
CI=1 EXPO_NO_TELEMETRY=1 npx expo start --port 8081   # run in background
# wait until curl -s http://localhost:8081 returns 200; first web bundle
# request takes ~1-2 min, so give the first page.goto a long timeout
```

Notes:
- `npx expo install <pkg>` fails behind the proxy ("Forbidden"); look up the
  SDK-pinned version in `node_modules/expo/bundledNativeModules.json` and
  `npm install pkg@<that version>` instead.
- `npm run lint` also fails: no ESLint config exists and expo tries to
  auto-configure it over the network. Use `npx tsc --noEmit` for static checks.

## Drive (Playwright)

Playwright 1.x is installed globally; import it by absolute path in an .mjs
script (ESM ignores NODE_PATH):

```js
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
```

Chromium is preinstalled (PLAYWRIGHT_BROWSERS_PATH is set) — plain
`chromium.launch()` works. Use a phone-ish viewport (420x800).

Gotchas learned driving it:
- Grant `clipboard-read`/`clipboard-write` context permissions to test the
  copy-to-clipboard flow; read back with `navigator.clipboard.readText()`.
- Routes are URLs (`/`, `/settings`, `/edit`, `/recipe/<id>`), but the edit
  screen finishes with `router.back()` — deep-linking straight to `/edit`
  leaves no history, so click through from the home screen (`+` button)
  instead of `goto('/edit')`.
- The settings Switch renders as a checkbox/switch role element:
  `page.locator('input[type="checkbox"], [role="switch"]')`.
- `Alert.alert` is a no-op on web — flows that end in an Alert can't be
  observed there; verify their state changes instead.
- AsyncStorage is localStorage on web, so `page.reload()` tests persistence.

## Flows worth driving

- Settings: server toggle (default OFF), persistence across reload, server
  URL/API key fields only visible when enabled.
- Recipe list: create via `+`, sync banner only when server enabled.
- Recipe screen: check off ingredients, copy-to-clipboard contents
  (newline-separated), Keep button only when server enabled.

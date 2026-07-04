# Recipe Book — Android app

Expo / React Native app. See the [repo README](../README.md) for full setup, server
configuration, and APK build instructions.

```bash
bun install
bunx expo start                                # develop (Expo Go)
bunx eas-cli build -p android --profile preview  # installable APK
```

Checks (run locally; CI only builds the APK):

```bash
bun run test    # jest unit + functional tests
bun run lint    # eslint
bunx tsc --noEmit  # typecheck
```

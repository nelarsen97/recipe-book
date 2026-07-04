import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the Expo web build. Jest covers component
 * logic; these cover real-browser behavior (keydown default actions,
 * focus timing, selection) that jsdom-style tests can't see.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:8081',
    viewport: { width: 420, height: 800 },
    // Metro bundles a route on its first request, which can take minutes.
    navigationTimeout: 180_000,
  },
  webServer: {
    command: 'bunx expo start --port 8081',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { CI: '1', EXPO_NO_TELEMETRY: '1' },
  },
});

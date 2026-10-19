import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against a running app + Supabase (local `npm run dev:all`, or a staging deploy).
 * Needs E2E_BASE_URL, E2E_SUPABASE_URL, E2E_SERVICE_ROLE_KEY and E2E_OWNER_EMAIL (see tests/e2e/helpers.ts).
 * Set PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled Chromium.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
    trace: "retain-on-failure",
  },
});

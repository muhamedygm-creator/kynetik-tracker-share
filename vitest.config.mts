import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "domain", include: ["domain/**/*.test.ts"], environment: "node" } },
      // Needs a Postgres superuser at TEST_DATABASE_URL (see README → Tests).
      { test: { name: "db", include: ["tests/db/**/*.test.ts"], environment: "node", testTimeout: 30_000, fileParallelism: false } },
    ],
  },
});

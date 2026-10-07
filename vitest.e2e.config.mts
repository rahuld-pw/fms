import { defineConfig } from "vitest/config";

// End-to-end API tests: require the app (npm run dev) and a seeded database.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { E2E: "1" },
  },
});

import { defineConfig } from "vitest/config";

// Database tests: run against a plain Postgres prepared by scripts/db-test-reset.sh
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/api/src/**/*.spec.ts"],
    testTimeout: 60000,
    setupFiles: ["./vitest.setup.ts"],
    // Integration specs share one scratch database: files must not run in
    // parallel (see test scripts: --fileParallelism=false). Kept as documentation;
    // the flag is authoritative.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});

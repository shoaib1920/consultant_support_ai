import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false, // gate/rules suites seed the same demo datastore
    exclude: ["tests/firestore.rules.test.ts"],
    env: { VISAGUARD_DATA_DIR: ".data-test", SESSION_SECRET: "test-secret-test-secret-test-secret" },
  },
});

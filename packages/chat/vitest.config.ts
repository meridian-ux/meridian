import { defineConfig } from "vitest/config";

// Local (pnpm) test runner. The Bazel path uses rules_vite's vitest_test; this
// config is for `pnpm test` during development. esbuild handles the .tsx JSX.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});

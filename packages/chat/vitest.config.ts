import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const schemasUiView = fileURLToPath(new URL("../../schemas/src/uiview/index.ts", import.meta.url));

// Local (pnpm) test runner. The Bazel path uses rules_vite's vitest_test; this
// config is for `pnpm test` during development. esbuild handles the .tsx JSX.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@savvifi/meridian-schemas/uiview": schemasUiView,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});

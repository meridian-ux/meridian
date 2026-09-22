import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const schemasUiView = fileURLToPath(new URL("../../schemas/src/uiview/index.ts", import.meta.url));

// Local (pnpm) test runner. The Bazel path uses rules_vite's vitest_test; this
// config is for `pnpm test` during development. esbuild handles the .tsx JSX.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  // The workspace schema package is source-only in the pnpm tree; the
  // publish/Bazel graph supplies its compiled package. Keep local Vitest
  // aligned with the source graph when compiled launchpad artifacts are
  // present from `npm run build`.
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

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    // @aion/* ships ESM without `"type": "module"`, so Node's default
    // externalization would try to require() its `import`-syntax files.
    // Inline it so Vite transforms it as ESM.
    server: { deps: { inline: [/@aion\//] } },
  },
});

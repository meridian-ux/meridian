// Copy Bazel's generated web-target bridge next to the local Vite suite.
// This is only called after a successful pinned wasm_artifacts build.
import { copyFileSync } from "node:fs";
for (const name of ["meridian_uiview.js", "meridian_uiview_bg.wasm"]) {
  copyFileSync(new URL(`../../bazel-bin/packages/web/tests/${name}`, import.meta.url),
    new URL(`../../packages/web/tests/${name}`, import.meta.url));
}

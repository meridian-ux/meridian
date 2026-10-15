// Copy Bazel's generated web-target bridge next to the local Vite suite.
// This is only called after a successful pinned wasm_artifacts build.
import { copyFileSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function prepareWasm(
  source = fileURLToPath(new URL("../../bazel-bin/packages/web/tests/", import.meta.url)),
  target = fileURLToPath(new URL("../../packages/web/tests/", import.meta.url)),
) {
  const names = ["meridian_uiview.js", "meridian_uiview_bg.wasm"];
  const staging = mkdtempSync(join(target, ".meridian-wasm-"));
  try {
    // Stage both artifacts before replacing either. Bazel outputs are read-only;
    // rename replaces our generated destinations without modifying their modes
    // or following a destination symlink into the build cache.
    for (const name of names) copyFileSync(join(source, name), join(staging, name));
    for (const name of names) renameSync(join(staging, name), join(target, name));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareWasm();

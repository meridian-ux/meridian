// Install only the two generated default-core files, never write through Bazel
// output symlinks. Call after building //schemas:core_runtime, or downloading
// that exact target's two artifacts in CI.
import { isMain } from "./cli_entrypoint.mjs";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function prepareCore(
  source = fileURLToPath(new URL("../../bazel-bin/schemas/src/uiview/generated/", import.meta.url)),
  target = fileURLToPath(new URL("../src/uiview/generated/", import.meta.url)),
) {
  mkdirSync(target, { recursive: true });
  const staging = mkdtempSync(join(target, ".core-runtime-"));
  try {
    const files = ["meridian_uiview.js", "meridian_uiview.d.ts"];
    for (const file of files) copyFileSync(join(source, file), join(staging, file));
    for (const file of files) renameSync(join(staging, file), join(target, file));
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

if (isMain(import.meta.url)) prepareCore(process.argv[2]);

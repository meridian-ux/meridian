import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { isMain } from "./cli_entrypoint.mjs";

test("entry identity supports physical paths and file/directory aliases without claiming other imports", () => {
  const work = mkdtempSync(join(tmpdir(), "meridian-entry-identity-"));
  try {
    const source = join(work, "actual"); mkdirSync(source);
    const main = join(source, "main.mjs"); writeFileSync(main, "export const value = 1;\n");
    const other = join(source, "other.mjs"); writeFileSync(other, "export const value = 2;\n");
    const fileAlias = join(work, "alias.mjs"); symlinkSync(main, fileAlias, "file");
    const directoryAlias = join(work, "alias"); symlinkSync(source, directoryAlias, "dir");
    const url = pathToFileURL(main).href;
    for (const path of [main, fileAlias, join(directoryAlias, "main.mjs")]) assert(isMain(url, path));
    for (const path of [other, join(work, "missing.mjs"), ""]) assert.equal(isMain(url, path), false);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("the exact-removal validator rejects missing input through an absolute path alias", () => {
  const work = mkdtempSync(join(tmpdir(), "meridian-removal-cli-alias-"));
  try {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const alias = join(work, "source"); symlinkSync(root, alias, "dir");
    const result = spawnSync(process.execPath, [join(alias, "schemas/tools/affordance_removal.mjs"), "--check", join(work, "missing.binpb")], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT/);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("the core preparer copies both artifacts through an alias into an isolated package", () => {
  const work = mkdtempSync(join(tmpdir(), "meridian-core-cli-alias-"));
  try {
    const source = join(work, "source"); const tools = join(source, "schemas/tools"); mkdirSync(tools, { recursive: true });
    for (const name of ["prepare_core_runtime.mjs", "cli_entrypoint.mjs"]) copyFileSync(new URL(name, import.meta.url), join(tools, name));
    const input = join(work, "input"); mkdirSync(input);
    for (const name of ["meridian_uiview.js", "meridian_uiview.d.ts"]) writeFileSync(join(input, name), `fixture ${name}\n`);
    const alias = join(work, "alias"); symlinkSync(source, alias, "dir");
    const result = spawnSync(process.execPath, [join(alias, "schemas/tools/prepare_core_runtime.mjs"), input], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    for (const name of ["meridian_uiview.js", "meridian_uiview.d.ts"]) assert.equal(readFileSync(join(source, "schemas/src/uiview/generated", name), "utf8"), `fixture ${name}\n`);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

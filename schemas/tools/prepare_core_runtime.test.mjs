import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCore } from "./prepare_core_runtime.mjs";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "meridian-core-copy-"));
  const source = join(root, "source"), target = join(root, "target");
  mkdirSync(source); mkdirSync(target);
  try { run(source, target); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("core preparation replaces read-only generated artifacts without writing through them", () => fixture((source, target) => {
  for (const file of ["meridian_uiview.js", "meridian_uiview.d.ts"]) {
    writeFileSync(join(source, file), `built ${file}`); chmodSync(join(source, file), 0o444);
    writeFileSync(join(target, file), "old"); chmodSync(join(target, file), 0o444);
  }
  prepareCore(source, target); prepareCore(source, target);
  for (const file of readdirSync(source)) assert.equal(readFileSync(join(target, file), "utf8"), `built ${file}`);
  assert.equal(readdirSync(target).length, 2);
}));

test("an incomplete runtime leaves the previous pair intact", () => fixture((source, target) => {
  writeFileSync(join(source, "meridian_uiview.js"), "new");
  for (const file of ["meridian_uiview.js", "meridian_uiview.d.ts"]) writeFileSync(join(target, file), "old");
  assert.throws(() => prepareCore(source, target), /ENOENT/);
  assert.equal(readdirSync(target).length, 2);
  for (const file of readdirSync(target)) assert.equal(readFileSync(join(target, file), "utf8"), "old");
}));

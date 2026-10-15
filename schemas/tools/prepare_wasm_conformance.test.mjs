import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareWasm } from "./prepare_wasm_conformance.mjs";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "meridian-wasm-copy-test-"));
  const source = join(root, "source"), target = join(root, "target");
  mkdirSync(source); mkdirSync(target);
  try { run(source, target); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("preparation can replace its own read-only Bazel artifacts repeatedly", () => fixture((source, target) => {
  for (const name of ["meridian_uiview.js", "meridian_uiview_bg.wasm"]) {
    writeFileSync(join(source, name), `built ${name}`); chmodSync(join(source, name), 0o444);
    writeFileSync(join(target, name), "old"); chmodSync(join(target, name), 0o444);
  }
  prepareWasm(source, target); prepareWasm(source, target);
  for (const name of readdirSync(source)) assert.equal(readFileSync(join(target, name), "utf8"), `built ${name}`);
  assert.deepEqual(readdirSync(target).sort(), readdirSync(source).sort());
}));

test("an incomplete build leaves the prior pair intact and removes staging files", () => fixture((source, target) => {
  writeFileSync(join(source, "meridian_uiview.js"), "new glue");
  for (const name of ["meridian_uiview.js", "meridian_uiview_bg.wasm"]) writeFileSync(join(target, name), "old artifact");
  assert.throws(() => prepareWasm(source, target), /ENOENT/);
  assert.equal(readdirSync(target).length, 2);
  for (const name of readdirSync(target)) assert.equal(readFileSync(join(target, name), "utf8"), "old artifact");
}));

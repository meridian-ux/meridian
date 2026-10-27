import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createFileRegistry, fromBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { probeRemoval } from "./affordance_removal_probe.mjs";

test("real removal probe preserves historical contracts, rejects both FILE lines, and compiles current readers", async t => {
  const protectedPaths = ["../compat/pre-v1.binpb", "../compat/v1-affordance-candidate.binpb",
    "../compat/v1-additive-pre-removal.binpb", "../compat/v1-surviving-imports.binpb", "../compat/v1-removal-candidate.binpb",
    "../../buf.yaml", "./compatibility_line.mjs"];
  const hashes = () => protectedPaths.map(path => createHash("sha256")
    .update(readFileSync(new URL(path, import.meta.url))).digest("hex"));
  const before = hashes();
  const result = await probeRemoval();
  t.after(() => rmSync(result.work, { recursive: true, force: true }));
  assert.equal(result.phase, "actual-source-removal");
  assert.equal(result.baselineActivated, false);
  assert.deepEqual(result.removals, { fields: 9, messages: 3, enums: 1 });
  assert.deepEqual(result.fileStatuses, { "maintained-0x": 100, "frozen-additive": 100 });
  assert.equal(result.historical.phase, "frozen-additive");
  assert.equal(result.historical.legacySourceCompilations, 4);
  assert.equal(result.historical.namedExports, 180);
  assert.deepEqual(result.generation, ["js+dts", "ts"].map(mode => ({ mode, facades: 9, typedConsumer: "passed" })));
  const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(join(result.work, "candidate.binpb"))));
  assert.equal(registry.getMessage("meridian.ui.v1.Action"), undefined);
  assert.equal(registry.getMessage("meridian.ui.v1.FormPanel").field.submit, undefined);
  assert.deepEqual(hashes(), before, "a probe must never rewrite the active/frozen compatibility inputs");
});

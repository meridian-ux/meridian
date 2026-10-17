import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject } from "./affordance_consumer_probe.mjs";

test("real compiler checking follows isolated aliases and retains strict source errors", () => {
  const work = mkdtempSync(join(tmpdir(), "meridian-consumer-test-"));
  try {
    const config = join(work, "tsconfig.json"), bindings = join(work, "bindings");
    mkdirSync(join(bindings, "proto"), { recursive: true });
    writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, types: [], moduleResolution: "bundler", module: "es2022" }, include: ["consumer.ts"] }));
    writeFileSync(join(work, "consumer.ts"), 'import type { Action } from "@savvifi/meridian-proto-ts/proto/action_pb.js"; declare const value: Action; const label: string = value.label;');
    const declaration = join(bindings, "proto/action_pb.d.ts");
    writeFileSync(declaration, 'export interface Action { label: string }');
    const valid = compileProject(config, bindings);
    assert.equal(valid.diagnostics.length, 0); assert.equal(valid.files, 1); assert.equal(valid.generatedFiles, 1);
    writeFileSync(declaration, 'export interface Action { label: number }');
    assert(compileProject(config, bindings).diagnostics.some(diagnostic => diagnostic.code === 2322));
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("missing project configuration is a failure, not a skipped consumer", () => {
  const result = compileProject(join(tmpdir(), "nonexistent-meridian-consumer/tsconfig.json"), tmpdir());
  assert(result.diagnostics.length > 0); assert.equal(result.files, 0);
});

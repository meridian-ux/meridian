#!/usr/bin/env node
// Explicit removal implementation evidence, never baseline activation. Keep the
// frozen additive checks intact and prove current consumers against real source.
import { isMain } from "./cli_entrypoint.mjs";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { probeCanonical } from "./affordance_migration_probe.mjs";
import { loadRemovalReference, survivingImportReference, verifyRemoval } from "./affordance_removal.mjs";
import { applyFacades, descriptorFiles, modulePath } from "./proto_facades.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUF = join(ROOT, "node_modules/.bin/buf");
const PLUGIN = join(ROOT, "node_modules/.bin/protoc-gen-es");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert(!result.error && result.signal === null, `probe process failed: ${result.error?.message ?? result.signal}`);
  assert.equal(result.status, 0, `${command}\n${result.stdout}\n${result.stderr}`);
  return result;
}
function generate(image, output, mode) {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "package.json"), '{"type":"module"}\n');
  symlinkSync(join(ROOT, "schemas/node_modules"), join(output, "node_modules"), "dir");
  run(BUF, ["generate", image, "--template", JSON.stringify({ version: "v2", plugins: [{
    local: PLUGIN, out: output, opt: [`target=${mode}`, "import_extension=js"],
  }] })]);
}

export async function probeRemoval() {
  // Compile unchanged legacy TypeScript against BOTH immutable historical
  // worlds first. These results never stand in for the actual removal build.
  const historical = await probeCanonical({ frozenAdditive: true });
  const work = mkdtempSync(join(tmpdir(), "meridian-affordance-removal-"));
  try {
    for (const name of ["old", "relocated"]) cpSync(join(historical.work, `${name}.binpb`), join(work, `${name}.binpb`));
    const image = join(work, "candidate.binpb");
    run(BUF, ["build", ROOT, "--as-file-descriptor-set", "--exclude-source-info", "-o", image]);
    const current = fromBinary(FileDescriptorSetSchema, readFileSync(image));
    const removals = verifyRemoval(loadRemovalReference(), current);
    // Do not add a release-line selector or ignore FILE failures. Both existing
    // lines must still reject this explicit breaking implementation candidate.
    const fileStatuses = {};
    for (const [name, baseline] of [
      ["maintained-0x", "pre-v1.binpb"], ["frozen-additive", "v1-additive-pre-removal.binpb"],
    ]) {
      const checked = spawnSync(BUF, ["breaking", image, "--against", join(ROOT, "schemas/compat", baseline),
        "--config", join(ROOT, "buf.yaml")], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      assert(!checked.error && checked.signal === null);
      assert.equal(checked.status, 100, `${name}: expected explicit FILE rejection, not success or tool failure`);
      assert.match(checked.stdout + checked.stderr, /deleted|previously present/i);
      writeFileSync(join(work, `${name}-FILE-rejection.txt`), checked.stdout + checked.stderr);
      fileStatuses[name] = checked.status;
    }
    const surviving = join(work, "surviving-imports.binpb");
    writeFileSync(surviving, toBinary(FileDescriptorSetSchema, survivingImportReference()));
    const source = readFileSync(join(ROOT, "schemas/migration/CanonicalAffordanceConsumer.ts"), "utf8");
    const options = JSON.parse(readFileSync(join(ROOT, "schemas/proto/tsconfig.es.json"), "utf8")).compilerOptions;
    const generation = [];
    for (const mode of ["js+dts", "ts"]) {
      const output = join(work, `after-${mode}`), baseline = join(work, `surviving-${mode}`);
      generate(image, output, mode);
      generate(surviving, baseline, mode);
      const files = descriptorFiles([current]);
      const sources = [...files.keys()].filter(name => name.startsWith("proto/"));
      const facade = applyFacades({ baseline: descriptorFiles([survivingImportReference()]), current: files,
        sources, input: output, output, mode, generateBaseline: () => baseline });
      assert.equal(facade.size, 9);
      writeFileSync(join(output, "consumer.ts"), source);
      writeFileSync(join(output, "tsconfig.json"), JSON.stringify({
        compilerOptions: { ...options, noEmit: true }, include: ["**/*.ts"], exclude: ["node_modules"],
      }));
      run(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(output, "tsconfig.json")]);
      generation.push({ mode, facades: facade.size, typedConsumer: "passed" });
      if (mode === "js+dts") {
        const { AffordanceSchema } = await import(pathToFileURL(join(output, modulePath("proto/affordance.proto") + ".js")).href);
        const parent = createFileRegistry(loadRemovalReference()).getMessage("meridian.ui.v1.Affordance");
        const targets = [{ uri: "/raw" }, { command: "raw\n'$value'" }, { rpc: { service: "raw.Service", method: "Get" } },
          { navigate: { route: "/form" } }, { openPanel: { panelId: "inline" } }, { openView: "raw-view" }, { copy: "" }];
        for (const target of targets) {
          const action = fromJson(AffordanceSchema, { ...target, tone: 0, emphasis: 0, refreshOnSuccess: false });
          const retained = fromBinary(parent, toBinary(AffordanceSchema, action));
          const roundTrip = fromBinary(AffordanceSchema, toBinary(parent, retained));
          assert.deepEqual(roundTrip.invoke, action.invoke);
          assert.equal(roundTrip.refreshOnSuccess, false);
        }
      }
    }
    return { work, phase: "actual-source-removal", removals, fileStatuses, generation,
      historical: { phase: historical.phase, legacySourceCompilations: historical.legacySourceCompilations,
        namedExports: historical.namedExports }, baselineActivated: false };
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  } finally { rmSync(historical.work, { recursive: true, force: true }); }
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || args.length === 1 && args[0] === "--keep", "usage: affordance_removal_probe.mjs [--keep]");
  const result = await probeRemoval();
  try { console.log(JSON.stringify({ ...result, work: args.includes("--keep") ? result.work : undefined }, null, 2)); }
  finally { if (!args.includes("--keep")) rmSync(result.work, { recursive: true, force: true }); }
}

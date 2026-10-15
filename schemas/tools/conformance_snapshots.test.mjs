import assert from "node:assert/strict";
import test from "node:test";

import {
  BAZEL_TARGETS,
  VITEST_SUITES,
  buildCommands,
  parseArgs,
} from "./conformance_snapshots.mjs";

test("builds one Vitest command per browser renderer plus the coverage gate", () => {
  const commands = buildCommands();
  assert.equal(commands.length, VITEST_SUITES.length + 1);
  assert.deepEqual(
    commands.slice(0, VITEST_SUITES.length).map((step) => step.args[0]),
    ["run", "run", "run"],
  );
  assert.deepEqual(commands.at(-1)?.args, ["schemas/tools/check_coverage.mjs"]);
});

test("update mode is explicit and applies to every Vitest suite", () => {
  const commands = buildCommands({ update: true });
  for (const step of commands.slice(0, VITEST_SUITES.length)) {
    assert.equal(step.args.at(-1), "--update");
  }
});

test("the shared update environment switch enables every Vitest suite", () => {
  const options = parseArgs([], { UPDATE_SNAPSHOTS: "1" });
  assert.equal(options.update, true);
  const commands = buildCommands(options);
  for (const step of commands.slice(0, VITEST_SUITES.length)) {
    assert.equal(step.args.at(-1), "--update");
  }
});

test("other UPDATE_SNAPSHOTS values do not opt into writing", () => {
  assert.equal(parseArgs([], { UPDATE_SNAPSHOTS: "true" }).update, false);
});

test("Bazel verification uses only snapshot-owning conformance targets", () => {
  const commands = buildCommands({ bazel: true });
  assert.deepEqual(commands.at(-1)?.args, ["test", "--announce_rc=false", ...BAZEL_TARGETS]);
});

test("argument parsing rejects misspelled destructive update flags", () => {
  assert.deepEqual(parseArgs(["--update", "--bazel", "--dry-run"]), {
    update: true,
    bazel: true,
    wasm: false,
    native: false,
    dryRun: true,
    help: false,
  });
  assert.throws(() => parseArgs(["--udpate"]), /unknown argument: --udpate/);
});

test("WASM recording builds and copies the real bridge before running its suite", () => {
  const commands = buildCommands({ wasm: true, update: true });
  const preparation = commands.slice(VITEST_SUITES.length, -1);
  assert.deepEqual(preparation.map(step => step.args), [
    ["build", "--announce_rc=false", "//packages/web/tests:wasm_artifacts"],
    ["schemas/tools/prepare_wasm_conformance.mjs"],
    ["run", "tests/conformance_wasm.test.ts", "--update"],
  ]);
  assert.equal(parseArgs(["--wasm"]).wasm, true);
});

test("native golden recording is explicit and read-only mode overrides an inherited writer flag", () => {
  const recording = buildCommands({ native: true, update: true }).at(-2);
  assert.deepEqual(recording.args, ["run", "--announce_rc=false", "//crates/tui/rust/tui:stateful_conformance_test"]);
  assert.deepEqual(recording.env, { UPDATE_SNAPSHOTS: "1" });
  assert.deepEqual(buildCommands({ native: true }).at(-2).env, { UPDATE_SNAPSHOTS: "0" });
  assert.equal(parseArgs(["--native"]).native, true);
});

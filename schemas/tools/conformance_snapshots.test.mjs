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

test("Bazel verification uses only snapshot-owning conformance targets", () => {
  const commands = buildCommands({ bazel: true });
  assert.deepEqual(commands.at(-1)?.args, ["test", ...BAZEL_TARGETS]);
});

test("argument parsing rejects misspelled destructive update flags", () => {
  assert.deepEqual(parseArgs(["--update", "--bazel", "--dry-run"]), {
    update: true,
    bazel: true,
    dryRun: true,
    help: false,
  });
  assert.throws(() => parseArgs(["--udpate"]), /unknown argument: --udpate/);
});

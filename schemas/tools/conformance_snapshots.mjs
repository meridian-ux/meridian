#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const VITEST_SUITES = [
  {
    cwd: "packages/web-react",
    files: ["tests/conformance.test.ts"],
  },
  {
    cwd: "packages/mui-kit",
    files: ["tests/conformance.test.tsx"],
  },
  {
    cwd: "packages/web",
    files: ["tests/conformance.test.ts", "tests/conformance_normalizer.test.ts"],
  },
];

export const BAZEL_TARGETS = [
  "//packages/web-react:conformance",
  "//packages/web/tests:conformance",
];

export function buildCommands({ update = false, bazel = false } = {}) {
  const commands = VITEST_SUITES.map(({ cwd, files }) => ({
    command: "./node_modules/.bin/vitest",
    args: ["run", ...files, ...(update ? ["--update"] : [])],
    cwd: resolve(ROOT, cwd),
  }));

  commands.push({
    command: process.execPath,
    args: ["schemas/tools/check_coverage.mjs"],
    cwd: ROOT,
  });

  if (bazel) {
    commands.push({
      command: "bazel",
      args: ["test", ...BAZEL_TARGETS],
      cwd: ROOT,
    });
  }

  return commands;
}

export function parseArgs(argv) {
  const known = new Set(["--update", "--bazel", "--dry-run", "--help"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) throw new Error(`unknown argument${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  return {
    update: argv.includes("--update"),
    bazel: argv.includes("--bazel"),
    dryRun: argv.includes("--dry-run"),
    help: argv.includes("--help"),
  };
}

function printable({ command, args, cwd }) {
  return `${cwd.replace(`${ROOT}/`, "")} $ ${[command, ...args].join(" ")}`;
}

export function run(commands, { dryRun = false } = {}) {
  for (const step of commands) {
    console.log(printable(step));
    if (dryRun) continue;
    const result = spawnSync(step.command, step.args, {
      cwd: step.cwd,
      stdio: "inherit",
      env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

function usage() {
  console.log(`Usage: node schemas/tools/conformance_snapshots.mjs [--update] [--bazel] [--dry-run]

Runs every browser semantic conformance suite and the snapshot coverage gate.
  --update   Re-record intentional Vitest snapshot changes.
  --bazel    Also run the Bazel conformance targets that own browser snapshots.
  --dry-run  Print the commands without executing them.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      usage();
      process.exitCode = 0;
    } else {
      process.exitCode = run(buildCommands(options), options);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

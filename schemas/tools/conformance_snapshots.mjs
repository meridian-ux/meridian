#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const VITEST_SUITES = [
  {
    cwd: "packages/web-react",
    files: ["tests/conformance.test.ts", "tests/stateful_conformance.test.ts"],
  },
  {
    cwd: "packages/mui-kit",
    files: ["tests/conformance.test.tsx", "tests/stateful_conformance.test.ts"],
  },
  {
    cwd: "packages/web",
    files: ["tests/conformance.test.ts", "tests/conformance_normalizer.test.ts"],
  },
];

export const BAZEL_TARGETS = [
  "//packages/web-react:conformance",
  "//packages/mui-kit:stateful_conformance",
  "//packages/web/tests:conformance",
  "//packages/web/tests:conformance_wasm",
  "//crates/tui/rust/tui:stateful_conformance_test",
];

export function buildCommands({ update = false, bazel = false, wasm = false, native = false, swiftui = false } = {}) {
  const commands = VITEST_SUITES.map(({ cwd, files }) => ({
    command: "./node_modules/.bin/vitest",
    args: ["run", ...files, ...(update ? ["--update"] : [])],
    cwd: resolve(ROOT, cwd),
  }));

  if (wasm) commands.push(
    { command: "bazel", args: ["build", "--announce_rc=false", "//packages/web/tests:wasm_artifacts"], cwd: ROOT },
    { command: process.execPath, args: ["schemas/tools/prepare_wasm_conformance.mjs"], cwd: ROOT },
    { command: "./node_modules/.bin/vitest", args: ["run", "tests/conformance_wasm.test.ts", ...(update ? ["--update"] : [])], cwd: resolve(ROOT, "packages/web") },
  );
  if (native) commands.push({
    command: "bazel",
    args: ["run", "--announce_rc=false", "//crates/tui/rust/tui:stateful_conformance_test"],
    cwd: ROOT,
    env: { UPDATE_SNAPSHOTS: update ? "1" : "0" },
  });

  if (swiftui) commands.push({
    command: "python3",
    args: ["tools/swiftui.py"],
    cwd: ROOT,
    // Bazel's Python launcher enables safe-path mode. Explicitly admit only
    // this workspace's sibling build helpers, not an inherited module path.
    env: { UPDATE_SNAPSHOTS: update ? "1" : "0", PYTHONPATH: resolve(ROOT, "tools") },
    requiresDarwin: true,
  });

  commands.push({
    command: process.execPath,
    args: ["schemas/tools/check_coverage.mjs"],
    cwd: ROOT,
  });

  if (bazel) {
    commands.push({
      command: "bazel",
      args: ["test", "--announce_rc=false", ...BAZEL_TARGETS],
      cwd: ROOT,
    });
  }

  return commands;
}

export function parseArgs(argv, env = process.env) {
  const known = new Set(["--update", "--bazel", "--wasm", "--native", "--swiftui", "--dry-run", "--help"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) throw new Error(`unknown argument${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  return {
    update: argv.includes("--update") || env.UPDATE_SNAPSHOTS === "1",
    bazel: argv.includes("--bazel"),
    wasm: argv.includes("--wasm"),
    native: argv.includes("--native"),
    swiftui: argv.includes("--swiftui"),
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
    if (step.requiresDarwin && process.platform !== "darwin") throw new Error("SwiftUI snapshots require macOS; they cannot be skipped or emulated");
    const result = spawnSync(step.command, step.args, {
      cwd: step.cwd,
      stdio: "inherit",
      env: { ...process.env, ...step.env },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

function usage() {
  console.log(`Usage: node schemas/tools/conformance_snapshots.mjs [--update] [--wasm] [--native] [--swiftui] [--bazel] [--dry-run]

Runs every browser semantic conformance suite and the snapshot coverage gate.
  --update   Re-record intentional Vitest snapshot changes (also UPDATE_SNAPSHOTS=1).
  --bazel    Also run the Bazel conformance targets that own browser snapshots.
  --wasm     Build the pinned real WASM bridge and compare/re-record its DOM suite.
  --native   Compare/re-record native buffers through the real PanelView renderer.
  --swiftui  Prepare and compare/re-record SwiftUI view projections on macOS.
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

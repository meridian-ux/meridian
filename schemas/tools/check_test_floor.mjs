#!/usr/bin/env node
/**
 * Test-floor ratchet.
 *
 * CI runs the suites separately. This gate protects the other half of the
 * contract: a package cannot quietly delete its tests and remain green merely
 * because the remaining tests still pass. Counts are intentionally based on
 * declarations in the same source roots CI discovers; they are not a claim
 * that a declaration passed, which is why this gate follows the test job.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative } from "node:path";

const SCHEMAS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(SCHEMAS_ROOT, "..");
const JAVASCRIPT_TEST_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

export function countJavaScriptTests(text) {
  // Test declarations begin a line in the supported Vitest/Node test styles.
  // Anchoring avoids counting assertion calls such as `pattern.test(value)`.
  return (text.match(/^\s*(?:test|it)(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\s*\(/gm) ?? []).length;
}

export function countRustTests(text) {
  return (text.match(/^\s*#\[(?:test|tokio::test|rstest)(?:\([^\n]*\))?\]\s*$/gm) ?? []).length;
}

export function countSuite(suite, { repoRoot = REPO_ROOT } = {}) {
  let count = 0;
  const missingRoots = [];
  const excluded = new Set(suite.exclude ?? []);
  for (const relativeRoot of suite.roots ?? []) {
    const files = (() => {
      try {
        return filesUnderFrom(repoRoot, relativeRoot);
      } catch (error) {
        if (error?.code === "ENOENT") {
          missingRoots.push(relativeRoot);
          return [];
        }
        throw error;
      }
    })();
    for (const path of files) {
      const relativePath = relative(repoRoot, path).replaceAll("\\", "/");
      if (excluded.has(relativePath)) continue;
      const extension = extname(path);
      const isTestFile = suite.kind === "rust"
        ? extension === ".rs"
        : JAVASCRIPT_TEST_EXTENSIONS.has(extension) && /\.test\.[^.]+$/.test(path);
      if (!isTestFile) continue;
      const text = readFileSync(path, "utf8");
      count += suite.kind === "rust" ? countRustTests(text) : countJavaScriptTests(text);
    }
  }
  return { count, missingRoots };
}

function filesUnderFrom(repoRoot, relativeRoot) {
  const absoluteRoot = join(repoRoot, relativeRoot);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(absoluteRoot);
  return files;
}

export function check(manifest, options = {}) {
  const errors = [];
  const ids = new Set();
  for (const suite of manifest.suites ?? []) {
    if (!suite.id || ids.has(suite.id)) {
      errors.push(`duplicate or empty suite id: ${suite.id ?? "<empty>"}`);
      continue;
    }
    ids.add(suite.id);
    if (!Number.isInteger(suite.floor) || suite.floor < 0) {
      errors.push(`${suite.id}: floor must be a non-negative integer`);
      continue;
    }
    if (suite.kind !== "javascript" && suite.kind !== "rust") {
      errors.push(`${suite.id}: unknown suite kind "${suite.kind}"`);
      continue;
    }
    const { count, missingRoots } = countSuite(suite, options);
    for (const root of missingRoots) errors.push(`${suite.id}: test root does not exist: ${root}`);
    if (count < suite.floor) {
      errors.push(`${suite.id}: test floor ${suite.floor} not met; found ${count} declared tests`);
    }
  }
  if (ids.size === 0) errors.push("test-floor manifest has no suites");
  return errors;
}

function readManifest() {
  return JSON.parse(readFileSync(join(SCHEMAS_ROOT, "conformance/test_floor.json"), "utf8"));
}

function main() {
  const manifest = readManifest();
  const errors = check(manifest);
  if (errors.length === 0) {
    const summary = manifest.suites.map((suite) => {
      const { count } = countSuite(suite);
      return `${suite.id} ${count}/${suite.floor}`;
    }).join(", ");
    console.log(`test floor OK — ${summary}`);
    return;
  }
  console.error(`test floor drift (${errors.length}):\n`);
  for (const error of errors) console.error(`  • ${error}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

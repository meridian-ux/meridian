import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSummary } from "./coverage_summary.mjs";

const suites = ["schemas", "chat", "launchpad", "mui-kit", "web", "web-react", "rust"];
const report = (source) => [
  `SF:${source}`,
  "DA:1,1",
  "BRDA:1,0,0,1",
  "LF:1",
  "LH:1",
  "BRF:1",
  "BRH:1",
  "end_of_record",
  "",
].join("\n");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "meridian-coverage-summary-"));
  const input = join(root, "coverage");
  mkdirSync(input);
  for (const suite of suites) {
    const suiteDir = join(input, suite);
    mkdirSync(suiteDir);
    writeFileSync(join(suiteDir, "lcov.info"), report(`${suite}/src/index.ts`));
  }
  return { root, input, output: join(root, "coverage-summary") };
}

test("builds the summary and preserves every expected LCOV report", (t) => {
  const paths = fixture();
  t.after(() => rmSync(paths.root, { recursive: true, force: true }));

  buildSummary(paths.input, paths.output);

  const summary = readFileSync(join(paths.output, "SUMMARY.md"), "utf8");
  assert.match(summary, /\| schemas \| 1 \| 100\.0% \(1\/1\)/);
  assert.match(summary, /\| \*\*All suites\*\* \| \*\*7\*\*/);
  assert.equal(readdirSync(paths.output, { recursive: true }).filter((path) => path === "SUMMARY.md").length, 1);
  assert.equal(readdirSync(paths.output, { recursive: true }).filter((path) => path.endsWith("lcov.info")).length, 7);
  for (const suite of suites) {
    assert.equal(readFileSync(join(paths.output, suite, "lcov.info"), "utf8"), report(`${suite}/src/index.ts`));
  }
});

test("refuses arbitrary and non-empty unowned output directories without deleting data", (t) => {
  const paths = fixture();
  t.after(() => rmSync(paths.root, { recursive: true, force: true }));
  const important = join(paths.root, "important-data");
  mkdirSync(important);
  const sentinel = join(important, "keep.txt");
  writeFileSync(sentinel, "preserve me");
  assert.throws(() => buildSummary(paths.input, important), /dedicated directory named coverage-summary/);
  assert.equal(readFileSync(sentinel, "utf8"), "preserve me");

  const unowned = join(paths.root, "coverage-summary");
  mkdirSync(unowned);
  writeFileSync(join(unowned, "keep.txt"), "also preserve me");
  assert.throws(() => buildSummary(paths.input, unowned), /non-empty, unowned output directory/);
  assert.equal(readFileSync(join(unowned, "keep.txt"), "utf8"), "also preserve me");
});

test("requires all seven LCOV reports before producing a summary", (t) => {
  const paths = fixture();
  t.after(() => rmSync(paths.root, { recursive: true, force: true }));
  rmSync(join(paths.input, "rust"), { recursive: true });
  assert.throws(() => buildSummary(paths.input, paths.output), /missing coverage report for rust/);
});

test("refuses a symlink output without changing its target", (t) => {
  const paths = fixture();
  t.after(() => rmSync(paths.root, { recursive: true, force: true }));
  const target = join(paths.root, "protected");
  mkdirSync(target);
  writeFileSync(join(target, "keep.txt"), "preserve symlink target");
  symlinkSync(target, paths.output, "dir");

  assert.throws(() => buildSummary(paths.input, paths.output), /symlink or file/);
  assert.equal(readFileSync(join(target, "keep.txt"), "utf8"), "preserve symlink target");
});

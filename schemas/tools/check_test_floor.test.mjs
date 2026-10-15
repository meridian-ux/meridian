import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check, checkRatchet, countJavaScriptTests, countRustTests, countSuite } from "./check_test_floor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readManifest = () => JSON.parse(readFileSync(join(ROOT, "conformance/test_floor.json"), "utf8"));

test("the committed test floor is met", () => {
  assert.deepEqual(check(readManifest()), []);
});

test("a suite below its floor fails", () => {
  const manifest = readManifest();
  const chat = manifest.suites.find((suite) => suite.id === "chat");
  const actual = countSuite(chat).count;
  chat.floor = actual + 1;
  assert.ok(check(manifest).some((error) => error ===
    `chat: test floor ${actual + 1} not met; found ${actual} declared tests`));
});

test("missing test roots fail instead of counting zero silently", () => {
  const manifest = readManifest();
  manifest.suites[0].roots = ["packages/does-not-exist/tests"];
  const errors = check(manifest);
  assert.ok(errors.some((error) => /test root does not exist/.test(error)));
});

test("excluded files mirror CI test-script exclusions", () => {
  const manifest = readManifest();
  const web = manifest.suites.find((suite) => suite.id === "web");
  const webPackage = JSON.parse(readFileSync(join(ROOT, "../packages/web/package.json"), "utf8"));
  const ciExclusions = [...webPackage.scripts.test.matchAll(/--exclude\s+([^\s]+)/g)]
    .map(([, path]) => `packages/web/${path}`);
  assert.deepEqual([...web.exclude].sort(), ciExclusions.sort());
});

test("JavaScript declarations count test and it styles but not assertion calls", () => {
  const source = `
    test("one", () => {});
    it.each([1])("two", () => {});
    expect("x").toMatch(/x/.test("x"));
  `;
  assert.equal(countJavaScriptTests(source), 2);
});

test("Rust declarations count supported test attributes", () => {
  const source = `
    #[test]
    fn one() {}
    #[tokio::test]
    async fn two() {}
    #[rstest]
    fn three() {}
  `;
  assert.equal(countRustTests(source), 3);
});

test("ordinary web tests cannot hide removal of a WASM boundary test", (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), "meridian-ffi-floor-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const root = join(repoRoot, "packages/web/tests");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "ordinary.test.ts"), 'it("renderer", () => {});\n'.repeat(100));
  const suite = readManifest().suites.find((entry) => entry.id === "web-wasm-ffi");
  writeFileSync(join(root, "conformance_wasm.test.ts"), 'it("boundary", () => {});\n'.repeat(suite.floor));
  assert.deepEqual(check({ suites: [suite] }, { repoRoot }), []);
  writeFileSync(join(root, "conformance_wasm.test.ts"), 'it("boundary", () => {});\n'.repeat(suite.floor - 1));
  assert.match(check({ suites: [suite] }, { repoRoot })[0], /test floor .* not met/);
});

test("ratchet rejects lowered floors and removed suites even when remaining tests pass", () => {
  const baseline = readManifest();
  const lowered = structuredClone(baseline);
  lowered.suites[0].floor -= 1;
  assert.deepEqual(check(lowered), []);
  assert.match(checkRatchet(lowered, baseline)[0], /floor cannot decrease/);
  const removed = structuredClone(baseline);
  removed.suites.shift();
  assert.match(checkRatchet(removed, baseline)[0], /cannot remove a protected test suite/);
});

test("ratchet allows unchanged and higher floors and newly protected suites", () => {
  const baseline = readManifest();
  assert.deepEqual(checkRatchet(baseline, baseline), []);
  const raised = structuredClone(baseline);
  raised.suites[0].floor += 1;
  raised.suites.push({ id: "new-suite", floor: 1 });
  assert.deepEqual(checkRatchet(raised, baseline), []);
});

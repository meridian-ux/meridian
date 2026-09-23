import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check, countJavaScriptTests, countRustTests, countSuite } from "./check_test_floor.mjs";

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
  const all = countSuite({ ...web, exclude: [] }).count;
  const ciScoped = countSuite(web).count;
  assert.equal(all - ciScoped, 5);
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

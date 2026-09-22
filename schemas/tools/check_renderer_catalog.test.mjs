import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check, checkCommittedCatalog } from "./check_renderer_catalog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(readFileSync(join(ROOT, "conformance", name), "utf8"));

test("the committed renderer catalog is complete", () => {
  assert.deepEqual(checkCommittedCatalog(), []);
});

test("every coverage renderer needs a catalog row", () => {
  const catalog = read("renderer_catalog.json");
  const coverage = read("coverage.json");
  catalog.renderers = catalog.renderers.filter((entry) => entry.id !== "tui");
  assert.ok(check(catalog, coverage).some((error) => /coverage renderer "tui"/.test(error)));
});

test("a new panel catalog row needs a coverage declaration", () => {
  const catalog = read("renderer_catalog.json");
  const coverage = read("coverage.json");
  catalog.renderers.push({ id: "native-panel", modality: "panel", status: "development", source: { kind: "local", root: "packages/web", entrypoint: "src/uiview/renderer.ts" } });
  assert.ok(check(catalog, coverage).some((error) => /catalog panel renderer "native-panel"/.test(error)));
});

test("an external preview must have a coverage row", () => {
  const catalog = read("renderer_catalog.json");
  const coverage = read("coverage.json");
  const swiftui = catalog.renderers.find((entry) => entry.id === "swiftui");
  assert.equal(swiftui.status, "preview");
  assert.equal(swiftui.source.kind, "external");
  delete coverage.renderers.swiftui;
  assert.ok(check(catalog, coverage).some((error) => /catalog panel renderer "swiftui"/.test(error)));
});

test("the committed external preview coverage row is complete", () => {
  const catalog = read("renderer_catalog.json");
  const coverage = read("coverage.json");
  assert.deepEqual(check(catalog, coverage), []);
});

test("local entrypoints cannot silently disappear", () => {
  const catalog = read("renderer_catalog.json");
  const coverage = read("coverage.json");
  catalog.renderers.find((entry) => entry.id === "chat-html").source.entrypoint = "src/missing-html.ts";
  catalog.renderers.find((entry) => entry.id === "chat-react").source.entrypoint = "src/missing-react.tsx";
  const errors = check(catalog, coverage);
  assert.ok(errors.some((error) => /chat-html: local entrypoint does not exist/.test(error)));
  assert.ok(errors.some((error) => /chat-react: local entrypoint does not exist/.test(error)));
});

test("external preview rows explain why they have no local path", () => {
  const catalog = read("renderer_catalog.json");
  const coverage = read("coverage.json");
  delete catalog.renderers.find((entry) => entry.id === "swiftui").source.note;
  assert.ok(check(catalog, coverage).some((error) => /swiftui: external source needs an explanatory note/.test(error)));
});

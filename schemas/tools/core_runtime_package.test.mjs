import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { embedCore } from "./embed_core_wasm.mjs";
import { createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

test("packaging refuses an invalid wasm module or incomplete formatter bridge", () => {
  assert.throws(() => embedCore("", new Uint8Array(), ""), /Incomplete core/);
  const glue = "function initSync() {} function formatValueDisplay() {} function formatValueDisplayAt() {} function matchesFormPattern() {} function matchesRowFilter() {} function buildRequest() {} function buildSubmissionRequest() {}";
  assert.throws(() => embedCore(glue, new Uint8Array(), ""), /Invalid core WebAssembly/);
  assert.throws(() => embedCore(glue.replace("function matchesFormPattern() {}", ""), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), ""), /Incomplete core/);
  assert.throws(() => embedCore(glue.replace("function matchesRowFilter() {}", ""), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), ""), /Incomplete core/);
  assert.throws(() => embedCore(glue.replace("function buildRequest() {}", ""), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), ""), /Incomplete core/);
  assert.throws(() => embedCore(glue.replace("function buildSubmissionRequest() {}", ""), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), ""), /Incomplete core/);
});

test("the packaged module imports detached and formats synchronously without fetch, Intl, or a process clock", () => {
  const directory = mkdtempSync(join(tmpdir(), "meridian-core-runtime-"));
  try {
    const modulePath = join(directory, "core.mjs");
    writeFileSync(modulePath, readFileSync(new URL("../src/uiview/generated/meridian_uiview.js", import.meta.url)));
    const corpus = JSON.parse(readFileSync(new URL("../conformance/core.json", import.meta.url), "utf8"));
    const fixture = corpus.valueFormats.find(entry => entry.name === "epoch-zero-clock");
    // Like the corpus writer, use the committed native descriptor image, not
    // extensionless generated SDK facade imports in this detached Node test.
    const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(
      new URL("../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url))));
    const PanelDescriptorSchema = registry.getMessage("meridian.ui.v1.PanelDescriptor");
    const submission = Buffer.from(toBinary(PanelDescriptorSchema, fromJson(PanelDescriptorSchema, { form: {
      submitAffordance: { rpc: { service: "raw.Service", method: "Get" } }, fields: [{ fieldId: "raw" }, { fieldId: "flag" }],
    } }))).toString("base64");
    for (const TZ of ["Pacific/Honolulu", "Asia/Tokyo"]) {
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
        globalThis.fetch = () => { throw new Error("unexpected fetch"); };
        Date.now = () => { throw new Error("unexpected clock"); };
        Intl.DateTimeFormat = Intl.RelativeTimeFormat = class { constructor() { throw new Error("unexpected Intl formatter"); } };
        const core = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
        const fixture = JSON.parse(process.argv[1]);
        const declaration = Uint8Array.from(Buffer.from(fixture.display, "base64"));
        console.log(JSON.stringify({
          result: Buffer.from(core.formatValueDisplayAt(declaration, fixture.input, 0)).toString("base64"),
          timestamp: core.formatTimestamp("2026-03-29T13:45:00"),
          inferred: core.formatInferredValue([false, "2026-03-29", null]),
          stat: core.formatStatNumber(1234.5, 3),
          submission: core.buildSubmissionRequest(Uint8Array.from(Buffer.from(process.argv[2], "base64")),
            { currentResourcePath: "", uiIdentity: null, selectedRow: null, formValues: {}, selections: {} }, { raw: "001.20", flag: false }),
        }));
      `, JSON.stringify(fixture), submission], { encoding: "utf8", env: { ...process.env, TZ } });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        result: fixture.expected,
        timestamp: "Mar 29, 2026, 1:45 PM UTC",
        inferred: "No, Mar 29, 2026, —",
        stat: "$1,234.50",
        submission: { raw: "001.20", flag: false },
      });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("browser display adapters contain no duplicate temporal, principal, or numeric formatter", () => {
  const source = readFileSync(new URL("../src/uiview/value_display.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new Date\(|Intl\.|\.toFixed\(|BigInt\(|function principalParts|function formatTemporal/);
  assert.match(source, /return formatByCore\(value, display, coreFormatting, nowMs\)/);
});

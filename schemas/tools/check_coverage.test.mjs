// Guards the coverage gate itself.
//
// Same standard mirror_conformance.test.mjs holds: a gate that has never been
// shown to fail is not a gate. The cases below are the drifts this one exists
// to catch — chiefly a new proto arm that never reaches a renderer, and a
// full-parity shape quietly left unrenderable.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  check,
  checkModalities,
  checkPanelRendererCoverage,
  checkWorkspaceRendererCoverage,
  parseBodyArms,
  parseScopedOneofArms,
} from "./check_coverage.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const realManifest = () =>
  JSON.parse(readFileSync(join(ROOT, "conformance/coverage.json"), "utf8"));
const realArms = () =>
  parseBodyArms(readFileSync(join(ROOT, "proto/panel.proto"), "utf8"));
const realCatalog = () =>
  JSON.parse(readFileSync(join(ROOT, "conformance/renderer_catalog.json"), "utf8"));

test("the committed manifest and proto agree", () => {
  assert.deepEqual(check(realManifest(), realArms()), []);
});

test("the parser finds every arm of the body oneof", () => {
  const arms = realArms();
  assert.equal(arms.length, 23);
  // Field numbers start at 3 (1/2 are panel_id/title) and must be unique.
  assert.equal(new Set(arms.map((a) => a.number)).size, arms.length);
  assert.ok(arms.some((a) => a.name === "table" && a.type === "TablePanel"));
  assert.ok(arms.some((a) => a.name === "stream"));
});

test("the scoped parser finds every Conversation.Block.kind arm", () => {
  const proto = readFileSync(join(ROOT, "proto/conversation.proto"), "utf8");
  const arms = parseScopedOneofArms(proto, "Block.kind");
  assert.equal(arms.length, 9);
  assert.deepEqual(arms.map((arm) => arm.name), [
    "markdown", "context", "tool", "list", "fields", "code", "divider", "table", "view",
  ]);
});

test("the committed non-panel modality coverage and catalog agree", () => {
  assert.deepEqual(checkModalities(realManifest(), realCatalog()), []);
});

test("every catalog panel renderer, including an external preview, has a coverage row", () => {
  const manifest = realManifest();
  delete manifest.renderers.swiftui;
  const errors = checkPanelRendererCoverage(manifest, realCatalog());
  assert.deepEqual(errors, ['catalog panel renderer "swiftui" has no coverage row']);
});

test("coverage cannot contain a renderer absent from the panel catalog", () => {
  const manifest = realManifest();
  manifest.renderers.ghost = { repo: "elsewhere", entrypoint: "unknown" };
  assert.ok(checkPanelRendererCoverage(manifest, realCatalog()).some((error) => /ghost/.test(error)));
});

test("workspace renderers are declared and cataloged across panel and non-panel modalities", () => {
  assert.deepEqual(checkWorkspaceRendererCoverage(realCatalog()), []);
});

test("a new proto-dependent package without renderer metadata fails", (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), "meridian-renderers-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, "packages", "new-renderer"), { recursive: true });
  mkdirSync(join(repoRoot, "crates"), { recursive: true });
  writeFileSync(join(repoRoot, "packages", "new-renderer", "package.json"), JSON.stringify({
    dependencies: { "@savvifi/meridian-proto-ts": "workspace:*" },
  }));
  const errors = checkWorkspaceRendererCoverage({ renderers: [] }, { repoRoot });
  assert.ok(errors.some((error) => /new-renderer.*no meridian\.rendererIds array/.test(error)));
});

test("a declared new workspace renderer missing from the catalog fails", (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), "meridian-renderers-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, "packages", "new-renderer"), { recursive: true });
  mkdirSync(join(repoRoot, "crates"), { recursive: true });
  writeFileSync(join(repoRoot, "packages", "new-renderer", "package.json"), JSON.stringify({
    dependencies: { "@savvifi/meridian-proto-ts": "workspace:*" },
    meridian: { rendererIds: ["new-renderer"] },
  }));
  const errors = checkWorkspaceRendererCoverage({ renderers: [] }, { repoRoot });
  assert.ok(errors.some((error) => /new-renderer.*has no catalog entry/.test(error)));
});

test("the Launchpad manifest covers every Command.action arm", () => {
  const proto = readFileSync(join(ROOT, "proto/command_palette.proto"), "utf8");
  const arms = parseScopedOneofArms(proto, "Command.action");
  assert.deepEqual(arms.map((arm) => arm.name), ["rpc", "open_panel", "open_view_id", "navigate"]);
  assert.deepEqual(checkModalities(realManifest(), realCatalog()), []);
});

test("a modality proto arm with no renderer coverage fails", () => {
  const manifest = realManifest();
  delete manifest.modalities.conversation.arms.view;
  const errors = checkModalities(manifest, realCatalog());
  assert.ok(errors.some((error) => /conversation\.view: proto arm has no declared coverage/.test(error)));
});

test("adding a conversation renderer without rows fails", () => {
  const catalog = realCatalog();
  catalog.renderers.push({ id: "new-chat", modality: "conversation", status: "development" });
  const errors = checkModalities(realManifest(), catalog);
  assert.ok(errors.some((error) => /conversation\.markdown: no entry for renderer "new-chat"/.test(error)));
});

test("a modality gap without a reason fails", () => {
  const manifest = realManifest();
  delete manifest.modalities.conversation.arms.view.renderers["chat-html"].reason;
  const errors = checkModalities(manifest, realCatalog());
  assert.ok(errors.some((error) => /conversation\.view\.chat-html: status "not-applicable" needs a reason/.test(error)));
});

test("a new proto arm with no declared coverage fails", () => {
  // The headline drift: someone adds a shape and no renderer ever hears of it.
  const arms = [...realArms(), { type: "SparklinePanel", name: "sparkline", number: 24 }];
  const errors = check(realManifest(), arms);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /sparkline/);
  assert.match(errors[0], /must declare where it renders/);
});

test("a manifest arm that the proto does not declare fails", () => {
  const m = realManifest();
  m.arms.ghost = { parity: "standard", renderers: {} };
  const errors = check(m, realArms());
  assert.ok(errors.some((e) => /ghost/.test(e) && /not in panel\.proto/.test(e)));
});

test("a gap with no reason fails", () => {
  const m = realManifest();
  m.arms.gallery.renderers["web-components"] = { status: "missing" };
  const errors = check(m, realArms());
  assert.ok(errors.some((e) => /gallery\.web-components/.test(e) && /needs a reason/.test(e)));
});

test("an UNWAIVED full-parity gap fails", () => {
  // This is the finding the gate is really for: panel.proto promises these
  // shapes render everywhere, so a silent hole must not be representable.
  const m = realManifest();
  m.arms.stream.renderers["web-react"].status = "missing";
  delete m.arms.stream.renderers["web-react"].waiver;
  const errors = check(m, realArms());
  assert.ok(
    errors.some((e) => /stream\.web-react/.test(e) && /FULL-PARITY/.test(e)),
    `expected a full-parity violation, got: ${errors.join(" | ")}`,
  );
});

test("an unverified full-parity cell requires a waiver", () => {
  const m = realManifest();
  m.arms.stream.renderers.swiftui = {
    status: "unverified",
    reason: "The external preview implementation was not verified here.",
  };
  const errors = check(m, realArms());
  assert.ok(errors.some((error) => /stream\.swiftui/.test(error) && /FULL-PARITY/.test(error)));
});

test("a specialized shape may have gaps without a waiver", () => {
  // terminal/grammar/media document degradation ladders instead of parity, so
  // the gate must not demand waivers there — otherwise it cries wolf and gets
  // switched off. Terminal's web-react fallback is now rendered, while the
  // specialized shape remains valid for the remaining degradation statuses.
  const m = realManifest();
  assert.equal(m.arms.terminal.parity, "specialized");
  assert.equal(m.arms.terminal.renderers["web-react"].status, "renders");
  assert.match(m.arms.terminal.renderers["web-react"].reason, /fallback/);
  assert.deepEqual(check(m, realArms()), []);
});

test("unknown statuses and renderers fail", () => {
  const m = realManifest();
  m.arms.table.renderers["web-react"] = { status: "probably-fine" };
  m.arms.stat.renderers["holo-deck"] = { status: "renders" };
  const errors = check(m, realArms());
  assert.ok(errors.some((e) => /probably-fine/.test(e)));
  assert.ok(errors.some((e) => /holo-deck/.test(e)));
});

test("a renderer missing from an arm fails", () => {
  const m = realManifest();
  delete m.arms.table.renderers.tui;
  const errors = check(m, realArms());
  assert.ok(errors.some((e) => /table/.test(e) && /no entry for renderer "tui"/.test(e)));
});

test("a parse that finds too little throws rather than passing by omission", () => {
  // A short parse would make the gate pass for arms it never saw — the one
  // failure mode a drift gate must not have.
  assert.throws(
    () => parseBodyArms("message PanelDescriptor {\n  oneof body {\n    TablePanel table = 3;\n  }\n}"),
    /parsed only 1 arms/,
  );
  assert.throws(() => parseBodyArms("message X {}"), /PanelDescriptor/);
  assert.throws(() => parseBodyArms("message PanelDescriptor {\n  oneof body {\n    TablePanel table = 3;\n  }"), /brace never closes/);
});

test("commented-out arms are not counted", () => {
  // panel.proto's oneof carries prose about future shapes; a line comment must
  // not read as a declaration.
  const arms = parseBodyArms(`
    message PanelDescriptor {
      oneof body {
        TablePanel table = 3;
        LroPanel lro = 4;
        // GridPanel grid = 5;  — future, promoted via the corpus ratchet
        FormPanel form = 9;
        ChoicePanel choice = 10;
        StatPanel stat = 18;
      }
    }
  `);
  assert.deepEqual(arms.map((a) => a.name), ["table", "lro", "form", "choice", "stat"]);
});

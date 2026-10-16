import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PANEL_EVIDENCE_OWNERS, checkPanelEvidenceOwners, requiredPanelProofTargets, runPanelProofs } from "./panel_evidence.mjs";
import { checkSnapshotFiles } from "./check_conformance_snapshots.mjs";

function manifest() {
  return JSON.parse(readFileSync(new URL("../conformance/coverage.json", import.meta.url), "utf8"));
}

test("committed render claims have explicit evidence owners and seven unique proof targets", () => {
  assert.deepEqual(checkPanelEvidenceOwners(manifest()), []);
  const targets = requiredPanelProofTargets(manifest());
  assert.equal(targets.length, 7);
  assert.deepEqual(targets, [...new Set(Object.values(PANEL_EVIDENCE_OWNERS).flat())].sort());
});

test("SwiftUI promotion fails the real snapshot gate without a verifier", () => {
  const coverage = manifest();
  coverage.arms.choice.renderers.swiftui = { status: "renders" };
  assert.match(checkSnapshotFiles(coverage).join("\n"), /choice.swiftui: renders requires a registered panel evidence owner/);
  assert.throws(() => requiredPanelProofTargets(coverage), /choice.swiftui/);
});

test("a new renderer cannot borrow existing renderers' goldens", () => {
  const coverage = manifest();
  coverage.arms.choice.renderers["new-kit"] = { status: "renders" };
  assert.match(checkSnapshotFiles(coverage).join("\n"), /choice.new-kit: renders requires/);
});

test("unverified external renderers do not acquire fictitious proof targets", () => {
  assert.deepEqual(requiredPanelProofTargets({ arms: { choice: { renderers: {
    swiftui: { status: "unverified", reason: "External verifier not integrated" },
  } } } }), []);
});

test("proof targets follow the claiming renderer and are deduplicated", () => {
  const coverage = { arms: { choice: { renderers: {
    "html-kit": { status: "renders" }, "shadcn-kit": { status: "renders" },
  } } } };
  assert.deepEqual(requiredPanelProofTargets(coverage), [...PANEL_EVIDENCE_OWNERS["html-kit"]].sort());
  assert.ok(Object.isFrozen(PANEL_EVIDENCE_OWNERS));
  assert.ok(Object.values(PANEL_EVIDENCE_OWNERS).every(Object.isFrozen));
});

test("verification explicitly executes all owners read-only and propagates a failed proof", () => {
  let calls = 0;
  runPanelProofs(manifest(), (command, args, options) => {
    calls++;
    assert.equal(command, "bazel");
    assert.deepEqual(args, ["test", ...requiredPanelProofTargets(manifest()), "--test_output=errors", "--announce_rc=false"]);
    assert.equal(options.env.CI, "true");
    assert.equal(options.stdio, "inherit");
    assert.match(options.cwd, /\/$/);
  });
  assert.equal(calls, 1);
  const failure = new Error("golden mismatch");
  assert.throws(() => runPanelProofs(manifest(), () => { throw failure; }), error => error === failure);
  assert.throws(() => runPanelProofs({ arms: {} }, () => assert.fail("must not execute empty proof")), /no panel render proof targets/);
  const unsupported = manifest();
  unsupported.arms.choice.renderers.swiftui = { status: "renders" };
  assert.throws(() => runPanelProofs(unsupported, () => assert.fail("must reject before executing")), /choice.swiftui/);
});

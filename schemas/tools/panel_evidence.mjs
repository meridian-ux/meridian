// Explicit owners of PanelDescriptor render proofs. Registration does not prove
// a renderer works: CI must execute these targets, and the presence gate must
// independently require their committed goldens. External renderers remain
// unverified until both their evidence and a verifier are integrated.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const accessibility = "//packages/mui-kit:computed_accessibility_test";
export const PANEL_EVIDENCE_OWNERS = Object.freeze(Object.fromEntries(Object.entries({
  "html-kit": ["//packages/web-react:conformance", accessibility],
  "shadcn-kit": ["//packages/web-react:conformance", accessibility],
  "web-react": ["//packages/web-react:conformance", accessibility],
  "mui-kit": ["//packages/mui-kit:stateful_conformance", accessibility],
  "web-components": ["//packages/web/tests:conformance", "//packages/web/tests:conformance_wasm", accessibility],
  tui: ["//crates/tui/rust/tui:stateful_conformance_test", "//crates/tui/rust/tui:render_descriptor_test"],
}).map(([renderer, targets]) => [renderer, Object.freeze(targets)])));

export function checkPanelEvidenceOwners(coverage) {
  const errors = [];
  for (const [arm, entry] of Object.entries(coverage.arms)) {
    for (const [renderer, cell] of Object.entries(entry.renderers ?? {})) {
      if (cell.status === "renders" && !Object.hasOwn(PANEL_EVIDENCE_OWNERS, renderer)) {
        errors.push(`${arm}.${renderer}: renders requires a registered panel evidence owner and committed goldens`);
      }
    }
  }
  return errors;
}

export function requiredPanelProofTargets(coverage) {
  const errors = checkPanelEvidenceOwners(coverage);
  if (errors.length) throw new Error(errors.join("\n"));
  const renderers = new Set(Object.values(coverage.arms).flatMap(entry =>
    Object.entries(entry.renderers ?? {}).filter(([, cell]) => cell.status === "renders").map(([renderer]) => renderer)));
  return [...new Set([...renderers].flatMap(renderer => PANEL_EVIDENCE_OWNERS[renderer]))].sort();
}

export function runPanelProofs(coverage, run = execFileSync) {
  const targets = requiredPanelProofTargets(coverage);
  if (!targets.length) throw new Error("no panel render proof targets selected");
  run("bazel", ["test", ...targets, "--test_output=errors", "--announce_rc=false"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--required-targets", "--verify"].includes(args[0])) {
    console.error("usage: node schemas/tools/panel_evidence.mjs --required-targets|--verify");
    process.exitCode = 1;
  } else {
    const coverage = JSON.parse(readFileSync(new URL("../conformance/coverage.json", import.meta.url), "utf8"));
    const targets = requiredPanelProofTargets(coverage);
    if (!targets.length) throw new Error("no panel render proof targets selected");
    if (args[0] === "--required-targets") console.log(targets.join("\n"));
    else runPanelProofs(coverage);
  }
}

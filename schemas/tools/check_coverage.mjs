#!/usr/bin/env node
/**
 * Renderer-coverage gate: conformance/coverage.json vs proto/panel.proto.
 *
 * WHY THIS EXISTS. `PanelDescriptor.body` is a 23-arm oneof and no renderer
 * implements all of it — which is fine and deliberate, because panel.proto
 * designs for degradation. What is NOT fine is that the coverage was, until
 * now, only knowable by reading six dispatch sites in four repositories and
 * three languages. That means:
 *
 *   • a new arm can be added to the proto and simply never reach a renderer,
 *     with nothing anywhere reporting the hole;
 *   • an arm the proto declares FULL-PARITY ("every modality realizes them at
 *     full fidelity") can be unrenderable in practice; and
 *   • a renderer advertised by the catalog can be omitted from the matrix,
 *     leaving every panel arm's status unknown.
 *
 * So coverage becomes a declared artifact that drifts loudly. This gate asserts
 * the manifest, proto, and renderer catalog agree, that every gap is explained,
 * and that a full-parity gap or unverified cell is explicitly waived.
 *
 * Deliberately parses the .proto TEXT rather than a FileDescriptorSet. The
 * canonical descriptor set is produced by Bazel, and ci.yml's gates job is
 * node/python only on purpose — no Bazel, no registry auth. Both inputs are
 * source files in this repository, so a text parse is comparing two things we
 * own. The parse is strict and fails loudly rather than degrading.
 *
 * Run:  node tools/check_coverage.mjs [--matrix]
 *       --matrix  print the coverage matrix and exit 0 (documentation mode)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkSnapshotFiles } from "./check_conformance_snapshots.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(ROOT, "..");

/** Statuses that are gaps or have not been verified for full parity. */
const GAP_STATUSES = new Set(["missing", "structural-gap", "unverified"]);
/** Statuses that need an explanation. Everything except the happy one. */
const NEEDS_REASON = (s) => s !== "renders";

/**
 * Extract the `body` oneof's arm names from panel.proto.
 *
 * Strict by construction: if the block cannot be found, or the brace never
 * closes, or it yields an implausible number of arms, this throws rather than
 * returning a partial set — a silently-short list would make the gate pass by
 * omission, which is the one failure mode a drift gate must not have.
 */
export function parseScopedOneofArms(protoText, scope) {
  const withoutComments = protoText.replace(/\/\/[^\n]*/g, "");
  const parts = scope.split(".");
  if (parts.length < 2 || parts.some((part) => !/^[A-Za-z_][\w]*$/.test(part))) {
    throw new Error(`invalid oneof scope "${scope}"`);
  }

  let context = withoutComments;
  for (const messageName of parts.slice(0, -1)) {
    const messagePattern = new RegExp(`\\bmessage\\s+${messageName}\\s*\\{`);
    const message = messagePattern.exec(context);
    if (!message) throw new Error(`${scope}: no message "${messageName}" block found`);
    const open = context.indexOf("{", message.index);
    let depth = 0;
    let close = -1;
    for (let i = open; i < context.length; i++) {
      if (context[i] === "{") depth++;
      else if (context[i] === "}") {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) throw new Error(`${scope}: message "${messageName}" brace never closes`);
    context = context.slice(open + 1, close);
  }

  const oneofName = parts.at(-1);
  const oneofPattern = new RegExp(`\\boneof\\s+${oneofName}\\s*\\{`);
  const match = oneofPattern.exec(context);
  if (!match) throw new Error(`${scope}: no oneof "${oneofName}" block found`);

  const open = context.indexOf("{", match.index);

  let depth = 0;
  let end = -1;
  for (let i = open; i < context.length; i++) {
    if (context[i] === "{") depth++;
    else if (context[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`${scope}: oneof brace never closes`);

  const body = context.slice(open + 1, end);
  const arms = [];
  const re = /^\s*([A-Za-z_][\w.]*)\s+([a-z_][a-z0-9_]*)\s*=\s*(\d+)\s*;/gm;
  let m;
  while ((m = re.exec(body)) !== null) arms.push({ type: m[1], name: m[2], number: Number(m[3]) });

  if (arms.length === 0) {
    throw new Error(`${scope}: parsed no arms from oneof`);
  }
  return arms;
}

/** Extract the PanelDescriptor.body arms with a plausibility floor. */
export function parseBodyArms(protoText) {
  const arms = parseScopedOneofArms(protoText, "PanelDescriptor.body");
  if (arms.length < 5) {
    throw new Error(
      `panel.proto: parsed only ${arms.length} arms from \`oneof body\` — the parse is ` +
      `wrong, not the proto. Fix the parser rather than the manifest.`,
    );
  }
  return arms;
}

/** Validate declared non-panel modality coverage against its proto and catalog. */
export function checkModalities(manifest, catalog, { repoRoot = REPO_ROOT } = {}) {
  const errors = [];
  const declared = manifest.modalities ?? {};
  const catalogModalities = catalog.modalities ?? {};
  const catalogRenderers = Array.isArray(catalog.renderers) ? catalog.renderers : [];

  for (const [modality, contract] of Object.entries(catalogModalities)) {
    if (modality === "panel" || !contract.coverage) continue;
    if (!Object.hasOwn(declared, modality)) {
      errors.push(`catalog modality "${modality}" declares coverage but coverage.json has no modality row`);
    }
  }

  for (const [modality, section] of Object.entries(declared)) {
    const contract = catalogModalities[modality];
    if (!contract) {
      errors.push(`coverage modality "${modality}" is not in renderer_catalog.json`);
      continue;
    }
    if (!contract.coverage) {
      errors.push(`coverage modality "${modality}" has no coverage path in renderer_catalog.json`);
    }
    if (!contract.schema || !contract.oneof || !section.oneof) {
      errors.push(`modality "${modality}" needs schema and oneof declarations in renderer_catalog.json and coverage.json`);
      continue;
    }
    if (contract.oneof !== section.oneof) {
      errors.push(`modality "${modality}": oneof scope differs between renderer_catalog.json and coverage.json`);
      continue;
    }

    let protoArms;
    try {
      protoArms = parseScopedOneofArms(readFileSync(join(repoRoot, contract.schema), "utf8"), section.oneof);
    } catch (error) {
      errors.push(`modality "${modality}": ${error.message}`);
      continue;
    }
    const protoNames = new Set(protoArms.map((arm) => arm.name));
    const manifestArms = section.arms ?? {};
    const rendererIds = catalogRenderers.filter((entry) => entry.modality === modality).map((entry) => entry.id);
    if (rendererIds.length === 0) errors.push(`modality "${modality}" has no renderer entries in renderer_catalog.json`);

    for (const name of protoNames) {
      if (!Object.hasOwn(manifestArms, name)) errors.push(`${modality}.${name}: proto arm has no declared coverage`);
    }
    for (const [name, arm] of Object.entries(manifestArms)) {
      if (!protoNames.has(name)) errors.push(`${modality}.${name}: coverage arm is not declared by ${section.oneof}`);
      const cells = arm.renderers ?? {};
      for (const renderer of rendererIds) {
        if (!Object.hasOwn(cells, renderer)) {
          errors.push(`${modality}.${name}: no entry for renderer "${renderer}"`);
          continue;
        }
        const { status, reason } = cells[renderer];
        if (!Object.hasOwn(manifest.statuses ?? {}, status)) {
          errors.push(`${modality}.${name}.${renderer}: unknown status "${status}"`);
        } else if (NEEDS_REASON(status) && !reason) {
          errors.push(`${modality}.${name}.${renderer}: status "${status}" needs a reason`);
        }
      }
      for (const renderer of Object.keys(cells)) {
        if (!rendererIds.includes(renderer)) errors.push(`${modality}.${name}: unknown renderer "${renderer}"`);
      }
    }
  }
  return errors;
}

/** Require a coverage row for every panel renderer advertised by the catalog. */
export function checkPanelRendererCoverage(manifest, catalog) {
  const errors = [];
  const catalogIds = new Set(
    (catalog.renderers ?? []).filter((entry) => entry.modality === "panel").map((entry) => entry.id),
  );
  const coverageIds = new Set(Object.keys(manifest.renderers ?? {}));

  for (const id of catalogIds) {
    if (!coverageIds.has(id)) errors.push(`catalog panel renderer "${id}" has no coverage row`);
  }
  for (const id of coverageIds) {
    if (!catalogIds.has(id)) errors.push(`coverage renderer "${id}" is not a panel renderer in renderer_catalog.json`);
  }
  return errors;
}

function renderMatrix(manifest, arms) {
  const renderers = Object.keys(manifest.renderers);
  const glyph = {
    renders: "  ●  ", placeholder: "  ○  ", "separate-entrypoint": " sep ", unverified: "  ?  ",
    missing: "  —  ", "structural-gap": "  ✗  ", "not-applicable": " n/a ",
  };
  const w = Math.max(...arms.map((a) => a.name.length)) + 1;
  const head = " ".repeat(w) + renderers.map((r) => r.slice(0, 5).padStart(5)).join(" ");
  const lines = [head];
  for (const arm of arms) {
    const cells = manifest.arms[arm.name].renderers;
    lines.push(arm.name.padEnd(w) + renderers.map((r) => glyph[cells[r].status]).join(" "));
  }
  const totals = renderers.map((r) => {
    const n = arms.filter((a) => manifest.arms[a.name].renderers[r].status === "renders").length;
    return String(n).padStart(5);
  });
  lines.push(" ".repeat(w) + totals.join(" ") + `   of ${arms.length}`);
  return lines.join("\n");
}

export function check(manifest, arms) {
  const errors = [];
  const renderers = Object.keys(manifest.renderers);
  const validStatuses = new Set(Object.keys(manifest.statuses));
  const validParity = new Set(Object.keys(manifest.parity));

  const protoNames = new Set(arms.map((a) => a.name));
  const manifestNames = new Set(Object.keys(manifest.arms));

  for (const n of protoNames) {
    if (!manifestNames.has(n)) {
      errors.push(
        `proto/panel.proto declares \`${n}\` but conformance/coverage.json does not. ` +
        `A new panel shape must declare where it renders — add it, marking each ` +
        `renderer honestly (\`missing\` with a reason is a fine answer).`,
      );
    }
  }
  for (const n of manifestNames) {
    if (!protoNames.has(n)) {
      errors.push(`conformance/coverage.json declares \`${n}\`, which is not in panel.proto's body oneof.`);
    }
  }

  for (const [name, arm] of Object.entries(manifest.arms)) {
    if (!validParity.has(arm.parity)) {
      errors.push(`${name}: unknown parity "${arm.parity}"`);
    }
    const cells = arm.renderers ?? {};
    for (const r of renderers) {
      if (!(r in cells)) { errors.push(`${name}: no entry for renderer "${r}"`); continue; }
      const { status, reason, waiver } = cells[r];
      if (!validStatuses.has(status)) {
        errors.push(`${name}.${r}: unknown status "${status}"`);
        continue;
      }
      if (NEEDS_REASON(status) && !reason) {
        errors.push(`${name}.${r}: status "${status}" needs a reason.`);
      }
      // The finding this gate exists to hold: panel.proto promises full-parity
      // shapes render everywhere. Where they do not, that must be an explicit,
      // attributable waiver — never a silence.
      if (arm.parity === "full" && GAP_STATUSES.has(status) && !waiver) {
        errors.push(
          `${name}.${r}: ${name} is declared FULL-PARITY by panel.proto ("every modality ` +
          `realizes them at full fidelity") but is "${status}" here with no waiver. ` +
          `Implement or verify it, or add a waiver saying who owes that proof.`,
        );
      }
    }
    for (const r of Object.keys(cells)) {
      if (!renderers.includes(r)) errors.push(`${name}: unknown renderer "${r}"`);
    }
  }
  return errors;
}

function main() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "conformance/coverage.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(ROOT, "conformance/renderer_catalog.json"), "utf8"));
  const arms = parseBodyArms(readFileSync(join(ROOT, "proto/panel.proto"), "utf8"));

  if (process.argv.includes("--matrix")) {
    console.log(renderMatrix(manifest, arms));
    console.log("\nLegend: ● renders · ○ placeholder · sep separate entrypoint · ? unverified · — missing · ✗ structural gap · n/a not applicable");
    return;
  }

  const errors = [
    ...check(manifest, arms),
    ...checkPanelRendererCoverage(manifest, catalog),
    ...checkModalities(manifest, catalog),
    ...checkSnapshotFiles(manifest),
  ];
  if (errors.length === 0) {
    const waived = Object.entries(manifest.arms).flatMap(([n, a]) =>
      Object.entries(a.renderers).filter(([, c]) => c.waiver).map(([r]) => `${n}.${r}`));
    console.log(
      `coverage OK — ${arms.length} arms × ${Object.keys(manifest.renderers).length} renderers` +
      (waived.length ? `, ${waived.length} waived full-parity cells: ${waived.join(", ")}` : ""),
    );
    return;
  }
  console.error(`coverage drift (${errors.length}):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

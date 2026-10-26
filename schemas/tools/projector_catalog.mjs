// Refresh the public structure catalog from an immutable, tested producer export.
// This is an authoring/build tool, never a legacy runtime adapter.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromJson } from "@bufbuild/protobuf";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";

const OUTPUT = fileURLToPath(new URL("../../packages/mui-kit/harness/proto-viewdescriptors.json", import.meta.url));
export const SOURCE_PATH = "crates/projector/testdata/golden/render-bundle.json";
export const PUBLIC_DOMAIN = "meridian.example.com";
const RESOURCE_TYPES = new Set(["Layout", "Resource", "Service", "Target"]);
const PREFIX = "targets/own/layouts/";

function publicResourceNames(value, key = "") {
  if (Array.isArray(value)) return value.map(item => publicResourceNames(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([name, item]) => [name, publicResourceNames(item, name)]));
  if (typeof value === "string" && ["subjectKind", "targetKind"].includes(key) && value) {
    const match = /^meridian\.[a-z0-9.-]+\/([A-Za-z]+)$/.exec(value);
    assert(match && RESOURCE_TYPES.has(match[1]), "unreviewed resource type/domain in producer catalog");
    return `${PUBLIC_DOMAIN}/${match[1]}`;
  }
  return value;
}

export function validateCatalog(bundle) {
  assert(bundle && Array.isArray(bundle.entries) && bundle.entries.length > 0, "catalog entries required");
  const decoded = new Map();
  for (const entry of bundle.entries) {
    assert(typeof entry.name === "string" && entry.name && !decoded.has(entry.name), "unique nonempty entry names required");
    for (const field of ["label", "group", "kind"]) assert(typeof entry[field] === "string", `missing entry ${field}`);
    // Deliberately no ignoreUnknownFields: every removed field is a hard failure.
    decoded.set(entry.name, fromJson(ViewDescriptorSchema, entry.view));
  }
  function checkIntent(action, navigationOnly) {
    if (navigationOnly) assert.equal(action.invoke.case, "openView", "row/header controls must open served request views, never mutate directly");
    if (action.invoke.case !== "openView") return;
    assert(action.invoke.value.startsWith(PREFIX), "catalog navigation must retain the actual producer layout name");
    const target = decoded.get(action.invoke.value.slice(PREFIX.length));
    assert(target, `unserved catalog destination ${action.invoke.value}`);
    const form = target.slots.map(slot => slot.panel?.body).find(body => body?.case === "form")?.value;
    assert(form && form.mode === 2 && form.submitAffordance?.invoke.case === "rpc", "navigation destination must be a real editable request form");
    assert(form.submitAffordance.invoke.value.service && form.submitAffordance.invoke.value.method, "request forms require a concrete service and method");
    assert(form.fields.length > 0, "request form must expose explicit request inputs");
  }
  for (const view of decoded.values()) {
    for (const action of view.affordances?.items ?? []) checkIntent(action, true);
    for (const slot of view.slots) {
      for (const action of slot.affordances?.items ?? []) checkIntent(action, true);
      const body = slot.panel?.body;
      if (body?.case === "table") for (const action of body.value.affordances?.items ?? []) checkIntent(action, true);
      if (body?.case === "form" && body.value.mode === 2) {
        assert.equal(body.value.submitAffordance?.invoke.case, "rpc", "editable forms require explicit canonical submit RPCs");
        assert(body.value.submitAffordance.invoke.value.service && body.value.submitAffordance.invoke.value.method, "form RPC target must be concrete");
      }
    }
  }
  return bundle;
}

export function buildCatalog(source, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/, "producer provenance requires a full immutable commit");
  const bundle = publicResourceNames(source);
  validateCatalog(bundle);
  return { ...bundle, generatedFrom: `meridian-proto: ${SOURCE_PATH} at meridian-ux/meridian-internal@${revision}; resource type domains normalized to ${PUBLIC_DOMAIN}` };
}

export function refresh(source, revision, write = false) {
  assert.match(revision, /^[a-f0-9]{40}$/, "use a full immutable producer revision");
  const bytes = execFileSync("git", ["show", `${revision}:${SOURCE_PATH}`], { cwd: resolve(source), maxBuffer: 1024 * 1024 });
  const result = JSON.stringify(buildCatalog(JSON.parse(bytes), revision), null, 2) + "\n";
  if (write) writeFileSync(OUTPUT, result);
  else assert.equal(readFileSync(OUTPUT, "utf8"), result, "projector catalog drift; regenerate from the reviewed producer revision");
  console.log(`Projector catalog ${write ? "written" : "verified"}: ${JSON.parse(result).entries.length} strict canonical views`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 4 || args.length === 5 && args[4] === "--write",
    "usage: projector_catalog.mjs --source <producer-checkout> --revision <40-character-commit> [--write]");
  assert(args[0] === "--source" && args[2] === "--revision", "explicit source and immutable revision required");
  refresh(args[1], args[3], args[4] === "--write");
}

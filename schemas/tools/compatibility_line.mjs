// Release-line preparation, not a production cutover selector. The repository's
// default FILE policy is unchanged; an explicit candidate check cannot activate it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fromBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { descriptorFiles } from "./proto_facades.mjs";
import { loadRemovalReference, survivingImportReference, verifyRemoval } from "./affordance_removal.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REFERENCES = Object.freeze({
  "maintained-0x": join(root, "schemas/compat/pre-v1.binpb"),
  "v1-candidate": join(root, "schemas/compat/v1-affordance-candidate.binpb"),
  "v1-removal-candidate": join(root, "schemas/compat/v1-removal-candidate.binpb"),
});
export const loadImage = path => fromBinary(FileDescriptorSetSchema, readFileSync(path));
export const REMOVAL_CANDIDATE_SHA256 = "022c995b582690be2aea4f9c63126cfc93652a168c38d1f3e54c337aa824d55c";

export function verifyRemovalCandidateReference(bytes) {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), REMOVAL_CANDIDATE_SHA256,
    "removal candidate reference changed; exact review required");
  const reference = fromBinary(FileDescriptorSetSchema, bytes);
  verifyRemoval(loadRemovalReference(), reference);
  return reference;
}

function owners(image) {
  const result = new Map();
  const add = (name, file) => { assert(!result.has(name), `duplicate declaration: ${name}`); result.set(name, file); };
  const message = (item, scope, file) => {
    const name = `${scope}.${item.name}`;
    add(name, file);
    for (const nested of item.nestedType) message(nested, name, file);
    for (const enumeration of item.enumType) add(`${name}.${enumeration.name}`, file);
  };
  for (const file of descriptorFiles([image]).values()) {
    for (const item of file.messageType) message(item, file.package, file.name);
    for (const item of [...file.enumType, ...file.service]) add(`${file.package}.${item.name}`, file.name);
  }
  return result;
}

export function ownershipChanges(before, after) {
  const previous = owners(before), current = owners(after), changes = [];
  for (const [name, oldFile] of previous) {
    assert(current.has(name), `declaration removed during transition: ${name}`);
    if (oldFile !== current.get(name)) changes.push(`${name}: ${oldFile} -> ${current.get(name)}`);
  }
  return changes.sort();
}

export function verifyOwnership(previous, prepared, candidate) {
  const expected = ownershipChanges(previous, prepared), actual = ownershipChanges(previous, candidate);
  assert(expected.length, "prepared transition must declare an ownership change");
  assert.deepEqual(actual, expected, "ownership changes differ from the frozen candidate; explicit review required");
  return expected;
}

function fileCheck(image, baseline) {
  const result = spawnSync(join(root, "node_modules/.bin/buf"), ["breaking", resolve(image), "--against", baseline,
    "--config", join(root, "buf.yaml")], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert(!result.error && result.signal === null && Number.isInteger(result.status), `FILE check did not complete: ${result.error?.message ?? result.signal}`);
  return { status: result.status, report: result.stdout + result.stderr };
}

export function requireCompatibilityRejection(checked) {
  // A crash/tool failure may retain partial output from an earlier FILE finding.
  // That output must not turn an operational failure into migration evidence.
  assert.equal(checked.status, 100,
    `expected FILE compatibility rejection (exit 100), got ${checked.status}:\n${checked.report}`);
  assert.match(checked.report, /previously present|deleted/i,
    `expected ownership rejection was not observed:\n${checked.report}`);
}

export function checkLine(line, image) {
  assert(Object.hasOwn(REFERENCES, line), `unknown release line: ${line}`);
  const candidate = loadImage(image);
  if (line === "maintained-0x") {
    const checked = fileCheck(image, REFERENCES[line]);
    assert.equal(checked.status, 0, `maintained-0x FILE rejected this image:\n${checked.report}`);
    return { line, ownership: [], legacy: checked, selected: checked };
  }
  if (line === "v1-removal-candidate") {
    // An opt-in initial-cutover rehearsal, not the future production v1 policy.
    // Freeze the audited removal image, and reject even compatible unrelated
    // additions here: they need their own review before this exact cutover.
    verifyRemovalCandidateReference(readFileSync(REFERENCES[line]));
    verifyRemoval(loadRemovalReference(), candidate);
    const ownership = ownershipChanges(survivingImportReference(), candidate);
    const legacy = fileCheck(image, REFERENCES["maintained-0x"]);
    requireCompatibilityRejection(legacy);
    const additive = fileCheck(image, join(root, "schemas/compat/v1-additive-pre-removal.binpb"));
    requireCompatibilityRejection(additive);
    const selected = fileCheck(image, REFERENCES[line]);
    assert.equal(selected.status, 0, `${line} FILE rejected this image:\n${selected.report}`);
    return { line, ownership, legacy, additive, selected };
  }
  const ownership = verifyOwnership(loadImage(REFERENCES["maintained-0x"]), loadImage(REFERENCES[line]), candidate);
  // Retain and surface the old FILE failure. A candidate-line success is not
  // a claim that relocation passed the maintained 0.x policy.
  const legacy = fileCheck(image, REFERENCES["maintained-0x"]);
  requireCompatibilityRejection(legacy);
  const selected = fileCheck(image, REFERENCES[line]);
  assert.equal(selected.status, 0, `v1-candidate FILE rejected this image:\n${selected.report}`);
  return { line, ownership, legacy, selected };
}

function main(args) {
  assert(args.length === 4 && args[0] === "--line" && args[2] === "--image",
    "usage: compatibility_line.mjs --line maintained-0x|v1-candidate|v1-removal-candidate --image descriptor.binpb");
  const result = checkLine(args[1], args[3]);
  if (result.line !== "maintained-0x") {
    process.stdout.write(`Maintained 0.x FILE: REJECTED (exit ${result.legacy.status}); full report follows\n${result.legacy.report}\n`);
    if (result.additive) process.stdout.write(`Pre-removal additive FILE: REJECTED (exit ${result.additive.status}); full report follows\n${result.additive.report}\n`);
    process.stdout.write(`Frozen transition ownership (${result.ownership.length} declarations):\n${result.ownership.join("\n")}\n`);
  }
  console.log(`${result.line} FILE: passed against its explicit frozen baseline`);
  if (result.line !== "maintained-0x") console.log("PREPARATION ONLY: no production baseline activation, cutover, release, or publication approval");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

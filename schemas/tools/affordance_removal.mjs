// Exact draft major-boundary validation. This is not a FILE-policy selector,
// migration executor, or permission to activate/publish the candidate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { clone, fromBinary, isFieldSet, toBinary } from "@bufbuild/protobuf";
import { FieldDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

export const RETIRED_FIELDS = Object.freeze({
  Affordance: Object.freeze({ style: 7 }),
  Command: Object.freeze({ rpc: 8, open_panel: 9, open_view_id: 10, navigate: 11 }),
  FormPanel: Object.freeze({ submit: 3 }),
  TablePanel: Object.freeze({ actions: 6 }),
  ViewDescriptor: Object.freeze({ actions: 8 }),
  Slot: Object.freeze({ actions: 7 }),
});
export const RETIRED_MESSAGES = Object.freeze(["Action", "RowAction", "OpenPanel"]);
export const RETIRED_ENUMS = Object.freeze(["AffordanceStyle"]);
export const REFERENCE_SHA256 = "6dfcee54b85b39b59c4b1bb17d241a02eccfa37441d5c742db480b87c1e0a968";
export function loadRemovalReference() {
  const bytes = readFileSync(new URL("../compat/v1-additive-pre-removal.binpb", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), REFERENCE_SHA256,
    "pre-removal reference changed; exact review required");
  return fromBinary(FileDescriptorSetSchema, bytes);
}

export function expectedRemoval(reference) {
  const result = clone(FileDescriptorSetSchema, reference);
  const interaction = result.file.find(file => file.name === "proto/interaction.proto");
  assert(interaction, "complete additive reference required");
  for (const [name, retired] of Object.entries(RETIRED_FIELDS)) {
    const message = interaction.messageType.find(message => message.name === name);
    assert(message, `missing source declaration: ${name}`);
    for (const [fieldName, number] of Object.entries(retired)) {
      const field = message.field.find(field => field.name === fieldName);
      assert(field && field.number === number && field.options?.deprecated === true,
        `retired source differs: ${name}.${fieldName}`);
      message.reservedRange.push({ $typeName: "google.protobuf.DescriptorProto.ReservedRange", start: number, end: number + 1 });
      message.reservedName.push(fieldName);
    }
    message.field = message.field.filter(field => !Object.hasOwn(retired, field.name));
    if (name === "Command") {
      assert.deepEqual(message.oneofDecl.map(oneof => oneof.name), ["action"]);
      assert(message.field.every(field => !isFieldSet(field, FieldDescriptorProtoSchema.field.oneofIndex)), "unexpected surviving command oneof");
      message.oneofDecl = [];
    }
  }
  for (const name of RETIRED_MESSAGES) {
    assert(interaction.messageType.some(message => message.name === name && message.options?.deprecated));
  }
  for (const name of RETIRED_ENUMS) {
    assert(interaction.enumType.some(enumeration => enumeration.name === name && enumeration.options?.deprecated));
  }
  interaction.messageType = interaction.messageType.filter(message => !RETIRED_MESSAGES.includes(message.name));
  interaction.enumType = interaction.enumType.filter(enumeration => !RETIRED_ENUMS.includes(enumeration.name));
  return result;
}

function canonicalBytes(image) {
  const copy = clone(FileDescriptorSetSchema, image);
  copy.file.sort((a, b) => a.name.localeCompare(b.name, "en"));
  assert.equal(new Set(copy.file.map(file => file.name)).size, copy.file.length, "duplicate descriptor file");
  assert(copy.file.every(file => file.sourceCodeInfo === undefined), "source-info-free full-module image required");
  return toBinary(FileDescriptorSetSchema, copy);
}

export function verifyRemoval(reference, candidate) {
  // Whole-image equality retains every other declaration, option/extension,
  // import, service, field, oneof, enum, and conformance dependency. No ignores.
  assert.deepEqual(canonicalBytes(candidate), canonicalBytes(expectedRemoval(reference)),
    "candidate differs from the exact reviewed removal and reservations");
  return { fields: 9, messages: 3, enums: 1 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 4 && process.argv[2] === "--check",
    "usage: affordance_removal.mjs --check full-module.binpb");
  const candidate = fromBinary(FileDescriptorSetSchema, readFileSync(process.argv[3]));
  verifyRemoval(loadRemovalReference(), candidate);
  console.log("Exact draft removal verified: 9 fields reserved, 3 messages and 1 enum retired. No cutover approval.");
}

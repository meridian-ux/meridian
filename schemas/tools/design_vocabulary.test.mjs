import assert from "node:assert/strict";
import test from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { buildInventory, conceptsFromMarkdown, inventoryDescriptors, renderVocabulary, spliceVocabulary } from "./design_vocabulary.mjs";

function descriptor() {
  const value = create(FileDescriptorSetSchema, { file: [{
    name: "proto/example.proto", package: "example.v1", syntax: "proto3",
    enumType: [{ name: "State", value: [{ name: "IDLE", number: 0 }, { name: "WORKING", number: 7 }] }],
    messageType: [{ name: "Outer", oneofDecl: [{ name: "body" }, { name: "_title" }], field: [
      { name: "id", number: 1, type: 9 }, // absent oneof_index is NOT index zero
      { name: "text", number: 2, type: 9, oneofIndex: 0 },
      { name: "title", number: 3, type: 9, oneofIndex: 1, proto3Optional: true },
    ], nestedType: [{ name: "Inner", enumType: [{ name: "State", value: [{ name: "OK", number: 0 }] }] }] }],
  }, { name: "google/protobuf/foreign.proto", package: "google.protobuf", enumType: [{ name: "Foreign", value: [{ name: "ZERO", number: 0 }] }] }] });
  // Exercise actual explicit presence after a wire round-trip, not just JS keys.
  return fromBinary(FileDescriptorSetSchema, toBinary(FileDescriptorSetSchema, value));
}
const inventory = () => inventoryDescriptors(descriptor(), ["proto/example.proto"]);
const authored = `### Profile: values
Values across modalities.
<!-- concepts:start -->
| Scope | Concept | Roles | Profile |
|---|---|---|---|
| \`example.v1.State\` | State | Foreground with readable state | \`values\` |
| \`example.v1.Outer.body\` | Content | Foreground | \`values\` |
| \`example.v1.Outer.Inner.State\` | Nested state | Foreground | \`values\` |
<!-- concepts:end -->
<!-- vocabulary:start -->
old
<!-- vocabulary:end -->
`;

test("compiled explicit scopes include nested enums but not imports or synthetic presence", () => {
  const entries = inventory();
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.find(entry => entry.scope === "example.v1.Outer.body").members, ["text=2"]);
  assert.deepEqual(entries.find(entry => entry.scope === "example.v1.State").members, ["IDLE=0", "WORKING=7"]);
  assert(entries.some(entry => entry.scope === "example.v1.Outer.Inner.State"));
});

test("missing source files, duplicate scopes, and empty explicit declarations fail closed", () => {
  assert.throws(() => inventoryDescriptors(descriptor(), ["proto/absent.proto"]), /missing/i);
  const duplicate = descriptor(); duplicate.file[0].enumType.push(duplicate.file[0].enumType[0]);
  assert.throws(() => inventoryDescriptors(duplicate, ["proto/example.proto"]), /Duplicate vocabulary/);
  const empty = descriptor(); empty.file[0].messageType[0].oneofDecl.push({ name: "empty" });
  assert.throws(() => inventoryDescriptors(empty, ["proto/example.proto"]), /Empty vocabulary/);
});

test("concepts require unique scopes, real profiles, and non-placeholder interpretation", () => {
  assert.equal(conceptsFromMarkdown(authored).size, 3);
  assert.throws(() => conceptsFromMarkdown(authored.replace("| State |", "| TBD |")), /Incomplete/);
  assert.throws(() => conceptsFromMarkdown(authored.replace("### Profile: values", "### Missing: values")), /Missing modality/);
  assert.throws(() => conceptsFromMarkdown(authored.replace("example.v1.Outer.body", "example.v1.State")), /Duplicate concept/);
  assert.throws(() => conceptsFromMarkdown(authored.replace("<!-- concepts:end -->", "")), /exactly one/);
  assert.throws(() => conceptsFromMarkdown(authored + authored), /exactly one/);
  assert.throws(() => conceptsFromMarkdown(authored + "<!-- concepts:start -->"), /exactly one/);
});

test("new declarations and removed declarations both invalidate mappings", () => {
  const concepts = conceptsFromMarkdown(authored), entries = inventory();
  assert.throws(() => renderVocabulary(entries.slice(1), concepts), /Stale concept/);
  assert.throws(() => renderVocabulary([...entries, { scope: "example.v1.New", kind: "enum", file: "proto/example.proto", members: ["ZERO=0"] }], concepts), /Undocumented enum/);
});

test("generated rows track member additions and wire-number changes", () => {
  const entries = inventory(), concepts = conceptsFromMarkdown(authored);
  const before = renderVocabulary(entries, concepts);
  entries.find(entry => entry.scope === "example.v1.State").members.push("DONE=9");
  const after = renderVocabulary(entries, concepts);
  assert.notEqual(after, before); assert.match(after, /`DONE=9`/);
  assert.match(after, /\]\(proto\/example.proto\)/);
  entries.find(entry => entry.scope === "example.v1.State").members[1] = "WORKING=8";
  assert.notEqual(renderVocabulary(entries, concepts), after);
});

test("splicing is idempotent, preserves authored prose, and rejects malformed markers", () => {
  const block = renderVocabulary(inventory(), conceptsFromMarkdown(authored));
  const doc = spliceVocabulary(authored, block);
  assert.equal(spliceVocabulary(doc, block), doc);
  assert(doc.startsWith(authored.split("<!-- vocabulary:start -->")[0]));
  assert.throws(() => spliceVocabulary(authored.replace("<!-- vocabulary:end -->", ""), block), /exactly one/);
  assert.throws(() => spliceVocabulary(authored + authored, block), /exactly one/);
  assert.throws(() => spliceVocabulary(authored + "<!-- vocabulary:start -->", block), /exactly one/);
});

test("real compiler inventory uses only actual oneof arms and excludes optional-presence choices", () => {
  const entries = buildInventory();
  const panel = entries.find(entry => entry.scope === "meridian.ui.v1.PanelDescriptor.body");
  assert(panel.members.includes("table=3"));
  assert(!panel.members.includes("panel_id=1"));
  assert(!entries.some(entry => /\._(?:title|previous|fraction_digits)$/.test(entry.scope)));
  assert(entries.some(entry => entry.scope === "meridian.ui.v1.Block.ToolBlock.State"));
});

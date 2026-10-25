import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clone, create, createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema, MessageOptionsSchema } from "@bufbuild/protobuf/wkt";
import { expectedRemoval, loadRemovalReference, RETIRED_FIELDS, RETIRED_MESSAGES, RETIRED_ENUMS, survivingImportReference, verifyRemoval } from "./affordance_removal.mjs";
import { applyFacades, descriptorFiles, modulePath } from "./proto_facades.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = mkdtempSync(join(tmpdir(), "meridian-removal-contract-"));
const built = spawnSync(join(root, "node_modules/.bin/buf"), ["build", "schemas", "--as-file-descriptor-set", "--exclude-source-info", "-o", join(scratch, "actual.binpb")], { cwd: root, encoding: "utf8" });
assert.equal(built.status, 0, built.stderr);
const actual = fromBinary(FileDescriptorSetSchema, readFileSync(join(scratch, "actual.binpb")));
const previous = loadRemovalReference();
const file = image => image.file.find(file => file.name === "proto/interaction.proto");
const message = (image, name) => file(image).messageType.find(message => message.name === name);

test("surviving import reference is derived exactly and is not a production FILE reference", () => {
  const bytes = readFileSync(join(root, "schemas/compat/v1-surviving-imports.binpb"));
  assert.deepEqual(bytes, Buffer.from(toBinary(FileDescriptorSetSchema, survivingImportReference())));
  const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, bytes));
  for (const name of RETIRED_MESSAGES) assert.equal(registry.getMessage(`meridian.ui.v1.${name}`), undefined);
  assert.equal(registry.getEnum("meridian.ui.v1.AffordanceStyle"), undefined);
  assert.equal(registry.getMessage("meridian.ui.v1.Affordance").file.proto.name, "proto/affordance.proto");
  assert(!readFileSync(join(root, "schemas/tools/compatibility_line.mjs"), "utf8").includes("v1-surviving-imports.binpb"));
});

for (const mode of ["ts", "js+dts"]) test(`actual pinned ${mode} generation forwards surviving exports without retired API shims`, () => {
  const output = join(scratch, mode.replace("+", "-"));
  function generate(image, directory) {
    const generated = spawnSync(join(root, "node_modules/.bin/buf"), ["generate", image, "--template", JSON.stringify({
      version: "v2", plugins: [{ local: join(root, "node_modules/.bin/protoc-gen-es"), out: directory,
        opt: [`target=${mode}`, "import_extension=js"] }],
    })], { cwd: root, encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
  }
  generate(join(scratch, "actual.binpb"), output);
  const baselinePath = join(root, "schemas/compat/v1-surviving-imports.binpb");
  const current = descriptorFiles([actual]);
  const extension = mode === "ts" ? ".ts" : ".d.ts";
  const sources = [...current.keys()].filter(name => existsSync(join(output, modulePath(name) + extension)));
  const plan = applyFacades({ baseline: descriptorFiles([survivingImportReference()]), current, sources,
    input: output, output, mode, generateBaseline: () => {
      const directory = join(scratch, `old-${mode}`);
      generate(baselinePath, directory);
      return directory;
    } });
  assert.equal(plan.size, 9);
  for (const name of plan.keys()) {
    const source = readFileSync(join(output, modulePath(name) + extension), "utf8");
    assert.match(source, /meridian compatibility exports:start/);
    assert(!/\b(?:ActionSchema|RowActionSchema|OpenPanelSchema|AffordanceStyleSchema)\b/.test(source));
    assert(!/export type \{[^}]*\b(?:Action|RowAction|OpenPanel)\b/.test(source));
  }
  assert.match(readFileSync(join(output, "proto/view_pb" + extension), "utf8"), /ViewDescriptorSchema/);
});

test("real source compiles to exactly nine reserved fields, three retired messages, and one enum", () => {
  assert.deepEqual(verifyRemoval(previous, actual), { fields: 9, messages: 3, enums: 1 });
  const registry = createFileRegistry(actual);
  for (const name of RETIRED_MESSAGES) assert.equal(registry.getMessage(`meridian.ui.v1.${name}`), undefined);
  for (const name of RETIRED_ENUMS) assert.equal(registry.getEnum(`meridian.ui.v1.${name}`), undefined);
  for (const [name, fields] of Object.entries(RETIRED_FIELDS)) for (const [field, number] of Object.entries(fields)) {
    const value = message(actual, name);
    assert(!value.field.some(value => value.name === field || value.number === number));
    assert(value.reservedName.includes(field));
    assert(value.reservedRange.some(range => range.start <= number && number < range.end));
  }
  assert.equal(message(actual, "Command").oneofDecl.length, 0);
  for (const name of ["ActionPanel", "ActionPlacement", "RowFilter", "Navigate", "RpcCall", "AffordanceCollection", "ValueTone"]) {
    assert(registry.getMessage(`meridian.ui.v1.${name}`) || registry.getEnum(`meridian.ui.v1.${name}`), `${name} must remain`);
  }
});

for (const [name, fields] of Object.entries(RETIRED_FIELDS)) for (const [fieldName, tag] of Object.entries(fields)) {
  test(`rejects missing name or tag reservation for ${name}.${fieldName}`, () => {
    for (const kind of ["name", "tag"]) {
      const bad = clone(FileDescriptorSetSchema, actual), value = message(bad, name);
      if (kind === "name") value.reservedName = value.reservedName.filter(name => name !== fieldName);
      else value.reservedRange = value.reservedRange.filter(range => range.start !== tag);
      assert.throws(() => verifyRemoval(previous, bad));
    }
  });
}

for (const [label, mutate] of [
  ["reintroduced message", image => file(image).messageType.push(clone(FileDescriptorSetSchema, previous).file.find(file => file.name === "proto/interaction.proto").messageType.find(message => message.name === "Action"))],
  ["reintroduced enum", image => file(image).enumType.push(clone(FileDescriptorSetSchema, previous).file.find(file => file.name === "proto/interaction.proto").enumType.find(value => value.name === "AffordanceStyle"))],
  ["canonical tag change", image => { message(image, "Command").field.find(field => field.name === "affordance").number = 99; }],
  ["unrelated field removal", image => { message(image, "Command").field = message(image, "Command").field.filter(field => field.name !== "keywords"); }],
  ["unrelated option change", image => { message(image, "Affordance").options = create(MessageOptionsSchema, { deprecated: true }); }],
  ["missing dependency", image => { image.file = image.file.filter(file => file.name !== "proto/value.proto"); }],
  ["duplicate file", image => { image.file.push(image.file[0]); }],
  ["unreviewed ownership move", image => { file(image).name = "proto/unreviewed.proto"; }],
]) test(`exact whole-module guard rejects ${label}`, () => {
  const bad = clone(FileDescriptorSetSchema, actual);
  mutate(bad);
  assert.throws(() => verifyRemoval(previous, bad));
});

test("unchanged additive image is not mislabeled as removal completion", () => {
  assert.throws(() => verifyRemoval(previous, previous));
  verifyRemoval(previous, expectedRemoval(previous));
});

test("old binary fields do not acquire a canonical intent in the removal reader", () => {
  const old = createFileRegistry(previous), current = createFileRegistry(actual);
  for (const [name, source] of [
    ["Command", { id: "old", rpc: { service: "fixture.Service", method: "Delete" } }],
    ["FormPanel", { submit: { service: "fixture.Service", method: "Delete" } }],
    ["ViewDescriptor", { actions: [{ id: "delete", label: "Delete" }] }],
    ["TablePanel", { actions: [{ label: "Delete", rpc: { service: "fixture.Service", method: "Delete" } }] }],
  ]) {
    const before = old.getMessage(`meridian.ui.v1.${name}`), after = current.getMessage(`meridian.ui.v1.${name}`);
    const decoded = fromBinary(after, toBinary(before, fromJson(before, source)));
    assert.equal(decoded.affordance, undefined);
    assert.equal(decoded.affordances, undefined);
    assert.equal(decoded.submitAffordance, undefined);
    assert.throws(() => fromJson(after, source), "strict JSON must not silently accept retired fields");
  }
});

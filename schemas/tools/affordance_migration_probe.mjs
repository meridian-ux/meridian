#!/usr/bin/env node
// Proposal-only experiment. Nothing is generated into production source/package
// directories, and expected FILE rejection is evidence, not a gate exception.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { clearField, clone, createFileRegistry, fromBinary, fromJson, isFieldSet, toBinary, toJson } from "@bufbuild/protobuf";
import { DescriptorProtoSchema, FieldDescriptorProtoSchema, FieldOptionsSchema, MessageOptionsSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { checkLine, loadImage, REFERENCES } from "./compatibility_line.mjs";
import { mergeDescriptorSets } from "./merge_descriptor_sets.mjs";
import { loadRemovalReference } from "./affordance_removal.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUF = join(ROOT, "node_modules/.bin/buf");
const PLUGIN = join(ROOT, "node_modules/.bin/protoc-gen-es");
const TSC = join(ROOT, "node_modules/typescript/bin/tsc");
const UNIT = "proto/interaction.proto";
export function verifyLegacyConsumerSource(source) {
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "dcf330625611979f8679b180fd87b352ab0df22adf924847f49cd4d9df652e82",
    "frozen legacy TypeScript source changed; explicit compatibility review required");
}
export const PROPOSED_COMPONENT = Object.freeze([
  "proto/affordance.proto", "proto/catalog.proto", "proto/command_palette.proto",
  "proto/connect_flow.proto", "proto/lro.proto", "proto/panel.proto", "proto/steps.proto",
  "proto/table.proto", "proto/view.proto",
]);

// Proposal allocations only. These runtime records generate canonical .proto
// declarations in scratch copies; production descriptors are never rewritten.
export const POLICY_ADDITIONS = Object.freeze({
  Affordance: [
    ["placement", 15, "optional ActionPlacement placement = 15;", ".meridian.ui.v1.ActionPlacement", true],
    ["enabled_when", 16, "RowFilter enabled_when = 16;", ".meridian.ui.v1.RowFilter", false],
    ["refresh_on_success", 17, "optional bool refresh_on_success = 17;", "", true],
  ],
  Command: [["affordance", 12, "Affordance affordance = 12;", ".meridian.ui.v1.Affordance", false]],
  ViewDescriptor: [["affordances", 10, "AffordanceCollection affordances = 10;", ".meridian.ui.v1.AffordanceCollection", false]],
  Slot: [["affordances", 13, "AffordanceCollection affordances = 13;", ".meridian.ui.v1.AffordanceCollection", false]],
  TablePanel: [["affordances", 8, "AffordanceCollection affordances = 8;", ".meridian.ui.v1.AffordanceCollection", false]],
  FormPanel: [["submit_affordance", 6, "Affordance submit_affordance = 6;", ".meridian.ui.v1.Affordance", false]],
});

// The retained 0.x compatibility fields, not permission to alter other options.
export const LEGACY_DEPRECATIONS = Object.freeze({
  Affordance: ["style"],
  Command: ["rpc", "open_panel", "open_view_id", "navigate"],
  FormPanel: ["submit"], TablePanel: ["actions"],
  ViewDescriptor: ["actions"], Slot: ["actions"],
});
export const LEGACY_MESSAGE_DEPRECATIONS = Object.freeze(["Action", "RowAction", "OpenPanel"]);

function withoutApprovedDeprecations(fullName, previous, current) {
  if (fullName !== `meridian.ui.v1.${previous.name}` || previous.$typeName !== "google.protobuf.DescriptorProto"
    || !(Object.hasOwn(LEGACY_DEPRECATIONS, previous.name) || LEGACY_MESSAGE_DEPRECATIONS.includes(previous.name))) return current;
  const copy = clone(DescriptorProtoSchema, current);
  if (LEGACY_MESSAGE_DEPRECATIONS.includes(previous.name) && copy.options?.deprecated === true && previous.options?.deprecated !== true) {
    const deprecated = MessageOptionsSchema.fields.find(option => option.name === "deprecated");
    if (!previous.options || !isFieldSet(previous.options, deprecated)) clearField(copy.options, deprecated);
    else copy.options.deprecated = previous.options.deprecated;
    if (previous.options === undefined && toBinary(MessageOptionsSchema, copy.options).length === 0) delete copy.options;
  }
  for (const name of LEGACY_DEPRECATIONS[previous.name] ?? []) {
    const old = previous.field.find(field => field.name === name);
    const field = copy.field.find(field => field.name === name);
    if (!old || field?.options?.deprecated !== true || old.options?.deprecated === true) continue;
    // Reset only the approved bit. Preserve every other option/unknown extension
    // so unrelated changes still fail the exact declaration comparison below.
    const deprecated = FieldOptionsSchema.fields.find(option => option.name === "deprecated");
    if (!old.options || !isFieldSet(old.options, deprecated)) clearField(field.options, deprecated);
    else field.options.deprecated = old.options.deprecated;
    if (old.options === undefined && toBinary(FieldOptionsSchema, field.options).length === 0) delete field.options;
  }
  return copy;
}

export function assertAvailableFields(message, fields) {
  const names = new Set([...message.field.map(field => field.name), ...message.reservedName]);
  const numbers = new Set(message.field.map(field => field.number));
  for (const [name, number] of fields) {
    assert(!names.has(name), `candidate name is occupied: ${message.name}.${name}`);
    assert(Number.isInteger(number) && number > 0 && number < 2 ** 29 && !(number >= 19000 && number <= 19999), "invalid candidate tag");
    assert(!numbers.has(number) && !message.reservedRange.some(range => number >= range.start && number < range.end),
      `candidate tag is occupied: ${message.name}.${number}`);
    names.add(name); numbers.add(number);
  }
}

export function componentContaining(graph, start) {
  // The SCC of start is the intersection of forward and reverse reachability.
  const reachable = (edges, root) => {
    const seen = new Set(), queue = [root];
    while (queue.length) {
      const node = queue.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      queue.push(...(edges.get(node) ?? []));
    }
    return seen;
  };
  const reverse = new Map();
  for (const [node, deps] of graph)
    for (const dependency of deps) reverse.set(dependency, [...(reverse.get(dependency) ?? []), node]);
  const forward = reachable(graph, start), backward = reachable(reverse, start);
  return [...forward].filter(node => backward.has(node)).sort();
}

function run(command, args, { expectedFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (expectedFailure) assert.notEqual(result.status, 0, `unexpected success: ${command}`);
  else assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function build(directory, output) {
  run(BUF, ["build", directory, "--as-file-descriptor-set", "--exclude-source-info", "-o", output]);
  return fromBinary(FileDescriptorSetSchema, readFileSync(output));
}

function declarations(descriptor) {
  const entries = new Map();
  const visit = (message, prefix) => {
    const name = `${prefix}.${message.name}`;
    entries.set(name, message);
    for (const nested of message.nestedType) visit(nested, name);
    for (const enumeration of message.enumType) entries.set(`${name}.${enumeration.name}`, enumeration);
  };
  for (const file of descriptor.file) {
    for (const message of file.messageType) visit(message, file.package);
    for (const enumeration of file.enumType) entries.set(`${file.package}.${enumeration.name}`, enumeration);
  }
  return entries;
}

function exportNames(source) {
  return [...source.matchAll(/^export (?:declare )?(type|const|enum) (\w+)/gm)]
    .map(([, kind, name]) => ({ kind, name })).filter(({ name }) => !name.startsWith("file_"));
}

function generate(image, directory, mode) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');
  symlinkSync(join(ROOT, "schemas/node_modules"), join(directory, "node_modules"), "dir");
  run(BUF, ["generate", image, "--template", JSON.stringify({ version: "v2", plugins: [{
    local: PLUGIN, out: directory, opt: [`target=${mode}`, "import_extension=js"],
  }] })]);
}

export function assertCandidateDeclarations(before, after) {
  const oldDeclarations = declarations(before);
  const newDeclarations = declarations(after);
  for (const [name, original] of oldDeclarations) {
    const current = newDeclarations.get(name);
    assert(current, `declaration disappeared: ${name}`);
    const next = withoutApprovedDeprecations(name, original, current);
    const additions = POLICY_ADDITIONS[original.name];
    if (additions) {
      const copy = structuredClone(next);
      const oldNumbers = new Set(original.field.map(field => field.number));
      copy.field = copy.field.filter(field => oldNumbers.has(field.number));
      copy.oneofDecl = copy.oneofDecl.slice(0, original.oneofDecl.length);
      assert.deepEqual(toBinary(DescriptorProtoSchema, copy), toBinary(DescriptorProtoSchema, original));
      const policy = next.field.filter(field => additions.some(([, number]) => number === field.number));
      assert.deepEqual(policy.map(field => [field.name, field.number, field.typeName, field.proto3Optional]),
        additions.map(([name, number, , typeName, optional]) => [name, number, typeName, optional]));
      for (const field of policy) {
        assert.equal(field.label, 1, "canonical siblings/policy fields must be singular");
        assert.equal(field.type, field.typeName === ".meridian.ui.v1.ActionPlacement" ? 14 : field.typeName ? 11 : 8);
        if (field.proto3Optional) assert.equal(next.oneofDecl[field.oneofIndex].name, `_${field.name}`);
        else assert.equal(isFieldSet(field, FieldDescriptorProtoSchema.fields.find(field => field.name === "oneof_index")), false);
      }
      assert.equal(next.oneofDecl.length, original.oneofDecl.length + policy.filter(field => field.proto3Optional).length);
      const invoke = next.field.filter(field => !oldNumbers.has(field.number) && !policy.includes(field));
      assert.deepEqual(invoke.map(field => [field.name, field.number, field.oneofIndex]), name.endsWith(".Affordance")
        ? [["rpc", 10, 0], ["navigate", 11, 0], ["open_panel", 12, 0], ["open_view", 13, 0], ["copy", 14, 0]] : []);
      if (invoke.length) {
        assert.deepEqual(invoke.map(field => [field.type, field.typeName, field.label]), [
          [11, ".meridian.ui.v1.RpcCall", 1], [11, ".meridian.ui.v1.Navigate", 1],
          [11, ".meridian.ui.v1.PanelDescriptor", 1], [9, "", 1], [9, "", 1],
        ]);
        assert(invoke.every(field => isFieldSet(field, FieldDescriptorProtoSchema.fields.find(field => field.name === "oneof_index"))));
      }
    } else assert.deepEqual(next, original, name);
  }
  assert.equal(newDeclarations.size, oldDeclarations.size + 1);
  const collection = newDeclarations.get("meridian.ui.v1.AffordanceCollection");
  assert.deepEqual(collection.field.map(field => [field.name, field.number, field.typeName, field.label]),
    [["items", 1, ".meridian.ui.v1.Affordance", 3]]);
}

async function verifyGeneratedCandidate({ work, before, after, component, oldImage, nextImage }) {
  const oldDeclarations = declarations(before), newDeclarations = declarations(after);
  const registries = [before, after].map(descriptor => createFileRegistry(descriptor));
  const panelSchemas = registries.map(registry => registry.getMessage("meridian.ui.v1.PanelDescriptor"));
  const fixtureNames = readdirSync(join(ROOT, "schemas/conformance/binpb")).filter(name => name.endsWith(".binpb"));
  for (const name of fixtureNames) {
    const bytes = readFileSync(join(ROOT, "schemas/conformance/binpb", name));
    const values = panelSchemas.map(schema => fromBinary(schema, bytes));
    assert.deepEqual(toJson(panelSchemas[0], values[0]), toJson(panelSchemas[1], values[1]), name);
    assert.deepEqual(toBinary(panelSchemas[0], values[0]), toBinary(panelSchemas[1], values[1]), name);
  }
  const newPanel = fromJson(panelSchemas[1], { panelId: "recursive", action: { action: {
    label: "Open", openPanel: { panelId: "child", choice: { options: [{ id: "a", label: "A" }] } },
  } } });
  const bytes = toBinary(panelSchemas[1], newPanel);
  assert.deepEqual(toBinary(panelSchemas[0], fromBinary(panelSchemas[0], bytes)), bytes,
    "old binary readers must preserve unknown new invocation fields");
  const affordanceSchemas = registries.map(registry => registry.getMessage("meridian.ui.v1.Affordance"));
  const invocations = [
    { uri: "https://example.test" }, { command: "printf '$raw'\n" },
    { rpc: { service: "Demo", method: "Run", bindings: [{ requestField: "id", rowField: "raw.id" }] } },
    { navigate: { route: "/items/raw" } }, { openPanel: { panelId: "inline", snippet: { snippet: { content: "raw\n" } } } },
    { openView: "host-owned-view" }, { copy: "" },
  ];
  for (const invocation of invocations) {
    const value = fromJson(affordanceSchemas[1], { label: "Test", ...invocation });
    const wire = toBinary(affordanceSchemas[1], value);
    const oldReaderWire = toBinary(affordanceSchemas[0], fromBinary(affordanceSchemas[0], wire));
    assert.deepEqual(oldReaderWire, wire);
    const recovered = fromBinary(affordanceSchemas[1], oldReaderWire);
    assert.deepEqual(toJson(affordanceSchemas[1], recovered), { label: "Test", ...invocation });
  }

  // Optional scalar presence is part of the proposal, not inferred from truthiness.
  // Re-encoding through an old reader may reorder unknown wire fields; compare
  // the recovered typed message and its canonical encoding, not that field order.
  let policyCases = 0;
  for (const placement of [undefined, 0, 1, 999]) for (const refresh of [undefined, false, true]) {
    const policy = { enabledWhen: { fieldPath: "flags.enabled", equals: "false" }, tone: 0, emphasis: 0,
      ...(placement === undefined ? {} : { placement }), ...(refresh === undefined ? {} : { refreshOnSuccess: refresh }) };
    for (const invocation of invocations) {
      const value = fromJson(affordanceSchemas[1], { label: "Policy", ...policy, ...invocation });
      const wire = toBinary(affordanceSchemas[1], value);
      const recovered = fromBinary(affordanceSchemas[1], toBinary(affordanceSchemas[0], fromBinary(affordanceSchemas[0], wire)));
      assert.deepEqual(toJson(affordanceSchemas[1], recovered, { enumAsInteger: true }), { label: "Policy", ...policy, ...invocation });
      assert.deepEqual(toBinary(affordanceSchemas[1], recovered), wire);
      policyCases++;
    }
  }
  const legacyCall = { service: "Demo", method: "Run", bindings: [{ requestField: "id", rowField: "raw.id" }] };
  const envelopes = [
    ["ViewDescriptor", "affordances", { id: "view", actions: [{ id: "legacy", label: "Legacy", call: legacyCall }] }, true],
    ["Slot", "affordances", { id: "slot", actions: [{ id: "legacy", label: "Legacy", call: legacyCall }] }, true],
    ["TablePanel", "affordances", { actions: [{ label: "Legacy", rpc: legacyCall, enabledWhen: { fieldPath: "state", equals: "OPEN" }, refreshOnSuccess: true }] }, true],
    ["FormPanel", "submitAffordance", { submit: legacyCall, itemNoun: "record" }, false],
    ["Command", "affordance", { id: "cmd", title: "Search title", subtitle: "Search detail", keywords: ["one", "two"],
      icon: "search", shortcut: "$mod+k", deepLink: "/search?cmd=raw", rpc: legacyCall }, false],
  ];
  let envelopeCases = 0;
  for (const [name, key, legacy, repeated] of envelopes) {
    const schemas = registries.map(registry => registry.getMessage(`meridian.ui.v1.${name}`));
    const canonical = { label: "Canonical", copy: "", placement: 0, refreshOnSuccess: false };
    for (const entry of [undefined, {}, repeated ? { items: [] } : { ...canonical }, ...(repeated ? [{ items: [canonical] }] : [])]) {
      const json = { ...legacy, ...(entry === undefined ? {} : { [key]: entry }) };
      const value = fromJson(schemas[1], json), wire = toBinary(schemas[1], value);
      const recovered = fromBinary(schemas[1], toBinary(schemas[0], fromBinary(schemas[0], wire)));
      assert.deepEqual(toJson(schemas[1], recovered, { enumAsInteger: true }), toJson(schemas[1], value, { enumAsInteger: true }));
      assert.equal(recovered[key] !== undefined, entry !== undefined, `${name}: canonical presence lost`);
      // Legacy search/binding/predicate/refresh data remains independently intact.
      assert.deepEqual(toJson(schemas[0], fromBinary(schemas[0], wire)), toJson(schemas[0], fromJson(schemas[0], legacy)));
      // Old JSON readers discard unknown candidate fields; they are not facades.
      assert.deepEqual(toJson(schemas[0], fromJson(schemas[0], toJson(schemas[1], value), { ignoreUnknownFields: true })),
        toJson(schemas[0], fromJson(schemas[0], legacy)));
      envelopeCases++;
    }
  }

  let namedExports = 0, legacySourceCompilations = 0;
  for (const mode of ["js+dts", "ts"]) {
    const baseline = join(work, `before-${mode}`), generated = join(work, `after-${mode}`);
    generate(oldImage, baseline, mode);
    generate(nextImage, generated, mode);
    const productionOptions = JSON.parse(readFileSync(join(ROOT, "schemas/proto/tsconfig.es.json"), "utf8")).compilerOptions;
    const legacySource = readFileSync(join(ROOT, "schemas/migration/LegacyAffordanceConsumer.ts"), "utf8");
    verifyLegacyConsumerSource(legacySource);
    for (const directory of [baseline, generated]) {
      writeFileSync(join(directory, "legacy_consumer.ts"), legacySource);
      writeFileSync(join(directory, "tsconfig.legacy.json"), JSON.stringify({
        compilerOptions: { ...productionOptions, noEmit: true }, files: ["legacy_consumer.ts"],
      }));
    }
    run(process.execPath, [TSC, "-p", join(baseline, "tsconfig.legacy.json")]);
    legacySourceCompilations++;
    writeFileSync(join(generated, "tsconfig.json"), JSON.stringify({
      compilerOptions: { ...productionOptions, noEmit: true }, include: ["**/*.ts"], exclude: ["node_modules"],
    }));
    writeFileSync(join(generated, "consumer.ts"),
      'import { type Affordance, AffordanceSchema } from "./proto/affordance_pb.js";\n');
    const missingExports = run(process.execPath, [TSC, "-p", join(generated, "tsconfig.json")], { expectedFailure: true });
    assert.match(missingExports.stdout + missingExports.stderr, /TS2305.*Affordance/);
    // Exercise the same CLI/compiler-backed transform used by development
    // generation, not a probe-local copy of the facade algorithm.
    run(process.execPath, [join(ROOT, "schemas/tools/proto_facades.mjs"),
      "--baseline", oldImage, "--current-image", nextImage, "--input", generated,
      "--output", generated, "--mode", mode, "--buf", BUF, "--plugin", PLUGIN,
      ...[...component, UNIT].flatMap(name => ["--source", name])]);
    const suffix = mode === "ts" ? ".ts" : ".d.ts";
    const importChecks = [];
    for (const name of component) {
      const module = name.replace(/\.proto$/, "_pb");
      const exports = exportNames(readFileSync(join(baseline, module + suffix), "utf8"));
      assert(exports.length > 0, module);
      namedExports += exports.length;
      const values = exports.filter(entry => entry.kind !== "type").map(entry => entry.name);
      const index = importChecks.length;
      importChecks.push(`import { ${exports.map(entry => `${entry.kind === "type" ? "type " : ""}${entry.name} as Check${index}_${entry.name}`).join(", ")} } from "./${module}.js";`);
      if (mode === "js+dts") {
        const js = join(generated, module + ".js");
        const [previous, relocated] = await Promise.all([
          import(pathToFileURL(join(baseline, module + ".js")).href),
          import(pathToFileURL(js).href),
        ]);
        assert.deepEqual(Object.keys(relocated).sort(), Object.keys(previous).sort(), module);
        for (const name of values) {
          assert(relocated[name] !== undefined, name);
          if (name.endsWith("Schema")) assert.equal(relocated[name].typeName, previous[name].typeName, name);
        }
      }
    }
    // Match the existing generated-package compiler settings, including its
    // dependency-only skipLibCheck. Import/type errors in this consumer and
    // generated .ts facades are not skipped.
    writeFileSync(join(generated, "consumer.ts"), `import { type Affordance, AffordanceSchema } from "./proto/affordance_pb.js";
import { type PanelDescriptor, PanelDescriptorSchema } from "./proto/panel_pb.js";
import { type AffordanceCollection } from "./proto/interaction_pb.js";
declare const action: Affordance;
declare const panel: PanelDescriptor;
const label: string = action.label;
const id: string = panel.panelId;
const placement: number | undefined = action.placement;
const refresh: boolean | undefined = action.refreshOnSuccess;
declare const collection: AffordanceCollection;
const first: Affordance | undefined = collection.items[0];
// @ts-expect-error Reject any-eroded facade types.
const invalid: number = action.label;
// @ts-expect-error New optional policy fields must not erode to any either.
const invalidRefresh: string = action.refreshOnSuccess;
// @ts-expect-error The new collection retains canonical Affordance element typing.
const invalidItem: number = collection.items[0];
void [label, id, placement, refresh, first, AffordanceSchema, PanelDescriptorSchema, invalid, invalidRefresh, invalidItem];
${importChecks.join("\n")}
`);
    run(process.execPath, [TSC, "-p", join(generated, "tsconfig.json")]);
    run(process.execPath, [TSC, "-p", join(generated, "tsconfig.legacy.json")]);
    legacySourceCompilations++;
  }
  return { component, declarations: oldDeclarations.size, candidateDeclarations: newDeclarations.size, fixtures: fixtureNames.length,
    invocations: invocations.length, policyCases, envelopeCases, namedExports, legacySourceCompilations, work };
}

export async function probe() {
  const work = mkdtempSync(join(tmpdir(), "meridian-affordance-proposal-"));
  try {
    const old = join(work, "old"), candidate = join(work, "candidate");
    mkdirSync(old);
    cpSync(join(ROOT, "schemas/proto"), join(old, "proto"), { recursive: true });
    // Build only proto sources; Bazel/TS files copied alongside are not inputs.
    cpSync(join(ROOT, "third_party/googleapis/google"), join(old, "google"), { recursive: true });
    writeFileSync(join(old, "buf.yaml"), "version: v2\nbreaking:\n  use: [FILE]\n");
    cpSync(old, candidate, { recursive: true });
    const oldImage = join(work, "old.binpb"), nextImage = join(work, "candidate.binpb");
    const before = build(old, oldImage);
    const graph = new Map(before.file.map(file => [file.name, [...file.dependency]]));
    // Proposed typed targets, placement/predicate reuse, palette envelope and
    // table adoption. FormPanel already lives in panel.proto; form.proto does
    // not acquire an Affordance dependency just to adapt a submit RPC.
    const edges = {
      "proto/affordance.proto": ["proto/panel.proto", "proto/command_palette.proto", "proto/view.proto", "proto/table.proto"],
      "proto/command_palette.proto": ["proto/affordance.proto"],
      "proto/table.proto": ["proto/affordance.proto"],
    };
    for (const [name, dependencies] of Object.entries(edges))
      graph.set(name, [...new Set([...graph.get(name), ...dependencies])]);
    const component = componentContaining(graph, "proto/affordance.proto");
    assert.deepEqual(component, PROPOSED_COMPONENT, "migration boundary changed; review the proposal before updating it");
    const members = new Set(component);
    const files = new Map(before.file.map(file => [file.name, file]));
    const dependencies = [...new Set(component.flatMap(name => graph.get(name)).filter(name => !members.has(name)))].sort();
    const originalBodies = [];
    const bodies = component.map(name => {
      let source = readFileSync(join(old, name), "utf8");
      const first = source.search(/^(?:message|enum) \w+/m);
      assert(first >= 0, name);
      source = source.slice(first);
      originalBodies.push(source);
      if (name === "proto/affordance.proto") {
        source = source.replace(/(oneof invoke \{[\s\S]*?)(\n  \})/, `$1
    RpcCall rpc = 10;
    Navigate navigate = 11;
    PanelDescriptor open_panel = 12;
    string open_view = 13;
    string copy = 14;$2`);
      }
      for (const [message, fields] of Object.entries(POLICY_ADDITIONS)) {
        const pattern = new RegExp(`(^message ${message} \\{[\\s\\S]*?)(^\\})`, "m");
        if (pattern.test(source)) source = source.replace(pattern, `$1${fields.map(field => `  ${field[2]}\n`).join("")}$2`);
      }
      return source;
    });
    const header = 'syntax = "proto3";\npackage meridian.ui.v1;\n'
      + 'option java_multiple_files = true;\noption java_package = "meridian.ui.v1";\n'
      + 'option java_outer_classname = "InteractionProto";\n';
    const unitHeader = header + dependencies.map(name => `import "${name}";\n`).join("");
    for (const name of component) {
      const holder = files.get(name).options.javaOuterClassname;
      writeFileSync(join(candidate, name), header.replace("InteractionProto", holder) + `import public "${UNIT}";\n`);
    }
    writeFileSync(join(candidate, UNIT), unitHeader + originalBodies.join("\n"));
    const relocatedImage = join(work, "relocated.binpb");
    const relocated = build(candidate, relocatedImage);
    const oldDeclarations = declarations(before);
    for (const [message, fields] of Object.entries(POLICY_ADDITIONS)) {
      const additions = message === "Affordance" ? [["rpc", 10], ["navigate", 11], ["open_panel", 12], ["open_view", 13], ["copy", 14], ...fields] : fields;
      assertAvailableFields(oldDeclarations.get(`meridian.ui.v1.${message}`), additions);
    }
    assert.deepEqual(declarations(relocated), oldDeclarations, "pure relocation changed declaration contents");
    const relocationRejection = run(BUF, ["breaking", relocatedImage, "--against", oldImage, "--config", join(ROOT, "buf.yaml")],
      { expectedFailure: true });
    assert.match(relocationRejection.stdout + relocationRejection.stderr, /previously present|deleted/i);
    writeFileSync(join(candidate, UNIT), unitHeader + bodies.join("\n")
      + "\n// Presence distinguishes an absent collection from an explicit empty override.\nmessage AffordanceCollection { repeated Affordance items = 1; }\n");
    const after = build(candidate, nextImage);
    assertCandidateDeclarations(before, after);
    const rejection = run(BUF, ["breaking", nextImage, "--against", oldImage, "--config", join(ROOT, "buf.yaml")],
      { expectedFailure: true });
    assert.match(rejection.stdout + rejection.stderr, /previously present|deleted/i);
    run(BUF, ["breaking", oldImage, "--against", oldImage, "--config", join(ROOT, "buf.yaml")]);

    return await verifyGeneratedCandidate({ work, before, after, component, oldImage, nextImage });
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

// Explicit implementation phase: compare the real source image with the frozen
// old reader, rather than inventing a second hypothetical migration of facades.
export async function probeCanonical({ frozenAdditive = false } = {}) {
  const work = mkdtempSync(join(tmpdir(), "meridian-affordance-canonical-"));
  try {
    const oldImage = join(work, "old.binpb"), nextImage = join(work, "candidate.binpb");
    cpSync(REFERENCES["maintained-0x"], oldImage);
    const before = loadImage(oldImage);
    // The retained additive contract is historical evidence, not a claim that
    // today's removal source retains those APIs. Its loader verifies the digest.
    const after = frozenAdditive ? loadRemovalReference() : build(ROOT, nextImage);
    if (frozenAdditive) writeFileSync(nextImage, toBinary(FileDescriptorSetSchema, after));
    checkLine("maintained-0x", oldImage);
    assertCandidateDeclarations(before, after);
    const transition = checkLine("v1-candidate", nextImage);
    const original = declarations(before), relocated = clone(FileDescriptorSetSchema, after);
    for (const file of relocated.file) {
      file.messageType = file.messageType.filter(message => `${file.package}.${message.name}` !== "meridian.ui.v1.AffordanceCollection")
        .map(message => {
          const previous = original.get(`${file.package}.${message.name}`);
          assert(previous, `unexpected declaration: ${file.package}.${message.name}`);
          return clone(DescriptorProtoSchema, previous);
        });
    }
    const pureRelocation = mergeDescriptorSets([relocated]);
    assert.deepEqual(declarations(pureRelocation), original, "pure relocation changed declarations");
    const relocatedImage = join(work, "relocated.binpb");
    writeFileSync(relocatedImage, toBinary(FileDescriptorSetSchema, pureRelocation));
    const rejection = run(BUF, ["breaking", relocatedImage, "--against", oldImage,
      "--config", join(ROOT, "buf.yaml")], { expectedFailure: true });
    assert.equal(rejection.status, 100);
    assert.match(rejection.stdout + rejection.stderr, /previously present|deleted/i);
    const result = await verifyGeneratedCandidate({ work, before, after,
      component: PROPOSED_COMPONENT, oldImage, nextImage });
    return { ...result, phase: frozenAdditive ? "frozen-additive" : "canonical-candidate", ownershipChanges: transition.ownership,
      maintainedFileStatus: transition.legacy.status, candidateFileStatus: transition.selected.status };
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  assert(new Set(args).size === args.length && args.every(arg => ["--keep", "--canonical"].includes(arg)),
    "usage: affordance_migration_probe.mjs [--keep] [--canonical]");
  const result = await (args.includes("--canonical") ? probeCanonical() : probe());
  try {
    console.log(JSON.stringify({ ...result, work: args.includes("--keep") ? result.work : undefined,
      fileGate: "expected rejection; unchanged" }, null, 2));
  } finally { if (!args.includes("--keep")) rmSync(result.work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();

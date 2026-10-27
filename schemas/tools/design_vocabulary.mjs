#!/usr/bin/env node
// Compile source protos with the workspace-pinned Buf compiler, never infer
// vocabulary from a regex or a possibly stale committed descriptor snapshot.
import { isMain } from "./cli_entrypoint.mjs";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fromBinary, isFieldSet } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema, FieldDescriptorProtoSchema } from "@bufbuild/protobuf/wkt";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = join(ROOT, "schemas/DESIGN_LANGUAGE.md");
const GENERATED = /(?<=<!-- vocabulary:start -->\n)[\s\S]*?(?=<!-- vocabulary:end -->)/g;
const ONEOF_INDEX = FieldDescriptorProtoSchema.fields.find(field => field.localName === "oneofIndex");

export function inventoryDescriptors(descriptors, sourceNames) {
  const wanted = new Set(sourceNames), found = new Set(), entries = [];
  const addEnum = (item, scope, file) => entries.push({
    scope: `${scope}.${item.name}`, kind: "enum", file,
    members: item.value.map(value => `${value.name}=${value.number}`),
  });
  const message = (item, scope, file) => {
    const name = `${scope}.${item.name}`;
    for (const enumeration of item.enumType) addEnum(enumeration, name, file);
    for (const [index, oneof] of item.oneofDecl.entries()) {
      const fields = item.field.filter(field => isFieldSet(field, ONEOF_INDEX) && field.oneofIndex === index);
      // proto3 optional presence is represented by compiler-synthetic oneofs;
      // it is not a producer-selectable semantic choice.
      if (fields.length === 1 && fields[0].proto3Optional) continue;
      entries.push({ scope: `${name}.${oneof.name}`, kind: "oneof", file,
        members: fields.map(field => `${field.name}=${field.number}`) });
    }
    for (const nested of item.nestedType) message(nested, name, file);
  };
  for (const file of descriptors.file) {
    if (!wanted.has(file.name)) continue;
    if (found.has(file.name)) throw new Error(`Duplicate descriptor file: ${file.name}`);
    found.add(file.name);
    for (const enumeration of file.enumType) addEnum(enumeration, file.package, file.name);
    for (const item of file.messageType) message(item, file.package, file.name);
  }
  for (const file of wanted) if (!found.has(file)) throw new Error(`Source missing from compiled descriptors: ${file}`);
  const scopes = new Set();
  for (const entry of entries) {
    if (scopes.has(entry.scope)) throw new Error(`Duplicate vocabulary scope: ${entry.scope}`);
    if (!entry.members.length) throw new Error(`Empty vocabulary declaration: ${entry.scope}`);
    scopes.add(entry.scope);
  }
  return entries.sort((a, b) => a.scope.localeCompare(b.scope, "en"));
}

export function conceptsFromMarkdown(doc) {
  for (const marker of ["<!-- concepts:start -->", "<!-- concepts:end -->"])
    if (doc.split(marker).length !== 2) throw new Error("Expected exactly one authored concept table");
  const blocks = [...doc.matchAll(/<!-- concepts:start -->\n([\s\S]*?)<!-- concepts:end -->/g)];
  if (blocks.length !== 1) throw new Error("Expected exactly one authored concept table");
  const concepts = new Map();
  for (const line of blocks[0][1].split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 4) throw new Error(`Expected four concept columns: ${line}`);
    const scope = /^`([\w.]+)`$/.exec(cells[0])?.[1];
    const profile = /^`([\w-]+)`$/.exec(cells[3])?.[1];
    if (!scope || !profile || cells.slice(1, 3).some(cell => !cell || /\b(?:TODO|TBD)\b/i.test(cell)))
      throw new Error(`Incomplete concept mapping: ${line}`);
    if (concepts.has(scope)) throw new Error(`Duplicate concept mapping: ${scope}`);
    if (!doc.includes(`### Profile: ${profile}\n`)) throw new Error(`Missing modality profile: ${profile}`);
    concepts.set(scope, { concept: cells[1], roles: cells[2], profile });
  }
  if (!concepts.size) throw new Error("Concept table is empty");
  return concepts;
}

export function renderVocabulary(entries, concepts) {
  const scopes = new Set(entries.map(entry => entry.scope));
  for (const scope of concepts.keys()) if (!scopes.has(scope)) throw new Error(`Stale concept mapping: ${scope}`);
  const rows = entries.map(entry => {
    if (!concepts.has(entry.scope)) throw new Error(`Undocumented ${entry.kind}: ${entry.scope}`);
    return `| [\`${entry.scope}\`](${entry.file}) | ${entry.kind} | ${entry.members.map(member => `\`${member}\``).join(", ")} |`;
  });
  return [
    "Generated from the current compiled proto sources; numbers are wire identities, not display order.", "",
    "| Scope | Kind | Declared members |", "|---|---|---|", ...rows, "",
    `**${entries.filter(entry => entry.kind === "enum").length} enums and ${entries.filter(entry => entry.kind === "oneof").length} explicit oneofs; ${entries.length} named-concept mappings.**`, "",
  ].join("\n");
}

export function spliceVocabulary(doc, generated) {
  for (const marker of ["<!-- vocabulary:start -->", "<!-- vocabulary:end -->"])
    if (doc.split(marker).length !== 2) throw new Error("Expected exactly one generated vocabulary marker pair");
  if ([...doc.matchAll(GENERATED)].length !== 1) throw new Error("Expected exactly one generated vocabulary marker pair");
  return doc.replace(GENERATED, () => generated);
}

export function buildInventory() {
  const sourceNames = readdirSync(join(ROOT, "schemas/proto"), { recursive: true })
    .filter(name => name.endsWith(".proto")).map(name => `proto/${name.replaceAll("\\", "/")}`);
  if (!sourceNames.length) throw new Error("No proto sources found");
  const built = spawnSync(join(ROOT, "node_modules/.bin/buf"),
    ["build", "--as-file-descriptor-set", "--exclude-source-info", "--output", "-"],
    { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, timeout: 60_000 });
  if (built.error || built.status !== 0) throw new Error(`Buf build failed: ${built.error?.message || built.stderr.toString()}`);
  return inventoryDescriptors(fromBinary(FileDescriptorSetSchema, built.stdout), sourceNames);
}

function main(args) {
  if (args.length > 1 || (args.length === 1 && !["--check", "--write"].includes(args[0])))
    throw new Error("Usage: node schemas/tools/design_vocabulary.mjs [--check | --write]");
  const doc = readFileSync(DOC, "utf8");
  const block = renderVocabulary(buildInventory(), conceptsFromMarkdown(doc));
  const expected = spliceVocabulary(doc, block);
  if (args[0] === "--check") {
    if (doc !== expected) throw new Error("Design vocabulary is stale; run node schemas/tools/design_vocabulary.mjs --write");
    console.log("Design vocabulary: compiled declarations, concepts, and generated table agree");
  } else if (args[0] === "--write") {
    if (doc !== expected) writeFileSync(DOC, expected);
    console.log("Design vocabulary refreshed");
  } else process.stdout.write(block);
}
if (isMain(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

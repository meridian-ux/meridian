// Assemble Cargo's self-contained image from the actual Bazel proto dependency
// outputs. Never fill missing dependencies from a stale reference image.
import { isMain } from "./cli_entrypoint.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { descriptorFiles } from "./proto_facades.mjs";

export function mergeDescriptorSets(images) {
  const files = descriptorFiles(images);
  assert(files.size, "no descriptor files supplied");
  for (const file of files.values()) for (const dependency of file.dependency) {
    assert(files.has(dependency), `${file.name}: missing dependency ${dependency}`);
  }
  // protobuf-es consumes FileDescriptorSet in dependency-first order. Sorting
  // paths alone is deterministic but can put a facade before its declaration.
  const ordered = [], visited = new Set(), pending = new Set();
  const visit = name => {
    if (visited.has(name)) return;
    assert(!pending.has(name), `cyclic descriptor imports: ${name}`);
    pending.add(name);
    const file = files.get(name);
    for (const dependency of [...file.dependency].sort()) visit(dependency);
    pending.delete(name);
    visited.add(name);
    ordered.push(file);
  };
  for (const name of [...files.keys()].sort()) visit(name);
  return create(FileDescriptorSetSchema, { file: ordered });
}

function main(args) {
  assert(args.length >= 3 && args[0] === "--output", "usage: merge_descriptor_sets.mjs --output image.binpb input.binpb [...]");
  const image = mergeDescriptorSets(args.slice(2).map(path => fromBinary(FileDescriptorSetSchema, readFileSync(path))));
  writeFileSync(args[1], toBinary(FileDescriptorSetSchema, image));
  console.log(`Generated self-contained descriptor: ${image.file.length} files`);
}
if (isMain(import.meta.url)) main(process.argv.slice(2));

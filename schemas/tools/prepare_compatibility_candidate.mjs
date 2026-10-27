// Complete the probe's production-schema candidate with every unchanged file
// in the frozen full-module reference. In particular, do not drop conformance
// DTOs just because the narrower relocation experiment does not copy them.
import { isMain } from "./cli_entrypoint.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { descriptorFiles } from "./proto_facades.mjs";

export function completeCandidate(previous, candidate) {
  const files = descriptorFiles([previous]);
  for (const [name, file] of descriptorFiles([candidate])) files.set(name, file);
  return create(FileDescriptorSetSchema, { file: [...files.values()].sort((a, b) => a.name.localeCompare(b.name, "en")) });
}

function main(args) {
  assert(args.length === 6 && args[0] === "--baseline" && args[2] === "--candidate" && args[4] === "--output",
    "usage: prepare_compatibility_candidate.mjs --baseline previous.binpb --candidate probe.binpb --output prepared.binpb");
  const load = path => fromBinary(FileDescriptorSetSchema, readFileSync(path));
  writeFileSync(args[5], toBinary(FileDescriptorSetSchema, completeCandidate(load(args[1]), load(args[3]))));
}
if (isMain(import.meta.url)) main(process.argv.slice(2));

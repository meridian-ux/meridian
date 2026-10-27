// Test-only old bindings: removed runtime DTOs are never recreated in v1 code.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { createFileRegistry, fromBinary, fromJson, toBinary, type DescMessage, type JsonObject } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const bytes = readFileSync(new NodeURL("../compat/v1-additive-pre-removal.binpb", import.meta.url));
if (createHash("sha256").update(bytes).digest("hex") !== "6dfcee54b85b39b59c4b1bb17d241a02eccfa37441d5c742db480b87c1e0a968") {
  throw Error("Frozen additive reader changed; explicit review required.");
}
const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, bytes));

export function readFrozen<Desc extends DescMessage>(schema: Desc, json: JsonObject) {
  const previous = registry.getMessage(schema.typeName);
  if (!previous) throw Error("Unknown frozen declaration.");
  return fromBinary(schema, toBinary(previous, fromJson(previous, json)));
}

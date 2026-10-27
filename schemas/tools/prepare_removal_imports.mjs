import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { survivingImportReference } from "./affordance_removal.mjs";

assert(process.argv.length === 4 && process.argv[2] === "--output",
  "usage: prepare_removal_imports.mjs --output audit-import-reference.binpb");
writeFileSync(process.argv[3], toBinary(FileDescriptorSetSchema, survivingImportReference()));

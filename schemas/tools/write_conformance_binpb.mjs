// Materialize the canonical PanelDescriptor corpus as protobuf wire bytes.
//
// The TypeScript renderers consume the fixture messages directly; native
// renderers consume these exact serialized messages. Keeping generation here
// makes the cross-language boundary explicit and avoids a second Rust fixture
// vocabulary.

import { mkdir, rm, writeFile } from "node:fs/promises";

import { toBinary } from "@bufbuild/protobuf";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";

import { FIXTURES } from "../conformance/fixtures.ts";

const output = new URL("../conformance/binpb/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const fixture of FIXTURES) {
  const bytes = toBinary(PanelDescriptorSchema, fixture.descriptor);
  const filename = fixture.name
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/\s+/g, "_");
  await writeFile(new URL(`${filename}.binpb`, output), bytes);
}

console.log(`wrote ${FIXTURES.length} conformance descriptors to ${output.pathname}`);

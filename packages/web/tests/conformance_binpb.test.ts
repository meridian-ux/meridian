// The native TUI consumes the checked-in protobuf bytes under
// schemas/conformance/binpb/. Keep those artifacts mechanically tied to the
// canonical TypeScript fixture messages so a fixture edit cannot leave Rust
// rendering yesterday's descriptor.

import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { equals } from "@bufbuild/protobuf";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { describe, expect, it } from "vitest";

import { FIXTURES } from "../../../schemas/conformance/fixtures.js";

type NodeFs = { readFileSync(path: URL | string): Uint8Array };

function filename(name: string): string {
  return name
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/\s+/g, "_");
}

describe("canonical protobuf conformance artifacts", () => {
  it("match every TypeScript fixture byte-for-byte", async () => {
    const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as NodeFs;

    for (const fixture of FIXTURES) {
      const path = new URL(
        `../../../schemas/conformance/binpb/${filename(fixture.name)}.binpb`,
        import.meta.url,
      );
      const bytes = readFileSync(path);
      const decoded = fromBinary(PanelDescriptorSchema, bytes);

      expect(
        equals(PanelDescriptorSchema, decoded, fixture.descriptor),
        `${fixture.name} decoded bytes differ from the canonical fixture`,
      ).toBe(true);
      expect(
        Array.from(toBinary(PanelDescriptorSchema, fixture.descriptor)),
        `${fixture.name} was not serialized canonically`,
      ).toEqual(Array.from(bytes));
    }
  });
});

import { toBinary } from "@bufbuild/protobuf";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { expect, it } from "vitest";
import { readFrozen } from "../../../schemas/tests/frozen_affordance.js";
import legacyViewBytes from "../harness/legacy-view.bin.json";

it("keeps the browser's legacy trap byte-for-byte tied to the frozen additive schema", () => {
  const legacy = readFrozen(ViewDescriptorSchema, { actions: [{ id: "legacy-trap", label: "Legacy trap",
    call: { service: "fixture.Legacy", method: "Delete" } }] });
  expect([...toBinary(ViewDescriptorSchema, legacy)]).toEqual(legacyViewBytes);
});

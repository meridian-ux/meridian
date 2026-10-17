// Runtime test loader only. Every stored descriptor, context, response, and
// expectation index crosses the boundary as a canonical protobuf message.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "layout");
const struct = (name: string) => toJson(StructSchema, fromBinary(StructSchema, readFileSync(join(root, name))));
const index = struct("index.binpb") as unknown as { cases: Array<{ name: string; order: string[]; tabs: string[]; content: string[]; staticOrder: string[]; staticContent: string[]; gateOpen?: boolean }> };
export const LAYOUT_CASES = index.cases.map(fixture => ({
  ...fixture,
  view: fromBinary(ViewDescriptorSchema, readFileSync(join(root, `${fixture.name}.view.binpb`))),
  context: struct(`${fixture.name}.context.binpb`) as { selections?: Record<string, unknown> },
  responses: struct(`${fixture.name}.responses.binpb`) as Record<string, object>,
}));

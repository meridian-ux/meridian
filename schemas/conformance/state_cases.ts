// Node-side test loader. Both serialized boundaries are canonical protobufs;
// the test runner's scenario object exists only in memory.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const valueCases = JSON.parse(readFileSync(join(root, "../value_types.json"), "utf8")).cases as Array<{ name: string; expected: string }>;
export const STATE_CASES = readdirSync(root).sort().flatMap(arm =>
  readdirSync(join(root, arm)).filter(name => name.endsWith(".view.binpb")).sort().map(name => {
    const state = name.slice(0, -".view.binpb".length);
    const view = fromBinary(ViewDescriptorSchema, readFileSync(join(root, arm, name)));
    const responses = toJson(StructSchema, fromBinary(StructSchema,
      readFileSync(join(root, arm, `${state}.responses.binpb`)))) as Record<string, unknown>;
    return { name: `${arm}/${state}`, arm, state, view, responses,
      expectedValue: state.startsWith("value-") ? valueCases.find(c => `value-${c.name}` === state)?.expected : undefined };
  }));

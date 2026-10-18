import { toBinary } from "@bufbuild/protobuf";
import { RowFilterSchema, type RowFilter } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { coreValidation } from "./core_runtime.js";

/** Pure bounded comparison, never host admission or permission to execute. */
export function matchesRowFilter(filter: RowFilter, row: unknown): boolean {
  return coreValidation.matchesRowFilter(toBinary(RowFilterSchema, filter), row);
}

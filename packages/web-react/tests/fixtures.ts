// Compatibility entrypoint for the shared renderer-neutral conformance corpus.
// Keep imports in this package stable while other renderers consume the same
// protobuf fixtures directly from schemas/conformance.

export { FIXTURES } from "../../../schemas/conformance/fixtures.js";
export type { Fixture } from "../../../schemas/conformance/fixtures.js";

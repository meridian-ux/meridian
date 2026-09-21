import test from "node:test";
import assert from "node:assert/strict";
import { checkCorpus } from "./check_conformance_corpus.mjs";

const coverage = { arms: { table: {}, llm_prompt: {} } };

test("accepts exactly one fixture per arm plus empty", () => {
  assert.deepEqual(checkCorpus({ coverage, files: ["table.binpb", "llm_prompt.binpb", "empty.binpb"] }), { count: 3 });
});

test("rejects a missing fixture", () => {
  assert.throws(() => checkCorpus({ coverage, files: ["table.binpb", "empty.binpb"] }), /missing: llm_prompt\.binpb/);
});

test("rejects a stale extra fixture", () => {
  assert.throws(() => checkCorpus({ coverage, files: ["table.binpb", "llm_prompt.binpb", "empty.binpb", "stale.binpb"] }), /extra: stale\.binpb/);
});

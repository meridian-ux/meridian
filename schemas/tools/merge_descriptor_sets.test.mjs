import test from "node:test";
import assert from "node:assert/strict";
import { create, createFileRegistry, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { mergeDescriptorSets } from "./merge_descriptor_sets.mjs";

const image = file => create(FileDescriptorSetSchema, { file });
test("merges transitive dependency outputs without an independent file list", () => {
  const source = image([{ name: "proto/view.proto", dependency: ["google/struct.proto"] }]);
  const dependency = image([{ name: "google/struct.proto" }]);
  const actual = mergeDescriptorSets([source, dependency, dependency]);
  assert.deepEqual(actual.file.map(file => file.name), ["google/struct.proto", "proto/view.proto"]);
  assert.deepEqual(toBinary(FileDescriptorSetSchema, actual),
    toBinary(FileDescriptorSetSchema, mergeDescriptorSets([dependency, source])));
});
test("rejects missing dependencies rather than borrowing a frozen copy", () => {
  assert.throws(() => mergeDescriptorSets([image([{ name: "a.proto", dependency: ["missing.proto"] }])]), /missing dependency/);
});
test("dependencies precede importing facades regardless of lexical filename order", () => {
  const merged = mergeDescriptorSets([image([
    { name: "a.proto", dependency: ["z.proto"] }, { name: "z.proto" },
  ])]);
  assert.deepEqual(merged.file.map(file => file.name), ["z.proto", "a.proto"]);
  assert.doesNotThrow(() => createFileRegistry(merged));
});
test("rejects cyclic file imports", () => {
  assert.throws(() => mergeDescriptorSets([image([
    { name: "a.proto", dependency: ["b.proto"] }, { name: "b.proto", dependency: ["a.proto"] },
  ])]), /cyclic descriptor imports/);
});
test("rejects conflicting same-name descriptors", () => {
  assert.throws(() => mergeDescriptorSets([image([{ name: "a.proto", package: "a" }]),
    image([{ name: "a.proto", package: "b" }])]), /conflicting descriptor/);
});
test("rejects empty images and unsafe filenames", () => {
  assert.throws(() => mergeDescriptorSets([image([])]), /no descriptor files/);
  assert.throws(() => mergeDescriptorSets([image([{ name: "../a.proto" }])]), /unsafe proto path/);
});

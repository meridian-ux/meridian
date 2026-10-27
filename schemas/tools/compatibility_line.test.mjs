import test from "node:test";
import assert from "node:assert/strict";
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLine, loadImage, ownershipChanges, REFERENCES, requireCompatibilityRejection, verifyOwnership } from "./compatibility_line.mjs";
import { completeCandidate } from "./prepare_compatibility_candidate.mjs";

test("snapshot preparation retains every unchanged file omitted by the narrow probe", () => {
  const previous = create(FileDescriptorSetSchema, { file: [
    { name: "old.proto", package: "x", messageType: [{ name: "Original" }] },
    { name: "conformance/corpus.proto", package: "test", messageType: [{ name: "Corpus" }] },
  ] });
  const candidate = create(FileDescriptorSetSchema, { file: [
    { name: "old.proto", package: "x" }, { name: "new.proto", package: "x", messageType: [{ name: "Original" }] },
  ] });
  const full = completeCandidate(previous, candidate);
  assert(full.file.some(file => file.name === "conformance/corpus.proto" && file.messageType[0].name === "Corpus"));
  assert.equal(ownershipChanges(previous, full).length, 1);
});

test("the prepared v1 snapshot digest requires an explicit reviewed update", () => {
  assert.equal(createHash("sha256").update(readFileSync(REFERENCES["v1-candidate"])).digest("hex"),
    "9da6cc3c1d76be32633753bd220be64929dc412386facc61d843a370fcdee170");
});

test("ownership includes nested messages/enums and rejects missing declarations", () => {
  const before = create(FileDescriptorSetSchema, { file: [{ name: "old.proto", package: "x",
    messageType: [{ name: "Outer", nestedType: [{ name: "Inner" }], enumType: [{ name: "Kind" }] }] }] });
  const next = clone(FileDescriptorSetSchema, before); next.file[0].name = "new.proto";
  assert.equal(ownershipChanges(before, next).length, 3);
  next.file[0].messageType[0].nestedType = [];
  assert.throws(() => ownershipChanges(before, next), /removed/);
});

test("the maintained line passes its frozen image and rejects the planned relocation", () => {
  assert.equal(checkLine("maintained-0x", REFERENCES["maintained-0x"]).selected.status, 0);
  assert.throws(() => checkLine("maintained-0x", REFERENCES["v1-candidate"]), /FILE rejected/);
  assert.throws(() => checkLine("default-new-baseline", REFERENCES["maintained-0x"]), /unknown release line/);
});

test("candidate verification retains old FILE rejection and passes the explicit candidate baseline", () => {
  const result = checkLine("v1-candidate", REFERENCES["v1-candidate"]);
  assert.equal(result.legacy.status, 100);
  assert.match(result.legacy.report, /previously present|deleted/i);
  assert.equal(result.selected.status, 0);
  assert(result.ownership.length > 0);
  assert(result.ownership.every(change => change.endsWith(" -> proto/interaction.proto")));
});

test("expected migration rejection cannot hide tool failure behind partial FILE output", () => {
  const report = 'Previously present field "label" was deleted.';
  requireCompatibilityRejection({ status: 100, report });
  for (const status of [0, 1, 2, 126, 127, 137, null]) {
    assert.throws(() => requireCompatibilityRejection({ status, report }),
      /expected FILE compatibility rejection \(exit 100\)/);
  }
});

test("compatibility exit alone does not replace the required ownership rejection report", () => {
  assert.throws(() => requireCompatibilityRejection({ status: 100, report: "remote service unavailable" }),
    /expected ownership rejection was not observed/);
});

test("ownership changes beyond the frozen transition fail before any baseline reset", () => {
  const before = loadImage(REFERENCES["maintained-0x"]), prepared = loadImage(REFERENCES["v1-candidate"]);
  const modified = clone(FileDescriptorSetSchema, prepared);
  modified.file.find(file => file.name === "proto/value.proto").name = "proto/renamed_value.proto";
  assert.throws(() => verifyOwnership(before, prepared, modified), /explicit review required/);
});

test("candidate FILE still rejects an incompatible field change despite matching ownership", () => {
  const root = mkdtempSync(join(tmpdir(), "meridian-file-line-test-"));
  try {
    const modified = loadImage(REFERENCES["v1-candidate"]);
    modified.file.find(file => file.name === "proto/interaction.proto").messageType
      .find(message => message.name === "Affordance").field.find(field => field.name === "label").number = 99;
    const path = join(root, "incompatible.binpb");
    writeFileSync(path, toBinary(FileDescriptorSetSchema, modified));
    assert.throws(() => checkLine("v1-candidate", path), /v1-candidate FILE rejected/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

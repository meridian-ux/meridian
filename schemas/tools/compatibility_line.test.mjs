import test from "node:test";
import assert from "node:assert/strict";
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { DescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkLine, loadImage, ownershipChanges, REFERENCES, requireCompatibilityRejection, verifyOwnership, verifyRemovalCandidateReference } from "./compatibility_line.mjs";
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

test("the removal reference is digest-pinned and remains the exact complete transformation", () => {
  const bytes = readFileSync(REFERENCES["v1-removal-candidate"]);
  const reference = verifyRemovalCandidateReference(bytes);
  assert(reference.file.some(file => file.name.startsWith("conformance/")));
  const altered = Buffer.from(bytes); altered[altered.length - 1] ^= 1;
  assert.throws(() => verifyRemovalCandidateReference(altered), /reference changed; exact review required/);
  assert.throws(() => verifyRemovalCandidateReference(readFileSync(REFERENCES["v1-candidate"])),
    /reference changed; exact review required/);
});

test("explicit removal preparation preserves both FILE rejections and inventories only surviving moves", () => {
  const result = checkLine("v1-removal-candidate", REFERENCES["v1-removal-candidate"]);
  assert.equal(result.legacy.status, 100);
  assert.equal(result.additive.status, 100);
  assert.equal(result.selected.status, 0);
  assert.equal(result.ownership.length, 41);
  assert(result.ownership.every(change => change.endsWith(" -> proto/interaction.proto")));
  assert(result.ownership.every(change => !/meridian\.ui\.v1\.(Action|RowAction|OpenPanel|AffordanceStyle):/.test(change)));
});

test("removal preparation neither changes the old lines nor adds a production alias", () => {
  assert.throws(() => checkLine("maintained-0x", REFERENCES["v1-removal-candidate"]), /FILE rejected/);
  assert.throws(() => checkLine("v1-candidate", REFERENCES["v1-removal-candidate"]), /declaration removed/);
  assert.throws(() => checkLine("v1-removal-candidate", REFERENCES["v1-candidate"]), /exact reviewed removal/);
  for (const line of ["v1", "v1-removal", "production", "default"]) {
    assert.throws(() => checkLine(line, REFERENCES["v1-removal-candidate"]), /unknown release line/);
  }
});

test("initial removal rehearsal rejects unrelated additions, incompatible changes and incomplete images", () => {
  const root = mkdtempSync(join(tmpdir(), "meridian-removal-line-test-"));
  try {
    for (const mutate of [
      image => image.file.find(file => file.name === "proto/interaction.proto").messageType
        .find(message => message.name === "Affordance").field.find(field => field.name === "label").number = 99,
      image => image.file.find(file => file.name === "proto/interaction.proto").messageType
        .push(create(DescriptorProtoSchema, { name: "UnreviewedAddition" })),
      image => image.file.splice(image.file.findIndex(file => file.name.startsWith("conformance/")), 1),
    ]) {
      const modified = loadImage(REFERENCES["v1-removal-candidate"]);
      mutate(modified);
      const path = join(root, "unreviewed.binpb");
      writeFileSync(path, toBinary(FileDescriptorSetSchema, modified));
      assert.throws(() => checkLine("v1-removal-candidate", path), /exact reviewed removal/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the removal CLI prints both complete old-line reports and cannot approve activation", () => {
  const script = fileURLToPath(new URL("./compatibility_line.mjs", import.meta.url));
  const args = [script, "--line", "v1-removal-candidate", "--image", REFERENCES["v1-removal-candidate"]];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Maintained 0.x FILE: REJECTED \(exit 100\); full report follows/);
  assert.match(result.stdout, /Pre-removal additive FILE: REJECTED \(exit 100\); full report follows/);
  assert.match(result.stdout, /Frozen transition ownership \(41 declarations\)/);
  assert.match(result.stdout, /v1-removal-candidate FILE: passed/);
  assert.match(result.stdout, /PREPARATION ONLY: no production baseline activation/);
  const expected = checkLine("v1-removal-candidate", REFERENCES["v1-removal-candidate"]);
  assert(result.stdout.includes(expected.legacy.report), "complete maintained FILE report must remain visible");
  assert(result.stdout.includes(expected.additive.report), "complete additive FILE report must remain visible");
  const approval = spawnSync(process.execPath, [...args, "--approve"], { encoding: "utf8" });
  assert.notEqual(approval.status, 0);
  assert.match(approval.stderr, /usage:/);
});

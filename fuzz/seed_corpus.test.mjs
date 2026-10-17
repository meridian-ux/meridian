import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedCorpus, source } from "./seed_corpus.mjs";

test("scratch seeds preserve canonical protobuf bytes and source corpus", () => {
  const scratch = mkdtempSync(join(tmpdir(), "meridian-fuzz-seeds-"));
  const original = readFileSync(join(source, "core.json"));
  try {
    const counts = seedCorpus(scratch);
    assert.ok(counts.legacy > 0);
    assert.ok(counts.typed > 0);
    const views = [
      ...readdirSync(join(source, "layout")).filter(name => name.endsWith(".view.binpb"))
        .map(name => join("layout", name)),
      ...readdirSync(join(source, "fixtures"), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => join("fixtures", entry.name, "typical.view.binpb")),
    ];
    assert.equal(counts.views, views.length);
    assert.ok(counts.views > 0);
    for (const name of views) {
      const expected = readFileSync(join(source, name));
      assert.ok(readdirSync(scratch).some(seed => seed.startsWith("view-")
        && readFileSync(join(scratch, seed)).equals(expected)), name);
    }
    const corpus = JSON.parse(original);
    const expected = Buffer.from(corpus.requests[0].rpc, "base64");
    assert.ok(readdirSync(scratch).some(name => readFileSync(join(scratch, name)).equals(expected)));
    assert.deepEqual(readFileSync(join(source, "core.json")), original);
    for (const name of readdirSync(join(source, "binpb")).filter(name => name.endsWith(".binpb"))) {
      assert.deepEqual(readFileSync(join(scratch, name)), readFileSync(join(source, "binpb", name)));
    }
  } finally { rmSync(scratch, { recursive: true }); }
});

test("seeding cannot overwrite the committed fixture tree", () => {
  assert.throws(() => seedCorpus(join(source, "binpb")), /scratch directory/);
});

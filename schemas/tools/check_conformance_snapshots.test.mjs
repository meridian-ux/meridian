import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SNAPSHOT_SUITES, checkSnapshotFiles, checkSnapshots } from "./check_conformance_snapshots.mjs";

const coverage = { arms: { choice: {}, stream: {} } };
function sources() {
  return Object.fromEntries(Object.entries(SNAPSHOT_SUITES).map(([path, renderers]) => [path,
    renderers.flatMap((renderer) => ["unset", "choice", "stream"].map((arm) =>
      `exports[\`suite > test > ${renderer}/${arm} 1\`] = \`"body"\`;`,
    )).join("\n"),
  ]));
}

test("accepts every canonical arm in each browser suite", () => {
  assert.deepEqual(checkSnapshots(coverage, sources()), []);
});

test("rejects missing files, missing arms, extra arms, and duplicate keys", () => {
  const path = Object.keys(SNAPSHOT_SUITES)[0];
  const missingFile = sources();
  delete missingFile[path];
  assert.match(checkSnapshots(coverage, missingFile).join("\n"), /missing semantic snapshot file/);
  const missingArm = sources();
  missingArm[path] = missingArm[path].replace(/^.*html-kit\/choice.*\n/m, "");
  assert.match(checkSnapshots(coverage, missingArm).join("\n"), /missing html-kit\/choice/);
  const extra = sources();
  extra[path] += '\nexports[`test > html-kit/unknown 1`] = `"body"`;';
  assert.match(checkSnapshots(coverage, extra).join("\n"), /unexpected html-kit\/unknown/);
  const duplicate = sources();
  duplicate[path] += '\nexports[`test > html-kit/choice 1`] = `"body"`;';
  assert.match(checkSnapshots(coverage, duplicate).join("\n"), /duplicate/);
});

test("a newly declared arm requires new snapshots in every browser suite", () => {
  assert.equal(checkSnapshots({ arms: { ...coverage.arms, new_arm: {} } }, sources()).length, 4);
});

test("the committed Vitest snapshots cover the real manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../conformance/coverage.json", import.meta.url), "utf8"));
  assert.deepEqual(checkSnapshotFiles(manifest), []);
});

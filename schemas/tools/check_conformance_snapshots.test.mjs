import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SNAPSHOT_SUITES, checkSnapshotFiles, checkSnapshots, checkStatefulSnapshots } from "./check_conformance_snapshots.mjs";

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

test("stateful gate rejects a missing state or formatter case, not just a missing arm", () => {
  const keys = ["html", "shadcn"].flatMap(renderer =>
    ["empty", "typical", "overflow", "value-boolean"].map(state => `${renderer}/table/${state}`));
  const source = keys.map(key => `exports[\`suite > ${key} 1\`] = \`"body"\`;`).join("\n");
  const manifest = { arms: { table: {} } };
  const values = [{ name: "boolean" }];
  assert.deepEqual(checkStatefulSnapshots(manifest, values, source), []);
  assert.match(checkStatefulSnapshots(manifest, values, source.replace(/^.*html\/table\/overflow.*\n/m, "")).join("\n"), /missing stateful snapshot html\/table\/overflow/);
  assert.match(checkStatefulSnapshots(manifest, values, source.replace(/^.*html\/table\/value-boolean.*\n/m, "")).join("\n"), /missing stateful snapshot html\/table\/value-boolean/);
  assert.match(checkStatefulSnapshots(manifest, values, undefined).join("\n"), /missing stateful/);
});

test("stateful MUI snapshots are independently required", () => {
  const manifest = { arms: { table: {} } };
  const source = ["empty", "typical", "overflow"].map(state =>
    `exports[\`suite > mui-kit/table/${state} 1\`] = \`"body"\`;`).join("\n");
  assert.deepEqual(checkStatefulSnapshots(manifest, [], source, ["mui-kit"]), []);
  assert.match(checkStatefulSnapshots(manifest, [], source.replace(/^.*mui-kit\/table\/typical.*\n/m, ""), ["mui-kit"]).join("\n"), /missing stateful snapshot mui-kit\/table\/typical/);
});

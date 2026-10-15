import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SNAPSHOT_SUITES, checkSnapshotFiles, checkSnapshots, checkStatefulSnapshots, checkNativeSnapshots } from "./check_conformance_snapshots.mjs";

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

test("real WASM web-components snapshots require every state independently", () => {
  const manifest = { arms: { table: {} } };
  const source = ["empty", "typical", "overflow"].map(state =>
    `exports[\`suite > web-components/table/${state} 1\`] = \`"body"\`;`).join("\n");
  assert.deepEqual(checkStatefulSnapshots(manifest, [], source, ["web-components"]), []);
  assert.match(checkStatefulSnapshots(manifest, [], source.replace(/^.*web-components\/table\/typical.*\n/m, ""), ["web-components"]).join("\n"), /missing stateful snapshot web-components\/table\/typical/);
});

test("native buffers require both viewports, all states, and every formatter case", () => {
  const manifest = { arms: { table: {} } };
  const values = [{ name: "boolean" }];
  const paths = ["empty", "typical", "overflow", "value-boolean"].flatMap(state =>
    ["96x28", "40x10"].map(size => `table/${state}-${size}.txt`));
  assert.deepEqual(checkNativeSnapshots(manifest, values, paths), []);
  for (const missing of paths) assert.match(checkNativeSnapshots(manifest, values, paths.filter(path => path !== missing)).join("\n"), /missing native snapshot/);
  assert.match(checkNativeSnapshots(manifest, values, [...paths, "table/stale.txt"]).join("\n"), /unexpected native snapshot table\/stale.txt/);
});

test("every unrestricted value surface requires its own browser and native formatter goldens", () => {
  const manifest = { arms: { table: {}, record_card: {} } };
  const values = [{ name: "null" }];
  const arms = ["table", "record_card"];
  const keys = arms.flatMap(arm => ["empty", "typical", "overflow", "value-null"].map(state => `${arm}/${state}`));
  const browser = keys.map(key => `exports[\`suite > html/${key} 1\`] = \`"body"\`;`).join("\n");
  assert.deepEqual(checkStatefulSnapshots(manifest, values, browser, ["html"], arms), []);
  assert.match(checkStatefulSnapshots(manifest, values, browser.replace(/^.*html\/record_card\/value-null.*$/m, ""), ["html"], arms).join("\n"), /missing stateful snapshot html\/record_card\/value-null/);
  const native = keys.flatMap(key => ["96x28", "40x10"].map(size => `${key}-${size}.txt`));
  assert.deepEqual(checkNativeSnapshots(manifest, values, native, arms), []);
  assert.match(checkNativeSnapshots(manifest, values, native.filter(key => key !== "record_card/value-null-96x28.txt"), arms).join("\n"), /missing native snapshot record_card\/value-null-96x28.txt/);
});

// Presence gate for the browser semantic goldens. Runtime conformance suites
// prove their contents; this check prevents missing snapshots from silently
// being auto-recorded by a local Vitest run.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fromBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";

export const SNAPSHOT_SUITES = {
  "packages/web-react/tests/__snapshots__/conformance.test.ts.snap": ["html-kit", "shadcn-kit"],
  "packages/mui-kit/tests/__snapshots__/conformance.test.tsx.snap": ["mui-kit"],
  "packages/web/tests/__snapshots__/conformance.test.ts.snap": ["web-components"],
};

function statefulCases(coverage, valueCases, valueArms = ["table"], constrained = {}, inputs = {}) {
  const cases = Object.keys(coverage.arms).flatMap(arm => ["empty", "typical", "overflow"].map(state => `${arm}/${state}`));
  cases.push(...valueArms.flatMap(arm => valueCases.map(value => `${arm}/value-${value.name}`)));
  for (const [arms, values] of [[constrained.stringArms ?? [], constrained.strings ?? []], [constrained.numberArms ?? [], constrained.numbers ?? []]]) {
    cases.push(...arms.flatMap(arm => values.map(value => `${arm}/typed-${value.name}`)));
  }
  for (const value of inputs.cases ?? []) {
    cases.push(...(inputs.arms ?? []).map(arm => `${arm}/input-${value.name}`), `form/read-${value.name}`);
  }
  return cases;
}

export function checkStatefulSnapshots(coverage, valueCases, source, renderers = ["html", "shadcn"], valueArms = ["table"], constrained = {}, inputs = {}) {
  if (source === undefined) return ["missing stateful ViewDescriptor snapshots"];
  const cases = statefulCases(coverage, valueCases, valueArms, constrained, inputs);
  const expected = new Set(renderers.flatMap(renderer => cases.map(name => `${renderer}/${name}`)));
  const actual = [...source.matchAll(/exports\[`[^`\n]* > ([a-z-]+\/[a-z_]+\/[a-z0-9-]+) 1`\] = /g)].map(match => match[1]);
  const errors = [];
  for (const key of expected) if (!actual.includes(key)) errors.push(`missing stateful snapshot ${key}`);
  for (const key of actual) if (!expected.has(key)) errors.push(`unexpected stateful snapshot ${key}`);
  if (new Set(actual).size !== actual.length) errors.push("duplicate stateful snapshot key");
  return errors;
}

export function checkNativeSnapshots(coverage, valueCases, paths, valueArms = ["table"], constrained = {}, inputs = {}) {
  const expected = new Set(statefulCases(coverage, valueCases, valueArms, constrained, inputs).flatMap(name =>
    ["96x28", "40x10"].map(size => `${name}-${size}.txt`)));
  const actual = new Set(paths);
  return [
    ...[...expected].filter(path => !actual.has(path)).map(path => `missing native snapshot ${path}`),
    ...[...actual].filter(path => !expected.has(path)).map(path => `unexpected native snapshot ${path}`),
  ];
}

export function checkSnapshots(coverage, sources) {
  const errors = [];
  const arms = ["unset", ...Object.keys(coverage.arms)];
  for (const [path, renderers] of Object.entries(SNAPSHOT_SUITES)) {
    const source = sources[path];
    if (source === undefined) {
      errors.push(`missing semantic snapshot file: ${path}`);
      continue;
    }
    const expected = new Set(renderers.flatMap((renderer) => arms.map((arm) => `${renderer}/${arm}`)));
    const actual = [...source.matchAll(/exports\[`[^`\n]* > ([a-z-]+\/[a-z_]+) 1`\] = /g)].map((match) => match[1]);
    for (const key of expected) if (!actual.includes(key)) errors.push(`${path}: missing ${key}`);
    for (const key of actual) if (!expected.has(key)) errors.push(`${path}: unexpected ${key}`);
    if (new Set(actual).size !== actual.length) errors.push(`${path}: duplicate semantic snapshot key`);
  }
  return errors;
}

export function checkSnapshotFiles(coverage) {
  const root = new URL("../../", import.meta.url);
  const sources = {};
  for (const path of Object.keys(SNAPSHOT_SUITES)) {
    try { sources[path] = readFileSync(new URL(path, root), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const valueCorpus = JSON.parse(readFileSync(new URL("schemas/conformance/value_types.json", root), "utf8"));
  const valueCases = valueCorpus.cases;
  const constrained = JSON.parse(readFileSync(new URL("schemas/conformance/constrained_value_types.json", root), "utf8"));
  const inputs = toJson(StructSchema, fromBinary(StructSchema, readFileSync(new URL("schemas/conformance/input_values.binpb", root))));
  const statefulErrors = [];
  for (const [path, renderers] of [
    ["packages/web-react/tests/__snapshots__/stateful_conformance.test.ts.snap", ["html", "shadcn"]],
    ["packages/mui-kit/tests/__snapshots__/stateful_conformance.test.ts.snap", ["mui-kit"]],
    ["packages/web/tests/__snapshots__/conformance_wasm.test.ts.snap", ["web-components"]],
  ]) {
    let source;
    try { source = readFileSync(new URL(path, root), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    statefulErrors.push(...checkStatefulSnapshots(coverage, valueCases, source, renderers, valueCorpus.panelArms, constrained, inputs).map(error => `${path}: ${error}`));
  }
  const native = [];
  function walkNative(prefix = "") {
    let entries;
    try { entries = readdirSync(new URL(`schemas/conformance/native/${prefix}`, root), { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (entry.isDirectory()) walkNative(`${prefix}${entry.name}/`);
      else native.push(`${prefix}${entry.name}`);
    }
  }
  walkNative();
  return [...checkSnapshots(coverage, sources), ...statefulErrors, ...checkNativeSnapshots(coverage, valueCases, native, valueCorpus.panelArms, constrained, inputs)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const coverage = JSON.parse(readFileSync(new URL("../conformance/coverage.json", import.meta.url), "utf8"));
  const errors = checkSnapshotFiles(coverage);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("browser semantic and native buffer snapshots OK");
}

// Presence gate for the browser semantic goldens. Runtime conformance suites
// prove their contents; this check prevents missing snapshots from silently
// being auto-recorded by a local Vitest run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SNAPSHOT_SUITES = {
  "packages/web-react/tests/__snapshots__/conformance.test.ts.snap": ["html-kit", "shadcn-kit"],
  "packages/mui-kit/tests/__snapshots__/conformance.test.tsx.snap": ["mui-kit"],
  "packages/web/tests/__snapshots__/conformance.test.ts.snap": ["web-components"],
};

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
  return checkSnapshots(coverage, sources);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const coverage = JSON.parse(readFileSync(new URL("../conformance/coverage.json", import.meta.url), "utf8"));
  const errors = checkSnapshotFiles(coverage);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("browser semantic snapshots OK");
}

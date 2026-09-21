import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

export function expectedFixtureNames(coverage) {
  return new Set(["empty.binpb", ...Object.keys(coverage.arms).map((name) => `${name}.binpb`)]);
}

export function checkCorpus({ coverage, files }) {
  const expected = expectedFixtureNames(coverage);
  const actual = new Set(files.filter((file) => file.endsWith(".binpb")));
  const missing = [...expected].filter((file) => !actual.has(file)).sort();
  const extra = [...actual].filter((file) => !expected.has(file)).sort();
  if (missing.length || extra.length) {
    throw new Error([
      missing.length ? `missing: ${missing.join(", ")}` : "",
      extra.length ? `extra: ${extra.join(", ")}` : "",
    ].filter(Boolean).join("; "));
  }
  return { count: expected.size };
}

export function check() {
  const coverage = JSON.parse(readFileSync(join(ROOT, "conformance/coverage.json"), "utf8"));
  const fixtureDir = join(ROOT, "conformance/binpb");
  if (!existsSync(fixtureDir)) throw new Error("conformance/binpb does not exist");
  return checkCorpus({ coverage, files: readdirSync(fixtureDir) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { count } = check();
  console.log(`conformance corpus OK — ${count} serialized fixtures`);
}

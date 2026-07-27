// Smoke test over the built site (//:build).
//
// Three jobs:
//   1. Every route the catalog implies actually emitted an index.html. Astro fails
//      loudly on a broken page, but a route that silently stops being generated —
//      a getStaticPaths that returns [], a catalog that lost an entry — looks like
//      a perfectly clean build. So the feature routes are derived from
//      src/content/features.json rather than hardcoded here: a feature that
//      disappears from the catalog AND from the output would otherwise agree with
//      itself and pass.
//   2. Internal links resolve. Cross-links between the hub and the feature pages
//      are exactly what breaks when a slug is renamed.
//   3. The run is not vacuous — see the page-count guard below.
//
// This is also the repo's only test target, which matters mechanically: the build
// runner sends TEST_TARGETS=//... and `bazel test` exits 4 ("no test targets were
// found, yet testing was requested") on a repo with none.
//
// It's a js_test, not an sh_test: sh_test pulls in
// @bazel_tools//tools/cpp:current_cc_toolchain, and the CI image sets
// BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1, so analysis fails on linux while passing on
// darwin. Node is already this repo's toolchain and needs no CC toolchain.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const fail = (m) => { console.error(`FAIL: ${m}`); fails++; };
const ok = (m) => console.log(`  ok: ${m}`);

// Locate the built tree. Under js_test the cwd is the runfiles root; fall back to a
// plain `pnpm run build` layout so this is runnable by hand.
const candidates = [
  join(process.cwd(), "dist"),
  join(process.cwd(), "_main", "dist"),
  join(process.env.RUNFILES_DIR ?? "", "_main", "dist"),
  join(process.env.JS_BINARY__RUNFILES ?? "", "_main", "dist"),
];
const DIST = candidates.find((p) => p && existsSync(p) && statSync(p).isDirectory());
if (!DIST) {
  console.error(`FAIL: cannot locate the built site. Looked in:\n  ${candidates.join("\n  ")}`);
  process.exit(1);
}

// Read the tree eagerly. This also guards against a vacuous run: an empty or
// unreadable dist would let every check below "pass" by having nothing to check.
// (The original version of this test in fastverk/site shelled out to `grep -r`,
// which on BSD silently refuses to descend the symlinked dist in runfiles and so
// passed while checking nothing.)
const htmlFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".html")) htmlFiles.push(p);
  }
})(DIST);

const MIN_PAGES = 5;
if (htmlFiles.length < MIN_PAGES) {
  fail(`only ${htmlFiles.length} html files under ${DIST} — every check below would be vacuous`);
}

console.log("== routes ==");
// Derive the feature routes from the catalog the pages render from.
const catalog = ["src/content/features.json", "_main/src/content/features.json"]
  .map((p) => join(process.cwd(), p))
  .find((p) => existsSync(p));
const features = catalog
  ? JSON.parse(readFileSync(catalog, "utf8")).features ?? []
  : [];
if (!catalog) fail("src/content/features.json not found — cannot derive feature routes");
else if (features.length === 0) fail("features.json lists no features — the catalog is empty");

const ROUTES = ["", "features", ...features.map((f) => `features/${f.slug}`)];
const before = fails;
for (const r of ROUTES) {
  const f = join(DIST, r, "index.html");
  if (!existsSync(f) || statSync(f).size === 0) fail(`route /${r} did not emit an index.html`);
}
if (!existsSync(join(DIST, "404.html"))) fail("404.html was not emitted");
if (fails === before) ok(`${ROUTES.length} routes + 404 emitted (${features.length} from the catalog)`);

console.log("== internal links ==");
const present = new Set();
(function walkAll(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkAll(p);
    else present.add("/" + p.slice(DIST.length + 1).split(/[\\/]/).join("/"));
  }
})(DIST);

// astro.config sets `base`, which prefixes every authored link (/site/features)
// while dist/ is written WITHOUT it (dist/features). Read the value rather than
// hardcoding it, so changing base doesn't quietly turn this check into a
// rubber stamp that passes on any input.
const cfg = ["astro.config.mjs", "_main/astro.config.mjs"]
  .map((p) => join(process.cwd(), p))
  .find((p) => existsSync(p));
if (!cfg) fail("astro.config.mjs not found — cannot determine the base path");
// Strip comments before matching: astro.config.mjs documents the alternative as
// `set base:"/" + a CNAME` in a comment ABOVE the real setting, and a naive regex
// happily matches that first, yielding an empty base and a check that then fails
// every link on the site.
const BASE = cfg
  ? (readFileSync(cfg, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .match(/base:\s*["']([^"']*)["']/)?.[1] ?? "").replace(/\/$/, "")
  : "";
if (BASE) ok(`base path is "${BASE}" — stripping it before resolving`);
else ok("no base path configured — links resolve against the dist root");

const resolves = (href) => {
  let h = href.split("#")[0].split("?")[0];
  if (!h || !h.startsWith("/")) return true;
  if (BASE && (h === BASE || h.startsWith(`${BASE}/`))) h = h.slice(BASE.length) || "/";
  else if (BASE) return false; // an absolute link that skips the base is broken in prod
  if (present.has(h)) return true;
  const stripped = h.endsWith("/") ? h.slice(0, -1) : h;
  return present.has(`${stripped}/index.html`) || present.has(`${stripped || ""}/index.html`);
};

let checked = 0;
const linkBefore = fails;
for (const f of htmlFiles) {
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|data:|#)/.test(u)) continue;
    checked++;
    if (!resolves(u)) fail(`${f.slice(DIST.length)} links to ${u}, which was not emitted`);
  }
}
if (fails === linkBefore) ok(`${checked} internal links resolve`);

console.log("");
if (fails > 0) {
  console.error(`${fails} check(s) failed`);
  process.exit(1);
}
console.log(`site smoke test passed (${htmlFiles.length} pages checked)`);

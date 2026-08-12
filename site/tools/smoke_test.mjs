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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let fails = 0;
const fail = (m) => { console.error(`FAIL: ${m}`); fails++; };
const ok = (m) => console.log(`  ok: ${m}`);

// Locate the built tree.
//
// FIRST candidate is relative to THIS FILE, and that is the one that survives a
// move. astro_site chdirs into its own package and emits `dist` there, so the
// tree is a sibling of this script's parent: site/tools/ -> site/dist. The
// cwd-relative candidates below are all `<root>/dist`, which was right only
// while site/ WAS the repository root — after the merge they resolve to a dist
// at the monorepo root that nothing writes, and the test failed reporting four
// paths that were all equally wrong.
const HERE = dirname(fileURLToPath(import.meta.url));

const candidates = [
  join(HERE, "..", "dist"),
  join(process.cwd(), "site", "dist"),
  join(process.cwd(), "dist"),
  join(process.cwd(), "_main", "site", "dist"),
  join(process.env.RUNFILES_DIR ?? "", "_main", "site", "dist"),
  join(process.env.JS_BINARY__RUNFILES ?? "", "_main", "site", "dist"),
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
const catalog = [
  join(HERE, "..", "src", "content", "features.json"),
  join(process.cwd(), "site", "src", "content", "features.json"),
  join(process.cwd(), "src", "content", "features.json"),
  join(process.cwd(), "_main", "site", "src", "content", "features.json"),
].find((p) => existsSync(p));
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
const cfg = [
  join(HERE, "..", "astro.config.mjs"),
  join(process.cwd(), "site", "astro.config.mjs"),
  join(process.cwd(), "astro.config.mjs"),
  join(process.cwd(), "_main", "site", "astro.config.mjs"),
].find((p) => existsSync(p));
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

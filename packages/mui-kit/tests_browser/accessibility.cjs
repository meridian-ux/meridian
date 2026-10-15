const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const { normalizeAX } = require(path.resolve("schemas/conformance/normalize_ax.cjs"));
const kits = ["html", "shadcn", "mui-kit", "web-components"];
const fixtureDir = path.resolve("schemas/conformance/fixtures");
const recording = process.env.UPDATE_AX_SNAPSHOTS === "1";
const source = process.env.BUILD_WORKSPACE_DIRECTORY;
if (recording && (!source || !path.isAbsolute(source) || source.includes(".runfiles/"))) throw new Error("Recording requires Bazel's explicit source workspace");
const goldenDir = path.resolve(recording ? source : ".", "schemas/conformance/ax");
const cases = fs.readdirSync(fixtureDir).sort().flatMap(arm => fs.readdirSync(path.join(fixtureDir, arm)).sort()
  .filter(file => file.endsWith(".view.binpb")).map(file => ({ arm, state: file.slice(0, -".view.binpb".length) })));

async function main() {
  const browser = await chromium.launch({ executablePath: path.resolve(process.argv[2]), headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu", "--lang=en-US"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" });
    await page.route(/^https?:\/\//, route => route.abort()); // Never dial external media.
    const css = fs.readFileSync(path.resolve(process.argv[6]), "utf8");
    await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><title>Meridian AX conformance</title><style>' + css + '</style><main class="meridian-uiview-body"><div id="root"></div></main></html>');
    await page.evaluate(async ({ glue, bytes }) => {
      const url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
      const module = await import(url); await module.default({ module_or_path: Uint8Array.from(bytes) });
      window.axWasm = module; URL.revokeObjectURL(url);
      // Test transport only, not a live PTY integration.
      window.WebSocket = class {
        static OPEN = 1; readyState = 0; binaryType = "";
        onopen = null; onmessage = null; onclose = null; onerror = null;
        send() {} close() { this.readyState = 3; }
      };
    }, { glue: fs.readFileSync(path.resolve(process.argv[4]), "utf8"), bytes: [...fs.readFileSync(path.resolve(process.argv[5]))] });
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(process.argv[3]), "utf8") });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Accessibility.enable");
    const expected = new Set();
    for (const kit of kits) {
      let completed = 0;
      for (const { arm, state } of cases) {
        const stem = path.join(fixtureDir, arm, state);
        const title = await page.evaluate(({ kit, view, responses }) => window.axConformance.render(kit, view, responses), {
          kit, view: [...fs.readFileSync(`${stem}.view.binpb`)], responses: [...fs.readFileSync(`${stem}.responses.binpb`)],
        });
        // Load offscreen lazy frames too so the deterministic unavailable-asset
        // condition applies to the whole AX tree, not just the first viewport.
        await page.evaluate(() => document.querySelectorAll("#root img").forEach(image => { image.loading = "eager"; }));
        await page.waitForFunction(() => [...document.querySelectorAll("#root img")].every(image => image.complete));
        // Wait for the real player → poster → text failure ladder. Steps may
        // retain a broken image with native alt text; do not impose DOM markup.
        if (arm === "media") await page.waitForFunction(() =>
          document.querySelectorAll("#root img, #root video, #root audio").length === 0, undefined, { timeout: 10000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => document.activeElement?.blur());
        const tree = normalizeAX((await cdp.send("Accessibility.getFullAXTree")).nodes);
        if (!tree.text.includes(JSON.stringify(title))) throw new Error(`${kit}/${arm}/${state}: view title missing from computed AX`);
        if (tree.unnamed.length) throw new Error(`${kit}/${arm}/${state}: unnamed computed controls: ${tree.unnamed.join(", ")}`);
        const relative = `${kit}/${arm}/${state}.txt`;
        expected.add(relative);
        const file = path.join(goldenDir, relative);
        if (recording) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, tree.text); }
        else {
          if (!fs.existsSync(file)) throw new Error(`Missing computed AX golden: ${relative}`);
          const wanted = fs.readFileSync(file, "utf8");
          if (wanted !== tree.text) {
            const left = wanted.split("\n"), right = tree.text.split("\n");
            const index = left.findIndex((line, index) => line !== right[index]);
            throw new Error(`Changed computed AX golden: ${relative}\nExpected: ${left.slice(Math.max(0, index - 1), index + 3).join("\n")}\nActual: ${right.slice(Math.max(0, index - 1), index + 3).join("\n")}`);
          }
        }
        if (++completed % 50 === 0) console.log(`${kit}: ${completed}/${cases.length} computed AX trees`);
      }
      console.log(`${kit}: ${cases.length} computed Chrome AX trees ${recording ? "recorded" : "verified"}`);
    }
    const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? walk(path.join(directory, entry.name)) : [path.relative(goldenDir, path.join(directory, entry.name))]);
    const extra = walk(goldenDir).filter(file => !expected.has(file));
    if (extra.length) throw new Error(`Unexpected AX goldens (not deleted): ${extra.join(", ")}`);
    console.log(`${expected.size} computed accessibility trees; no unnamed interactive controls.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

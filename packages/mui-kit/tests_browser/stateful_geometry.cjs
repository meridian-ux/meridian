// Real geometry over canonical stateful wires, independent of semantic/AX goldens.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const directory = path.resolve("schemas/conformance/fixtures");
const coverage = JSON.parse(fs.readFileSync("schemas/conformance/coverage.json", "utf8"));
const cases = Object.keys(coverage.arms).sort().flatMap(arm => ["empty", "typical", "overflow"].map(state => ({ arm, state })));
const allKits = ["html", "shadcn", "mui-kit", "web-components"];
const shards = Number(process.env.TEST_TOTAL_SHARDS ?? "1"), shard = Number(process.env.TEST_SHARD_INDEX ?? "0");
assert.ok([1, allKits.length].includes(shards) && Number.isInteger(shard) && shard >= 0 && shard < shards, "Invalid geometry shard assignment");
if (process.env.TEST_SHARD_STATUS_FILE) fs.writeFileSync(process.env.TEST_SHARD_STATUS_FILE, "");
const kits = shards === 1 ? allKits : [allKits[shard]];

async function main() {
  const browser = await chromium.launch({ executablePath: path.resolve(process.argv[2]), headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu", "--lang=en-US"] });
  try {
    const page = await browser.newPage({ locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => route.abort());
    const css = fs.readFileSync(path.resolve(process.argv[6]), "utf8");
    await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><title>Stateful geometry conformance</title><style>body{margin:0}' + css + '</style><main class="meridian-uiview-body" style="margin:16px"><div id="root"></div></main></html>');
    await page.evaluate(async ({ glue, bytes }) => {
      const url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
      try { const module = await import(url); await module.default({ module_or_path: Uint8Array.from(bytes) }); window.axWasm = module; }
      finally { URL.revokeObjectURL(url); }
      // A socket stand-in exercises layout only, not live PTY claims.
      window.WebSocket = class {
        static OPEN = 1; readyState = 0; binaryType = "";
        onopen = null; onmessage = null; onclose = null; onerror = null;
        send() {} close() { this.readyState = 3; }
      };
    }, { glue: fs.readFileSync(path.resolve(process.argv[4]), "utf8"), bytes: [...fs.readFileSync(path.resolve(process.argv[5]))] });
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(process.argv[3]), "utf8") });
    const failures = [];
    for (const kit of kits) {
      for (const { arm, state } of cases) for (const width of [1100, 320]) {
        try {
          await page.setViewportSize({ width, height: 800 });
          await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
          const stem = path.join(directory, arm, state);
          const title = await page.evaluate(({ kit, view, responses }) => window.axConformance.render(kit, view, responses), {
            kit, view: [...fs.readFileSync(`${stem}.view.binpb`)], responses: [...fs.readFileSync(`${stem}.responses.binpb`)],
          });
          await page.evaluate(() => document.querySelectorAll("#root img").forEach(image => { image.loading = "eager"; }));
          await page.waitForFunction(() => [...document.querySelectorAll("#root img")].every(image => image.complete));
          if (arm === "media") await page.waitForFunction(() => document.querySelectorAll("#root img, #root video, #root audio").length === 0);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.evaluate(title => {
            const root = document.getElementById("root");
            if (!root.textContent.includes(title)) throw new Error("Missing composed view identity");
            if (document.documentElement.scrollWidth > innerWidth + 1) {
              const outside = [...root.querySelectorAll("*")].filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 5)
                .map(element => `${element.tagName}.${element.className}(${Math.round(element.getBoundingClientRect().width)}px)`);
              throw new Error(`Page overflows horizontally: ${outside.join(", ")}`);
            }
            const scrollOwner = element => {
              for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
                if (/auto|scroll/.test(getComputedStyle(parent).overflowX) && parent.clientWidth < parent.scrollWidth) return parent;
              }
            };
            for (const element of root.querySelectorAll('h1,h2,h3,h4,p,label,button,input,select,textarea,pre,th,td,a[href],[role="button"],[role="combobox"],.MuiChip-label')) {
              if (!element.getClientRects().length || getComputedStyle(element).visibility === "hidden") continue;
              // xterm deliberately positions its native input helper offscreen;
              // the visible surface is the terminal, not the helper's box.
              // Verify both that surface and the actual keyboard focus target.
              if (element.matches("textarea.xterm-helper-textarea")) {
                const terminal = element.closest(".xterm");
                if (!terminal || !element.getAttribute("aria-label")?.trim()) throw new Error("Unlabeled terminal input helper");
                terminal.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
                const surface = terminal.getBoundingClientRect();
                if (surface.width <= 0 || surface.height <= 0 || surface.left < -1 || surface.right > innerWidth + 1 || surface.bottom < 0 || surface.top > innerHeight) throw new Error("Unreachable terminal surface");
                element.focus({ preventScroll: true });
                if (document.activeElement !== element) throw new Error("Unfocusable terminal input helper");
                continue;
              }
              element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
              const box = element.getBoundingClientRect();
              const owner = scrollOwner(element);
              if ((!owner && (box.left < -1 || box.right > innerWidth + 1)) || box.bottom < 0 || box.top > innerHeight) {
                throw new Error(`Unreachable ${element.tagName}: ${element.textContent.slice(0, 60)}`);
              }
              if (element.matches('button,label,[role="button"],.MuiChip-label') && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) {
                throw new Error(`Clipped label/control: ${element.textContent.slice(0, 60)}`);
              }
              if (element.matches('button,input,select,textarea,a[href],[role="button"],[role="combobox"]') && !element.disabled && element.getAttribute("aria-disabled") !== "true") {
                element.focus({ preventScroll: true });
                if (document.activeElement !== element) throw new Error(`Unfocusable ${element.tagName}`);
              }
            }
            window.scrollTo(0, 0);
          }, title);
        } catch (error) { failures.push(`${kit}/${arm}/${state}/${width}: ${error.message.split("\n")[0]}`); }
      }
      console.log(`${kit}: ${cases.length * 2} canonical mounts checked; ${failures.length} failures so far`);
    }
    assert.deepEqual(errors, []);
    if (failures.length) throw new Error(`${failures.length} canonical geometry failures:\n${failures.join("\n")}`);
    console.log(`${cases.length * kits.length * 2} stateful real-browser geometry mounts verified in this shard; no live transport.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

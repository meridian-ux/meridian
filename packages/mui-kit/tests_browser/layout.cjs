const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { fromBinary, toJson } = require("@bufbuild/protobuf");
const { StructSchema } = require("@bufbuild/protobuf/wkt");
const directory = path.resolve("schemas/conformance/layout");
const cases = toJson(StructSchema, fromBinary(StructSchema, fs.readFileSync(path.join(directory, "index.binpb")))).cases;
const kits = ["html", "shadcn", "mui-kit", "web-components"];

async function geometry(page, fixture, initial = true) {
  await page.evaluate(({ fixture, initial }) => {
    const root = document.getElementById("root");
    const bounds = root.getBoundingClientRect();
    if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error("Composition overflows viewport horizontally");
    const slots = [...root.querySelectorAll("[data-slot]")];
    if (initial && JSON.stringify(slots.map(slot => slot.dataset.slot)) !== JSON.stringify(fixture.order)) throw new Error("Changed slot reading order");
    for (const slot of slots) {
      const box = slot.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1) throw new Error(`Clipped section ${slot.dataset.slot}`);
    }
    for (const tab of root.querySelectorAll('[role="tab"]')) {
      const box = tab.getBoundingClientRect();
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || tab.scrollWidth > tab.clientWidth + 1 || tab.scrollHeight > tab.clientHeight + 1) throw new Error("Clipped tab label");
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (!tab.id || panel?.getAttribute("role") !== "tabpanel" || panel.getAttribute("aria-labelledby") !== tab.id) throw new Error("Broken tab/panel association");
    }
    if (fixture.name === "twoColumn") {
      const main = root.querySelector(".mer-col-main, .meridian-uiview-col-main");
      const side = root.querySelector(".mer-col-sidebar, .meridian-uiview-col-sidebar");
      if (!main || !side || side.tagName !== "ASIDE" || side.getAttribute("aria-label") !== "Sidebar") throw new Error("Missing labeled sidebar group");
      const a = main.getBoundingClientRect(), b = side.getBoundingClientRect();
      if (innerWidth === 320) {
        if (b.top < a.bottom - 1 || Math.abs(a.left - b.left) > 1) throw new Error("Compact view does not stack main then sidebar");
      } else if (b.left < a.right - 1 || Math.abs(a.top - b.top) > 1) throw new Error("Wide view does not form usable columns");
    } else {
      for (let i = 1; i < slots.length; i++) if (slots[i].getBoundingClientRect().top < slots[i - 1].getBoundingClientRect().top - 1) throw new Error("Visual section order differs from reading order");
    }
    const header = slots.find(slot => slot.dataset.slot === "header");
    const body = slots.find(slot => slot.dataset.slot !== "header");
    if (header && body && header.getBoundingClientRect().bottom > body.getBoundingClientRect().top + 1) throw new Error("Header section is not before body");
    // Reach the actual authored section label, including sections below the
    // initial viewport. No hidden selector or extracted-panel proxy counts.
    for (const slot of slots) {
      const label = slot.querySelector(":scope > h3") ?? slot;
      label.scrollIntoView({ block: "center", behavior: "instant" });
      const box = label.getBoundingClientRect();
      if (box.top < -1 || box.bottom > innerHeight + 1) throw new Error(`Unreachable label ${slot.dataset.slot}`);
    }
    window.scrollTo(0, 0);
  }, { fixture, initial });
}

async function tabs(page, fixture, width) {
  const tabs = page.getByRole("tab");
  assert.deepEqual(await tabs.allTextContents(), fixture.tabs);
  const ids = await tabs.evaluateAll(elements => elements.map(element => element.id));
  assert.equal(new Set(ids).size, ids.length);
  if (!fixture.tabs.length) return;
  const before = await page.evaluate(() => window.layoutConformance.calls());
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await tabs.nth(1).evaluate(element => element === document.activeElement), true);
  assert.equal(await tabs.first().getAttribute("aria-selected"), "true", "focus must not activate");
  assert.deepEqual(await page.evaluate(() => window.layoutConformance.calls()), before);
  await page.keyboard.press("Enter");
  await page.getByRole("tabpanel", { name: fixture.tabs[1], exact: true }).getByText("Content first", { exact: true }).waitFor();
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByText("Content last", { exact: true }).count(), 0);
  // A responsive reflow must preserve selection, association, and focus.
  await page.setViewportSize({ width: width === 320 ? 1100 : 320, height: 900 });
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
  assert.equal(await tabs.nth(1).evaluate(element => element === document.activeElement), true);
  await geometry(page, fixture, false);
  await page.setViewportSize({ width, height: 900 });
  await page.keyboard.press("Home");
  assert.equal(await tabs.first().evaluate(element => element === document.activeElement), true);
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
  await page.keyboard.press("Space");
  await page.getByRole("tabpanel", { name: fixture.tabs[0], exact: true }).getByText("Content last", { exact: true }).waitFor();
  await page.keyboard.press("End");
  assert.equal(await tabs.nth(1).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("ArrowRight");
  assert.equal(await tabs.first().evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await tabs.nth(1).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(await page.evaluate(() => window.layoutConformance.calls()), before, "tab navigation must not invent RPCs");
}

async function main() {
  const browser = await chromium.launch({ executablePath: path.resolve(process.argv[2]), headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu", "--lang=en-US"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC" });
    await page.route(/^https?:\/\//, route => route.abort());
    const css = fs.readFileSync(path.resolve(process.argv[6]), "utf8");
    await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><title>Meridian layout conformance</title><style>body{margin:0}' + css + '</style><main id="root" class="meridian-uiview-body" style="margin:16px"></main></html>');
    await page.evaluate(async ({ glue, bytes }) => {
      const url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
      try { const module = await import(url); await module.default({ module_or_path: Uint8Array.from(bytes) }); window.layoutWasm = module; }
      finally { URL.revokeObjectURL(url); }
    }, { glue: fs.readFileSync(path.resolve(process.argv[4]), "utf8"), bytes: [...fs.readFileSync(path.resolve(process.argv[5]))] });
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(process.argv[3]), "utf8") });
    await page.evaluate(() => {
      const style = document.createElement("style"); style.id = "host-theme-guard";
      style.textContent = "body { margin: 23px; }"; document.head.append(style);
      document.getElementById("root").style.setProperty("--mer-space-1", "17px");
    });
    await page.evaluate(() => window.layoutConformance.mountThemedMuiPanel());
    await page.getByText("Themed metric", { exact: true }).waitFor();
    await page.evaluate(() => {
      const card = document.querySelector(".MuiCard-root"), scope = document.querySelector(".MuiScopedCssBaseline-root");
      if (!scope || getComputedStyle(scope).fontSize !== "19px") throw new Error(`Public MUI mount did not bind Typography: ${scope ? getComputedStyle(scope).fontSize : "missing scoped boundary"}`);
      if (getComputedStyle(card).borderRadius !== "12px" || getComputedStyle(card).borderTopWidth !== "0px") throw new Error("Public MUI mount did not bind radius/zero stroke");
      if (getComputedStyle(card).backgroundColor !== "rgb(32, 48, 64)") throw new Error("Public MUI mount lost canonical palette");
      if (getComputedStyle(document.querySelector(".mer-stat-delta")).marginLeft !== "1.5px") throw new Error("Public MUI mount did not bind scale/density to real component spacing");
      if (getComputedStyle(document.body).margin !== "23px") throw new Error("Mounted panel reset host body styles");
      window.layoutConformance.unmountThemedMuiPanel();
      const root = document.getElementById("root");
      if (root.children.length || root.style.getPropertyValue("--mer-space-1") !== "17px") throw new Error("Public MUI unmount lost host ownership");
      root.style.removeProperty("--mer-space-1"); document.getElementById("host-theme-guard").remove();
    });
    for (const kit of kits) {
      for (const fixture of cases) for (const width of [1100, 320]) {
        try {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(({ kit, view, context, responses }) => window.layoutConformance.render(kit, view, context, responses), {
            kit, view: [...fs.readFileSync(path.join(directory, `${fixture.name}.view.binpb`))],
            context: [...fs.readFileSync(path.join(directory, `${fixture.name}.context.binpb`))],
            responses: [...fs.readFileSync(path.join(directory, `${fixture.name}.responses.binpb`))],
          });
          await page.waitForFunction(content => content.every(text => document.getElementById("root").textContent.includes(text)), fixture.content);
          await geometry(page, fixture);
          await tabs(page, fixture, width);
          const calls = await page.evaluate(() => window.layoutConformance.calls());
          const expected = fixture.name === "repeated" ? ["fixture.Layout.Rows"] : fixture.gateOpen ? ["fixture.Layout.Scoped"] : [];
          assert.deepEqual(calls, expected, "closed gates and static composition must not fetch");
          if (fixture.name === "twoColumn") {
            await page.evaluate(kit => {
              window.layoutConformance.metrics(true);
              const columns = document.querySelector(".mer-two-column, .meridian-uiview-two-column");
              if (!columns) throw new Error("Missing columns for Metrics verification");
              if (getComputedStyle(columns).gap !== "27px") throw new Error("Scale/density did not reach composition gap");
              if (kit === "mui-kit" && getComputedStyle(document.querySelector(".mer-view")).backgroundColor !== "rgb(16, 16, 16)") throw new Error("Nested MUI theme binding replaced dark mode with light colors");
              window.layoutConformance.metrics(false);
            }, kit);
            await geometry(page, fixture);
            await page.setViewportSize({ width: width === 320 ? 1100 : 320, height: 900 });
            await geometry(page, fixture);
            assert.deepEqual(await page.evaluate(() => window.layoutConformance.calls()), expected);
          }
        } catch (error) { throw new Error(`${kit}/${fixture.name}/${width}: ${error.message}`, { cause: error }); }
      }
      console.log(`${kit}: ${cases.length * 2} shared-wire mounts verified at 320/1100px, including keyboard/reflow checks`);
    }
    console.log(`${kits.length * cases.length * 2} real-browser compositions verified; no live transport.`);
  } finally { await browser.close(); }
}
module.exports = { geometry };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

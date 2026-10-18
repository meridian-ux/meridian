const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ executablePath: path.resolve(process.argv[2]), headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route("https://assets.meridian.invalid/**", route => route.request().url().endsWith(".svg")
      ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="gray"/></svg>' })
      : route.fulfill({ status: 404, contentType: "text/plain", body: "No frame" }));
    const css = fs.readFileSync(path.resolve(process.argv[4]), "utf8");
    await page.setContent('<!doctype html><meta charset="utf-8"><style>' + css + '</style><main id="root" class="meridian-uiview-body" style="margin:16px;--mer-unit:8px"></main>');
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(process.argv[3]), "utf8") });
    await page.evaluate(() => window.webConformance.tableInvocation("allow"));
    const useRow = page.getByRole("button", { name: "Use row", exact: true });
    if (!(await useRow.isDisabled())) throw Error("Unselected row was actionable");
    await page.getByRole("row", { name: "First row", exact: true }).focus(); await page.keyboard.press("Space");
    await useRow.focus(); await page.keyboard.press("Enter"); await page.getByRole("status").filter({ hasText: "Action completed." }).waitFor();
    if (await page.locator("#root").getAttribute("data-table-row") !== "0" || await page.locator("#root").getAttribute("data-table-calls") !== "1") throw Error("Table lost zero row ID or duplicated effect");
    await page.evaluate(() => window.webConformance.tableInvocation("deny"));
    await page.getByRole("row", { name: "Second row", exact: true }).focus(); await page.keyboard.press("Enter"); await useRow.focus(); await page.keyboard.press("Space");
    await page.getByRole("alert").filter({ hasText: "Action denied" }).waitFor();
    if (await page.locator("#root").getAttribute("data-table-calls") !== "0") throw Error("Denied row executed");
    await page.evaluate(() => window.webConformance.tableInvocation("pending"));
    await page.getByRole("row", { name: "First row", exact: true }).focus(); await page.keyboard.press("Enter"); await useRow.focus(); await page.keyboard.press("Space");
    const tableCancel = page.getByRole("button", { name: "Cancel action", exact: true }); await tableCancel.waitFor();
    if (await useRow.getAttribute("disabled") !== null || !(await page.getByRole("button", { name: "Other row action", exact: true }).isDisabled())) throw Error("Table group pending guard/reachability is wrong");
    await page.keyboard.press("Tab"); if (!(await tableCancel.evaluate(node => node === document.activeElement))) throw Error("Table cancel unreachable by Tab");
    await page.keyboard.press("Enter"); await useRow.focus(); await page.keyboard.press("Enter");
    if (await page.locator("#root").getAttribute("data-table-calls") !== "1" || await page.locator("#root").getAttribute("data-table-aborted") !== "true") throw Error("Table cancellation lost duplicate guard/signal");
    await tableCancel.focus(); await page.evaluate(() => window.webConformance.tableSettle()); await tableCancel.waitFor({ state: "hidden" });
    if (!(await useRow.evaluate(node => node === document.activeElement))) throw Error("Table cancel failed focus return");
    await page.evaluate(() => window.webConformance.formInvocation("allow"));
    const formInput = page.getByRole("textbox", { name: "Name", exact: true });
    const formSave = page.getByRole("button", { name: "Save current", exact: true });
    await formInput.fill("raw/e\u0301"); await page.keyboard.press("Enter");
    await page.getByRole("status").filter({ hasText: "Action completed." }).waitFor();
    if (await page.locator("#root").getAttribute("data-form-value") !== "raw/e\u0301" || await formInput.inputValue() !== "raw/e\u0301") throw Error("Form lost raw current input");
    await page.evaluate(() => window.webConformance.formInvocation("deny"));
    await formSave.focus(); await page.keyboard.press("Space");
    await page.getByRole("alert").filter({ hasText: "Action denied" }).waitFor();
    if (await page.locator("#root").getAttribute("data-form-calls") !== "0") throw Error("Denied form executed");
    await page.evaluate(() => window.webConformance.formInvocation("pending"));
    await formInput.fill("keep input"); await formSave.focus(); await page.keyboard.press("Enter");
    const formCancel = page.getByRole("button", { name: "Cancel action", exact: true }); await formCancel.waitFor();
    if (!(await formInput.isDisabled()) || await formSave.getAttribute("disabled") !== null) throw Error("Form pending reachability is wrong");
    await page.keyboard.press("Tab"); if (!(await formCancel.evaluate(node => node === document.activeElement))) throw Error("Form cancellation unreachable by Tab");
    await page.keyboard.press("Enter"); if (await page.locator("#root").getAttribute("data-form-aborted") !== "true") throw Error("Form cancellation did not abort");
    await formSave.focus(); await page.keyboard.press("Enter");
    if (await page.locator("#root").getAttribute("data-form-calls") !== "1") throw Error("Form duplicated noncooperative work");
    await formCancel.focus(); await page.evaluate(() => window.webConformance.formSettle()); await formCancel.waitFor({ state: "hidden" });
    if (!(await formSave.evaluate(node => node === document.activeElement)) || await formInput.isDisabled() || await formInput.inputValue() !== "keep input") throw Error("Form lost focus/input after cancellation");
    await page.evaluate(() => window.webConformance.invocation("allow"));
    const invocationButton = page.getByRole("button", { name: "Admitted copy" });
    await invocationButton.focus(); await page.keyboard.press("Enter");
    await page.getByRole("status").filter({ hasText: "Action completed." }).waitFor();
    if (await page.locator("#root").getAttribute("data-calls") !== "1" || await page.locator("a[href]").count()) throw Error("Invocation fell back or duplicated");
    await page.evaluate(() => window.webConformance.invocation("deny"));
    await invocationButton.focus(); await page.keyboard.press("Space");
    await page.getByRole("alert").filter({ hasText: "Action denied" }).waitFor();
    if (await page.locator("#root").getAttribute("data-calls") !== "0") throw Error("Denied capability ran");
    await page.evaluate(() => window.webConformance.invocation("pending"));
    await invocationButton.focus(); await page.keyboard.press("Enter");
    const cancel = page.getByRole("button", { name: "Cancel action" }); await cancel.waitFor();
    await page.keyboard.press("Tab"); if (!(await cancel.evaluate(node => node === document.activeElement))) throw Error("Cancel unreachable by Tab");
    await page.keyboard.press("Enter");
    if (await page.locator("#root").getAttribute("data-aborted") !== "true") throw Error("Cancel did not abort capability");
    await invocationButton.focus(); await page.keyboard.press("Enter");
    if (await page.locator("#root").getAttribute("data-calls") !== "1") throw Error("Cancellation released pending duplicate guard");
    await cancel.focus(); await page.evaluate(() => window.webConformance.invocationSettle());
    await cancel.waitFor({ state: "hidden" });
    if (!(await invocationButton.evaluate(node => node === document.activeElement))) throw Error("Cancel settlement failed focus return");
    await page.evaluate(() => window.webConformance.gallery());
    await page.locator("img").first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => {
      const grid = document.querySelector(".mer-gallery"), cards = [...grid.querySelectorAll("article")];
      const boxes = cards.map(card => card.getBoundingClientRect());
      if (getComputedStyle(grid).display !== "grid" || boxes.length !== 3) throw new Error("Gallery is not a card grid");
      if (!boxes.every(box => Math.abs(box.top - boxes[0].top) < 1) || boxes[1].left <= boxes[0].left) throw new Error("Wide gallery does not form columns");
      if (getComputedStyle(grid).gap !== "32px" || getComputedStyle(cards[0]).padding !== "24px") throw new Error("Gallery spacing ignores theme units");
      for (const card of cards) if (card.querySelector("img").getBoundingClientRect().width > card.getBoundingClientRect().width) throw new Error("Image overflows its card");
    });
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement.textContent) !== "Open card 1") throw new Error("Gallery link is not keyboard reachable");
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(".mer-gallery-card")].map(card => card.getBoundingClientRect());
      if (!boxes.every(box => Math.abs(box.left - boxes[0].left) < 1) || boxes[1].top <= boxes[0].top) throw new Error("Narrow gallery does not stack");
      if (document.documentElement.scrollWidth > innerWidth) throw new Error("Narrow gallery overflows horizontally");
    });
    await page.evaluate(() => window.webConformance.viewLayout("tabbed"));
    const alpha = page.getByRole("tab", { name: /^Alpha/ }), beta = page.getByRole("tab", { name: /^Beta/ });
    await alpha.focus(); await page.keyboard.press("ArrowRight");
    if (!await beta.evaluate(tab => tab === document.activeElement) || await alpha.getAttribute("aria-selected") !== "true") throw new Error("Tabs did not separate focus from activation");
    if (JSON.stringify(await page.evaluate(() => window.webConformance.viewCalls)) !== '["Alpha"]') throw new Error("Inactive tab fetched before activation");
    await page.keyboard.press("Enter"); await page.getByText("Beta body", { exact: true }).waitFor();
    if (await beta.getAttribute("aria-selected") !== "true") throw new Error("Enter failed to activate a tab");
    await page.keyboard.press("Home"); await page.keyboard.press("Space");
    await page.getByText("Alpha body", { exact: true }).waitFor();
    if (JSON.stringify(await page.evaluate(() => window.webConformance.viewCalls)) !== '["Alpha","Beta","Alpha"]') throw new Error("Tab activation lost its read lifecycle");
    await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const ids = tabs.map(tab => tab.id).concat([...document.querySelectorAll('[role="tabpanel"]')].map(panel => panel.id));
      if (new Set(ids).size !== ids.length) throw new Error("Reused slot IDs collided in tab associations");
      for (const tab of tabs) {
        const panel = document.getElementById(tab.getAttribute("aria-controls"));
        if (!panel || panel.getAttribute("aria-labelledby") !== tab.id) throw new Error("Tab/panel association is invalid");
        const box = tab.getBoundingClientRect();
        if (box.width > innerWidth || tab.scrollWidth > tab.clientWidth + 1) throw new Error("Long tab label is clipped");
      }
      if (document.documentElement.scrollWidth > innerWidth) throw new Error("Narrow tab view overflows horizontally");
      if (!document.querySelector("header [data-slot=header]")) throw new Error("Pinned header became a tab");
      if (document.querySelectorAll('[role="tab"]').length !== 2) throw new Error("Persistent region became a tab");
    });
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.evaluate(() => window.webConformance.viewLayout("twoColumn"));
    await page.evaluate(() => {
      const main = document.querySelector(".meridian-uiview-col-main").getBoundingClientRect();
      const side = document.querySelector(".meridian-uiview-col-sidebar").getBoundingClientRect();
      if (side.left <= main.left || Math.abs(side.top - main.top) > 1) throw new Error("Wide main/sidebar layout does not form columns");
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => {
      const main = document.querySelector(".meridian-uiview-col-main").getBoundingClientRect();
      const side = document.querySelector(".meridian-uiview-col-sidebar").getBoundingClientRect();
      if (side.top < main.bottom || Math.abs(side.left - main.left) > 1) throw new Error("Narrow sidebar did not stack after main");
      if (document.documentElement.scrollWidth > innerWidth) throw new Error("Narrow columns overflow horizontally");
    });
    await page.evaluate(() => window.webConformance.steps());
    await page.getByText("Keep the frame summary", { exact: true }).waitFor({ state: "visible" });
    for (const text of ["Keep the narration", "First", "Second", "Start here", "Finish here"]) await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
    if (await page.locator("ol > li").count() !== 2 || await page.locator("img").count() !== 0) throw new Error("Failed step lost its ordered structure");
    if (await page.getByRole("button", { name: "Continue", exact: true }).count() !== 1 || await page.locator('a[href="/next"]').count()) throw new Error("Step bypassed admitted button action");
    await page.evaluate(() => {
      window.webConformance.typography();
      const root = document.getElementById("root");
      const heading = document.createElement("h2");
      heading.className = "meridian-uiview-header";
      heading.textContent = "Themed heading";
      const body = document.createElement("p");
      body.textContent = "Themed body";
      root.append(heading, body);
      if (getComputedStyle(root).fontSize !== "19px") throw new Error("Typography base size was dropped");
      if (getComputedStyle(heading).fontWeight !== "700") throw new Error("Typography heading weight was dropped");
      if (getComputedStyle(body).fontWeight !== "500") throw new Error("Typography body weight was dropped");
      window.webConformance.resetTheme();
      if (getComputedStyle(body).fontWeight !== "400") throw new Error("Unset body weight lost neutral fallback");
      if (getComputedStyle(root).fontSize !== "14px" || getComputedStyle(heading).fontWeight !== "600") throw new Error("Replacement theme retained old typography");
    });
    await page.evaluate(() => window.webConformance.gallery());
    await page.evaluate(() => {
      const root = document.getElementById("root"), grid = root.querySelector(".mer-gallery");
      const card = grid.querySelector("article");
      window.webConformance.metricsScale();
      if (getComputedStyle(grid).gap !== "13.5px" || getComputedStyle(card).padding !== "9px") throw new Error("Scale and density did not reach real gallery geometry");
      if (getComputedStyle(card).borderTopWidth !== "0px") throw new Error("Explicit zero stroke was lost");
      if (getComputedStyle(root).fontSize !== "14px" || getComputedStyle(card).borderRadius !== "8px") throw new Error("Density scaled typography or radius");
    });
    await page.getByRole("link", { name: "Open card 1", exact: true }).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await page.evaluate(() => {
      const link = document.activeElement;
      if (!link.matches(".mer-gallery-card-link:focus-visible") || getComputedStyle(link).outlineWidth !== "2px") throw new Error("Zero decorative stroke removed keyboard focus");
      const root = document.getElementById("root"), grid = root.querySelector(".mer-gallery");
      const card = grid.querySelector("article");
      window.webConformance.resetTheme();
      if (getComputedStyle(grid).gap !== "32px" || getComputedStyle(card).borderTopWidth !== "1px") throw new Error("Replacement retained scale/density/stroke");
      window.webConformance.metrics();
      if (getComputedStyle(grid).gap !== "64px" || getComputedStyle(card).borderRadius !== "20px") throw new Error("Metrics were not applied");
      window.webConformance.resetTheme();
      if (getComputedStyle(grid).gap !== "32px" || getComputedStyle(card).borderRadius !== "8px") throw new Error("Replacement theme retained old Metrics or lost host spacing");
      if (root.style.getPropertyValue("--mer-unit") !== "8px") throw new Error("Pre-theme host spacing was not restored");
      root.style.setProperty("--mer-unit", "7px", "important");
      if (root.style.getPropertyPriority("--mer-unit") !== "important") throw new Error("Browser did not preserve priority in test setup");
      window.webConformance.metrics();
      window.webConformance.metrics();
      window.webConformance.resetTheme();
      if (root.style.getPropertyValue("--mer-unit") !== "7px" || root.style.getPropertyPriority("--mer-unit") !== "important") throw new Error("Pre-theme host priority was not restored");
      window.webConformance.metrics();
      root.style.setProperty("--mer-unit", "11px", "important");
      window.webConformance.metrics();
      window.webConformance.resetTheme();
      if (root.style.getPropertyValue("--mer-unit") !== "11px" || root.style.getPropertyPriority("--mer-unit") !== "important") throw new Error("Latest host override priority was not restored");
    });
    await page.evaluate(() => {
      const root = document.getElementById("root");
      const colors = { fg: "rgb(1, 2, 3)", info: "rgb(4, 5, 6)", success: "rgb(7, 8, 9)", warning: "rgb(10, 11, 12)", danger: "rgb(13, 14, 15)", accent: "rgb(16, 17, 18)" };
      Object.entries(colors).forEach(([role, color]) => root.style.setProperty(`--mer-${role}`, color));
      for (const { tone, role, palette } of [...window.webConformance.toneCases, { tone: 999, role: "neutral", palette: "fg" }]) {
        for (const state of [0, 1, 2]) {
          window.webConformance.conversationTone(tone, state);
          const marker = root.querySelector(state === 0 ? ".tool .spin" : ".tool .dot"), status = root.querySelector(".status.on");
          const expected = colors[palette];
          if (!expected) throw new Error(`Missing independent color expectation for Palette.${palette}`);
          if (!marker || !status || getComputedStyle(marker)[state === 0 ? "borderTopColor" : "backgroundColor"] !== expected || getComputedStyle(status).color !== expected)
            throw new Error(`Conversation Tone ${tone}: marker=${marker && getComputedStyle(marker).backgroundColor}, status=${status && getComputedStyle(status).color}, expected=${expected}`);
          if (Boolean(root.querySelector(".tool.err")) !== (state === 2)) throw new Error("Tone changed tool operational state");
          if (marker.getAttribute("aria-label") !== ["RUNNING", "OK", "ERROR"][state] || marker.getAttribute("title") !== ["RUNNING", "OK", "ERROR"][state])
            throw new Error("Tone hid the non-color tool state label");
          if (root.querySelector(".tool").getAttribute("data-mer-tone") !== role)
            throw new Error("Conversation Tone attribute is not canonical");
        }
      }
      window.webConformance.conversationTone();
      if (root.querySelector(".tool").hasAttribute("data-mer-tone") || getComputedStyle(root.querySelector(".dot.err")).backgroundColor !== "rgb(239, 68, 68)")
        throw new Error("Absent conversation Tone changed legacy error styling");
    });
    await page.evaluate(async () => {
      const colors = { fg: "rgb(1, 2, 3)", info: "rgb(4, 5, 6)", success: "rgb(7, 8, 9)", warning: "rgb(10, 11, 12)", danger: "rgb(13, 14, 15)", accent: "rgb(16, 17, 18)" };
      const cases = [...window.webConformance.toneCases, { tone: undefined, palette: "fg" }, { tone: 999, palette: "fg" }];
      for (const emphasis of [undefined, 0, 1, 2, 999]) for (const { tone, palette } of cases) {
        await window.webConformance.affordance(tone, emphasis);
        const control = document.querySelector(".mer-affordance"), computed = getComputedStyle(control);
        control.click();
        if (control.hasAttribute("href") || document.getElementById("root").dataset.destination !== "/next") throw new Error("Presentation changed admitted destination");
        if (!colors[palette]) throw new Error(`Missing independent color expectation for Palette.${palette}`);
        if (tone !== undefined && computed.color !== colors[palette]) throw new Error(`Affordance Tone ${tone} was dropped`);
        if (tone === undefined && control.hasAttribute("data-mer-tone")) throw new Error("Missing Tone gained a semantic role");
        if (emphasis !== undefined && (computed.fontWeight !== (emphasis === 1 ? "700" : "500") || computed.borderWidth !== (emphasis === 1 ? "2px" : "1px")))
          throw new Error("Affordance emphasis presence was dropped");
      }
      await window.webConformance.affordance(5, 1, true);
      if (!document.querySelector(".mer-affordance").disabled) throw new Error("Presentation enabled a denied URI");
    });
    console.log("Web-components layouts, theme replacement, conversation and Affordance presentation passed.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });

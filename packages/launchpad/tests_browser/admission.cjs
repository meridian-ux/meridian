const fs = require("node:fs");
const path = require("node:path");
// Explicit test-only reuse of the existing pinned browser driver.
const { chromium } = require("../../mui-kit/node_modules/playwright");
(async () => {
  const browser = await chromium.launch({ executablePath: path.resolve(process.argv[2]), headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(process.argv[3]), "utf8") });
    const data = key => page.locator("#root").getAttribute(`data-${key}`);
    const waitData = (key, value) => page.waitForFunction(({ key, value }) => document.getElementById("root").dataset[key] === value, { key, value: String(value) });
    const search = page.getByRole("combobox", { name: "Search commands" });
    const start = async mode => { await page.evaluate(mode => window.launchpadStart(mode), mode); await page.getByRole("button", { name: "Open palette" }).click(); await search.waitFor(); };
    await start("allow");
    if (!(await search.evaluate(node => node === document.activeElement))) throw Error("Search not focused on open");
    await page.keyboard.press("ArrowDown");
    const selected = await search.getAttribute("aria-activedescendant");
    if (await page.locator(`[id="${selected}"]`).getAttribute("aria-label") !== "Copy 1") throw Error("Arrow navigation lost canonical row");
    await page.keyboard.press("Enter"); await waitData("runs", 1);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    if (!(await page.locator("#opener").evaluate(node => node === document.activeElement))) throw Error("Success did not restore opener focus");
    if (await data("calls") !== "1" || await data("closes") !== "1" || await data("legacy") !== "0") throw Error("Wrong effect/close/legacy outcome");
    await start("deny"); await page.keyboard.press("Enter");
    await page.getByRole("alert").filter({ hasText: "target policy" }).waitFor();
    if (await data("calls") !== "0" || await data("closes") !== "0" || await data("runs") !== "0") throw Error("Denial closed/notified/executed");
    await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
    await start("pending"); await page.keyboard.press("Enter"); await waitData("calls", 1);
    const cancel = page.getByRole("button", { name: "Cancel action" }); await cancel.waitFor();
    if (await page.getByRole("option", { name: "Copy 0" }).getAttribute("disabled") !== null
      || !(await page.getByRole("option", { name: "Copy 1" }).isDisabled())) throw Error("Incorrect pending reachability/serialization");
    await page.keyboard.press("Tab");
    if (!(await cancel.evaluate(node => node === document.activeElement))) throw Error("Tab cannot reach cancellation");
    await page.keyboard.press("Enter"); await waitData("aborted", "true");
    await search.focus(); await page.keyboard.press("Enter");
    if (await data("calls") !== "1") throw Error("Pending effect duplicated");
    await cancel.focus(); await page.evaluate(() => window.launchpadSettle());
    await cancel.waitFor({ state: "detached" });
    if (!(await search.evaluate(node => node === document.activeElement))) throw Error("Cancel settlement lost search focus");
    if (await data("runs") !== "0" || await data("closes") !== "0") throw Error("Canceled effect closed/notified");
    // The group survives query invalidation and explicit close/reopen.
    await page.keyboard.press("Enter"); await waitData("calls", 2);
    await search.fill("discoverable"); await waitData("aborted", "true");
    await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Open palette" }).click(); await search.waitFor(); await page.keyboard.press("Enter");
    if (await data("calls") !== "2" || !(await page.getByRole("option", { name: "Copy 0" }).isDisabled())) throw Error("Reopen lost noncooperative guard");
    await page.evaluate(() => window.launchpadSettle());
    await page.waitForFunction(() => !document.querySelector('[role="option"]').hasAttribute("disabled"));
    if (await data("legacy") !== "0" || await data("runs") !== "0" || errors.length) throw Error(`Legacy/late notification/error: ${errors.join("; ")}`);
    console.log("Standalone Launchpad Chrome: canonical ranking, keyboard, denial, success-only close, cancellation, focus, query/close/reopen guard pass.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

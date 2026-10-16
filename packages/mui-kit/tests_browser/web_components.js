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
    await page.evaluate(() => window.webConformance.steps());
    await page.getByText("Keep the frame summary", { exact: true }).waitFor({ state: "visible" });
    for (const text of ["Keep the narration", "First", "Second", "Start here", "Finish here"]) await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
    if (await page.locator("ol > li").count() !== 2 || await page.locator("img").count() !== 0) throw new Error("Failed step lost its ordered structure");
    if (await page.getByRole("link", { name: "Continue", exact: true }).getAttribute("href") !== "/next") throw new Error("Step lost its action");
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
      const roles = ["fg", "fg", "info", "success", "warning", "danger", "accent"];
      const colors = ["rgb(1, 2, 3)", "rgb(1, 2, 3)", "rgb(4, 5, 6)", "rgb(7, 8, 9)", "rgb(10, 11, 12)", "rgb(13, 14, 15)", "rgb(16, 17, 18)"];
      roles.forEach((role, index) => root.style.setProperty(`--mer-${role}`, colors[index]));
      for (const tone of [0, 1, 2, 3, 4, 5, 6, 999]) {
        window.webConformance.conversationTone(tone);
        const marker = root.querySelector(".tool .dot.err"), status = root.querySelector(".status.on");
        const expected = colors[tone <= 6 ? tone : 0];
        if (!marker || !status || getComputedStyle(marker).backgroundColor !== expected || getComputedStyle(status).color !== expected)
          throw new Error(`Conversation Tone ${tone}: marker=${marker && getComputedStyle(marker).backgroundColor}, status=${status && getComputedStyle(status).color}, expected=${expected}`);
        if (root.querySelector(".tool").getAttribute("data-mer-tone") !== (tone <= 1 || tone === 999 ? "neutral" : roles[tone]))
          throw new Error("Conversation Tone attribute is not canonical");
      }
      window.webConformance.conversationTone();
      if (root.querySelector(".tool").hasAttribute("data-mer-tone") || getComputedStyle(root.querySelector(".dot.err")).backgroundColor !== "rgb(239, 68, 68)")
        throw new Error("Absent conversation Tone changed legacy error styling");
    });
    console.log("Web-components layouts, typography, theme replacement, and conversation semantic Tone colors passed.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });

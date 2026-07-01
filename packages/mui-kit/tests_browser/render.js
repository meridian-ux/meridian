// Real-browser UI test — 0 tolerance for UI mishaps.
//
// Loads the fixture harness bundle into hermetic Chrome for Testing (the @chrome
// binary from rules_chrome, driven by Playwright directly — the same launch path
// as rules_chrome's non-macro smoke) and asserts what actually renders + how it
// behaves: every primitive + layout, plus the interactions jsdom can't prove
// (pagination clicks re-fetch the next page, tabs switch content, forms edit).
//
//   argv[2] = @chrome//:chrome launcher path
//   argv[3] = the harness bundle path

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const chromePath = path.resolve(process.argv[2]);
const bundlePath = path.resolve(process.argv[3]);
const bundle = fs.readFileSync(bundlePath, "utf8");
const html =
  '<!doctype html><html><head><meta charset="utf-8"><title>meridian</title></head>' +
  '<body style="margin:0"><div id="root"></div>' +
  "<script>" +
  bundle +
  "</script></body></html>";

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log("  ✓", name);
  } catch (err) {
    failures.push(name);
    console.error("  ✗", name, "—", err.message);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.meridianHarness, null, { timeout: 15000 });

    const render = (name) => page.evaluate((n) => window.meridianHarness.render(n), name);
    const seen = (text) =>
      page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 8000 });
    const absent = async (text) => {
      if ((await page.getByText(text, { exact: false }).count()) > 0) {
        throw new Error(`expected "${text}" to be absent`);
      }
    };

    // ── Table · client pagination ──
    await check("table-client: MUI headers + populated rows", async () => {
      await render("table-client");
      await seen("Name");
      await seen("Status");
      await seen("Widget");
      await seen("Gadget");
    });
    await check("table-client: header actions render (ActionBar)", async () => {
      await seen("Edit");
      await seen("Export YAML");
    });

    // ── Table · OFFSET pagination (re-fetch on next) ──
    await check("table-offset: page 1 then advance to page 2 via the pager", async () => {
      await render("table-offset");
      await seen("Widget");
      await absent("Gizmo");
      await page.getByRole("button", { name: /go to next page/i }).click();
      await seen("Gizmo");
      await seen("Sprocket");
    });

    // ── Table · CURSOR pagination (aion's preferred) ──
    await check("table-cursor: first page then advance via opaque cursor", async () => {
      await render("table-cursor");
      await seen("Widget");
      await absent("Gizmo");
      await page.getByRole("button", { name: /go to next page/i }).click();
      await seen("Gizmo");
      await seen("Sprocket");
    });

    // ── Form · read-only ──
    await check("form-readonly: MUI field labels render", async () => {
      await render("form-readonly");
      await seen("Product Type");
      await seen("Review Status");
      await seen("Attributes");
    });

    // ── Form · editable (inputs enabled + Save) ──
    await check("form-edit: editable inputs + Save button", async () => {
      await render("form-edit");
      await seen("Product Type");
      await seen("Save");
      const input = page.locator("input").first();
      await input.fill("physical");
      if ((await input.inputValue()) !== "physical") throw new Error("input not editable");
    });

    // ── Prompt ──
    await check("prompt: description + field + accept label", async () => {
      await render("prompt");
      await seen("Region");
      await seen("Continue");
    });

    // ── LRO ──
    await check("lro: run button + input", async () => {
      await render("lro");
      await seen("Count");
      await seen("Generate");
    });

    // ── Fallback ──
    await check("fallback: empty panel renders the fallback affordance", async () => {
      await render("fallback");
      await seen("empty panel");
    });

    // ── Layout · stacked (header above configuration) ──
    await check("layout-stacked: adhoc header + form, ordered", async () => {
      await render("layout-stacked");
      await seen("Widget — product");
      await seen("Product Type");
      const headerBox = await page.getByText("Widget — product").first().boundingBox();
      const formBox = await page.getByText("Attributes").first().boundingBox();
      if (!headerBox || !formBox || headerBox.y >= formBox.y) {
        throw new Error("header not above form");
      }
    });

    // ── Layout · tabbed (switch tabs) ──
    await check("layout-tabbed: tabs switch content", async () => {
      await render("layout-tabbed");
      await seen("Overview");
      await seen("Items");
      await seen("Product Type");
      await page.getByRole("tab", { name: "Items" }).click();
      await seen("Widget");
    });

    // ── Layout · two-column (main + sidebar both present) ──
    await check("layout-two-column: main table + sidebar form", async () => {
      await render("layout-two-column");
      await seen("Widget");
      await seen("Product Type");
    });
  } finally {
    await browser.close();
  }

  console.log("");
  if (failures.length) {
    console.error(`${failures.length} UI failure(s): ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("All browser UI checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
